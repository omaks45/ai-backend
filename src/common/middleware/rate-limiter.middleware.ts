
//
// WEEK 3 DAY 2 — RATE LIMITING
//
// WHY RATE LIMITING?
// Without it a single user can fire unlimited requests, each potentially
// triggering a database query, a Redis lookup, and an expensive OpenAI call.
// Rate limiting is the bouncer: it decides how many requests a user can make
// in a given window and politely turns them away when they exceed it.
//
// WHY SLIDING WINDOW OVER FIXED WINDOW?
// Fixed window resets at clock boundaries. A user can fire N requests at
// 12:00:59 and N more at 12:01:00 — 2N requests in 2 seconds. Sliding window
// always looks at the last N seconds from NOW, so the effective rate is always
// ≤ the configured limit. No boundary burst.
//
// WHY REDIS-BACKED AND NOT IN-MEMORY?
// In-memory rate limiting is per-process. Running 3 Node.js instances means
// users get 3× the allowed rate. Redis is a single shared store — limits are
// enforced consistently across ALL instances.
//
// WHY TIER-BASED LIMITS?
// A free user hammering the API should not get the same allowance as an
// enterprise customer who pays thousands per month. The max() callback
// receives the request and returns the correct limit for the user's tier.
//
// WHY STACK LIMITERS?
// POST /documents goes through BOTH apiLimiter (general budget) AND
// uploadLimiter (upload-specific budget). Users can exhaust their upload
// budget while still having general API budget. Separate concerns = separate
// counters.
//
// RATE LIMIT HEADERS (RFC 6585):
// express-rate-limit automatically sends:
//   RateLimit-Limit:     total allowed this window
//   RateLimit-Remaining: how many left
//   RateLimit-Reset:     Unix timestamp when window resets
//   Retry-After:         seconds to wait (only on 429 responses)

import rateLimit, { Options } from 'express-rate-limit';
import { Request } from 'express';

//  Tier limit tables — one place to change limits for the whole app

const API_LIMITS: Record<string, number> = {
    free:       100,
    pro:        500,
    enterprise: 2_000,
};

const UPLOAD_LIMITS: Record<string, number> = {
    free:         5,
    pro:         50,
    enterprise: 500,
};

const CHAT_LIMITS: Record<string, number> = {
    free:       10,
    pro:        30,
    enterprise: 100,
};

// Factory: DRY helper — all limiters share the same defaults

function buildLimiter(
    overrides: Partial<Options> & {
        max: number | ((req: Request) => number);
        message?: string;
    },
    ) {
    return rateLimit({
        standardHeaders: true,   // RFC-compliant RateLimit-* headers
        legacyHeaders:   false,  // Suppress deprecated X-RateLimit-* headers

        // Consistent API error envelope — same shape as every other error
        message: {
        success:    false,
        statusCode: 429,
        error: {
            code:    'RATE_LIMITED',
            message: overrides.message ?? 'Too many requests. Please slow down.',
        },
        },

        // Default key: authenticated user ID — follows the user across IPs.
        // Auth endpoints override this with IP (user not yet known).
        keyGenerator: (req: Request) =>
        (req as any).user?.id ?? req.ip ?? 'anonymous',

        ...overrides,
    });
}

//  Auth limiter
// Routes:  POST /auth/register, /auth/login, /auth/refresh
// Key:     IP address (user not yet authenticated)
// Why 10?  10 attempts/15min → trying 1000 passwords takes 25 hours.

export const authLimiter = buildLimiter({
    windowMs: 15 * 60 * 1_000, // 15 minutes
    max:      10,
    message:  'Too many auth attempts. Please try again in 15 minutes.',
    keyGenerator: (req: Request) => req.ip ?? 'anonymous',
});

//  General API limiter
// Routes:  All authenticated /api/v1/* endpoints
// Key:     User ID
// max():   Returns the correct limit for the user's tier dynamically.

export const apiLimiter = buildLimiter({
    windowMs: 15 * 60 * 1_000,
    max: (req: Request) => {
        const tier = (req as any).user?.tier ?? 'free';
        return API_LIMITS[tier] ?? API_LIMITS.free;
    },
    message: 'API rate limit exceeded. Upgrade your plan for higher limits.',
});

//Upload limiter
// Routes:  POST /documents
// Stacks on top of apiLimiter.
// 1-hour window because uploads trigger chunking + embedding (expensive).

export const uploadLimiter = buildLimiter({
    windowMs: 60 * 60 * 1_000, // 1 hour
    max: (req: Request) => {
        const tier = (req as any).user?.tier ?? 'free';
        return UPLOAD_LIMITS[tier] ?? UPLOAD_LIMITS.free;
    },
    message: 'Upload limit reached. You can upload more documents next hour.',
});

//  Chat / AI limiter
// Routes:  POST /conversations/:id/messages
// Tightest window (1 minute) — every message calls OpenAI.

export const chatLimiter = buildLimiter({
    windowMs: 60 * 1_000, // 1 minute
    max: (req: Request) => {
        const tier = (req as any).user?.tier ?? 'free';
        return CHAT_LIMITS[tier] ?? CHAT_LIMITS.free;
    },
    message: 'Chat rate limit exceeded. Please wait a moment before sending another message.',
});