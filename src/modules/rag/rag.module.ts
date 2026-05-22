// src/modules/rag/rag.module.ts
//
// RagModule now imports McpModule so RagService can inject McpService.
// RagService no longer calls OpenAI/Ollama directly — all LLM calls
// go through the MCP pipeline.

import { Module }                  from '@nestjs/common';
import { RagService }              from './rag.service';
import { ContextAssemblerService } from './context-assembler.service';
import { McpModule }               from '../mcp/mcp.module';

@Module({
  imports:   [McpModule],       // provides McpService → injected into RagService
  providers: [RagService, ContextAssemblerService],
  exports:   [RagService, ContextAssemblerService],
})
export class RagModule {}