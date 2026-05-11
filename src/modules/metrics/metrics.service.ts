
import { Injectable } from '@nestjs/common';
import * as promClient from 'prom-client';

@Injectable()
export class MetricsService {
    private readonly registry: promClient.Registry;

    readonly httpRequestsTotal:   promClient.Counter<string>;
    readonly httpRequestDuration: promClient.Histogram<string>;
    readonly documentsProcessed:  promClient.Counter<string>;
    readonly activeQueueJobs:     promClient.Gauge<string>;
    readonly cacheOperations:     promClient.Counter<string>;
    readonly embeddingCostUsd:    promClient.Counter<string>;

    constructor() {
        this.registry = new promClient.Registry();

        promClient.collectDefaultMetrics({ register: this.registry, prefix: 'docuchat_node_' });

        this.httpRequestsTotal = new promClient.Counter({
        name: 'docuchat_http_requests_total',
        help: 'Total HTTP requests',
        labelNames: ['method', 'path', 'status_code'],
        registers: [this.registry],
        });

        this.httpRequestDuration = new promClient.Histogram({
        name: 'docuchat_http_request_duration_seconds',
        help: 'HTTP request duration in seconds',
        labelNames: ['method', 'path'],
        buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
        registers: [this.registry],
        });

        this.documentsProcessed = new promClient.Counter({
        name: 'docuchat_documents_processed_total',
        help: 'Documents processed by the ingestion pipeline',
        labelNames: ['status', 'format'],
        registers: [this.registry],
        });

        this.activeQueueJobs = new promClient.Gauge({
        name: 'docuchat_active_queue_jobs',
        help: 'Currently active jobs per queue',
        labelNames: ['queue'],
        registers: [this.registry],
        });

        this.cacheOperations = new promClient.Counter({
        name: 'docuchat_cache_operations_total',
        help: 'Cache get/set operations with hit/miss result',
        labelNames: ['operation', 'result'],
        registers: [this.registry],
        });

        this.embeddingCostUsd = new promClient.Counter({
        name: 'docuchat_embedding_cost_usd_total',
        help: 'Cumulative OpenAI embedding cost in USD',
        registers: [this.registry],
        });
    }

    // Replaces UUIDs and numeric IDs with :id / :num to prevent cardinality explosion
    normalisePath(path: string): string {
        return path
        .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id')
        .replace(/\/\d+/g, '/:num');
    }

    recordRequest(method: string, path: string, statusCode: number): void {
        this.httpRequestsTotal.inc({
        method,
        path:        this.normalisePath(path),
        status_code: String(statusCode),
        });
    }

    startRequestTimer(method: string, path: string): () => void {
        return this.httpRequestDuration.startTimer({
        method,
        path: this.normalisePath(path),
        });
    }

    async getMetrics(): Promise<string> {
        return this.registry.metrics();
    }

    getContentType(): string {
        return this.registry.contentType;
    }
}