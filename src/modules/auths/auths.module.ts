import { Module, Redirect } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auths.controller';
import { AuthService } from './auths.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { PrismaService } from '../../database/prisma.service';
import { RbacModule } from '../rbac/rbac.module';
import { CacheService } from '../cache/cache.service';
import { RedisService } from 'src/redis/redis.service';

@Module({
  imports: [
    PassportModule,
    JwtModule.register({}), // secrets set per-call in service
    RbacModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, PrismaService, CacheService, RedisService],
  exports: [AuthService],
})
export class AuthModule {}