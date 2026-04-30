import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleDestroy {
    private readonly client: Redis;

    constructor(private readonly config: ConfigService) {
        this.client = new Redis({
        host: config.get<string>('REDIS_HOST', 'localhost'),
        port: config.get<number>('REDIS_PORT', 6379),
        });
    }

    // Token blacklist — O(1) set and get
    async blacklistToken(jti: string, ttlSeconds: number): Promise<void> {
        await this.client.setex(`blacklist:${jti}`, ttlSeconds, '1');
    }

    async isTokenBlacklisted(jti: string): Promise<boolean> {
        const result = await this.client.get(`blacklist:${jti}`);
        return result !== null;
    }

    async ping(): Promise<string> {
        return this.client.ping();
    }

    onModuleDestroy() {
        this.client.disconnect();
    }
}