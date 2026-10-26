import { Injectable, Logger } from '@nestjs/common';
import { BOT_NAME } from '../bot.config';
import { MessageDto } from './chat.dto';
import { Domain } from './chat.types';
import { LlmService, Provider } from './llm.service';

export type Decision =
  | { type: 'general' }
  | { type: 'unsupported' }
  | { type: 'law'; domains: Domain[] };

const clip = (s: string, n = 300) => (s.length > n ? s.slice(0, n) + '…' : s);

/**
 * Decides, for every message: is it a legal question? If so, which knowledge
 * base(s) can answer it? The list of knowledge bases comes from the search
 * service, so adding a .jsonl file needs no change here.
 */
@Injectable()
export class RouterService {
  private readonly logger = new Logger(RouterService.name);

  constructor(private readonly llm: LlmService) {}

  async route(messages: MessageDto[], domains: Domain[]): Promise<Decision> {
    const provider = (process.env.ROUTER_PROVIDER ?? 'gemini') as Provider;
    const model =
      provider === 'gemini'
        ? (process.env.ROUTER_MODEL ?? 'gemini-flash-lite-latest')
        : undefined;

    let raw: string;
    try {
      raw = await this.llm.complete(
        provider,
        this.systemPrompt(domains),
        [{ role: 'user', content: this.userPrompt(messages) }],
        { temperature: 0, model, json: true },
      );
    } catch (e) {
      this.logger.warn(`Router call failed (${(e as Error).message})`);
      return this.fallback(domains);
    }

    const parsed = this.parse(raw);
    if (!parsed) {
      this.logger.warn(`Router returned something unreadable: ${clip(raw, 200)}`);
      return this.fallback(domains);
    }
    if (parsed.category === 'general') return { type: 'general' };

    const byId = new Map(domains.map((d) => [d.id.toLowerCase(), d]));
    const picked = [...new Set(parsed.ids)]
      .map((id) => byId.get(id))
      .filter((d): d is Domain => !!d)
      .slice(0, 2);
    return picked.length ? { type: 'law', domains: picked } : { type: 'unsupported' };
  }

  /** If routing itself fails, stay safe: answer only from the law databases. */
  private fallback(domains: Domain[]): Decision {
    this.logger.warn('Falling back to searching every law database.');
    return domains.length ? { type: 'law', domains } : { type: 'general' };
  }

  private systemPrompt(domains: Domain[]): string {
    const list = domains.length
      ? domains
          .map((d) => {
            const acts = d.acts.slice(0, 20).map((a) => clip(a, 90)).join('; ');
            const more = d.acts.length > 20 ? ` (+${d.acts.length - 20} more)` : '';
            return `- ${d.id}: ${d.label}. ${d.description ? d.description + ' ' : ''}Acts include: ${acts}${more}`;
          })
          .join('\n')
      : '(none)';

    return [
      `You are the routing step of ${BOT_NAME}, a Bangladesh legal assistant.`,
      'Read the conversation and decide how the LATEST user message must be handled.',
      '',
      'Legal knowledge bases available:',
      list,
      '',
      'Reply with ONLY a JSON object: {"category": "law" | "general", "domains": ["<id>", ...]}',
      '',
      'Rules:',
      '- "law": the message asks about laws, legal rules, rights, offences, penalties, legal procedure, courts, Acts or sections.',
      '- "general": everything else (greetings, small talk, coding, maths, science, recipes, news, opinions, advice that is not about the law).',
      '- Questions about the assistant itself (its name, who it is, who made it, what it can do) are "general".',
      '- "domains": for "law", the ids from the list above that could contain the answer. Pick 1, or at most 2 if the question truly spans two areas. Use [] if it is a legal question but no knowledge base fits. For "general" use [].',
      '- A short follow-up (for example "and what is the penalty?") belongs to the same topic as the earlier messages. Use them to decide.',
    ].join('\n');
  }

  private userPrompt(messages: MessageDto[]): string {
    const latest = messages[messages.length - 1]?.content ?? '';
    const earlier = messages
      .slice(-5, -1)
      .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${clip(m.content)}`)
      .join('\n');
    return `${earlier ? `Earlier messages:\n${earlier}\n\n` : ''}Latest user message:\n${clip(latest, 1500)}`;
  }

  private parse(raw: string): { category: 'law' | 'general'; ids: string[] } | null {
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      const j = JSON.parse(m[0]);
      const category = String(j.category ?? '').toLowerCase();
      if (category !== 'law' && category !== 'general') return null;
      const ids = Array.isArray(j.domains)
        ? j.domains.map((x: unknown) => String(x).toLowerCase().trim())
        : [];
      return { category, ids };
    } catch {
      return null;
    }
  }
}
