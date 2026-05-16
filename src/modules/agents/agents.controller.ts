import {
  Controller,
  Post,
  Body,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import { Request } from 'express';

// ── Auth/guard imports ────────────────────────────────────────────────────────
// same pattern as ConversationsController. No separate decorator file needed.
import { JwtAuthGuard }                         from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard, RequirePermissions } from '../../common/guards/permissions.guard';
import { CurrentUser }                          from '../../common/decorators/current-user.decorator';

import { AgentExecutorService } from './agent-executor.service';
import { DocumentsService }     from '../documents/documents.service';
import { AgentResearchDto }     from './dto/agent-research.dto';

// ─────────────────────────────────────────────────────────────────────────────
// AgentController
//
// HOW THIS RELATES TO ConversationsController:
//
//   ConversationsController  →  single-turn RAG pipeline
//     POST /conversations/:id/messages
//     Search once → assemble context → generate → save to DB
//     Best for: "What is the notice period in this contract?"
//
//   AgentController          →  multi-step reasoning loop
//     POST /agent/research
//     Think → search → observe → think → search → observe → answer
//     Best for: "Compare notice periods across all my uploaded contracts"
//
// They share SearchService and the LLM but do NOT call each other.
// Agent answers are NOT saved to a conversation — they are one-shot responses.
// If you want to save agent answers, do it in the calling client or add
// a conversationId field to AgentResearchDto later.
// ─────────────────────────────────────────────────────────────────────────────

@ApiTags('Agent')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('agent')
export class AgentController {
  private readonly logger = new Logger(AgentController.name);

  constructor(
    private readonly executor:  AgentExecutorService,
    private readonly documents: DocumentsService,
  ) {}

  /**
   * POST /api/v1/agent/research
   *
   * Runs a multi-step document research agent. Use this instead of the
   * conversations endpoint when:
   *   - The question requires comparing information across multiple documents
   *   - The answer cannot be found in a single search pass
   *   - You want structured citations with confidence scoring
   *
   * The agent runs up to 10 iterations with a 60-second timeout and a
   * $0.50 cost ceiling. Guardrail terminations still return 200 — the
   * client should check terminationReason to adapt the UI.
   */
  @Post('research')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('conversations:create')
  @ApiOperation({
    summary:     'Run a multi-step document research agent',
    description:
      'Unlike POST /conversations/:id/messages (single RAG pass), this ' +
      'endpoint runs a ReAct loop that can search multiple times, compare ' +
      'results, and synthesise answers across documents.',
  })
  @ApiResponse({
    status: 200,
    schema: {
      example: {
        answer:     'Contract A gives 12 weeks; Contract B gives 8 weeks [Source 1][Source 2]',
        sources:    ['Contract A.pdf', 'Contract B.pdf'],
        confidence: 'high',
        metadata:   { iterations: 3, costUsd: 0.04, terminationReason: 'completed' },
      },
    },
  })
  async research(
    @Body()        dto:  AgentResearchDto,
    @CurrentUser() user: { id: string },
    @Req()         req:  Request,
  ) {
    const correlationId = (req as any).correlationId as string ?? `agent-${Date.now()}`;

    this.logger.log('Agent research request', {
      correlationId,
      userId:   user.id,
      question: dto.question.substring(0, 100),
    });

    // Fetch available documents so the system prompt can list them.
    // The agent sees what exists before deciding which to search.
    const { data: docs } = await this.documents.findAll(user.id, {
      page: 1, limit: 100, sortBy: 'createdAt', sortOrder: 'desc',
    } as any);

    const availableDocs = (docs as Array<{ id: string; title: string }>)
      .map(d => ({ id: d.id, title: d.title }));

    const result = await this.executor.runAgent({
      question:      dto.question,
      userId:        user.id,
      correlationId,
      availableDocs,
    });

    return {
      answer:     result.answer,
      sources:    result.sources,
      confidence: result.confidence,
      metadata: {
        iterations:        result.iterations,
        costUsd:           parseFloat(result.totalCostUsd.toFixed(4)),
        terminationReason: result.terminationReason,
      },
    };
  }
}