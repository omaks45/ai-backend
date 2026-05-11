
// NestJS-compatible middleware that records HTTP request counts and durations
// using MetricsService (prom-client). Applied globally in AppModule.configure().
//
// SEPARATION OF CONCERNS:
//   MetricsService  — owns all prom-client counters/histograms/registries
//   MetricsMiddleware — intercepts requests and calls MetricsService to record them
//
// This split is required because NestJS middleware must implement NestMiddleware,
// and MetricsService is an @Injectable() service, not a middleware class.
// Putting recording logic in the service and wiring in middleware keeps both clean.

import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { MetricsService } from '../../modules/metrics/metrics.service';

@Injectable()
export class MetricsMiddleware implements NestMiddleware {
    constructor(private readonly metrics: MetricsService) {}

    use(req: Request, res: Response, next: NextFunction): void {
        const stopTimer = this.metrics.startRequestTimer(req.method, req.path);

        // Record after response is sent so we capture the final status code
        res.on('finish', () => {
        this.metrics.recordRequest(req.method, req.path, res.statusCode);
        stopTimer();
        });

        next();
    }
}