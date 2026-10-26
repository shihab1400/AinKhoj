import { BadRequestException, Injectable } from '@nestjs/common';
import { BOT_NAME, identityLine } from '../bot.config';
import { AnswerMode, MessageDto } from './chat.dto';
import { Domain, RouteInfo, Source } from './chat.types';
import { LlmService, Provider } from './llm.service';
import { Hit, RetrievalService } from './retrieval.service';
import { RouterService } from './router.service';

const GENERAL_PROMPT = [
  identityLine(),
  'You are friendly and helpful. Answer clearly and concisely, in the same language the user writes in.',
].join(' ');

type Answer = { reply: string; sources: Source[]; route: RouteInfo };

@Injectable()
export class ChatService {
  constructor(
    private readonly retrieval: RetrievalService,
    private readonly router: RouterService,
    private readonly llm: LlmService,
  ) {}

  async reply(
    messages: MessageDto[],
    mode: AnswerMode = 'auto',
    domainId?: string,
  ): Promise<Answer> {
    // The user chose "General": no router, no search.
    if (mode === 'general') return this.general(messages);

    // The user picked one law database: no router, search only that one.
    if (mode === 'law') {
      const domain = (await this.retrieval.domains()).find((d) => d.id === domainId);
      if (!domain) {
        throw new BadRequestException(
          'That law database isn’t available any more. Pick another one or switch to Auto.',
        );
      }
      return this.law(messages, [domain]);
    }

    // Auto: ask the router. If the search service is down, general questions still work.
    let domains: Domain[] = [];
    let searchError: unknown = null;
    try {
      domains = await this.retrieval.domains();
    } catch (e) {
      searchError = e;
    }
    const decision = await this.router.route(messages, domains);
    if (searchError && decision.type !== 'general') throw searchError;

    // 1) Not a legal question -> Gemini
    if (decision.type === 'general') return this.general(messages);

    // 2) Legal, but none of our databases covers it -> don't guess
    if (decision.type === 'unsupported') {
      return {
        reply: this.unsupportedMessage(domains),
        sources: [],
        route: { type: 'unsupported', domains: [] },
      };
    }

    // 3) Legal and covered -> search the right database(s), answer only from them
    return this.law(messages, decision.domains);
  }

  private async general(messages: MessageDto[]): Promise<Answer> {
    const reply = await this.llm.complete(
      'gemini',
      GENERAL_PROMPT,
      this.recent(messages, 10),
      { model: process.env.GENERAL_MODEL ?? 'gemini-flash-latest' },
    );
    return { reply, sources: [], route: { type: 'general', domains: [] } };
  }

  private async law(messages: MessageDto[], domains: Domain[]): Promise<Answer> {
    const hits = await this.retrieval.search(
      this.buildQuery(messages),
      domains.map((d) => d.id),
    );
    const provider = (process.env.LLM_PROVIDER ?? 'lmstudio') as Provider;
    const reply = await this.llm.complete(
      provider,
      this.lawPrompt(hits),
      this.recent(messages, 6),
      { temperature: 0.2 },
    );
    return {
      reply,
      sources: hits.map(({ _text, ...s }) => s),
      route: {
        type: 'law',
        domains: domains.map((d) => ({ id: d.id, label: d.label })),
      },
    };
  }

  /** Last n turns, never starting with an assistant message. */
  private recent(messages: MessageDto[], n: number): MessageDto[] {
    const h = messages.slice(-n);
    while (h.length && h[0].role === 'assistant') h.shift();
    return h;
  }

  /** Short follow-ups ("and section 3?") are searched together with the previous question. */
  private buildQuery(messages: MessageDto[]): string {
    const users = messages.filter((m) => m.role === 'user');
    const last = users[users.length - 1]?.content ?? '';
    const prev = users[users.length - 2]?.content;
    return last.length < 40 && prev ? `${prev}\n${last}` : last;
  }

  private lawPrompt(hits: Hit[]): string {
    const excerpts = hits.length
      ? hits.map((h, i) => `[${i + 1}] ${h._text}`).join('\n\n')
      : '(no relevant excerpts were found)';
    return [
      identityLine(),
      'You answer questions about Bangladesh law using ONLY the excerpts below.',
      'Rules:',
      `- If the user only asks who you are or what your name is, just reply "I am ${BOT_NAME}, an AI assistant for Bangladesh law" in your own words; no excerpts are needed for that.`,
      '- Cite the Act and section number for every claim, e.g. (Public Examinations (Offences) Act, 1980, Section 2).',
      '- If the excerpts do not contain the answer, say you could not find it in the available laws. Never guess or use outside knowledge.',
      '- Do not invent section numbers or quotes.',
      '- Reply in the same language the user writes in. Be concise.',
      '- You give general information, not legal advice.',
      '',
      'EXCERPTS:',
      excerpts,
    ].join('\n');
  }

  private unsupportedMessage(domains: Domain[]): string {
    const covered = domains.map((d) => d.label).join(', ') || 'none yet';
    return (
      `This looks like a legal question, but it isn't about an area I (${BOT_NAME}) have laws for, so I won't guess. ` +
      `I currently cover Bangladesh: ${covered}. ` +
      `You can rephrase your question, or ask me something else.`
    );
  }
}
