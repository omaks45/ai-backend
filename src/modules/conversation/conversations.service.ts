import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService }           from '../../database/prisma.service';
import { SearchService }           from '../search/search.service';
import { ContextAssemblerService } from '../rag/context-assembler.service';
import { RagService }              from '../rag/rag.service';
import { CreateConversationDto }   from './dto/create-conversation.dto';
import { ListConversationsDto }    from './dto/list-conversations.dto';
import { SendMessageDto }          from './dto/send-message.dto';

@Injectable()
export class ConversationsService {
  constructor(
    private readonly prisma:    PrismaService,
    private readonly search:    SearchService,
    private readonly assembler: ContextAssemblerService,
    private readonly rag:       RagService,
  ) {}

  //  Create conversation 

  async create(dto: CreateConversationDto, userId: string) {
    return this.prisma.conversation.create({
      data: { userId, title: dto.title },
    });
  }

  // List conversations

  async findAll(userId: string, query: ListConversationsDto) {
    const { page = 1, limit = 20 } = query;

    const [data, total] = await Promise.all([
      this.prisma.conversation.findMany({
        where:   { userId },
        orderBy: { updatedAt: 'desc' },
        skip:    (page - 1) * limit,
        take:    limit,
        include: {
          messages: {
            orderBy: { createdAt: 'desc' },
            take:    1,
            select:  { content: true, role: true, createdAt: true },
          },
          _count: { select: { messages: true } },
        },
      }),
      this.prisma.conversation.count({ where: { userId } }),
    ]);

    return {
      data: data.map((c) => ({
        id:           c.id,
        title:        c.title,
        messageCount: c._count.messages,
        lastMessage:  c.messages[0] ?? null,
        updatedAt:    c.updatedAt,
      })),
      meta: { page, limit, total },
    };
  }

  // Get messages

  async getMessages(conversationId: string, userId: string) {
    const conv = await this.prisma.conversation.findFirst({
      where: { id: conversationId, userId },
    });
    if (!conv) throw new NotFoundException('Conversation not found');

    return this.prisma.message.findMany({
      where:   { conversationId },
      orderBy: { createdAt: 'asc' },
    });
  }

  // Send message — full RAG pipeline

  async sendMessage(conversationId: string, dto: SendMessageDto, userId: string) {
    const { content, documentId } = dto;
    const correlationId = `conv-${conversationId}-${Date.now()}`;

    // Steps 4-6: external I/O OUTSIDE the transaction
    const searchResults = await this.search.search({
      query: content,
      userId,
      documentId,
      correlationId,
    });

    const context = this.assembler.assemble(searchResults);

    const recentHistory = await this.prisma.message.findMany({
      where:   { conversationId },
      orderBy: { createdAt: 'desc' },
      take:    10,
      select:  { role: true, content: true },
    });

    const ragResponse = await this.rag.generate({
      question:            content,
      context,
      conversationHistory: recentHistory.reverse() as any,
      userId,
      conversationId,
      correlationId,
    });

    // Steps 1-2, 7-8: fast DB writes inside the transaction
    return this.prisma.$transaction(async (tx) => {
      const conv = await tx.conversation.findFirst({
        where: { id: conversationId, userId },
      });
      if (!conv) throw new NotFoundException('Conversation not found');

      const userMessage = await tx.message.create({
        data: { conversationId, documentId, role: 'user', content },
      });

      const assistantMessage = await tx.message.create({
        data: {
          conversationId,
          documentId,
          role:             'assistant',
          content:          ragResponse.answer,
          promptTokens:     ragResponse.tokensUsed.prompt,
          completionTokens: ragResponse.tokensUsed.completion,
          costUsd:          ragResponse.costUsd,
          sources:          JSON.stringify(ragResponse.citations),
        },
      });

      await tx.conversation.update({
        where: { id: conversationId },
        data:  { updatedAt: new Date() },
      });

      await tx.usageLog.create({
        data: {
          userId,
          action:  'chat',
          tokens:  ragResponse.tokensUsed.total,
          costUsd: ragResponse.costUsd,
          metadata: {
            conversationId,
            model:         ragResponse.model,
            contextChunks: context.chunks.length,
            correlationId,
          },
        },
      });

      return {
        userMessage,
        assistantMessage: { ...assistantMessage, citations: ragResponse.citations },
      };
    });
  }
}