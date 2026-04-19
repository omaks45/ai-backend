import { IsEmail, IsString, MinLength, MaxLength, Matches } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class RegisterDto {
    @ApiProperty({ example: 'user@example.com' })
    @IsEmail({}, { message: 'Must be a valid email' })
    @Transform(({ value }) => value?.toLowerCase().trim())
    email!: string;

    @ApiProperty({ example: 'SecurePass1' })
    @IsString()
    @MinLength(8)
    @MaxLength(128)
    @Matches(/[A-Z]/, { message: 'Must contain an uppercase letter' })
    @Matches(/[0-9]/, { message: 'Must contain a number' })
    password!: string;
}