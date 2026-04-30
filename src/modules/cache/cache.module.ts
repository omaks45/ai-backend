// src/modules/cache/cache.module.ts
import { Global, Module } from '@nestjs/common';
import { CacheService } from './cache.service';

@Global() // Available everywhere without re-importing
@Module({
  providers: [CacheService],
  exports: [CacheService],
})
export class CacheModule {}
