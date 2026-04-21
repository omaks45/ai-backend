import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DocumentsService } from './documents.service';
import { PrismaService } from '../../database/prisma.service';
import { RbacService } from '../rbac/rbac.service';
import { DocumentProcessorService } from '../jobs/document-processor.service';

const mockPrisma = {
  document: {
    create: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
  },
};

const mockRbac = { getUserPermissions: jest.fn().mockResolvedValue(new Set()) };
const mockEvents = { emit: jest.fn() };
const mockProcessor = { enqueue: jest.fn().mockResolvedValue('job-1') };

describe('DocumentsService', () => {
  let service: DocumentsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DocumentsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: RbacService, useValue: mockRbac },
        { provide: EventEmitter2, useValue: mockEvents },
        { provide: DocumentProcessorService, useValue: mockProcessor },
      ],
    }).compile();

    service = module.get<DocumentsService>(DocumentsService);
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('creates document and enqueues job', async () => {
      const doc = { id: 'doc-1', title: 'Test', userId: 'user-1', status: 'pending' };
      mockPrisma.document.create.mockResolvedValue(doc);

      const result = await service.create({ title: 'Test', content: 'hello' }, 'user-1');

      expect(mockPrisma.document.create).toHaveBeenCalled();
      expect(mockProcessor.enqueue).toHaveBeenCalledWith('doc-1', 'user-1');
      expect(mockEvents.emit).toHaveBeenCalledWith('document.created', expect.any(Object));
      expect(result.jobId).toBe('job-1');
    });
  });

  describe('findAll', () => {
    it('returns paginated documents', async () => {
      const docs = [{ id: 'doc-1', title: 'Test', status: 'ready' }];
      mockPrisma.document.findMany.mockResolvedValue(docs);
      mockPrisma.document.count.mockResolvedValue(1);

      const result = await service.findAll('user-1', {
        page: 1, limit: 20, sortBy: 'createdAt', sortOrder: 'desc',
      });

      expect(result.data).toEqual(docs);
      expect(result.meta).toEqual({ page: 1, limit: 20, total: 1 });
    });

    it('applies status filter when provided', async () => {
      mockPrisma.document.findMany.mockResolvedValue([]);
      mockPrisma.document.count.mockResolvedValue(0);

      await service.findAll('user-1', {
        page: 1, limit: 20, status: 'ready', sortBy: 'createdAt', sortOrder: 'desc',
      });

      const whereArg = mockPrisma.document.findMany.mock.calls[0][0].where;
      expect(whereArg.status).toBe('ready');
    });
  });

  describe('findOne', () => {
    it('throws NotFoundException for missing document', async () => {
      mockPrisma.document.findFirst.mockResolvedValue(null);

      await expect(service.findOne('bad-id', 'user-1'))
        .rejects.toThrow(NotFoundException);
    });

    it('returns 404 (not 403) when user accesses another users document', async () => {
      mockPrisma.document.findFirst.mockResolvedValue({ id: 'doc-1', userId: 'other-user' });
      mockRbac.getUserPermissions.mockResolvedValue(new Set()); // no admin perms

      await expect(service.findOne('doc-1', 'user-1'))
        .rejects.toThrow(NotFoundException);
    });
  });

  describe('softDelete', () => {
    it('sets deletedAt instead of deleting the row', async () => {
      const doc = { id: 'doc-1', userId: 'user-1', title: 'Test' };
      mockPrisma.document.findFirst.mockResolvedValue(doc);
      mockPrisma.document.update.mockResolvedValue({ ...doc, deletedAt: new Date() });

      await service.softDelete('doc-1', 'user-1');

      const updateCall = mockPrisma.document.update.mock.calls[0][0];
      expect(updateCall.data.deletedAt).toBeInstanceOf(Date);
      expect(updateCall.data.deletedBy).toBe('user-1');
    });

    it('emits document.deleted event', async () => {
      const doc = { id: 'doc-1', userId: 'user-1', title: 'Test' };
      mockPrisma.document.findFirst.mockResolvedValue(doc);
      mockPrisma.document.update.mockResolvedValue(doc);

      await service.softDelete('doc-1', 'user-1');

      expect(mockEvents.emit).toHaveBeenCalledWith('document.deleted', expect.objectContaining({ documentId: 'doc-1' }));
    });
  });
});