// src/modules/search/search.module.ts
//
// SEARCH MODULE wires SearchService with its dependencies.
// EmbeddingModule is imported so SearchService can embed the query
// using whichever provider is active (Ollama or OpenAI).

import { Module }         from '@nestjs/common';
import { SearchService }  from './search.service';
import { EmbeddingModule } from '../embedding/embedding.module';

@Module({
  imports:   [EmbeddingModule],
  providers: [SearchService],
  exports:   [SearchService],
})
export class SearchModule {}