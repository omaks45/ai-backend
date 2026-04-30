/**
 * WHY A SEPARATE REDIS SERVICE FROM CACHE SERVICE?
 * CacheService owns high-level caching logic (TTL constants, key builders,
 * typed get/set). RedisService owns the raw IORedis client that is also needed
 * by third-party libraries (BullMQ, rate-limit-redis) that need the client
 * object directly rather than our typed wrapper methods.
 *
 * This separation follows the Interface Segregation Principle: consumers only
 * depend on the abstraction they actually use.
 *
 * CONNECTION STRATEGY:
 * - Local / CI:   REDIS_HOST + REDIS_PORT (plain TCP)
 * - Production:   REDIS_URL  (rediss://... with TLS, e.g. Redis Cloud)
 * REDIS_URL takes precedence when both are present.
 */

import { Injectable, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis, { RedisOptions } from 'ioredis';

@Injectable()
export class RedisService implements OnModuleDestroy {
    private readonly logger = new Logger(RedisService.name);
    readonly client: Redis;

    constructor(private readonly config: ConfigService) {
        const redisUrl  = this.config.get<string>('REDIS_URL');
        const isSecure  = redisUrl?.startsWith('rediss://') ?? false;

        // When a full URL is supplied (production / Redis Cloud) ioredis accepts
        // it as the first argument.  The options object is merged on top so we can
        // still inject TLS and shared settings without duplicating them.
        const sharedOptions: RedisOptions = {
        lazyConnect:        true,
        retryStrategy: (times) => {
            // Exponential back-off capped at 30 s — avoids hammering a cold cluster
            const delay = Math.min(times * 500, 30_000);
            this.logger.warn(`Redis retry #${times} — next attempt in ${delay}ms`);
            return delay;
        },
        ...(isSecure && { tls: {} }), // required by Redis Cloud / TLS endpoints
        };

        this.client = redisUrl
        ? new Redis(redisUrl, sharedOptions)
        : new Redis({
            host: this.config.get<string>('REDIS_HOST', 'localhost'),
            port: this.config.get<number>('REDIS_PORT', 6379),
            ...sharedOptions,
            });

        this.client.on('connect', () =>
        this.logger.log('Redis connection established'),
        );

        this.client.on('ready', () =>
        this.logger.log('Redis client ready'),
        );

        this.client.on('error', (err: Error) =>
        this.logger.error(`Redis error: ${err.message}`, err.stack),
        );

        this.client.on('close', () =>
        this.logger.warn('Redis connection closed'),
        );
    }

    async ping(): Promise<string> {
        return this.client.ping();
    }

    async onModuleDestroy(): Promise<void> {
        // quit() sends QUIT and waits for the server ACK — cleaner than disconnect()
        await this.client.quit();
        this.logger.log('Redis client disconnected');
    }
}