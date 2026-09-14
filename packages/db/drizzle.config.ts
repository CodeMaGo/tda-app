import type { Config } from 'drizzle-kit';

export default {
  schema: './dist/schema/index.js',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.MIGRATION_DATABASE_URL! },
  verbose: true,
  strict: true,
} satisfies Config;
