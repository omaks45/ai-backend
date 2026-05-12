
// Wraps MetricsService in a proper NestJS module so it can be imported
// by AppModule. MetricsService is exported so MetricsMiddleware (and any
// controller that serves the /metrics endpoint) can inject it.

import { Module }         from '@nestjs/common';
import { MetricsService } from './metrics.service';
import { MetricsMiddleware } from 'src/common/middleware/metrics.middleware';

@Module({
  providers: [MetricsService, MetricsMiddleware],
  exports:   [MetricsService, MetricsMiddleware],
})
export class MetricsModule {}