import { IsOptional, IsString, MaxLength, IsUUID } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class CreateConversationDto {
    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    @MaxLength(200)
    title?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsUUID()
    documentId?: string;
}