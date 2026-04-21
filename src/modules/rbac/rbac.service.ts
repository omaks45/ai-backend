import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class RbacService {
  constructor(private readonly prisma: PrismaService) {}

  // Returns flat Set of permission names — O(1) lookups
  async getUserPermissions(userId: string): Promise<Set<string>> {
    const userRoles = await this.prisma.userRole.findMany({
      where: { userId },
      include: {
        role: {
          include: {
            permissions: { include: { permission: true } },
          },
        },
      },
    });

    const permissions = new Set<string>();
    for (const { role } of userRoles) {
      for (const { permission } of role.permissions) {
        permissions.add(permission.name);
      }
    }

    return permissions;
  }

  async assignRole(userId: string, roleName: string, assignedBy: string) {
    const role = await this.prisma.role.findUniqueOrThrow({
      where: { name: roleName },
    });

    return this.prisma.userRole.upsert({
      where: { userId_roleId: { userId, roleId: role.id } },
      update: {},
      create: { userId, roleId: role.id, assignedBy },
    });
  }

  async revokeRole(userId: string, roleName: string) {
    const role = await this.prisma.role.findUniqueOrThrow({
      where: { name: roleName },
    });

    return this.prisma.userRole.deleteMany({
      where: { userId, roleId: role.id },
    });
  }

  async assignDefaultRole(userId: string) {
    const defaultRole = await this.prisma.role.findFirst({
      where: { isDefault: true },
    });

    if (!defaultRole) return;

    await this.prisma.userRole.upsert({
      where: { userId_roleId: { userId, roleId: defaultRole.id } },
      update: {},
      create: { userId, roleId: defaultRole.id },
    });
  }

  async listRoles() {
    return this.prisma.role.findMany({
      include: {
        permissions: { include: { permission: true } },
        _count: { select: { users: true } },
      },
      orderBy: { name: 'asc' },
    });
  }
}