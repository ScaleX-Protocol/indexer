import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5435/scalex_api',
    ssl: process.env.DATABASE_CA ? {
      rejectUnauthorized: true,
      ca: require('fs').readFileSync(process.env.DATABASE_CA).toString(),
    } : undefined,
  },
});