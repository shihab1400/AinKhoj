import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { ChatsController } from './chats.controller';
import { ChatsService } from './chats.service';
import { DomainsController } from './domains.controller';
import { LlmService } from './llm.service';
import { RetrievalService } from './retrieval.service';
import { RouterService } from './router.service';

@Module({
  controllers: [ChatController, ChatsController, DomainsController],
  providers: [ChatService, ChatsService, RetrievalService, RouterService, LlmService],
})
export class ChatModule {}
