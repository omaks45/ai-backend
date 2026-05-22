
// Admin-only endpoints for the Model Control Plane.
// All routes require 'admin' role via PermissionsGuard.
//
// Endpoints:
//   GET  /mcp/prompts/:taskType           — list all versions
//   POST /mcp/prompts/:taskType/versions  — create a new version
//   POST /mcp/prompts/:taskType/activate  — activate a version
//   GET  /mcp/budget/:userId             — check a user's budget status
//   GET  /mcp/audit/stats                — aggregate stats dashboard
//   GET  /mcp/audit/user/:userId         — recent calls for a user

import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { JwtAuthGuard }                          from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard, RequirePermissions }  from '../../common/guards/permissions.guard';
import { McpService }                            from './services/mcp.service';
import { CreatePromptVersionDto }                from './dto/create-prompt.dto';
import { ActivatePromptDto }                     from './dto/activate-prompt.dto';
import { TaskType }                              from './mcp.types';

@ApiTags('MCP (Admin)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('mcp')
export class McpController {
  private readonly logger = new Logger(McpController.name);

  constructor(private readonly mcp: McpService) {}

  //  Prompt management

  @Get('prompts/:taskType')
  @RequirePermissions('admin:manage')
  @ApiOperation({ summary: 'List all prompt versions for a task type' })
  @ApiParam({ name: 'taskType', enum: ['chat', 'agent', 'summary', 'embedding'] })
  listVersions(@Param('taskType') taskType: TaskType) {
    return this.mcp.listPromptVersions(taskType);
  }

  @Post('prompts/:taskType/versions')
  @RequirePermissions('admin:manage')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a new prompt version (does not activate it)',
    description: 'Creates a new version in draft state. Call /activate to go live.',
  })
  createVersion(
    @Param('taskType') taskType: TaskType,
    @Body() dto: CreatePromptVersionDto,
  ) {
    return this.mcp.createPromptVersion({ taskType, ...dto });
  }

  @Post('prompts/:taskType/activate')
  @RequirePermissions('admin:manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Activate a prompt version',
    description:
      'Deactivates all other versions for this task type and activates ' +
      'the specified version. Takes effect within 5 minutes (cache TTL).',
  })
  activatePrompt(
    @Param('taskType') taskType: TaskType,
    @Body() dto: ActivatePromptDto,
  ) {
    return this.mcp.activatePrompt(taskType, dto.version);
  }

  // ── Budget ────────────────────────────────────────────────────────────────

  @Get('budget/:userId')
  @RequirePermissions('admin:manage')
  @ApiOperation({ summary: "Check a user's current monthly AI budget status" })
  getBudgetStatus(@Param('userId') userId: string) {
    return this.mcp.getBudgetStatus(userId);
  }

  // ── Audit ─────────────────────────────────────────────────────────────────

  @Get('audit/stats')
  @RequirePermissions('admin:manage')
  @ApiOperation({ summary: 'Aggregate AI usage stats for the dashboard' })
  @ApiQuery({ name: 'days', required: false, description: 'Lookback window in days (default: 30)' })
  getAuditStats(@Query('days') days = '30') {
    const since = new Date();
    since.setDate(since.getDate() - parseInt(days, 10));
    return this.mcp.getAuditStats(since);
  }

  @Get('audit/user/:userId')
  @RequirePermissions('admin:manage')
  @ApiOperation({ summary: 'Recent AI audit log entries for a specific user' })
  @ApiQuery({ name: 'limit',  required: false })
  @ApiQuery({ name: 'offset', required: false })
  getAuditByUser(
    @Param('userId') userId: string,
    @Query('limit')  limit  = '20',
    @Query('offset') offset = '0',
  ) {
    return this.mcp.getAuditByUser(
      userId,
      parseInt(limit,  10),
      parseInt(offset, 10),
    );
  }
}