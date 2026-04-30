// src/modules/cache/cache.module.ts
import { Global, Module } from '@nestjs/common';
import { CacheService } from './cache.service';
import { RedisModule } from 'src/redis/redis.module';

@Global() // Available everywhere without re-importing
@Module({
  imports:   [RedisModule],
  providers: [CacheService],
  exports:   [CacheService],
})
export class CacheModule {}