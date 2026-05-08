import { Test, TestingModule } from '@nestjs/testing';
import { AppLoggerService } from './logger.service';

describe('AppLoggerService', () => {
    let service: AppLoggerService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
        providers: [AppLoggerService],
        }).compile();
        service = module.get<AppLoggerService>(AppLoggerService);
    });

    it('is defined', () => expect(service).toBeDefined());

    it('implements NestJS LoggerService interface', () => {
        expect(typeof service.log).toBe('function');
        expect(typeof service.error).toBe('function');
        expect(typeof service.warn).toBe('function');
        expect(typeof service.debug).toBe('function');
        expect(typeof service.verbose).toBe('function');
    });

    it('log() does not throw', () => {
        expect(() => service.log('test message')).not.toThrow();
    });

    it('error() does not throw', () => {
        expect(() => service.error('error', { code: 'ERR' })).not.toThrow();
    });

    it('warn() does not throw', () => {
        expect(() => service.warn('warning')).not.toThrow();
    });

    it('info() with context does not throw', () => {
        expect(() => service.info('info', { userId: 'u1' })).not.toThrow();
    });

    it('http() does not throw', () => {
        expect(() => service.http('GET /test', { statusCode: 200 })).not.toThrow();
    });

    it('handles messages containing sensitive patterns without throwing', () => {
        expect(() => service.error('Token: Bearer eyJhbGciOiJIUzI1NiJ9.x.y')).not.toThrow();
        expect(() => service.error('Key: sk-abc123def456ghi789jklmno')).not.toThrow();
        expect(() => service.error('DB: postgresql://user:pass@localhost/db')).not.toThrow();
    });
});