

import {
    authLimiter,
    apiLimiter,
    uploadLimiter,
    chatLimiter,
} from './rate-limiter.middleware';
import { Request } from 'express';

//  Helper: build a minimal mock Request
function mockReq(overrides: {
    tier?: string;
    ip?: string;
    userId?: string;
    } = {}): Partial<Request> {
    return {
        ip: overrides.ip ?? '127.0.0.1',
        user: overrides.userId || overrides.tier
        ? { id: overrides.userId ?? 'uid-1', tier: overrides.tier ?? 'free' }
        : undefined,
    } as any;
    }

    describe('Rate limiter middleware', () => {

    // authLimiter

    describe('authLimiter', () => {
        it('has a 15-minute window', () => {
        expect((authLimiter as any).options?.windowMs).toBe(15 * 60 * 1_000);
        });

        it('allows exactly 10 requests', () => {
        expect((authLimiter as any).options?.max).toBe(10);
        });

        it('keys by IP address', () => {
        const keyFn = (authLimiter as any).options?.keyGenerator as (r: Request) => string;
        expect(keyFn(mockReq({ ip: '1.2.3.4' }) as Request)).toBe('1.2.3.4');
        });

        it('falls back to "anonymous" when IP is missing', () => {
        const keyFn = (authLimiter as any).options?.keyGenerator as (r: Request) => string;
        expect(keyFn({ ip: undefined } as any)).toBe('anonymous');
        });
    });

    // ── apiLimiter ──────────────────────────────────────────────────────────

    describe('apiLimiter', () => {
        it('has a 15-minute window', () => {
        expect((apiLimiter as any).options?.windowMs).toBe(15 * 60 * 1_000);
        });

        it.each([
        ['free',       100],
        ['pro',        500],
        ['enterprise', 2_000],
        ])('returns %s-tier limit of %d', (tier, expected) => {
        const maxFn = (apiLimiter as any).options?.max as (r: Request) => number;
        expect(maxFn(mockReq({ tier }) as Request)).toBe(expected);
        });

        it('defaults to free limit for unknown tier', () => {
        const maxFn = (apiLimiter as any).options?.max as (r: Request) => number;
        expect(maxFn(mockReq({ tier: 'unknown' }) as Request)).toBe(100);
        });

        it('defaults to free limit for unauthenticated requests', () => {
        const maxFn = (apiLimiter as any).options?.max as (r: Request) => number;
        expect(maxFn({ ip: '1.1.1.1' } as Request)).toBe(100);
        });

        it('keys by user ID', () => {
        const keyFn = (apiLimiter as any).options?.keyGenerator as (r: Request) => string;
        expect(keyFn(mockReq({ userId: 'user-abc' }) as Request)).toBe('user-abc');
        });

        it('falls back to IP when user ID is absent', () => {
        const keyFn = (apiLimiter as any).options?.keyGenerator as (r: Request) => string;
        expect(keyFn({ ip: '9.9.9.9' } as Request)).toBe('9.9.9.9');
        });
    });

    // ── uploadLimiter ───────────────────────────────────────────────────────

    describe('uploadLimiter', () => {
        it('has a 1-hour window', () => {
        expect((uploadLimiter as any).options?.windowMs).toBe(60 * 60 * 1_000);
        });

        it.each([
        ['free',         5],
        ['pro',         50],
        ['enterprise', 500],
        ])('returns %s-tier upload limit of %d', (tier, expected) => {
        const maxFn = (uploadLimiter as any).options?.max as (r: Request) => number;
        expect(maxFn(mockReq({ tier }) as Request)).toBe(expected);
        });
    });

    // ── chatLimiter ─────────────────────────────────────────────────────────

    describe('chatLimiter', () => {
        it('has a 1-minute window', () => {
        expect((chatLimiter as any).options?.windowMs).toBe(60 * 1_000);
        });

        it.each([
        ['free',       10],
        ['pro',        30],
        ['enterprise', 100],
        ])('returns %s-tier chat limit of %d per minute', (tier, expected) => {
        const maxFn = (chatLimiter as any).options?.max as (r: Request) => number;
        expect(maxFn(mockReq({ tier }) as Request)).toBe(expected);
        });
    });

    // ── All limiters: shared behaviour ─────────────────────────────────────

    describe('all limiters', () => {
        const allLimiters = [authLimiter, apiLimiter, uploadLimiter, chatLimiter];

        it('use RFC standard headers (not legacy X-RateLimit-*)', () => {
        allLimiters.forEach((l) => {
            expect((l as any).options?.standardHeaders).toBe(true);
            expect((l as any).options?.legacyHeaders).toBe(false);
        });
        });

        it('return a 429-shaped error envelope', () => {
        allLimiters.forEach((l) => {
            const msg = (l as any).options?.message;
            expect(msg).toMatchObject({
            success:    false,
            statusCode: 429,
            error: expect.objectContaining({ code: 'RATE_LIMITED' }),
            });
        });
        });
    });
});