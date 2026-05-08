
import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { PrismaService } from '../../database/prisma.service';
import { CacheService }  from '../cache/cache.service';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache:  CacheService,
  ) {}

  // Liveness: process is alive — no I/O, always fast
  @Get('live')
  @ApiOperation({ summary: 'Liveness probe — is the process running?' })
  @ApiResponse({ status: 200, description: 'Process is alive' })
  liveness() {
    return {
      status:    'ok',
      timestamp: new Date().toISOString(),
      uptime:    Math.floor(process.uptime()),
    };
  }

  // Readiness: can the process handle requests — checks DB + Redis
  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe — are all dependencies reachable?' })
  @ApiResponse({ status: 200, description: 'All dependencies healthy' })
  @ApiResponse({ status: 503, description: 'One or more dependencies down' })
  async readiness() {
    const checks: Record<string, { status: string; latencyMs?: number; message?: string }> = {};

    const dbStart = Date.now();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      checks.database = { status: 'ok', latencyMs: Date.now() - dbStart };
    } catch (err) {
      checks.database = { status: 'error', message: (err as Error).message };
    }

    const redisStart = Date.now();
    try {
      await this.cache.ping();
      checks.redis = { status: 'ok', latencyMs: Date.now() - redisStart };
    } catch (err) {
      checks.redis = { status: 'error', message: (err as Error).message };
    }

    const allHealthy = Object.values(checks).every((c) => c.status === 'ok');

    return {
      status:    allHealthy ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      uptime:    Math.floor(process.uptime()),
      checks,
    };
  }
}