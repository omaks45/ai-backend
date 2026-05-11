
// RAG MODULE wires together:
//   ContextAssemblerService — token budgeting + deduplication
//   RagService              — LLM call + cost tracking
//
// Both are exported so ConversationsModule can inject them directly.

import { Module }                   from '@nestjs/common';
import { RagService }               from './rag.service';
import { ContextAssemblerService }  from './context-assembler.service';

@Module({
  providers: [RagService, ContextAssemblerService],
  exports:   [RagService, ContextAssemblerService],
})
export class RagModule {}