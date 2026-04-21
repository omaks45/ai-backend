import { Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../database/prisma.service';
import { RbacService } from '../rbac/rbac.service';
import { CreateDocumentDto } from './dto/create-document.dto';
import { ListDocumentsDto } from './dto/list-documents.dto';

// Active document filter — reused in every query
const ACTIVE = { deletedAt: null };

@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rbac: RbacService,
    private readonly events: EventEmitter2,
  ) {}

  async create(dto: CreateDocumentDto, userId: string) {
    const doc = await this.prisma.document.create({
      data: {
        userId,
        title: dto.title,
        filename: dto.title.toLowerCase().replace(/\s+/g, '-') + '.txt',
        content: dto.content,
        status: 'pending',
      },
    });

    this.events.emit('document.created', {
      userId,
      documentId: doc.id,
      title: doc.title,
    });

    return doc;
  }

  async findAll(userId: string, query: ListDocumentsDto) {
    const { page, limit, status, search, sortBy, sortOrder } = query;

    // Build where clause dynamically — only add filters that were provided
    const where: any = { userId, ...ACTIVE };
    if (status) where.status = status;
    if (search) where.title = { contains: search, mode: 'insensitive' };

    const [data, total] = await Promise.all([
      this.prisma.document.findMany({
        where,
        orderBy: { [sortBy]: sortOrder },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true, title: true, filename: true,
          status: true, chunkCount: true,
          createdAt: true, updatedAt: true,
        },
      }),
      this.prisma.document.count({ where }),
    ]);

    return { data, meta: { page, limit, total } };
  }

  async findOne(id: string, userId: string) {
    const doc = await this.prisma.document.findFirst({
      where: { id, ...ACTIVE },
    });

    if (!doc) throw new NotFoundException('Document not found');

    // Resource ownership — admins bypass, others get 404 (not 403)
    if (doc.userId !== userId) {
      const perms = await this.rbac.getUserPermissions(userId);
      if (!perms.has('users:manage')) {
        throw new NotFoundException('Document not found');
      }
    }

    return doc;
  }

  async softDelete(id: string, userId: string) {
    const doc = await this.prisma.document.findFirst({
      where: { id, ...ACTIVE },
    });

    if (!doc) throw new NotFoundException('Document not found');
    if (doc.userId !== userId) throw new NotFoundException('Document not found');

    const deleted = await this.prisma.document.update({
      where: { id },
      data: { deletedAt: new Date(), deletedBy: userId },
    });

    this.events.emit('document.deleted', {
      userId,
      documentId: id,
      title: doc.title,
    });

    return deleted;
  }

  async getProcessingStatus(id: string, userId: string) {
    const doc = await this.prisma.document.findFirst({
      where: { id, userId, ...ACTIVE },
      select: { id: true, status: true, error: true, chunkCount: true },
    });

    if (!doc) throw new NotFoundException('Document not found');
    return doc;
  }
}