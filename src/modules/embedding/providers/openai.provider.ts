// OPENAI PRODUCTION PROVIDER
//
// Used in production via EMBEDDING_PROVIDER=openai in .env
// Model: text-embedding-3-small → 1536 dimensions
// BATCHING:
// OpenAI accepts up to 2048 inputs per request. We cap at 100 per batch
// to stay well within limits. Sequential batches if more than 100 texts.
//
// RESPONSE ORDERING:
// OpenAI does NOT guarantee response order matches input order.
// Each response item has an `index` field — we sort by it before returning.
//
// DIMENSIONS NOTE:
// text-embedding-3-small produces 1536 dimensions.
// Chunk.embedding column must be vector(1536) in production.
// Chunk.embedding column must be vector(768) in local dev (Ollama).
// Use separate migration files or a conditional schema for each environment.

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService }      from '@nestjs/config';
import { EmbeddingProvider }  from '../embedding-provider.interface';

const BATCH_SIZE = 100;

@Injectable()
export class OpenAIProvider implements EmbeddingProvider {
  private readonly logger  = new Logger(OpenAIProvider.name);
  private readonly apiKey:  string;
  private readonly baseUrl: string;
  private readonly model:   string;

  readonly providerName = 'openai';
  readonly dimensions   = 1536; // text-embedding-3-small

  constructor(private readonly config: ConfigService) {
    this.apiKey  = config.get<string>('OPENAI_API_KEY', '');
    this.baseUrl = config.get<string>('OPENAI_API_BASE', 'https://api.openai.com/v1');
    this.model   = config.get<string>('OPENAI_EMBED_MODEL', 'text-embedding-3-small');
  }

  async embed(text: string): Promise<number[]> {
    const { embeddings } = await this.embedBatch([text]);
    return embeddings[0];
  }

  async embedBatch(texts: string[]): Promise<{ embeddings: number[][]; tokensUsed: number }> {
    if (!texts.length) return { embeddings: [], tokensUsed: 0 };
    if (!this.apiKey)  throw new Error('OPENAI_API_KEY is not configured');

    const allEmbeddings: number[][] = new Array(texts.length);
    let totalTokens = 0;

    // Process in batches of 100
    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const batch  = texts.slice(i, i + BATCH_SIZE);
      const result = await this.callAPI(batch);

      totalTokens += result.usage.total_tokens;

      // Sort by index — OpenAI does not guarantee response order
      result.data
        .sort((a: any, b: any) => a.index - b.index)
        .forEach((item: any, batchIdx: number) => {
          allEmbeddings[i + batchIdx] = item.embedding;
        });

      this.logger.debug('OpenAI batch processed', {
        batchIndex: Math.floor(i / BATCH_SIZE),
        batchSize:  batch.length,
        tokens:     result.usage.total_tokens,
      });
    }

    return { embeddings: allEmbeddings, tokensUsed: totalTokens };
  }

  private async callAPI(texts: string[]): Promise<any> {
    const response = await fetch(`${this.baseUrl}/embeddings`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body:   JSON.stringify({ model: this.model, input: texts }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`OpenAI embeddings API error ${response.status}: ${body}`);
    }

    return response.json();
  }
}