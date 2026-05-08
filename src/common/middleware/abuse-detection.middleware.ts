
import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CacheService } from '../../modules/cache/cache.service';

const SCRAPE_THRESHOLD  = 50;
const SCRAPE_WINDOW_SEC = 300; // 5 minutes
const DOC_PATH_PATTERN  = /\/documents\/([0-9a-f-]{36})/i;

@Injectable()
export class AbuseDetectionMiddleware implements NestMiddleware {
    private readonly logger = new Logger(AbuseDetectionMiddleware.name);

    constructor(
        private readonly cache: CacheService,
        private readonly events: EventEmitter2,
    ) {}

    async use(req: Request, _res: Response, next: NextFunction): Promise<void> {
        const userId = (req as any).user?.id;
        if (!userId) return next();

        const match = req.path.match(DOC_PATH_PATTERN);
        if (match) {
        await this.trackDocAccess(userId, match[1]);
        }

        next();
    }

    private async trackDocAccess(userId: string, docId: string): Promise<void> {
        try {
        const key   = `abuse:docs:${userId}`;
        const isNew = await this.cache.sadd(key, docId);

        if (isNew === 1) {
            await this.cache.expire(key, SCRAPE_WINDOW_SEC);
        }

        const count = await this.cache.scard(key);
        if (count >= SCRAPE_THRESHOLD) {
            this.logger.warn('Potential scraping detected', { userId, count });
            this.events.emit('security.scraping.detected', { userId, uniqueDocsIn5Min: count });
        }
        } catch (err) {
        // Never block a request due to abuse detection failure
        this.logger.error('Abuse detection error', err);
        }
    }
}