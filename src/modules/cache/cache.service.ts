import { Injectable, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

// TTL constants (seconds) 
export const CACHE_TTL = {
  SHORT:     60,              // 1 minute  — rate limit windows, session data
  MEDIUM:    5 * 60,         // 5 minutes — user permissions, role lookups
  LONG:      60 * 60,        // 1 hour    — document metadata
  EMBEDDING: 7 * 24 * 60 * 60, // 7 days — embeddings (deterministic, expensive)
} as const;

export type CacheTTL = (typeof CACHE_TTL)[keyof typeof CACHE_TTL];

// Cache key builders (prevents typos, centralises naming) 
export const CacheKeys = {
  embedding:    (hash: string)   => `embed:${hash}`,
  userPerms:    (userId: string) => `perms:${userId}`,
  docStatus:    (docId: string)  => `doc:status:${docId}`,
  tokenBlocked: (jti: string)    => `blacklist:${jti}`,
  rateLimitKey: (key: string)    => `rl:${key}`,
} as const;

@Injectable()
export class CacheService implements OnModuleDestroy {
  private readonly logger = new Logger(CacheService.name);
  private readonly client: Redis;

  constructor(private readonly config: ConfigService) {
    this.client = new Redis({
      host: config.get<string>('REDIS_HOST', 'localhost'),
      port: config.get<number>('REDIS_PORT', 6379),
      lazyConnect: true,
    });

    this.client.on('error', (err) =>
      this.logger.error('Redis connection error', err),
    );
  }

  // Generic typed get/set

  async get<T>(key: string): Promise<T | null> {
    const raw = await this.client.get(key);
    if (!raw) return null;

    try {
      return JSON.parse(raw) as T;
    } catch {
      return raw as unknown as T;
    }
  }

  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    const serialized =
      typeof value === 'string' ? value : JSON.stringify(value);
    await this.client.setex(key, ttlSeconds, serialized);
  }

  async del(key: string): Promise<void> {
    await this.client.del(key);
  }

  async exists(key: string): Promise<boolean> {
    return (await this.client.exists(key)) === 1;
  }

  // Token blacklist (Redis SET with TTL)

  async blacklistToken(jti: string, ttlSeconds: number): Promise<void> {
    await this.client.setex(CacheKeys.tokenBlocked(jti), ttlSeconds, '1');
  }

  async isTokenBlacklisted(jti: string): Promise<boolean> {
    return this.exists(CacheKeys.tokenBlocked(jti));
  }

  // Sorted set helpers for rate limiting / tracking

  async sadd(key: string, ...members: string[]): Promise<number> {
    return this.client.sadd(key, ...members);
  }

  async scard(key: string): Promise<number> {
    return this.client.scard(key);
  }

  async expire(key: string, ttlSeconds: number): Promise<void> {
    await this.client.expire(key, ttlSeconds);
  }

  async incr(key: string): Promise<number> {
    return this.client.incr(key);
  }

  async ping(): Promise<string> {
    return this.client.ping();
  }

  /** Expose raw client for libraries that need it (e.g. rate-limit-redis) */
  getClient(): Redis {
    return this.client;
  }

  async onModuleDestroy() {
    await this.client.quit();
  }
}
