import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

// Permission definitions

const PERMISSION_DEFS = [
    { name: 'documents:create',     resource: 'documents',     action: 'create',  description: 'Upload documents' },
    { name: 'documents:read',       resource: 'documents',     action: 'read',    description: 'View documents' },
    { name: 'documents:update',     resource: 'documents',     action: 'update',  description: 'Edit document metadata' },
    { name: 'documents:delete',     resource: 'documents',     action: 'delete',  description: 'Delete documents' },
    { name: 'conversations:create', resource: 'conversations', action: 'create',  description: 'Start conversations' },
    { name: 'conversations:read',   resource: 'conversations', action: 'read',    description: 'View conversations' },
    { name: 'users:read',           resource: 'users',         action: 'read',    description: 'View user list' },
    { name: 'users:manage',         resource: 'users',         action: 'manage',  description: 'Manage user accounts' },
    { name: 'roles:manage',         resource: 'roles',         action: 'manage',  description: 'Manage roles and permissions' },
] as const;

type PermissionName = (typeof PERMISSION_DEFS)[number]['name'];

// Role definitions

const ROLE_DEFS: {
    name: string;
    description: string;
    isDefault: boolean;
    permissions: readonly PermissionName[];
    }[] = [
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
        'documents:create',
        'documents:read',
        'documents:update',
        'conversations:create',
        'conversations:read',
        ],
    },
    {
        name: 'viewer',
        description: 'Read-only access',
        isDefault: false,
        permissions: ['documents:read', 'conversations:read'],
    },
];

// Seed functions

async function seedPermissions(): Promise<Record<string, string>> {
    const permMap: Record<string, string> = {};

    for (const def of PERMISSION_DEFS) {
        const perm = await prisma.permission.upsert({
        where: { name: def.name },
        update: {},
        create: def,
        });
        permMap[def.name] = perm.id;
    }

    console.log(`   ${PERMISSION_DEFS.length} permissions`);
    return permMap;
}

async function seedRoles(permMap: Record<string, string>): Promise<Record<string, string>> {
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
            where: {
            roleId_permissionId: { roleId: role.id, permissionId: permMap[permName] },
            },
            update: {},
            create: { roleId: role.id, permissionId: permMap[permName] },
        });
        }
    }

    console.log(`   ${ROLE_DEFS.length} roles`);
    return roleMap;
}

async function seedUsers(roleMap: Record<string, string>) {
    // Validate required env vars before hashing
    const requiredVars = [
        'SEED_ADMIN_EMAIL',
        'SEED_ADMIN_PASSWORD',
        'SEED_USER_EMAIL',
        'SEED_USER_PASSWORD',
    ] as const;

    for (const key of requiredVars) {
        if (!process.env[key]) {
        throw new Error(`Missing required env var: ${key}`);
        }
    }

    const [adminHash, userHash] = await Promise.all([
        bcrypt.hash(process.env.SEED_ADMIN_PASSWORD!, 12),
        bcrypt.hash(process.env.SEED_USER_PASSWORD!, 12),
    ]);

    const admin = await prisma.user.upsert({
        where: { email: process.env.SEED_ADMIN_EMAIL! },
        update: {},
        create: {
        email: process.env.SEED_ADMIN_EMAIL!,
        passwordHash: adminHash,
        tier: 'enterprise',
        tokenLimit: 1_000_000,
        },
    });

    const user = await prisma.user.upsert({
        where: { email: process.env.SEED_USER_EMAIL! },
        update: {},
        create: {
        email: process.env.SEED_USER_EMAIL!,
        passwordHash: userHash,
        },
    });

    // Assign roles — idempotent via upsert
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

    console.log(`   admin: ${admin.email}`);
    console.log(`   user:  ${user.email}`);

    return { admin, user };
}

async function seedSampleData(userId: string) {
    await prisma.document.upsert({
        where: { id: 'seed-doc-001' },
        update: {},
        create: {
        id: 'seed-doc-001',
        userId,
        title: 'Getting Started',
        filename: 'getting-started.txt',
        content: 'Welcome to DocuChat. Upload your documents and start asking questions.',
        status: 'ready',
        chunkCount: 1,
        },
    });

    console.log('   sample document');
}

// Entry point

async function main() {
    console.log('Seeding database...');

    const permMap = await seedPermissions();
    const roleMap = await seedRoles(permMap);
    const { user } = await seedUsers(roleMap);
    await seedSampleData(user.id);

    console.log('Done.');
}

main()
    .then(() => prisma.$disconnect())
    .catch((e) => {
        console.error(e);
        prisma.$disconnect();
        process.exit(1);
    });