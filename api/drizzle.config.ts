import { defineConfig } from 'drizzle-kit';
import * as fs from 'fs';

const sslConfig = process.env.DB_CA_CERT_PATH ? {
  ssl: {
    rejectUnauthorized: true,
    ca: fs.readFileSync(process.env.DB_CA_CERT_PATH).toString(),
  }
} : {};

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './drizzle',
  dbCredentials: {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 5432,
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'password',
    database: process.env.DB_NAME || 'gtx_api',
    ...sslConfig,
  },
});