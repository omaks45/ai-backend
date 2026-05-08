
import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { CacheService } from '../../modules/cache/cache.service';

const FAILURE_WINDOW_SEC = 15 * 60;
const WARN_THRESHOLD     = 5;
const ALERT_THRESHOLD    = 10;

@Injectable()
export class SecurityEventsListener {
    private readonly logger = new Logger(SecurityEventsListener.name);

    constructor(private readonly cache: CacheService) {}

    @OnEvent('auth.login.failed')
    async onLoginFailed(data: { email: string; deviceInfo?: string }): Promise<void> {
        try {
        const key      = `security:login-failures:${data.email}`;
        const failures = await this.cache.incr(key);

        if (failures === 1) {
            await this.cache.expire(key, FAILURE_WINDOW_SEC);
        }

        if (failures >= ALERT_THRESHOLD) {
            this.logger.error('High failed login volume — potential brute force', {
            email: data.email, failures,
            });
        } else if (failures >= WARN_THRESHOLD) {
            this.logger.warn('Multiple failed login attempts', {
            email: data.email, failures,
            });
        }
        } catch (err) {
        this.logger.error('Failed to track login failure', err);
        }
    }

    @OnEvent('security.scraping.detected')
    onScrapingDetected(data: { userId: string; uniqueDocsIn5Min: number }): void {
        this.logger.warn('Document scraping pattern detected', data);
    }
}