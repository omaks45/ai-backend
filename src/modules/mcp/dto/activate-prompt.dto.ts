// src/modules/mcp/dto/activate-prompt.dto.ts
import { IsString, MinLength, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ActivatePromptDto {
    @ApiProperty({ example: 'v2', description: 'Version to activate' })
    @IsString()
    @MinLength(2)
    @MaxLength(20)
    version!: string;
}