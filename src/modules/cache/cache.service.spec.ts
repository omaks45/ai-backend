import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { CacheService, CACHE_TTL, CacheKeys } from './cache.service';

// Redis mock
const mockRedis = {
  get:    jest.fn(),
  setex:  jest.fn(),
  del:    jest.fn(),
  exists: jest.fn(),
  sadd:   jest.fn(),
  scard:  jest.fn(),
  expire: jest.fn(),
  incr:   jest.fn(),
  ping:   jest.fn(),
  quit:   jest.fn(),
  on:     jest.fn(),
};

jest.mock('ioredis', () =>
  jest.fn().mockImplementation(() => mockRedis),
);

describe('CacheService', () => {
  let service: CacheService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CacheService,
        {
          provide: ConfigService,
          useValue: { get: jest.fn((k: string, d?: any) => d ?? k) },
        },
      ],
    }).compile();

    service = module.get<CacheService>(CacheService);
    jest.clearAllMocks();
  });

  // get

  describe('get', () => {
    it('returns null when key does not exist', async () => {
      mockRedis.get.mockResolvedValue(null);
      expect(await service.get('missing')).toBeNull();
    });

    it('parses JSON values correctly', async () => {
      const data = { id: '1', nums: [1, 2, 3] };
      mockRedis.get.mockResolvedValue(JSON.stringify(data));
      expect(await service.get<typeof data>('key')).toEqual(data);
    });

    it('returns raw string for non-JSON values', async () => {
      mockRedis.get.mockResolvedValue('plain');
      expect(await service.get<string>('key')).toBe('plain');
    });
  });

  // set

  describe('set', () => {
    it('serialises objects to JSON and calls setex', async () => {
      await service.set('key', { a: 1 }, 60);
      expect(mockRedis.setex).toHaveBeenCalledWith('key', 60, '{"a":1}');
    });

    it('passes strings through without extra serialisation', async () => {
      await service.set('key', 'hello', 60);
      expect(mockRedis.setex).toHaveBeenCalledWith('key', 60, 'hello');
    });
  });

  // token blacklist

  describe('blacklistToken / isTokenBlacklisted', () => {
    it('stores token with correct key and TTL', async () => {
      await service.blacklistToken('jti-abc', 900);
      expect(mockRedis.setex).toHaveBeenCalledWith(
        CacheKeys.tokenBlocked('jti-abc'),
        900,
        '1',
      );
    });

    it('returns true when token is blacklisted', async () => {
      mockRedis.exists.mockResolvedValue(1);
      expect(await service.isTokenBlacklisted('jti-abc')).toBe(true);
    });

    it('returns false when token is not blacklisted', async () => {
      mockRedis.exists.mockResolvedValue(0);
      expect(await service.isTokenBlacklisted('jti-xyz')).toBe(false);
    });
  });

  //  CACHE_TTL constants

  describe('CACHE_TTL', () => {
    it('has correct embedding TTL of 7 days', () => {
      expect(CACHE_TTL.EMBEDDING).toBe(7 * 24 * 60 * 60);
    });

    it('has correct medium TTL of 5 minutes', () => {
      expect(CACHE_TTL.MEDIUM).toBe(5 * 60);
    });
  });

  //  CacheKeys

  describe('CacheKeys', () => {
    it('generates correct embedding key', () => {
      expect(CacheKeys.embedding('abc123')).toBe('embed:abc123');
    });

    it('generates correct user perms key', () => {
      expect(CacheKeys.userPerms('user-1')).toBe('perms:user-1');
    });
  });
});
