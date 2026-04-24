import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// ── Generic wrappers

export class PaginationMeta {
    @ApiProperty({ example: 1, description: 'Current page number' })
    page!: number;

    @ApiProperty({ example: 20, description: 'Items per page' })
        limit!: number;

    @ApiProperty({ example: 145, description: 'Total number of items' })
    total!: number;
}

export class ErrorDetail {
    @ApiProperty({ example: 'email', description: 'Field that failed validation' })
    field!: string;

    @ApiProperty({ example: 'Must be a valid email', description: 'Validation message' })
    message!: string;
}

export class ErrorResponse {
    @ApiProperty({ example: false })
    success!: boolean;

    @ApiProperty({ example: 400 })
    statusCode!: number;

    @ApiProperty({
        example: {
        message: 'Request validation failed',
        error: 'Bad Request',
        },
    })
    error!: Record<string, any>;

    @ApiProperty({ example: '/api/v1/auth/register' })
    path!: string;

    @ApiProperty({ example: '2026-04-24T10:00:00.000Z' })
    timestamp!: string;
}

// Auth

export class AuthUserDto {
    @ApiProperty({ example: 'f47ac10b-58cc-4372-a567-0e02b2c3d479' })
    id!: string;

    @ApiProperty({ example: 'user@example.com' })
    email!: string;

    @ApiProperty({ example: 'free', enum: ['free', 'pro', 'enterprise'] })
    tier!: string;
}

export class TokensResponse {
    @ApiProperty({ example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' })
    accessToken!: string;

    @ApiProperty({ example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' })
    refreshToken!: string;

    @ApiProperty({ type: AuthUserDto })
    user!: AuthUserDto;
}

export class RegisterResponse {
    @ApiProperty({ example: true })
    success!: boolean;

    @ApiProperty({ type: AuthUserDto })
    data!: AuthUserDto;
}

export class LoginResponse {
    @ApiProperty({ example: true })
    success!: boolean;

    @ApiProperty({ type: TokensResponse })
    data!: TokensResponse;
}

export class RefreshResponse {
    @ApiProperty({ example: true })
    success!: boolean;

    @ApiProperty({
        example: {
        accessToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
        refreshToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
        },
    })
    data!: { accessToken: string; refreshToken: string };
}

export class MessageResponse {
    @ApiProperty({ example: true })
    success!: boolean;

    @ApiProperty({ example: { message: 'Logged out successfully' } })
    data!: { message: string };
}

// Documents

export class DocumentDto {
    @ApiProperty({ example: 'f47ac10b-58cc-4372-a567-0e02b2c3d479' })
    id!: string;

    @ApiProperty({ example: 'f47ac10b-58cc-4372-a567-0e02b2c3d480' })
    userId!: string;

    @ApiProperty({ example: 'Q4 Financial Report' })
    title!: string;

    @ApiProperty({ example: 'q4-financial-report.txt' })
    filename!: string;

    @ApiProperty({ example: 'pending', enum: ['pending', 'processing', 'ready', 'failed'] })
    status!: string;

    @ApiProperty({ example: 24, description: 'Number of text chunks generated' })
    chunkCount!: number;

    @ApiProperty({ example: '2026-04-24T10:00:00.000Z' })
    createdAt!: string;

    @ApiProperty({ example: '2026-04-24T10:05:00.000Z' })
    updatedAt!: string;
}

export class DocumentFullDto extends DocumentDto {
    @ApiProperty({ example: 'Full document text content goes here...' })
    content!: string;

    @ApiPropertyOptional({ example: 'text/plain' })
    mimeType!: string | null;

    @ApiPropertyOptional({ example: 204800, description: 'File size in bytes' })
    fileSizeBytes!: number | null;

    @ApiPropertyOptional({ example: null, description: 'Error message if processing failed' })
    error!: string | null;

    @ApiPropertyOptional({ example: null })
    deletedAt!: string | null;
}

export class CreateDocumentResponse {
    @ApiProperty({ example: true })
    success!: boolean;

    @ApiProperty({ type: DocumentFullDto })
    data!: DocumentFullDto & { jobId: string };
}

export class ListDocumentsResponse {
    @ApiProperty({ example: true })
    success!: boolean;

    @ApiProperty({ type: [DocumentDto] })
    data!: DocumentDto[];

    @ApiProperty({ type: PaginationMeta })
    meta!: PaginationMeta;
}

export class SingleDocumentResponse {
    @ApiProperty({ example: true })
    success!: boolean;

    @ApiProperty({ type: DocumentFullDto })
    data!: DocumentFullDto;
}

export class ProcessingStatusResponse {
    @ApiProperty({ example: true })
    success!: boolean;

    @ApiProperty({
        example: {
        id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
        status: 'processing',
        error: null,
        chunkCount: 0,
        progress: 40,
        },
    })
    data!: {
        id: string;
        status: string;
        error: string | null;
        chunkCount: number;
        progress: number | null;
    };
}

// Conversations

export class LastMessageDto {
    @ApiProperty({ example: 'What are the key findings?' })
    content!: string;

    @ApiProperty({ example: 'user', enum: ['user', 'assistant'] })
    role!: string;

    @ApiProperty({ example: '2026-04-24T10:00:00.000Z' })
    createdAt!: string;
}

export class ConversationSummaryDto {
    @ApiProperty({ example: 'f47ac10b-58cc-4372-a567-0e02b2c3d479' })
    id!: string;

    @ApiPropertyOptional({ example: 'Q4 Report Analysis' })
    title!: string | null;

    @ApiProperty({ example: 12, description: 'Total messages in this conversation' })
    messageCount!: number;

    @ApiPropertyOptional({ type: LastMessageDto, nullable: true })
    lastMessage!: LastMessageDto | null;

    @ApiProperty({ example: '2026-04-24T10:00:00.000Z' })
    updatedAt!: string;
}

export class MessageDto {
    @ApiProperty({ example: 'f47ac10b-58cc-4372-a567-0e02b2c3d479' })
    id!: string;

    @ApiProperty({ example: 'f47ac10b-58cc-4372-a567-0e02b2c3d480' })
    conversationId!: string;

    @ApiPropertyOptional({ example: 'f47ac10b-58cc-4372-a567-0e02b2c3d481', nullable: true })
    documentId!: string | null;

    @ApiProperty({ example: 'user', enum: ['user', 'assistant'] })
    role!: string;

    @ApiProperty({ example: 'What are the key findings in this report?' })
    content!: string;

    @ApiPropertyOptional({ example: null, nullable: true, description: 'JSON array of chunk IDs used as context' })
    sources!: string | null;

    @ApiPropertyOptional({ example: 'high', enum: ['high', 'medium', 'low'], nullable: true })
    confidence!: string | null;

    @ApiPropertyOptional({ example: 120, description: 'Prompt tokens consumed' })
    promptTokens!: number | null;

    @ApiPropertyOptional({ example: 80, description: 'Completion tokens consumed' })
    completionTokens!: number | null;

    @ApiPropertyOptional({ example: 0.0024, description: 'Cost in USD' })
    costUsd!: number | null;

    @ApiPropertyOptional({ example: 1240, description: 'Response latency in milliseconds' })
    latencyMs!: number | null;

    @ApiProperty({ example: '2026-04-24T10:00:00.000Z' })
    createdAt!: string;
}

export class SendMessageResponseData {
    @ApiProperty({ type: MessageDto })
    userMessage!: MessageDto;

    @ApiProperty({ type: MessageDto })
    assistantMessage!: MessageDto;
}

export class ListConversationsResponse {
    @ApiProperty({ example: true })
    success!: boolean;

    @ApiProperty({ type: [ConversationSummaryDto] })
    data!: ConversationSummaryDto[];

    @ApiProperty({ type: PaginationMeta })
    meta!: PaginationMeta;
}

export class ConversationResponse {
    @ApiProperty({ example: true })
    success!: boolean;

    @ApiProperty({ type: ConversationSummaryDto })
    data!: ConversationSummaryDto;
}

export class MessagesListResponse {
    @ApiProperty({ example: true })
    success!: boolean;

    @ApiProperty({ type: [MessageDto] })
    data!: MessageDto[];
}

export class SendMessageResponse {
    @ApiProperty({ example: true })
    success!: boolean;

    @ApiProperty({ type: SendMessageResponseData })
    data!: SendMessageResponseData;
}

// Admin / RBAC

export class PermissionDto {
    @ApiProperty({ example: 'f47ac10b-58cc-4372-a567-0e02b2c3d479' })
    id!: string;

    @ApiProperty({ example: 'documents:create' })
    name!: string;

    @ApiProperty({ example: 'documents' })
    resource!: string;

    @ApiProperty({ example: 'create' })
    action!: string;

    @ApiPropertyOptional({ example: 'Upload documents' })
    description!: string | null;
}

export class RoleDto {
    @ApiProperty({ example: 'f47ac10b-58cc-4372-a567-0e02b2c3d479' })
    id!: string;

    @ApiProperty({ example: 'member', enum: ['admin', 'member', 'viewer'] })
    name!: string;

    @ApiPropertyOptional({ example: 'Standard user with document access' })
    description!: string | null;

    @ApiProperty({ example: true, description: 'New users receive this role automatically' })
    isDefault!: boolean;

    @ApiProperty({ example: 42, description: 'Number of users assigned this role' })
    userCount!: number;

    @ApiProperty({ type: [PermissionDto] })
    permissions!: PermissionDto[];
}

export class ListRolesResponse {
    @ApiProperty({ example: true })
    success!: boolean;

    @ApiProperty({ type: [RoleDto] })
    data!: RoleDto[];
    }

    export class RoleActionResponse {
    @ApiProperty({ example: true })
    success!: boolean;

    @ApiProperty({ example: { message: "Role 'member' assigned" } })
    data!: { message: string };
}