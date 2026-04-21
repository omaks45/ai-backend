import {
  Controller, Get, Post, Delete, Param, Body,
  Query, HttpCode, HttpStatus, UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard, RequirePermissions } from '../../common/guards/permissions.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { DocumentsService } from './documents.service';
import { CreateDocumentDto } from './dto/create-document.dto';
import { ListDocumentsDto } from './dto/list-documents.dto';

@ApiTags('documents')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('documents')
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Post()
  @RequirePermissions('documents:create')
  @ApiOperation({ summary: 'Upload a document' })
  create(@Body() dto: CreateDocumentDto, @CurrentUser() user: any) {
    return this.documents.create(dto, user.id);
  }

  @Get()
  @RequirePermissions('documents:read')
  @ApiOperation({ summary: 'List documents' })
  findAll(@Query() query: ListDocumentsDto, @CurrentUser() user: any) {
    return this.documents.findAll(user.id, query);
  }

  @Get(':id')
  @RequirePermissions('documents:read')
  @ApiOperation({ summary: 'Get a document' })
  findOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.documents.findOne(id, user.id);
  }

  @Delete(':id')
  @RequirePermissions('documents:delete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Soft-delete a document' })
  remove(@Param('id') id: string, @CurrentUser() user: any) {
    return this.documents.softDelete(id, user.id);
  }

  @Get(':id/processing-status')
  @RequirePermissions('documents:read')
  @ApiOperation({ summary: 'Get document processing status' })
  processingStatus(@Param('id') id: string, @CurrentUser() user: any) {
    return this.documents.getProcessingStatus(id, user.id);
  }
}