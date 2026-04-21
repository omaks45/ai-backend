import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { ListConversationsDto } from './dto/list-conversations.dto';

@Injectable()
export class ConversationsService {
  constructor(private readonly prisma: PrismaService) {}

  // For simplicity, all conversations are "active" — no soft deletes or archiving yet
  async create(dto: CreateConversationDto, userId: string) {
    return this.prisma.conversation.create({
      data: { userId, title: dto.title },
    });
  }

  // List conversations with pagination, search, and sorting
  async findAll(userId: string, query: ListConversationsDto) {
    const { page, limit } = query;

    const [conversations, total] = await Promise.all([
      this.prisma.conversation.findMany({
        where: { userId },
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          // Fetch only the latest message — no N+1
          messages: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { content: true, role: true, createdAt: true },
          },
          _count: { select: { messages: true } },
        },
      }),
      this.prisma.conversation.count({ where: { userId } }),
    ]);

    return {
      data: conversations.map((c) => ({
        id: c.id,
        title: c.title,
        messageCount: c._count.messages,
        lastMessage: c.messages[0] ?? null,
        updatedAt: c.updatedAt,
      })),
      meta: { page, limit, total },
    };
  }

  // For simplicity, conversations are never deleted — just not returned in lists if "archived"
  async sendMessage(conversationId: string, dto: SendMessageDto, userId: string) {
    // All DB writes are atomic — if any step fails, everything rolls back
    return this.prisma.$transaction(async (tx) => {
      const conversation = await tx.conversation.findFirst({
        where: { id: conversationId, userId },
      });

      if (!conversation) throw new NotFoundException('Conversation not found');

      // Validate document belongs to user if provided
      if (dto.documentId) {
        const doc = await tx.document.findFirst({
          where: { id: dto.documentId, userId, deletedAt: null },
        });
        if (!doc) throw new NotFoundException('Document not found');
      }

      const userMessage = await tx.message.create({
        data: {
          conversationId,
          documentId: dto.documentId,
          role: 'user',
          content: dto.content,
        },
      });

      // Placeholder — Week 4 replaces this with real RAG
      const assistantMessage = await tx.message.create({
        data: {
          conversationId,
          documentId: dto.documentId,
          role: 'assistant',
          content: 'AI response coming in Week 4.',
          promptTokens: 0,
          completionTokens: 0,
          costUsd: 0,
        },
      });

      await tx.conversation.update({
        where: { id: conversationId },
        data: { updatedAt: new Date() },
      });

      await tx.usageLog.create({
        data: { userId, action: 'chat', tokens: 0, costUsd: 0 },
      });

      return { userMessage, assistantMessage };
    });
  }

  // For simplicity, no access control on messages — if you can see the conversation, you can see all messages
  async getMessages(conversationId: string, userId: string) {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, userId },
    });

    if (!conversation) throw new NotFoundException('Conversation not found');

    return this.prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
    });
  }
}