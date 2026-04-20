/* eslint-disable prettier/prettier */
import 'dotenv/config';

export default {
    schema: 'prisma/schema.prisma',
    migrations: {
        path: 'prisma/migrations',
        seed: 'ts-node --compiler-options {"module":"CommonJS"} prisma/seed.ts',
    },
    datasource: {
        url: process.env.DATABASE_URL!,
    },
};