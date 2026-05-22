import { IsString, MinLength, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

// ─────────────────────────────────────────────────────────────────────────────
// AgentResearchDto
//
// Validated at the NestJS pipe layer before reaching the controller.
// The ValidationPipe (configured globally in main.ts with whitelist: true)
// strips any unknown fields so the executor never receives unexpected data.
// ─────────────────────────────────────────────────────────────────────────────

export class AgentResearchDto {
    @ApiProperty({
        description: 'The research question the agent should answer',
        example:     'Compare the parental leave policies across all my uploaded documents.',
        minLength:   10,
        maxLength:   1000,
    })
    @IsString()
    @MinLength(10,   { message: 'Question must be at least 10 characters' })
    @MaxLength(1000, { message: 'Question must not exceed 1000 characters' })
    question!: string;
}