import { Test, TestingModule } from '@nestjs/testing';
import { AgentMetricsService } from './agent-metrics.service';

// ─────────────────────────────────────────────────────────────────────────────
// AgentMetricsService tests
//
// Mirrors the pattern in metrics.service.spec.ts:
//   - Verify every metric object is defined
//   - Verify helper methods don't throw under normal use
//   - Verify Prometheus output contains the expected metric names
//   - Verify content-type is the standard Prometheus text format
//
// No LLM calls, no database, no external I/O — this service is pure
// in-process Prometheus instrumentation.
// ─────────────────────────────────────────────────────────────────────────────

describe('AgentMetricsService', () => {
    let service: AgentMetricsService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
        providers: [AgentMetricsService],
        }).compile();

        service = module.get<AgentMetricsService>(AgentMetricsService);
    });

    it('is defined', () => expect(service).toBeDefined());

    // Metric objects

    describe('metric objects', () => {
        it('exposes agentIterations histogram', () => {
        expect(service.agentIterations).toBeDefined();
        });

        it('exposes agentCostUsd histogram', () => {
        expect(service.agentCostUsd).toBeDefined();
        });

        it('exposes agentTerminations counter', () => {
        expect(service.agentTerminations).toBeDefined();
        });

        it('exposes agentToolCallsTotal counter', () => {
        expect(service.agentToolCallsTotal).toBeDefined();
        });

        it('exposes agentDurationSeconds histogram', () => {
        expect(service.agentDurationSeconds).toBeDefined();
        });

        it('exposes agentRunsTotal counter', () => {
        expect(service.agentRunsTotal).toBeDefined();
        });
    });

    //  recordRun

    describe('recordRun', () => {
        it('does not throw for a completed run', () => {
        expect(() =>
            service.recordRun({
            terminationReason: 'completed',
            iterations:        3,
            costUsd:           0.04,
            durationMs:        4_200,
            confidence:        'high',
            }),
        ).not.toThrow();
        });

        it('does not throw for an iteration_limit termination', () => {
        expect(() =>
            service.recordRun({
            terminationReason: 'iteration_limit',
            iterations:        10,
            costUsd:           0.45,
            durationMs:        58_000,
            confidence:        'low',
            }),
        ).not.toThrow();
        });

        it('does not throw for a timeout termination', () => {
        expect(() =>
            service.recordRun({
            terminationReason: 'timeout',
            iterations:        5,
            costUsd:           0.20,
            durationMs:        60_001,
            confidence:        'low',
            }),
        ).not.toThrow();
        });

        it('does not throw for a cost_limit termination', () => {
        expect(() =>
            service.recordRun({
            terminationReason: 'cost_limit',
            iterations:        7,
            costUsd:           0.50,
            durationMs:        30_000,
            confidence:        'low',
            }),
        ).not.toThrow();
        });

        it('records the termination in Prometheus output', async () => {
        service.recordRun({
            terminationReason: 'completed',
            iterations:        2,
            costUsd:           0.01,
            durationMs:        1_800,
            confidence:        'high',
        });

        const output = await service.getMetrics();
        expect(output).toContain('docuchat_agent_terminations_total');
        expect(output).toContain('docuchat_agent_iterations');
        expect(output).toContain('docuchat_agent_cost_usd');
        expect(output).toContain('docuchat_agent_duration_seconds');
        expect(output).toContain('docuchat_agent_runs_total');
        });
    });

    //  recordToolCall

    describe('recordToolCall', () => {
        it('does not throw for a successful tool call', () => {
        expect(() =>
            service.recordToolCall('search_documents', 'success'),
        ).not.toThrow();
        });

        it('does not throw for an errored tool call', () => {
        expect(() =>
            service.recordToolCall('analyze_chunks', 'error'),
        ).not.toThrow();
        });

        it('does not throw for a rejected (unknown) tool call', () => {
        expect(() =>
            service.recordToolCall('ghost_tool', 'rejected'),
        ).not.toThrow();
        });

        it('appears in Prometheus output after recording', async () => {
        service.recordToolCall('search_documents', 'success');

        const output = await service.getMetrics();
        expect(output).toContain('docuchat_agent_tool_calls_total');
        });
    });

    //  getMetrics

    describe('getMetrics', () => {
        it('returns a non-empty Prometheus text string', async () => {
        service.recordToolCall('final_answer', 'success');
        const metrics = await service.getMetrics();
        expect(typeof metrics).toBe('string');
        expect(metrics.length).toBeGreaterThan(0);
        });

        it('contains all expected metric names', async () => {
        const metrics = await service.getMetrics();
        const expectedMetrics = [
            'docuchat_agent_iterations',
            'docuchat_agent_cost_usd',
            'docuchat_agent_terminations_total',
            'docuchat_agent_tool_calls_total',
            'docuchat_agent_duration_seconds',
            'docuchat_agent_runs_total',
        ];
        for (const name of expectedMetrics) {
            expect(metrics).toContain(name);
        }
        });
    });

    //  getContentType

    describe('getContentType', () => {
        it('returns a valid Prometheus content type', () => {
        expect(service.getContentType()).toContain('text/plain');
        });
    });
});