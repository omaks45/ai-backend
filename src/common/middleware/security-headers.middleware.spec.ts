
import { buildCorsOptions } from './security-headers.middleware';

describe('buildCorsOptions', () => {
    const origins  = ['http://localhost:3001', 'https://app.docuchat.com'];
    const options  = buildCorsOptions(origins);

    // Helper: call the origin callback and return a promise
    function resolveOrigin(origin: string | undefined): Promise<boolean> {
        return new Promise((resolve, reject) => {
        (options.origin as Function)(
            origin,
            (err: Error | null, allow?: boolean) => {
            if (err) reject(err);
            else resolve(allow ?? false);
            },
        );
        });
    }

    //  Origin validation

    describe('origin callback', () => {
        it('allows requests with no Origin (curl, Postman, server-to-server)', async () => {
        await expect(resolveOrigin(undefined)).resolves.toBe(true);
        });

        it('allows listed origins', async () => {
        await expect(resolveOrigin('http://localhost:3001')).resolves.toBe(true);
        await expect(resolveOrigin('https://app.docuchat.com')).resolves.toBe(true);
        });

        it('rejects unlisted origins', async () => {
        await expect(resolveOrigin('https://evil.com')).rejects.toThrow('not allowed');
        });

        it('rejects subdomains not explicitly in the list', async () => {
        await expect(resolveOrigin('https://admin.docuchat.com')).rejects.toThrow();
        });

        it('is case-sensitive (https ≠ HTTP)', async () => {
        await expect(resolveOrigin('HTTP://localhost:3001')).rejects.toThrow();
        });
    });

    //  CORS option values

    it('enables credentials (required for JWT Authorization header)', () => {
        expect(options.credentials).toBe(true);
    });

    it('includes all standard HTTP methods', () => {
        const methods = options.methods as string[];
        ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'].forEach((m) => {
        expect(methods).toContain(m);
        });
    });

    it('allows Authorization and X-Correlation-Id headers', () => {
        const headers = options.allowedHeaders as string[];
        expect(headers).toContain('Authorization');
        expect(headers).toContain('X-Correlation-Id');
    });

    it('exposes RateLimit-* and X-Correlation-Id response headers', () => {
        const exposed = options.exposedHeaders as string[];
        expect(exposed).toContain('X-Correlation-Id');
        expect(exposed).toContain('RateLimit-Remaining');
        expect(exposed).toContain('RateLimit-Reset');
    });

    it('caches preflight for 24 hours', () => {
        expect(options.maxAge).toBe(86_400);
    });
});