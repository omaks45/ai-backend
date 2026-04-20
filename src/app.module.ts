import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './modules/auths/auths.module';
import { PrismaService } from './database/prisma.service';
import { RedisService } from './redis/redis.service';
import { AuthEventsListener } from './modules/events/auth.events';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
    EventEmitterModule.forRoot({ maxListeners: 20 }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 10 }]),
    AuthModule,
  ],
  providers: [PrismaService, RedisService, AuthEventsListener],
})
export class AppModule {}