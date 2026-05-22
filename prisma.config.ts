/* eslint-disable prettier/prettier */
/// <reference types="node" />
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