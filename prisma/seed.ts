import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const PERMISSION_DEFS = [
    { name: 'documents:create', resource: 'documents', action: 'create', description: 'Upload documents' },
    { name: 'documents:read',   resource: 'documents', action: 'read',   description: 'View documents' },
    { name: 'documents:update', resource: 'documents', action: 'update', description: 'Edit document metadata' },
    { name: 'documents:delete', resource: 'documents', action: 'delete', description: 'Delete documents' },
    { name: 'conversations:create', resource: 'conversations', action: 'create', description: 'Start conversations' },
    { name: 'conversations:read',   resource: 'conversations', action: 'read',   description: 'View conversations' },
    { name: 'users:read',    resource: 'users', action: 'read',   description: 'View user list' },
    { name: 'users:manage',  resource: 'users', action: 'manage', description: 'Manage user accounts' },
    { name: 'roles:manage',  resource: 'roles', action: 'manage', description: 'Manage roles and permissions' },
] as const;

const ROLE_DEFS = [
    {
        name: 'admin',
        description: 'Full system access',
        isDefault: false,
        permissions: PERMISSION_DEFS.map((p) => p.name),
    },
    {
        name: 'member',
        description: 'Standard user',
        isDefault: true,
        permissions: [
        'documents:create', 'documents:read', 'documents:update',
        'conversations:create', 'conversations:read',
        ],
    },
    {
        name: 'viewer',
        description: 'Read-only access',
        isDefault: false,
        permissions: ['documents:read', 'conversations:read'],
    },
] as const;

async function seedPermissions() {
    const permMap: Record<string, string> = {};

    for (const def of PERMISSION_DEFS) {
        const perm = await prisma.permission.upsert({
        where: { name: def.name },
        update: {},
        create: def,
        });
        permMap[def.name] = perm.id;
    }

    return permMap;
}

async function seedRoles(permMap: Record<string, string>) {
    const roleMap: Record<string, string> = {};

    for (const def of ROLE_DEFS) {
        const role = await prisma.role.upsert({
        where: { name: def.name },
        update: {},
        create: { name: def.name, description: def.description, isDefault: def.isDefault },
        });

        roleMap[def.name] = role.id;

        for (const permName of def.permissions) {
        await prisma.rolePermission.upsert({
            where: { roleId_permissionId: { roleId: role.id, permissionId: permMap[permName] } },
            update: {},
            create: { roleId: role.id, permissionId: permMap[permName] },
        });
        }
    }

    return roleMap;
}

async function seedUsers(roleMap: Record<string, string>) {
    const [adminHash, userHash] = await Promise.all([
        bcrypt.hash('Admin123!', 12),
        bcrypt.hash('Test1234!', 12),
    ]);

    const admin = await prisma.user.upsert({
        where: { email: 'admin@docuchat.dev' },
        update: {},
        create: { email: 'admin@docuchat.dev', passwordHash: adminHash, tier: 'enterprise', tokenLimit: 1_000_000 },
    });

    const user = await prisma.user.upsert({
        where: { email: 'test@docuchat.dev' },
        update: {},
        create: { email: 'test@docuchat.dev', passwordHash: userHash },
    });

    // Assign roles
    await prisma.userRole.upsert({
        where: { userId_roleId: { userId: admin.id, roleId: roleMap['admin'] } },
        update: {},
        create: { userId: admin.id, roleId: roleMap['admin'] },
    });

    await prisma.userRole.upsert({
        where: { userId_roleId: { userId: user.id, roleId: roleMap['member'] } },
        update: {},
        create: { userId: user.id, roleId: roleMap['member'] },
    });

    return { admin, user };
}

async function main() {
    console.log('Seeding...');
    const permMap = await seedPermissions();
    const roleMap = await seedRoles(permMap);
    const { admin, user } = await seedUsers(roleMap);
    console.log('Done:', { admin: admin.email, user: user.email });
}

main()
    .then(() => prisma.$disconnect())
    .catch((e) => { console.error(e); prisma.$disconnect(); process.exit(1); });