
// WHY A DEDICATED EMBEDDING MODULE?
// Embedding generation is a cross-cutting concern used by both the ingestion
// pipeline (week 4) and the RAG query pipeline (week 4 day 3). By isolating it
// in its own module we follow the Single Responsibility Principle and make it
// easy to swap OpenAI for a different provider later.

import { Module } from '@nestjs/common';
import { EmbeddingService } from './embedding.service';
import { CacheModule } from '../cache/cache.module';

@Module({
  imports:   [CacheModule],
  providers: [EmbeddingService],
  exports:   [EmbeddingService],
})
export class EmbeddingModule {}
