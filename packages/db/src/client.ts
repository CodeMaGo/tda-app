import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index.js';

export type Database = ReturnType<typeof createDatabase>;

let cached: Database | undefined;

/**
 * Azure Functions reuses the host process between invocations, so the pool is
 * cached at module scope. `max` is deliberately small: Supabase's pooler is the
 * real connection manager and each Function instance should hold few sockets.
 */
export function createDatabase(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) throw new Error('DATABASE_URL is not set');
  const sql = postgres(connectionString, {
    max: Number(process.env.DATABASE_POOL_MAX ?? 4),
    idle_timeout: 20,
    connect_timeout: 15,
    prepare: false, // required when using Supabase's transaction pooler
  });
  return drizzle(sql, { schema, casing: 'snake_case' });
}

export function getDatabase(): Database {
  cached ??= createDatabase();
  return cached;
}

export { schema };
