import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auths.controller';
import { AuthService } from './auths.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../redis/redis.service';

@Module({
  imports: [
    PassportModule,
    JwtModule.register({}), // secrets set per-call in service
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, PrismaService, RedisService],
  exports: [AuthService],
})
export class AuthModule {}