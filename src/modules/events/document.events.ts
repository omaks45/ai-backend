import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class DocumentEventsListener {
    private readonly logger = new Logger(DocumentEventsListener.name);

    constructor(private readonly prisma: PrismaService) {}

    @OnEvent('document.created')
    async onDocumentCreated(data: { userId: string; documentId: string; title: string }) {
        try {
        await this.prisma.usageLog.create({
            data: {
            userId: data.userId,
            action: 'document_created',
            tokens: 0,
            costUsd: 0,
            metadata: { documentId: data.documentId, title: data.title },
            },
        });
        } catch (err) {
        this.logger.error('Failed to log document.created', err);
        }
    }

    @OnEvent('document.deleted')
    async onDocumentDeleted(data: { userId: string; documentId: string; title: string }) {
        try {
        await this.prisma.usageLog.create({
            data: {
            userId: data.userId,
            action: 'document_deleted',
            tokens: 0,
            costUsd: 0,
            metadata: { documentId: data.documentId, title: data.title },
            },
        });
        } catch (err) {
        this.logger.error('Failed to log document.deleted', err);
        }
    }

    @OnEvent('admin.role.assigned')
    async onRoleAssigned(data: { targetUserId: string; roleName: string; assignedBy: string }) {
        try {
        await this.prisma.usageLog.create({
            data: {
            userId: data.assignedBy,
            action: 'role_assigned',
            tokens: 0,
            costUsd: 0,
            metadata: data,
            },
        });
        } catch (err) {
        this.logger.error('Failed to log role assignment', err);
        }
    }

    @OnEvent('admin.role.revoked')
    async onRoleRevoked(data: { targetUserId: string; roleName: string; revokedBy: string }) {
        try {
        await this.prisma.usageLog.create({
            data: {
            userId: data.revokedBy,
            action: 'role_revoked',
            tokens: 0,
            costUsd: 0,
            metadata: data,
            },
        });
        } catch (err) {
        this.logger.error('Failed to log role revocation', err);
        }
    }
}