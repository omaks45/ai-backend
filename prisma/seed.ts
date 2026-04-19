import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
    console.log('Seeding database...');

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

    await prisma.document.upsert({
        where: { id: 'seed-doc-001' },
        update: {},
        create: {
        id: 'seed-doc-001',
        userId: user.id,
        title: 'Getting Started',
        filename: 'getting-started.txt',
        content: 'Welcome to DocuChat.',
        status: 'ready',
        chunkCount: 1,
        },
    });

    console.log('Seeded:', { admin: admin.email, user: user.email });
}

main()
    .then(() => prisma.$disconnect())
    .catch((e) => {
        console.error(e);
        prisma.$disconnect();
        process.exit(1);
    });