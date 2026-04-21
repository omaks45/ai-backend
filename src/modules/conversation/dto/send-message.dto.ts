import { IsString, MinLength, MaxLength, IsOptional, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SendMessageDto {
    @ApiProperty()
    @IsString()
    @MinLength(1)
    @MaxLength(10_000)
    content!: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsUUID()
    documentId?: string;
}