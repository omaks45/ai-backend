import {
  Injectable,
  UnauthorizedException,
  ConflictException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { RbacService } from '../rbac/rbac.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

const SALT_ROUNDS = 12;
const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const PLACEHOLDER_HASH = '$2b$12$placeholderhashtopreventimingtimingattacks1234567890';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly redis: RedisService,
    private readonly events: EventEmitter2,
    private readonly rbac: RbacService,
  ) {}

  async register(dto: RegisterDto) {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (existing) throw new ConflictException('Email already registered');

    const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);

    const user = await this.prisma.user.create({
      data: { email: dto.email, passwordHash },
      select: { id: true, email: true, tier: true },
    });

    // Assign default role (member) — non-blocking side effect
    await this.rbac.assignDefaultRole(user.id);

    this.events.emit('auth.user.registered', user);

    return user;
  }

  async login(dto: LoginDto, deviceInfo?: string) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    const isValid = user
      ? await bcrypt.compare(dto.password, user.passwordHash)
      : await bcrypt.compare(dto.password, PLACEHOLDER_HASH);

    if (!user || !user.isActive || !isValid) {
      this.events.emit('auth.login.failed', { email: dto.email, deviceInfo });
      throw new UnauthorizedException('Invalid credentials');
    }

    const tokens = await this.generateAndStoreTokens(user);
    this.events.emit('auth.user.logged_in', { userId: user.id, deviceInfo });

    return { ...tokens, user: { id: user.id, email: user.email, tier: user.tier } };
  }

  async refresh(rawRefreshToken: string) {
    let payload: any;
    try {
      payload = this.jwt.verify(rawRefreshToken, {
        secret: this.config.get('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (payload.type !== 'refresh') {
      throw new UnauthorizedException('Invalid token type');
    }

    const tokenHash = this.hashToken(rawRefreshToken);
    const stored = await this.prisma.refreshToken.findUnique({
      where: { token: tokenHash },
    });

    if (!stored || stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token expired or revoked');
    }

    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || !user.isActive) throw new UnauthorizedException('User not found');

    await this.prisma.refreshToken.delete({ where: { token: tokenHash } });
    return this.generateAndStoreTokens(user);
  }

  async logout(rawRefreshToken: string, accessTokenJti?: string) {
    const tokenHash = this.hashToken(rawRefreshToken);
    await this.prisma.refreshToken.deleteMany({ where: { token: tokenHash } });

    if (accessTokenJti) {
      await this.redis.blacklistToken(accessTokenJti, 15 * 60);
    }
  }

  private async generateAndStoreTokens(user: { id: string; email: string; tier: string }) {
    const jti = crypto.randomUUID();
    const refreshJti = crypto.randomUUID();

    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(
        { sub: user.id, email: user.email, tier: user.tier, type: 'access', jti },
        { secret: this.config.get('JWT_ACCESS_SECRET'), expiresIn: this.config.get('JWT_ACCESS_EXPIRES_IN', '15m') },
      ),
      this.jwt.signAsync(
        { sub: user.id, email: user.email, tier: user.tier, type: 'refresh', jti: refreshJti },
        { secret: this.config.get('JWT_REFRESH_SECRET'), expiresIn: this.config.get('JWT_REFRESH_EXPIRES_IN', '7d') },
      ),
    ]);

    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        token: this.hashToken(refreshToken),
        expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
      },
    });

    return { accessToken, refreshToken };
  }

  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }
}