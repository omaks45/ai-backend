import { Test, TestingModule }        from '@nestjs/testing';
import { AbuseDetectionMiddleware }   from './abuse-detection.middleware';
import { CacheService }               from '../../modules/cache/cache.service';
import { EventEmitter2 }              from '@nestjs/event-emitter';


const UUID_A = 'f47ac10b-58cc-4372-a567-0e02b2c3d479'; // used in most tests
const UUID_B = 'a47ac10b-58cc-4372-a567-0e02b2c3d479'; // used where a second UUID is needed

// Mocks

const mockCache  = { sadd: jest.fn(), expire: jest.fn(), scard: jest.fn() };
const mockEvents = { emit: jest.fn() };
const mockNext   = jest.fn();
const mockRes    = {} as any;

function makeReq(path: string, userId?: string): any {
    return { path, user: userId ? { id: userId } : undefined };
}

//  Suite

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

    // Skips

    it('skips unauthenticated requests', async () => {
        await middleware.use(makeReq(`/documents/${UUID_A}`), mockRes, mockNext);
        expect(mockCache.sadd).not.toHaveBeenCalled();
        expect(mockNext).toHaveBeenCalled();
    });

    it('skips non-document paths', async () => {
        await middleware.use(makeReq('/conversations/abc', 'user-1'), mockRes, mockNext);
        expect(mockCache.sadd).not.toHaveBeenCalled();
    });

    // Tracking

    it('tracks document access in Redis set', async () => {
        mockCache.sadd.mockResolvedValue(1);
        mockCache.scard.mockResolvedValue(1);

        await middleware.use(makeReq(`/documents/${UUID_A}`, 'user-1'), mockRes, mockNext);

        expect(mockCache.sadd).toHaveBeenCalledWith('abuse:docs:user-1', UUID_A);
    });

    it('sets TTL only on first new member (sadd returns 1)', async () => {
        mockCache.sadd.mockResolvedValue(1);
        mockCache.scard.mockResolvedValue(1);

        await middleware.use(makeReq(`/documents/${UUID_A}`, 'user-1'), mockRes, mockNext);

        expect(mockCache.expire).toHaveBeenCalledWith('abuse:docs:user-1', 300);
    });

    it('does not reset TTL for an already-seen doc (sadd returns 0)', async () => {
        mockCache.sadd.mockResolvedValue(0);
        mockCache.scard.mockResolvedValue(5);

        await middleware.use(makeReq(`/documents/${UUID_A}`, 'user-1'), mockRes, mockNext);

        expect(mockCache.expire).not.toHaveBeenCalled();
    });

    //  Threshold events

    it('emits scraping event when unique doc count hits threshold of 50', async () => {
        mockCache.sadd.mockResolvedValue(1);
        mockCache.scard.mockResolvedValue(50);

        await middleware.use(makeReq(`/documents/${UUID_B}`, 'user-1'), mockRes, mockNext);

        expect(mockEvents.emit).toHaveBeenCalledWith(
        'security.scraping.detected',
        expect.objectContaining({ userId: 'user-1' }),
        );
    });

    it('does not emit event when count is below threshold (49)', async () => {
        mockCache.sadd.mockResolvedValue(1);
        mockCache.scard.mockResolvedValue(49);

        await middleware.use(makeReq(`/documents/${UUID_A}`, 'user-1'), mockRes, mockNext);

        expect(mockEvents.emit).not.toHaveBeenCalled();
    });

    // Resilience

    it('calls next() even when Redis throws', async () => {
        mockCache.sadd.mockRejectedValue(new Error('Redis down'));

        await middleware.use(makeReq(`/documents/${UUID_A}`, 'user-1'), mockRes, mockNext);

        expect(mockNext).toHaveBeenCalled();
    });
});