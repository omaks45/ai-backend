
// express-rate-limit v7+ requires the ipKeyGenerator helper for any keyGenerator
// that uses req.ip. Without it, IPv6 users can bypass limits because
// "::ffff:1.2.3.4" and "1.2.3.4" are treated as different keys.
// ipKeyGenerator normalises both forms to a consistent key.

import rateLimit, { Options, ipKeyGenerator } from 'express-rate-limit';
import { Request, Response } from 'express';

// Tier limit tables

const API_LIMITS: Record<string, number> = {
    free:       100,
    pro:        500,
    enterprise: 2_000,
};

const UPLOAD_LIMITS: Record<string, number> = {
    free:         5,
    pro:          50,
    enterprise:  500,
};

const CHAT_LIMITS: Record<string, number> = {
    free:        10,
    pro:         30,
    enterprise: 100,
};

// Factory

function buildLimiter(
    overrides: Partial<Options> & {
        max: number | ((req: Request) => number);
        message?: string;
    },
    ) {
    return rateLimit({
        standardHeaders: true,
        legacyHeaders:   false,

        message: {
        success:    false,
        statusCode: 429,
        error: {
            code:    'RATE_LIMITED',
            message: overrides.message ?? 'Too many requests. Please slow down.',
        },
        },

        // Default key: authenticated user ID — follows the user across IPs.
        // Auth endpoints override this with the ipKeyGenerator helper (see below).
        keyGenerator: (req: Request) =>
        (req as any).user?.id ?? req.ip ?? 'anonymous',

        ...overrides,
    });
}

// Auth limiter
// Routes:  POST /auth/register, /auth/login, /auth/refresh
// Key:     IP address — user not yet authenticated, no user.id available
// Fix:     ipKeyGenerator normalises IPv4-mapped IPv6 addresses so
//          "::ffff:1.2.3.4" and "1.2.3.4" resolve to the same bucket.

export const authLimiter = buildLimiter({
    windowMs: 15 * 60 * 1_000,
    max:      10,
    message:  'Too many auth attempts. Please try again in 15 minutes.',
    keyGenerator: (req) => ipKeyGenerator(req.ip ?? 'anonymous'),
});

// ── General API limiter
// Routes:  All authenticated /api/v1/* endpoints
// Key:     User ID (set by JWT guard before this runs)

export const apiLimiter = buildLimiter({
    windowMs: 15 * 60 * 1_000,
    max: (req: Request) => {
        const tier = (req as any).user?.tier ?? 'free';
        return API_LIMITS[tier] ?? API_LIMITS.free;
    },
    message: 'API rate limit exceeded. Upgrade your plan for higher limits.',
});

// Upload limiter
// Routes:  POST /documents
// 1-hour window — uploads trigger chunking + embedding (expensive).

export const uploadLimiter = buildLimiter({
    windowMs: 60 * 60 * 1_000,
    max: (req: Request) => {
        const tier = (req as any).user?.tier ?? 'free';
        return UPLOAD_LIMITS[tier] ?? UPLOAD_LIMITS.free;
    },
    message: 'Upload limit reached. You can upload more documents next hour.',
});

//  Chat limiter
// Routes:  POST /conversations/:id/messages
// 1-minute window — every message calls the LLM (most expensive operation).

export const chatLimiter = buildLimiter({
    windowMs: 60 * 1_000,
    max: (req: Request) => {
        const tier = (req as any).user?.tier ?? 'free';
        return CHAT_LIMITS[tier] ?? CHAT_LIMITS.free;
    },
    message: 'Chat rate limit exceeded. Please wait a moment before sending another message.',
});