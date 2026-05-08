
// WHAT IS A CORRELATION ID?
// A unique UUID generated for EVERY incoming HTTP request. It is:
//   - Attached to req.correlationId so all code in that request can log it
//   - Returned in X-Correlation-Id response header (client uses it for bug reports)
//   - Included in EVERY log line produced during that request's lifetime
//
// WHY DOES THIS MATTER?
// Without correlation IDs:
//   grep "error" logs.txt → 20 errors from 20 different requests, mixed together.
//
// With correlation IDs:
//   grep "corr-abc-123" logs.txt → EVERY log line from that ONE request:
//   incoming request → DB query → cache miss → OpenAI call → error → response.
//   A complete timeline. Debugging goes from hours to minutes.
//
// CORRELATION ID FLOWS INTO WEEK 4:
//   documents.controller.ts passes req.correlationId to
//   documentProcessor.enqueue(docId, userId, correlationId)
//   The BullMQ worker includes it in every log line.
//   You can trace a document from upload → worker → chunks → embeddings
//   using a single correlationId search in your log tool.
//
// LOG LEVELS BY STATUS CODE:
//   5xx → error  (broke on our side — needs investigation)
//   4xx → warn   (client did something wrong — security monitoring)
//   2xx/3xx → info (normal operation)
//
// WHY res.on('finish') NOT res.on('close')?
// 'finish' fires when the response is handed off to the OS for sending.
// 'close' fires when the TCP connection closes — much later, or never
// (keep-alive connections). 'finish' is correct for measuring request duration.

import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import { AppLoggerService } from '../../modules/logger/logger.service';

@Injectable()
export class RequestLoggerMiddleware implements NestMiddleware {
    constructor(private readonly logger: AppLoggerService) {}

    use(req: Request, res: Response, next: NextFunction): void {
        // Reuse incoming ID (from API gateway / upstream service) or generate fresh
        const correlationId =
        (req.headers['x-correlation-id'] as string) ?? randomUUID();

        (req as any).correlationId = correlationId;
        res.setHeader('X-Correlation-Id', correlationId);

        const startTime = Date.now();

        this.logger.http('Request received', {
        correlationId,
        method:    req.method,
        path:      req.path,
        ip:        req.ip,
        userAgent: req.headers['user-agent'],
        });

        res.on('finish', () => {
        const durationMs = Date.now() - startTime;
        const statusCode = res.statusCode;

        const logData = {
            correlationId,
            method:     req.method,
            path:       req.path,
            statusCode,
            durationMs,
            userId:     (req as any).user?.id,
        };

        if (statusCode >= 500)      this.logger.error('Request failed',       logData);
        else if (statusCode >= 400) this.logger.warn('Request client error',  logData);
        else                        this.logger.info('Request completed',     logData);
        });

        next();
    }
}