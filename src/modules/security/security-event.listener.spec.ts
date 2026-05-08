
import { Test, TestingModule } from '@nestjs/testing';
import { SecurityEventsListener } from './security-event.listener';
import { CacheService } from '../cache/cache.service';

const mockCache = { incr: jest.fn(), expire: jest.fn() };

describe('SecurityEventsListener', () => {
    let listener: SecurityEventsListener;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
        providers: [
            SecurityEventsListener,
            { provide: CacheService, useValue: mockCache },
        ],
        }).compile();
        listener = module.get<SecurityEventsListener>(SecurityEventsListener);
        jest.clearAllMocks();
    });

    describe('onLoginFailed', () => {
        it('increments the failure counter', async () => {
        mockCache.incr.mockResolvedValue(1);
        await listener.onLoginFailed({ email: 'user@test.com' });
        expect(mockCache.incr).toHaveBeenCalledWith('security:login-failures:user@test.com');
        });

        it('sets TTL only on the first failure', async () => {
        mockCache.incr.mockResolvedValue(1);
        await listener.onLoginFailed({ email: 'user@test.com' });
        expect(mockCache.expire).toHaveBeenCalledWith('security:login-failures:user@test.com', 900);
        });

        it('does not reset TTL on subsequent failures', async () => {
        mockCache.incr.mockResolvedValue(3);
        await listener.onLoginFailed({ email: 'user@test.com' });
        expect(mockCache.expire).not.toHaveBeenCalled();
        });

        it('does not throw when cache fails', async () => {
        mockCache.incr.mockRejectedValue(new Error('Redis timeout'));
        await expect(listener.onLoginFailed({ email: 'user@test.com' })).resolves.toBeUndefined();
        });

        it('handles 10+ failures without throwing', async () => {
        mockCache.incr.mockResolvedValue(10);
        await expect(listener.onLoginFailed({ email: 'user@test.com' })).resolves.toBeUndefined();
        });
    });

    describe('onScrapingDetected', () => {
        it('handles the event without throwing', () => {
        expect(() =>
            listener.onScrapingDetected({ userId: 'u1', uniqueDocsIn5Min: 55 }),
        ).not.toThrow();
        });
    });
});