import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Pool } from 'pg';
import { loadConfig } from '../config.js';

async function migrate(): Promise<void> {
  const config = loadConfig();
  const pool = new Pool({ connectionString: config.DATABASE_URL });
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    const migrationDir = join(process.cwd(), 'migrations');
    const files = (await readdir(migrationDir)).filter((file) => file.endsWith('.sql')).sort();
    for (const file of files) {
      const applied = await pool.query('SELECT 1 FROM schema_migrations WHERE id = $1', [file]);
      if (applied.rowCount) continue;
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(await readFile(join(migrationDir, file), 'utf8'));
        await client.query('INSERT INTO schema_migrations (id) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log(`Applied migration ${file}`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }
  } finally {
    await pool.end();
  }
}

void migrate();
