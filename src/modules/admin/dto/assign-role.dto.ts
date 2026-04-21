import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AssignRoleDto {
    @ApiProperty({ example: 'member' })
    @IsString()
    @IsNotEmpty()
    roleName!: string;
}