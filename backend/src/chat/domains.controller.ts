import { Controller, Get, UseGuards } from '@nestjs/common';
import { FirebaseAuthGuard } from '../auth/firebase-auth.guard';
import { RetrievalService } from './retrieval.service';

/** The law databases a user can pick in "Specific law" mode (one per .jsonl file). */
@Controller('domains')
@UseGuards(FirebaseAuthGuard)
export class DomainsController {
  constructor(private readonly retrieval: RetrievalService) {}

  @Get()
  async list() {
    const domains = await this.retrieval.domains();
    return domains.map(({ id, label, description }) => ({ id, label, description }));
  }
}
