
import { IsString, MinLength, MaxLength, IsOptional, IsObject } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreatePromptVersionDto {
    @ApiProperty({ example: 'v2', description: 'Version identifier' })
    @IsString()
    @MinLength(2)
    @MaxLength(20)
    version!: string;

    @ApiProperty({ example: 'RAG Chat — Improved citations' })
    @IsString()
    @MinLength(5)
    @MaxLength(100)
    name!: string;

    @ApiProperty({ description: 'The full prompt text' })
    @IsString()
    @MinLength(20)
    content!: string;

    @ApiPropertyOptional({ description: 'Metadata: author, changelog, notes' })
    @IsOptional()
    @IsObject()
    metadata?: Record<string, unknown>;
}