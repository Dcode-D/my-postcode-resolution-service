import { Pool } from 'pg';
import { loadConfig } from '../config.js';

const seedRows = [
  ['42200', 'SELANGOR', 'KAPAR', 'KLANG'],
  ['50000', 'KUALA LUMPUR', 'KUALA LUMPUR', 'KUALA LUMPUR'],
  ['50450', 'KUALA LUMPUR', 'KUALA LUMPUR', 'KUALA LUMPUR'],
];

async function seed(): Promise<void> {
  const config = loadConfig();
  const pool = new Pool({ connectionString: config.DATABASE_URL });
  try {
    for (const [postcode, state, city, district] of seedRows) {
      await pool.query(
        `INSERT INTO malaysia_postcode_references (postcode, state, city, district, source)
         VALUES ($1, $2, $3, $4, 'development_seed')
         ON CONFLICT (postcode, state, city) DO UPDATE SET district = EXCLUDED.district, updated_at = now()`,
        [postcode, state, city, district],
      );
    }
    console.log(`Seeded ${seedRows.length} development postcode references`);
  } finally {
    await pool.end();
  }
}

void seed();
