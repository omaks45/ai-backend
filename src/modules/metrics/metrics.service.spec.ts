
import { Test, TestingModule } from '@nestjs/testing';
import { MetricsService } from './metrics.service';

describe('MetricsService', () => {
    let service: MetricsService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
        providers: [MetricsService],
        }).compile();
        service = module.get<MetricsService>(MetricsService);
    });

    it('is defined', () => expect(service).toBeDefined());

    it('exposes all metric objects', () => {
        expect(service.httpRequestsTotal).toBeDefined();
        expect(service.httpRequestDuration).toBeDefined();
        expect(service.documentsProcessed).toBeDefined();
        expect(service.activeQueueJobs).toBeDefined();
        expect(service.cacheOperations).toBeDefined();
        expect(service.embeddingCostUsd).toBeDefined();
    });

    describe('normalisePath', () => {
        it('replaces UUIDs with :id', () => {
        expect(service.normalisePath('/documents/f47ac10b-58cc-4372-a567-0e02b2c3d479'))
            .toBe('/documents/:id');
        });

        it('replaces numeric segments with :num', () => {
        expect(service.normalisePath('/items/42')).toBe('/items/:num');
        });

        it('replaces multiple UUIDs', () => {
        expect(service.normalisePath(
            '/users/f47ac10b-58cc-4372-a567-0e02b2c3d479/documents/f47ac10b-58cc-4372-a567-0e02b2c3d480',
        )).toBe('/users/:id/documents/:id');
        });

        it('leaves plain paths unchanged', () => {
        expect(service.normalisePath('/api/v1/auth/login')).toBe('/api/v1/auth/login');
        });
    });

    describe('recordRequest', () => {
        it('does not throw', () => {
        expect(() => service.recordRequest('GET', '/documents', 200)).not.toThrow();
        });
    });

    describe('startRequestTimer', () => {
        it('returns a callable end function', () => {
        const end = service.startRequestTimer('POST', '/documents');
        expect(typeof end).toBe('function');
        expect(() => end()).not.toThrow();
        });
    });

    describe('getMetrics', () => {
        it('returns a non-empty Prometheus text string', async () => {
        service.recordRequest('GET', '/test', 200);
        const metrics = await service.getMetrics();
        expect(metrics).toContain('docuchat_http_requests_total');
        });
    });

    it('returns a valid content type', () => {
        expect(service.getContentType()).toContain('text/plain');
    });
});