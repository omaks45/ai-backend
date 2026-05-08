import { Test, TestingModule } from '@nestjs/testing';
import { RequestLoggerMiddleware } from './request-logger.middleware';
import { AppLoggerService }        from '../../modules/logger/logger.service';

const mockLogger = {
    http:  jest.fn(),
    info:  jest.fn(),
    warn:  jest.fn(),
    error: jest.fn(),
    log:   jest.fn(),
    debug: jest.fn(),
};

function makeReq(overrides: Partial<any> = {}): any {
    return {
        method:  'GET',
        path:    '/api/v1/documents',
        ip:      '127.0.0.1',
        headers: {},
        user:    undefined,
        ...overrides,
    };
}

function makeRes(statusCode = 200): any {
    const listeners: Record<string, Function[]> = {};
    return {
        statusCode,
        setHeader: jest.fn(),
        on: (event: string, cb: Function) => {
        listeners[event] = listeners[event] ?? [];
        listeners[event].push(cb);
        },
        _emit: (event: string) => (listeners[event] ?? []).forEach((fn) => fn()),
    };
}

describe('RequestLoggerMiddleware', () => {
    let middleware: RequestLoggerMiddleware;
    const mockNext = jest.fn();

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
        providers: [
            RequestLoggerMiddleware,
            { provide: AppLoggerService, useValue: mockLogger },
        ],
        }).compile();

        middleware = module.get<RequestLoggerMiddleware>(RequestLoggerMiddleware);
        jest.clearAllMocks();
    });

    it('attaches a correlationId to req', () => {
        const req = makeReq();
        middleware.use(req, makeRes(), mockNext);
        expect(req.correlationId).toBeDefined();
        expect(typeof req.correlationId).toBe('string');
    });

    it('reuses X-Correlation-Id header when present', () => {
        const req = makeReq({ headers: { 'x-correlation-id': 'existing-id' } });
        middleware.use(req, makeRes(), mockNext);
        expect(req.correlationId).toBe('existing-id');
    });

    it('generates a UUID v4 when no header is present', () => {
        const req = makeReq({ headers: {} });
        middleware.use(req, makeRes(), mockNext);
        expect(req.correlationId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
        );
    });

    it('sets X-Correlation-Id on the response', () => {
        const res = makeRes();
        const req = makeReq();
        middleware.use(req, res, mockNext);
        expect(res.setHeader).toHaveBeenCalledWith('X-Correlation-Id', req.correlationId);
    });

    it('calls next()', () => {
        middleware.use(makeReq(), makeRes(), mockNext);
        expect(mockNext).toHaveBeenCalled();
    });

    it('logs the incoming request via logger.http()', () => {
        middleware.use(makeReq(), makeRes(), mockNext);
        expect(mockLogger.http).toHaveBeenCalledWith(
        'Request received',
        expect.objectContaining({ method: 'GET', path: '/api/v1/documents' }),
        );
    });

    it('calls logger.info() on 200 finish', () => {
        const res = makeRes(200);
        middleware.use(makeReq(), res, mockNext);
        res._emit('finish');
        expect(mockLogger.info).toHaveBeenCalledWith(
        'Request completed',
        expect.objectContaining({ statusCode: 200 }),
        );
    });

    it('calls logger.warn() on 400 finish', () => {
        const res = makeRes(404);
        middleware.use(makeReq(), res, mockNext);
        res._emit('finish');
        expect(mockLogger.warn).toHaveBeenCalledWith(
        'Request client error',
        expect.objectContaining({ statusCode: 404 }),
        );
    });

    it('calls logger.error() on 500 finish', () => {
        const res = makeRes(500);
        middleware.use(makeReq(), res, mockNext);
        res._emit('finish');
        expect(mockLogger.error).toHaveBeenCalledWith(
        'Request failed',
        expect.objectContaining({ statusCode: 500 }),
        );
    });
});