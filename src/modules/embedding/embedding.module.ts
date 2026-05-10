
// Reads EMBEDDING_PROVIDER from .env and registers the correct provider.
//
// .env (development):
//   EMBEDDING_PROVIDER=ollama
//   OLLAMA_BASE_URL=http://localhost:11434
//
// .env (production):
//   EMBEDDING_PROVIDER=openai
//   OPENAI_API_KEY=sk-proj-...
//   OPENAI_BASE_URL=https://api.openai.com/v1
//
// No code changes needed when switching environments — only .env changes.
//
// pgvector NOTE:
//   chunks table vector column must match the active provider's dimensions.
//   Ollama → 768, OpenAI → 1536. If you switch providers in production,
//   you must re-embed all documents and recreate the pgvector index.

import { Module }          from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EmbeddingService }   from './embedding.service';
import { OllamaProvider }    from './providers/ollama-provider';
import { OpenAIProvider }    from './providers/openai.provider';
import { EMBEDDING_PROVIDER } from './embedding-provider.interface';
import { CacheModule }        from '../cache/cache.module';

@Module({
  imports: [ConfigModule, CacheModule],
  providers: [
    //  Eagerly register both providers so NestJS can inject them
    OllamaProvider,
    OpenAIProvider,

    //  Dynamic provider selection via factory
    {
      provide:    EMBEDDING_PROVIDER,
      useFactory: (
        config:  ConfigService,
        ollama:  OllamaProvider,
        openai:  OpenAIProvider,
      ) => {
        const provider = config.get<string>('EMBEDDING_PROVIDER', 'ollama').toLowerCase();

        if (provider === 'openai') {
          const key = config.get<string>('OPENAI_API_KEY', '');
          if (!key) {
            throw new Error(
              'EMBEDDING_PROVIDER=openai but OPENAI_API_KEY is not set. ' +
              'Add it to your .env file.',
            );
          }
          return openai;
        }

        if (provider === 'ollama') {
          return ollama;
        }

        throw new Error(
          `Unknown EMBEDDING_PROVIDER="${provider}". Valid values: ollama | openai`,
        );
      },
      inject: [ConfigService, OllamaProvider, OpenAIProvider],
    },

    EmbeddingService,
  ],
  exports: [EmbeddingService],
})
export class EmbeddingModule {}