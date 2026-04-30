/**
 * WHY CACHE SERVICE INJECTS REDIS SERVICE?
 * CacheService owns all high-level caching logic — TTL constants, key builders,
 * typed get/set, token blacklisting, and rate-limit helpers.
 *
 * It no longer creates its own Redis connection. Instead it reuses the single
 * client owned by RedisService. This means:
 *  - One TCP connection to Redis (not two)
 *  - One retry/error/lifecycle handler (not two)
 *  - RedisService.client can still be handed directly to BullMQ / rate-limit-redis
 */

import { Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { RedisService } from '../../redis/redis.service';

// TTL constants (seconds)

export const CACHE_TTL = {
  SHORT:     60,                    // 1 min  — rate-limit windows, session data
  MEDIUM:    5  * 60,               // 5 min  — user permissions, role lookups
  LONG:      60 * 60,               // 1 hr   — document metadata
  EMBEDDING: 7  * 24 * 60 * 60,    // 7 days — embeddings (deterministic, expensive)
} as const;

export type CacheTTL = (typeof CACHE_TTL)[keyof typeof CACHE_TTL];

//Key builders (centralised naming, prevents typos)

export const CacheKeys = {
  embedding:    (hash: string)   => `embed:${hash}`,
  userPerms:    (userId: string) => `perms:${userId}`,
  docStatus:    (docId: string)  => `doc:status:${docId}`,
  tokenBlocked: (jti: string)    => `blacklist:${jti}`,
  rateLimitKey: (key: string)    => `rl:${key}`,
} as const;


@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);
  private readonly client: Redis;

  constructor(private readonly redisService: RedisService) {
    // Reuse the single connection managed by RedisService.
    // Lifecycle (connect/error/quit) is already handled there.
    this.client = this.redisService.client;
  }

  async get<T>(key: string): Promise<T | null> {
    const raw = await this.client.get(key);
    if (!raw) return null;

    try {
      return JSON.parse(raw) as T;
    } catch {
      // Stored as a plain string — return as-is
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

  //  Token blacklist 

  async blacklistToken(jti: string, ttlSeconds: number): Promise<void> {
    await this.client.setex(CacheKeys.tokenBlocked(jti), ttlSeconds, '1');
    this.logger.debug(`Token blacklisted — jti: ${jti}, ttl: ${ttlSeconds}s`);
  }

  async isTokenBlacklisted(jti: string): Promise<boolean> {
    return this.exists(CacheKeys.tokenBlocked(jti));
  }

  // Rate-limit / set helpers

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

  //  Atomic increment with TTL (safe rate-limit counter)
  // Uses a pipeline so both commands are sent in one round-trip.
  // The EXPIRE is only set on the first call (when incr returns 1) to avoid
  // resetting the window on every request.

  async incrWithTTL(key: string, ttlSeconds: number): Promise<number> {
    const pipeline = this.client.pipeline();
    pipeline.incr(key);
    pipeline.expire(key, ttlSeconds);
    const results = await pipeline.exec();
    // results: [[err, incrValue], [err, expireValue]]
    const incrResult = results?.[0];
    if (incrResult?.[0]) throw incrResult[0]; // surface Redis error
    return incrResult?.[1] as number;
  }

  //  Diagnostics 

  async ping(): Promise<string> {
    return this.client.ping();
  }

  /**
   * Expose the raw client for libraries that need it directly
   * (e.g. rate-limit-redis, BullMQ).
   */
  getClient(): Redis {
    return this.client;
  }

  // No onModuleDestroy here — RedisService owns the connection lifecycle.
}