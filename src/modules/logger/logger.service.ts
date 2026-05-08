import { Injectable, LoggerService } from '@nestjs/common';
import * as winston from 'winston';

const REDACT_PATTERNS = [
    { pattern: /Bearer [A-Za-z0-9\-._~+/]+=*/g,  replacement: 'Bearer [REDACTED]'       },
    { pattern: /sk-[A-Za-z0-9]{20,}/g,            replacement: '[OPENAI_KEY_REDACTED]'   },
    { pattern: /"password"\s*:\s*"[^"]+"/gi,       replacement: '"password":"[REDACTED]"' },
    { pattern: /postgresql:\/\/[^@]+@/g,           replacement: 'postgresql://[REDACTED]@'},
];

function redact(message: string): string {
    return REDACT_PATTERNS.reduce(
        (msg, { pattern, replacement }) => msg.replace(pattern, replacement),
        message,
    );
}

const redactFormat = winston.format((info) => {
    if (typeof info.message === 'string') info.message = redact(info.message);
    if (typeof info.stack   === 'string') info.stack   = redact(info.stack);
    return info;
});

function createWinstonLogger() {
    const isProd = process.env.NODE_ENV === 'production';

    return winston.createLogger({
        level:       isProd ? 'info' : 'debug',
        defaultMeta: { service: 'docuchat' },
        format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        redactFormat(),
        isProd
            ? winston.format.json()
            : winston.format.combine(
                winston.format.colorize(),
                winston.format.printf(({ timestamp, level, message, service, ...meta }) => {
                const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
                return `${timestamp} [${level}]: ${message}${metaStr}`;
                }),
            ),
        ),
        transports: [new winston.transports.Console()],
    });
}

@Injectable()
export class AppLoggerService implements LoggerService {
    private readonly logger = createWinstonLogger();

    log(message: string, ...meta: any[])     { this.logger.info(message,    this.parseMeta(meta)); }
    error(message: string, ...meta: any[])   { this.logger.error(message,   this.parseMeta(meta)); }
    warn(message: string, ...meta: any[])    { this.logger.warn(message,    this.parseMeta(meta)); }
    debug(message: string, ...meta: any[])   { this.logger.debug(message,   this.parseMeta(meta)); }
    verbose(message: string, ...meta: any[]) { this.logger.verbose(message, this.parseMeta(meta)); }

    info(message: string, context?: Record<string, unknown>) {
        this.logger.info(message, context ?? {});
    }

    http(message: string, context?: Record<string, unknown>) {
        this.logger.http(message, context ?? {});
    }

    private parseMeta(meta: any[]): Record<string, unknown> {
        if (!meta.length) return {};
        if (meta.length === 1 && meta[0] !== null && typeof meta[0] === 'object') return meta[0];
        return { context: meta };
    }
}

// Standalone instance for use outside DI (workers, seeds)
export const logger = createWinstonLogger();