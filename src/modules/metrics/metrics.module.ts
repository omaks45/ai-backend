
// Wraps MetricsService in a proper NestJS module so it can be imported
// by AppModule. MetricsService is exported so MetricsMiddleware (and any
// controller that serves the /metrics endpoint) can inject it.

import { Module }         from '@nestjs/common';
import { MetricsService } from './metrics.service';

@Module({
  providers: [MetricsService],
  exports:   [MetricsService],
})
export class MetricsModule {}