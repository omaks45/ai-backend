import { IsEmail, IsString, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class LoginDto {
    @ApiProperty({ example: 'user@example.com' })
    @IsEmail()
    @Transform(({ value }) => value?.toLowerCase().trim())
    email!: string;

    @ApiProperty()
    @IsString()
    @MinLength(1, { message: 'Password is required' })
    password!: string;
}