import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from '../schema';
import * as fs from 'fs';

// SSL configuration
const sslConfig = process.env.DATABASE_CA ? {
  ssl: {
    rejectUnauthorized: true,
    ca: fs.readFileSync(process.env.DATABASE_CA).toString(),
  }
} : {};

// Using dedicated database for API/faucet functionality
const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5435/scalex_api';

const pool = new Pool({
  connectionString,
  ...sslConfig,
});

export const db = drizzle(pool, { schema });