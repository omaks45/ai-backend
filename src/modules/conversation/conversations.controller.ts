import { Controller, Get, Post, Param, Body, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard, RequirePermissions } from '../../common/guards/permissions.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ConversationsService } from './conversations.service';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { ListConversationsDto } from './dto/list-conversations.dto';

@ApiTags('conversations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('conversations')
export class ConversationsController {
  constructor(private readonly conversations: ConversationsService) {}

  @Post()
  @RequirePermissions('conversations:create')
  @ApiOperation({ summary: 'Start a conversation' })
  create(@Body() dto: CreateConversationDto, @CurrentUser() user: any) {
    return this.conversations.create(dto, user.id);
  }

  @Get()
  @RequirePermissions('conversations:read')
  @ApiOperation({ summary: 'List conversations' })
  findAll(@Query() query: ListConversationsDto, @CurrentUser() user: any) {
    return this.conversations.findAll(user.id, query);
  }

  @Get(':id/messages')
  @RequirePermissions('conversations:read')
  @ApiOperation({ summary: 'Get messages in a conversation' })
  getMessages(@Param('id') id: string, @CurrentUser() user: any) {
    return this.conversations.getMessages(id, user.id);
  }

  @Post(':id/messages')
  @RequirePermissions('conversations:create')
  @ApiOperation({ summary: 'Send a message' })
  sendMessage(
    @Param('id') id: string,
    @Body() dto: SendMessageDto,
    @CurrentUser() user: any,
  ) {
    return this.conversations.sendMessage(id, dto, user.id);
  }
}