import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { Domain, Source } from './chat.types';

export type Hit = Source & { _text: string };

/** Talks to the Python search service (one vector database per domain). */
@Injectable()
export class RetrievalService {
  private readonly logger = new Logger(RetrievalService.name);
  private cache: { at: number; domains: Domain[] } | null = null;

  private base() {
    return (process.env.RETRIEVAL_URL ?? 'http://localhost:8000').replace(/\/$/, '');
  }

  private async call<T>(path: string, init: RequestInit = {}): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.base()}${path}`, {
        ...init,
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(60_000),
      });
    } catch {
      throw new InternalServerErrorException(
        `Cannot reach the search service at ${this.base()}. Start it: python -m uvicorn server:app --port 8000`,
      );
    }
    if (!res.ok) {
      this.logger.error(`Search service ${res.status} on ${path}: ${await res.text()}`);
      this.cache = null;
      throw new InternalServerErrorException(
        res.status === 503
          ? 'No law databases yet. Run "python ingest.py" in the retrieval folder.'
          : 'The search service returned an error. Check its terminal.',
      );
    }
    return (await res.json()) as T;
  }

  /** Every available knowledge base. Cached briefly so new .jsonl files appear on their own. */
  async domains(): Promise<Domain[]> {
    if (this.cache && Date.now() - this.cache.at < 15_000) return this.cache.domains;
    const data = await this.call<{ domains: Domain[] }>('/domains');
    this.cache = { at: Date.now(), domains: data.domains };
    return data.domains;
  }

  async search(query: string, domainIds: string[]): Promise<Hit[]> {
    const labels = new Map((await this.domains()).map((d) => [d.id, d.label]));
    const k = Number(process.env.TOP_K ?? 5);
    const min = Number(process.env.MIN_SCORE ?? 0);

    const data = await this.call<{ results: any[] }>('/search', {
      method: 'POST',
      body: JSON.stringify({ query, k, domains: domainIds }),
    });
    return data.results
      .filter((r) => r.score >= min)
      .map(({ text, ...r }) => ({
        ...r,
        domain: labels.get(r.domain) ?? r.domain,
        _text: text,
      })) as Hit[];
  }
}
