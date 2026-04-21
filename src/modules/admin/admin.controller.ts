import {
  Controller, Get, Post, Delete, Param, Body,
  UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard, RequirePermissions } from '../../common/guards/permissions.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RbacService } from '../rbac/rbac.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AssignRoleDto } from './dto/assign-role.dto';

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions('roles:manage')
@Controller('admin')
export class AdminController {
  constructor(
    private readonly rbac: RbacService,
    private readonly events: EventEmitter2,
  ) {}

  @Get('roles')
  @ApiOperation({ summary: 'List all roles with permissions' })
  listRoles() {
    return this.rbac.listRoles();
  }

  @Post('users/:userId/roles')
  @ApiOperation({ summary: 'Assign a role to a user' })
  async assignRole(
    @Param('userId') userId: string,
    @Body() dto: AssignRoleDto,
    @CurrentUser() admin: any,
  ) {
    await this.rbac.assignRole(userId, dto.roleName, admin.id);

    this.events.emit('admin.role.assigned', {
      targetUserId: userId,
      roleName: dto.roleName,
      assignedBy: admin.id,
    });

    return { message: `Role '${dto.roleName}' assigned` };
  }

  @Delete('users/:userId/roles/:roleName')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoke a role from a user' })
  async revokeRole(
    @Param('userId') userId: string,
    @Param('roleName') roleName: string,
    @CurrentUser() admin: any,
  ) {
    await this.rbac.revokeRole(userId, roleName);

    this.events.emit('admin.role.revoked', {
      targetUserId: userId,
      roleName,
      revokedBy: admin.id,
    });

    return { message: `Role '${roleName}' revoked` };
  }
}