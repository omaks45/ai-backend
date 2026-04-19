import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../../../redis/redis.service';
import { PrismaService } from '../../../database/prisma.service';

export interface JwtPayload {
    sub: string;
    email: string;
    tier: string;
    type: 'access' | 'refresh';
    jti: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
    constructor(
        config: ConfigService,
        private readonly redis: RedisService,
        private readonly prisma: PrismaService,
    ) {
        super({
        jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
        ignoreExpiration: false,
        secretOrKey: config.get<string>('JWT_ACCESS_SECRET'),
        });
    }

    async validate(payload: JwtPayload) {
        if (payload.type !== 'access') {
        throw new UnauthorizedException('Invalid token type');
        }

        if (await this.redis.isTokenBlacklisted(payload.jti)) {
        throw new UnauthorizedException('Token has been revoked');
        }

        const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: { id: true, email: true, tier: true, isActive: true },
        });

        if (!user || !user.isActive) {
        throw new UnauthorizedException('User not found or inactive');
        }

        return user;
    }
}