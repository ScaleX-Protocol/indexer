import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from '../schema';

// Option 1: Using Pool with schema in options
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 5432,
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'password',
  database: process.env.DB_NAME || 'gtx_api',
  options: process.env.DB_SCHEMA ? `-c search_path=${process.env.DB_SCHEMA}` : undefined,
});

// Option 2: Using connection string (alternative approach)
// const connectionString = `postgresql://${process.env.DB_USER || 'postgres'}:${process.env.DB_PASSWORD || 'password'}@${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || 5432}/${process.env.DB_NAME || 'gtx_api'}${process.env.DB_SCHEMA ? `?options=-csearch_path%3D${process.env.DB_SCHEMA}` : ''}`;
// const pool = new Pool({ connectionString });

export const db = drizzle(pool, { schema });