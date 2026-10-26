import {
  BadGatewayException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { MessageDto } from './chat.dto';

export type Provider = 'gemini' | 'lmstudio';

export interface LlmOptions {
  temperature?: number;
  /** Gemini model id (ignored for LM Studio, which uses LMSTUDIO_CHAT_MODEL). */
  model?: string;
  /** Ask Gemini for a JSON-only reply. */
  json?: boolean;
}

/** The only place that talks to Gemini / LM Studio chat endpoints. */
@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);

  complete(
    provider: Provider,
    system: string,
    history: MessageDto[],
    opts: LlmOptions = {},
  ): Promise<string> {
    return provider === 'gemini'
      ? this.gemini(system, history, opts)
      : this.lmStudio(system, history, opts);
  }

  async lmStudio(system: string, history: MessageDto[], opts: LlmOptions): Promise<string> {
    const base = process.env.LMSTUDIO_URL ?? 'http://localhost:1234/v1';
    const model = process.env.LMSTUDIO_CHAT_MODEL;
    if (!model) throw new InternalServerErrorException('LMSTUDIO_CHAT_MODEL is not set.');

    let res: Response;
    try {
      res = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          temperature: opts.temperature ?? 0.2,
          messages: [{ role: 'system', content: system }, ...history],
        }),
        signal: AbortSignal.timeout(180_000), // local models can be slow
      });
    } catch (err) {
      this.logger.error('LM Studio unreachable', err as Error);
      throw new BadGatewayException(
        'Could not reach LM Studio. Make sure its local server is running and a model is loaded.',
      );
    }
    if (!res.ok) {
      this.logger.error(`LM Studio ${res.status}: ${await res.text()}`);
      throw new BadGatewayException('LM Studio returned an error. Check its logs.');
    }
    const data: any = await res.json();
    const text: string = (data?.choices?.[0]?.message?.content ?? '')
      .replace(/<think>[\s\S]*?<\/think>/g, '')
      .trim();
    if (!text) throw new BadGatewayException('The model returned an empty answer.');
    return text;
  }

  async gemini(system: string, history: MessageDto[], opts: LlmOptions): Promise<string> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new InternalServerErrorException('GEMINI_API_KEY is not set in backend/.env.');
    }
    const model = opts.model ?? process.env.GEMINI_MODEL ?? 'gemini-flash-latest';
    const base =
      process.env.GEMINI_BASE_URL ?? 'https://generativelanguage.googleapis.com/v1beta';

    const generationConfig: Record<string, unknown> = {};
    if (opts.temperature !== undefined) generationConfig.temperature = opts.temperature;
    if (opts.json) generationConfig.responseMimeType = 'application/json';

    let res: Response;
    try {
      res = await fetch(`${base}/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: history.map((m) => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }],
          })),
          generationConfig,
        }),
        signal: AbortSignal.timeout(60_000),
      });
    } catch (err) {
      this.logger.error('Could not reach Gemini', err as Error);
      throw new BadGatewayException('Could not reach the AI service.');
    }
    if (res.status === 429) {
      throw new BadGatewayException(
        'The AI service is busy (rate limit reached). Please try again in a minute.',
      );
    }
    if (!res.ok) {
      this.logger.error(`Gemini ${res.status} (${model}): ${await res.text()}`);
      throw new BadGatewayException('The AI service returned an error. Check the server logs.');
    }
    const data: any = await res.json();
    const text = (data?.candidates?.[0]?.content?.parts ?? [])
      .map((p: { text?: string }) => p.text ?? '')
      .join('')
      .trim();
    if (!text) {
      throw new BadGatewayException('The AI service returned no answer. Try rephrasing.');
    }
    return text;
  }
}
