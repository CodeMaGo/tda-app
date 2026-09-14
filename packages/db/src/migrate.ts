/**
 * Applies Drizzle migrations, then the hand-written SQL in ../sql that covers
 * triggers, RLS and search. Run by the CI pipeline before deploying the API.
 */
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

const here = dirname(fileURLToPath(import.meta.url));

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');

  const sql = postgres(url, { max: 1, prepare: false });
  const db = drizzle(sql);

  console.log('Applying schema migrations...');
  await migrate(db, { migrationsFolder: join(here, '..', 'migrations') });

  const sqlDir = join(here, '..', 'sql');
  const files = (await readdir(sqlDir)).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    console.log(`Applying ${file}...`);
    await sql.unsafe(await readFile(join(sqlDir, file), 'utf8'));
  }

  await sql.end();
  console.log('Database is up to date.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
