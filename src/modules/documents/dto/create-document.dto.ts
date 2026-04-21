import { IsString, MinLength, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateDocumentDto {
    @ApiProperty()
    @IsString()
    @MinLength(1)
    @MaxLength(500)
    title!: string;

    @ApiProperty()
    @IsString()
    @MinLength(1)
    content!: string;
}