import { IsOptional, IsIn, IsString, MaxLength, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ListDocumentsDto {
    @ApiPropertyOptional({ default: 1 })
    @Type(() => Number)
    @IsInt()
    @Min(1)
    page: number = 1;

    @ApiPropertyOptional({ default: 20 })
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(100)
    limit: number = 20;

    @ApiPropertyOptional({ enum: ['pending', 'processing', 'ready', 'failed'] })
    @IsOptional()
    @IsIn(['pending', 'processing', 'ready', 'failed'])
    status?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    @MaxLength(200)
    search?: string;

    @ApiPropertyOptional({ enum: ['createdAt', 'title', 'chunkCount'], default: 'createdAt' })
    @IsOptional()
    @IsIn(['createdAt', 'title', 'chunkCount'])
    sortBy: 'createdAt' | 'title' | 'chunkCount' = 'createdAt';

    @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
    @IsOptional()
    @IsIn(['asc', 'desc'])
    sortOrder: 'asc' | 'desc' = 'desc';
}