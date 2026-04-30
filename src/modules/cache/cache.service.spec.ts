import { Test, TestingModule } from '@nestjs/testing';
import { CacheService, CACHE_TTL, CacheKeys } from './cache.service';
import { RedisService } from '../../redis/redis.service';

// Redis client mock

const mockPipeline = {
  incr:   jest.fn().mockReturnThis(),
  expire: jest.fn().mockReturnThis(),
  exec:   jest.fn().mockResolvedValue([[null, 1], [null, 1]]),
};

const mockRedisClient = {
  get:      jest.fn(),
  setex:    jest.fn(),
  del:      jest.fn(),
  exists:   jest.fn(),
  sadd:     jest.fn(),
  scard:    jest.fn(),
  expire:   jest.fn(),
  incr:     jest.fn(),
  ping:     jest.fn(),
  quit:     jest.fn(),
  pipeline: jest.fn().mockReturnValue(mockPipeline),
};

// RedisService mock — just exposes the client property CacheService reads
const mockRedisService = {
  client: mockRedisClient,
};

describe('CacheService', () => {
  let service: CacheService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CacheService,
        {
          provide: RedisService,
          useValue: mockRedisService,
        },
      ],
    }).compile();

    service = module.get<CacheService>(CacheService);
    jest.clearAllMocks();

    // Reset pipeline mock after clearAllMocks
    mockRedisClient.pipeline.mockReturnValue(mockPipeline);
    mockPipeline.exec.mockResolvedValue([[null, 1], [null, 1]]);
  });

  //  get 

  describe('get', () => {
    it('returns null when key does not exist', async () => {
      mockRedisClient.get.mockResolvedValue(null);
      expect(await service.get('missing')).toBeNull();
    });

    it('parses JSON values correctly', async () => {
      const data = { id: '1', nums: [1, 2, 3] };
      mockRedisClient.get.mockResolvedValue(JSON.stringify(data));
      expect(await service.get<typeof data>('key')).toEqual(data);
    });

    it('returns raw string for non-JSON values', async () => {
      mockRedisClient.get.mockResolvedValue('plain');
      expect(await service.get<string>('key')).toBe('plain');
    });
  });

  //  set 

  describe('set', () => {
    it('serialises objects to JSON and calls setex', async () => {
      await service.set('key', { a: 1 }, 60);
      expect(mockRedisClient.setex).toHaveBeenCalledWith('key', 60, '{"a":1}');
    });

    it('passes strings through without extra serialisation', async () => {
      await service.set('key', 'hello', 60);
      expect(mockRedisClient.setex).toHaveBeenCalledWith('key', 60, 'hello');
    });
  });

  //  del / exists

  describe('del', () => {
    it('calls del with the correct key', async () => {
      await service.del('some-key');
      expect(mockRedisClient.del).toHaveBeenCalledWith('some-key');
    });
  });

  describe('exists', () => {
    it('returns true when key exists', async () => {
      mockRedisClient.exists.mockResolvedValue(1);
      expect(await service.exists('k')).toBe(true);
    });

    it('returns false when key does not exist', async () => {
      mockRedisClient.exists.mockResolvedValue(0);
      expect(await service.exists('k')).toBe(false);
    });
  });

  //  Token blacklist 

  describe('blacklistToken / isTokenBlacklisted', () => {
    it('stores token with correct key and TTL', async () => {
      await service.blacklistToken('jti-abc', 900);
      expect(mockRedisClient.setex).toHaveBeenCalledWith(
        CacheKeys.tokenBlocked('jti-abc'),
        900,
        '1',
      );
    });

    it('returns true when token is blacklisted', async () => {
      mockRedisClient.exists.mockResolvedValue(1);
      expect(await service.isTokenBlacklisted('jti-abc')).toBe(true);
    });

    it('returns false when token is not blacklisted', async () => {
      mockRedisClient.exists.mockResolvedValue(0);
      expect(await service.isTokenBlacklisted('jti-xyz')).toBe(false);
    });
  });

  //  incrWithTTL 

  describe('incrWithTTL', () => {
    it('returns the incremented value', async () => {
      mockPipeline.exec.mockResolvedValue([[null, 5], [null, 1]]);
      const result = await service.incrWithTTL('rl:user-1', 60);
      expect(result).toBe(5);
    });

    it('calls pipeline incr and expire with correct args', async () => {
      await service.incrWithTTL('rl:user-1', 60);
      expect(mockPipeline.incr).toHaveBeenCalledWith('rl:user-1');
      expect(mockPipeline.expire).toHaveBeenCalledWith('rl:user-1', 60);
    });

    it('throws if Redis returns an error in the pipeline', async () => {
      const redisError = new Error('Redis failure');
      mockPipeline.exec.mockResolvedValue([[redisError, null], [null, 1]]);
      await expect(service.incrWithTTL('rl:user-1', 60)).rejects.toThrow('Redis failure');
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

    it('has correct short TTL of 1 minute', () => {
      expect(CACHE_TTL.SHORT).toBe(60);
    });

    it('has correct long TTL of 1 hour', () => {
      expect(CACHE_TTL.LONG).toBe(60 * 60);
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

    it('generates correct doc status key', () => {
      expect(CacheKeys.docStatus('doc-99')).toBe('doc:status:doc-99');
    });

    it('generates correct token blocked key', () => {
      expect(CacheKeys.tokenBlocked('jti-1')).toBe('blacklist:jti-1');
    });

    it('generates correct rate limit key', () => {
      expect(CacheKeys.rateLimitKey('ip:127.0.0.1')).toBe('rl:ip:127.0.0.1');
    });
  });

  //  ping / getClient 

  describe('ping', () => {
    it('delegates to the redis client', async () => {
      mockRedisClient.ping.mockResolvedValue('PONG');
      expect(await service.ping()).toBe('PONG');
    });
  });

  describe('getClient', () => {
    it('returns the underlying Redis client', () => {
      expect(service.getClient()).toBe(mockRedisClient);
    });
  });
});