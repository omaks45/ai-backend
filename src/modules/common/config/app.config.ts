// Single source of truth for every environment variable.
// Validated at startup — the app refuses to start with a bad config.

import { registerAs } from '@nestjs/config';

export const appConfig = registerAs('app', () => ({
    nodeEnv: process.env.NODE_ENV ?? 'development',
    port: parseInt(process.env.PORT ?? '3000', 10),
    apiPrefix: process.env.API_PREFIX ?? 'api/v1',
    isDev: (process.env.NODE_ENV ?? 'development') === 'development',
    isProd: process.env.NODE_ENV === 'production',
}));

export const databaseConfig = registerAs('database', () => ({
    url: process.env.DATABASE_URL,
}));

export const redisConfig = registerAs('redis', () => ({
    host: process.env.REDIS_HOST ?? 'localhost',
    port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
    password: process.env.REDIS_PASSWORD ?? undefined,
    db: parseInt(process.env.REDIS_DB ?? '0', 10),
    ttl: parseInt(process.env.REDIS_TTL ?? '3600', 10),
}));

export const jwtConfig = registerAs('jwt', () => ({
    secret: process.env.JWT_SECRET,
    expiry: process.env.JWT_EXPIRY ?? '15m',
    refreshSecret: process.env.JWT_REFRESH_SECRET,
    refreshExpiry: process.env.JWT_REFRESH_EXPIRY ?? '7d',
}));

export const throttleConfig = registerAs('throttle', () => ({
    ttl: parseInt(process.env.THROTTLE_TTL ?? '60000', 10),
    limit: parseInt(process.env.THROTTLE_LIMIT ?? '100', 10),
}));

export const aiConfig = registerAs('ai', () => ({
    openaiKey: process.env.OPENAI_API_KEY,
    anthropicKey: process.env.ANTHROPIC_API_KEY,
}));

// All config namespaces in one array — pass to ConfigModule.forRoot()
export const ALL_CONFIG = [
    appConfig,
    databaseConfig,
    redisConfig,
    jwtConfig,
    throttleConfig,
    aiConfig,
];