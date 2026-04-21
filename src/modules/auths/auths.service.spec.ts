import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auths.service';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { RbacService } from '../rbac/rbac.service';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    create: jest.fn(),
  },
  refreshToken: {
    create: jest.fn(),
    findUnique: jest.fn(),
    delete: jest.fn(),
    deleteMany: jest.fn(),
  },
};

const mockJwt = {
  signAsync: jest.fn().mockResolvedValue('mock.jwt.token'),
  verify: jest.fn(),
};

const mockConfig = {
  get: jest.fn((key: string, fallback?: any) => fallback ?? key),
};

const mockRedis = {
  blacklistToken: jest.fn().mockResolvedValue(undefined),
  isTokenBlacklisted: jest.fn().mockResolvedValue(false),
};

const mockEvents = { emit: jest.fn() };

// Added in Week 2 — must be present or NestJS DI fails
const mockRbac = {
  assignDefaultRole: jest.fn().mockResolvedValue(undefined),
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService,  useValue: mockPrisma  },
        { provide: JwtService,     useValue: mockJwt     },
        { provide: ConfigService,  useValue: mockConfig  },
        { provide: RedisService,   useValue: mockRedis   },
        { provide: EventEmitter2,  useValue: mockEvents  },
        { provide: RbacService,    useValue: mockRbac    }, // ← was missing
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    jest.clearAllMocks();
  });

  // ── register ────────────────────────────────────────────────────────────────

  describe('register', () => {
    it('creates a user and returns safe fields only', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({
        id: 'uuid-1',
        email: 'test@example.com',
        tier: 'free',
      });

      const result = await service.register({
        email: 'test@example.com',
        password: 'SecurePass1',
      });

      expect(result).toEqual({ id: 'uuid-1', email: 'test@example.com', tier: 'free' });
      expect(result).not.toHaveProperty('passwordHash');
    });

    it('hashes the password before storing', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({
        id: 'uuid-1',
        email: 'a@b.com',
        tier: 'free',
      });

      await service.register({ email: 'a@b.com', password: 'SecurePass1' });

      const createCall = mockPrisma.user.create.mock.calls[0][0];
      expect(createCall.data.passwordHash).toMatch(/^\$2b\$/);
      expect(createCall.data.passwordHash).not.toBe('SecurePass1');
    });

    it('throws ConflictException for duplicate email', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'existing' });

      await expect(
        service.register({ email: 'taken@example.com', password: 'SecurePass1' }),
      ).rejects.toThrow(ConflictException);
    });

    it('emits auth.user.registered event', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({
        id: 'uuid-1',
        email: 'a@b.com',
        tier: 'free',
      });

      await service.register({ email: 'a@b.com', password: 'SecurePass1' });

      expect(mockEvents.emit).toHaveBeenCalledWith(
        'auth.user.registered',
        expect.objectContaining({ email: 'a@b.com' }),
      );
    });

    it('assigns default role after registration', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({
        id: 'uuid-1',
        email: 'a@b.com',
        tier: 'free',
      });

      await service.register({ email: 'a@b.com', password: 'SecurePass1' });

      expect(mockRbac.assignDefaultRole).toHaveBeenCalledWith('uuid-1');
    });
  });

  // ── login ────────────────────────────────────────────────────────────────────

  describe('login', () => {
    const makeUserWithHash = async (password = 'CorrectPass1') => ({
      id: 'uuid-1',
      email: 'user@example.com',
      tier: 'free',
      isActive: true,
      passwordHash: await bcrypt.hash(password, 4), // 4 rounds for test speed
    });

    it('returns tokens and user for valid credentials', async () => {
      const user = await makeUserWithHash();
      mockPrisma.user.findUnique.mockResolvedValue(user);
      mockPrisma.refreshToken.create.mockResolvedValue({});

      const result = await service.login({
        email: 'user@example.com',
        password: 'CorrectPass1',
      });

      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
      expect(result.user.email).toBe('user@example.com');
      expect(result.user).not.toHaveProperty('passwordHash');
    });

    it('throws UnauthorizedException for wrong password', async () => {
      const user = await makeUserWithHash('CorrectPass1');
      mockPrisma.user.findUnique.mockResolvedValue(user);

      await expect(
        service.login({ email: 'user@example.com', password: 'WrongPass1' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws same UnauthorizedException for non-existent user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      const error = await service
        .login({ email: 'nobody@example.com', password: 'Whatever1' })
        .catch((e) => e);

      expect(error).toBeInstanceOf(UnauthorizedException);
      expect(error.message).toBe('Invalid credentials');
    });

    it('wrong email and wrong password return identical error messages', async () => {
      // Wrong email
      mockPrisma.user.findUnique.mockResolvedValue(null);
      const errorA = await service
        .login({ email: 'none@x.com', password: 'P' })
        .catch((e) => e);

      // Wrong password
      const user = await makeUserWithHash();
      mockPrisma.user.findUnique.mockResolvedValue(user);
      const errorB = await service
        .login({ email: 'user@example.com', password: 'WrongPass1' })
        .catch((e) => e);

      expect(errorA.message).toBe(errorB.message);
    });

    it('emits auth.login.failed on failure', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await service.login({ email: 'x@x.com', password: 'P' }).catch(() => {});

      expect(mockEvents.emit).toHaveBeenCalledWith(
        'auth.login.failed',
        expect.objectContaining({ email: 'x@x.com' }),
      );
    });

    it('throws UnauthorizedException for inactive user', async () => {
      const user = await makeUserWithHash();
      mockPrisma.user.findUnique.mockResolvedValue({ ...user, isActive: false });

      await expect(
        service.login({ email: 'user@example.com', password: 'CorrectPass1' }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });
});