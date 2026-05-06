
//
// WHY HTTP SECURITY HEADERS?
// Modern browsers implement security policies based on response headers.
// Setting the right headers means the browser ENFORCES security rules
// automatically — defence-in-depth for free without application logic.
//
// KEY HEADERS EXPLAINED:
//
//  Content-Security-Policy (CSP)
//    Tells the browser which sources may load scripts, styles, images.
//    If XSS injects <script src="evil.com/steal.js">, CSP blocks it
//    because evil.com is not in the allowlist.
//    API-only backend: default-src 'none' — nothing should load from
//    our responses as a webpage. Relaxed only for /api-docs (Swagger).
//
//  Strict-Transport-Security (HSTS)
//    Forces HTTPS for all future requests to this domain for 180 days.
//    Prevents SSL-stripping attacks.
//
//  X-Content-Type-Options: nosniff
//    Prevents browsers from guessing (sniffing) the MIME type.
//    Without this, a browser might interpret text/plain containing HTML
//    as text/html and execute embedded scripts.
//
//  X-Frame-Options: SAMEORIGIN
//    Prevents clickjacking: wrapping your app in an evil.com <iframe>.
//
//  Referrer-Policy: no-referrer
//    Stops leaking internal URLs to third-party services via Referer header.
//
// WHY CORS?
//  Without CORS a malicious page at evil.com can fire authenticated requests
//  to api.docuchat.com using the user's browser session.
//
//  WHY NOT origin: '*'?
//    Wildcard allows ANY website to call your API from a browser.
//    Always use explicit origins in production.
//
//  credentials: true
//    Allows the browser to include Authorization headers in cross-origin
//    requests. Required for JWT auth to work across origins.
//
//  maxAge: 86400
//    Browsers send an OPTIONS preflight before the actual request.
//    Caching it for 24 hours eliminates one HTTP request per API call.

import helmet    from 'helmet';
import cors, { CorsOptions } from 'cors';
import { Application } from 'express';

//  Build CORS options 

export function buildCorsOptions(allowedOrigins: string[]): CorsOptions {
    return {
        origin: (origin, callback) => {
        // No Origin header = curl / Postman / server-to-server — always allow
        if (!origin) return callback(null, true);

        if (allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error(`Origin '${origin}' is not allowed by CORS policy`));
        }
        },
        credentials:    true,
        methods:        ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'X-Correlation-Id'],
        // Expose these response headers to the browser JavaScript
        exposedHeaders: [
        'X-Correlation-Id',
        'RateLimit-Limit',
        'RateLimit-Remaining',
        'RateLimit-Reset',
        ],
        maxAge: 86_400, // Cache preflight 24 hours — halves HTTP requests
    };
}

//  Apply all security middleware to an Express app 
// Called once in main.ts BEFORE NestJS sets global prefix/versioning.

export function applySecurityMiddleware(
    app: Application,
    allowedOrigins: string[],
    ): void {

    // 1. CORS — before Helmet so preflight OPTIONS requests are handled first
    app.use(cors(buildCorsOptions(allowedOrigins)));

    // 2. Helmet — strict policy for all routes …
    app.use(
        helmet({
        contentSecurityPolicy: {
            directives: {
            defaultSrc: ["'none'"],
            connectSrc: ["'self'"],
            // No scriptSrc / styleSrc / imgSrc — this is an API, not a webpage
            },
        },
        strictTransportSecurity: {
            maxAge:            15_552_000, // 180 days
            includeSubDomains: true,
        },
        xXssProtection:      false,  // Disable old filter — CSP is strictly better
        xContentTypeOptions: true,   // nosniff
        frameguard:          { action: 'sameorigin' },
        referrerPolicy:      { policy: 'no-referrer' },
        }),
    );

    // 3. … then RELAX CSP only for Swagger UI (uses inline scripts + styles)
    app.use(
        '/api-docs',
        helmet({
        contentSecurityPolicy: {
            directives: {
            defaultSrc: ["'self'"],
            scriptSrc:  ["'self'", "'unsafe-inline'"],
            styleSrc:   ["'self'", "'unsafe-inline'"],
            imgSrc:     ["'self'", 'data:'],
            connectSrc: ["'self'"],
            },
        },
        }),
    );
}