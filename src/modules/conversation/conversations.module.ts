
// CONVERSATIONS MODULE — how the RAG pipeline connects to the API
//
// ConversationsService depends on:
//   RbacModule            — check user permissions for each action
//   SearchService         — embed the question, find relevant chunks
//   ContextAssemblerService — select chunks within token budget
//   RagService            — call GPT-4o (or Ollama) with assembled context
//   PrismaService         — save user + assistant messages transactionally
//
// The ConversationsController applies chatLimiter on
// POST /:id/messages to protect OpenAI spend.

import { Module }                  from '@nestjs/common';
import { ConversationsController } from './conversations.controller';
import { ConversationsService }    from './conversations.service';
import { SearchModule }            from '../search/search.module';
import { RagModule }               from '../rag/rag.module';
import { PrismaService }           from '../../database/prisma.service';
import { RbacModule } from '../rbac/rbac.module';

@Module({
  imports:     [ RbacModule, SearchModule, RagModule],
  controllers: [ConversationsController],
  providers:   [ConversationsService, PrismaService],
})
export class ConversationsModule {}