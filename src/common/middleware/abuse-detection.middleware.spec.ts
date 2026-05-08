
import { Test, TestingModule } from '@nestjs/testing';
import { AbuseDetectionMiddleware } from './abuse-detection.middleware';
import { CacheService } from '../../modules/cache/cache.service';
import { EventEmitter2 } from '@nestjs/event-emitter';

const mockCache  = { sadd: jest.fn(), expire: jest.fn(), scard: jest.fn() };
const mockEvents = { emit: jest.fn() };
const mockNext   = jest.fn();
const mockRes    = {} as any;

function makeReq(path: string, userId?: string): any {
    return { path, user: userId ? { id: userId } : undefined };
}

describe('AbuseDetectionMiddleware', () => {
    let middleware: AbuseDetectionMiddleware;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
        providers: [
            AbuseDetectionMiddleware,
            { provide: CacheService,  useValue: mockCache  },
            { provide: EventEmitter2, useValue: mockEvents },
        ],
        }).compile();
        middleware = module.get<AbuseDetectionMiddleware>(AbuseDetectionMiddleware);
        jest.clearAllMocks();
    });

    it('skips unauthenticated requests', async () => {
        await middleware.use(makeReq('/documents/uuid-1'), mockRes, mockNext);
        expect(mockCache.sadd).not.toHaveBeenCalled();
        expect(mockNext).toHaveBeenCalled();
    });

    it('skips non-document paths', async () => {
        await middleware.use(makeReq('/conversations/abc', 'user-1'), mockRes, mockNext);
        expect(mockCache.sadd).not.toHaveBeenCalled();
    });

    it('tracks document access in Redis set', async () => {
        mockCache.sadd.mockResolvedValue(1);
        mockCache.scard.mockResolvedValue(1);
        await middleware.use(
        makeReq('/documents/f47ac10b-58cc-4372-a567-0e02b2c3d479', 'user-1'),
        mockRes, mockNext,
        );
        expect(mockCache.sadd).toHaveBeenCalledWith(
        'abuse:docs:user-1',
        'f47ac10b-58cc-4372-a567-0e02b2c3d479',
        );
    });

    it('sets TTL only on first new member', async () => {
        mockCache.sadd.mockResolvedValue(1);
        mockCache.scard.mockResolvedValue(1);
        await middleware.use(makeReq('/documents/uuid-1', 'user-1'), mockRes, mockNext);
        expect(mockCache.expire).toHaveBeenCalledWith('abuse:docs:user-1', 300);
    });

    it('does not reset TTL for already-seen docs', async () => {
        mockCache.sadd.mockResolvedValue(0);
        mockCache.scard.mockResolvedValue(5);
        await middleware.use(makeReq('/documents/uuid-1', 'user-1'), mockRes, mockNext);
        expect(mockCache.expire).not.toHaveBeenCalled();
    });

    it('emits scraping event at threshold of 50', async () => {
        mockCache.sadd.mockResolvedValue(1);
        mockCache.scard.mockResolvedValue(50);
        await middleware.use(makeReq('/documents/uuid-50', 'user-1'), mockRes, mockNext);
        expect(mockEvents.emit).toHaveBeenCalledWith(
        'security.scraping.detected',
        expect.objectContaining({ userId: 'user-1' }),
        );
    });

    it('does not emit event below threshold', async () => {
        mockCache.sadd.mockResolvedValue(1);
        mockCache.scard.mockResolvedValue(49);
        await middleware.use(makeReq('/documents/uuid-49', 'user-1'), mockRes, mockNext);
        expect(mockEvents.emit).not.toHaveBeenCalled();
    });

    it('calls next() even when Redis throws', async () => {
        mockCache.sadd.mockRejectedValue(new Error('Redis down'));
        await middleware.use(makeReq('/documents/uuid-1', 'user-1'), mockRes, mockNext);
        expect(mockNext).toHaveBeenCalled();
    });
});