import { PrismaClient } from '@prisma/client';
import fs from 'node:fs';

const env = Object.fromEntries(
  fs.readFileSync('.env', 'utf-8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => {
      const idx = l.indexOf('=');
      return [l.slice(0, idx).trim(), l.slice(idx + 1).trim().replace(/^[\'\"]|[\'\"]$/g, '')];
    })
);

process.env.DATABASE_URL = env.DATABASE_URL;

const db = new PrismaClient({
  datasources: { db: { url: env.DATABASE_URL } },
});

async function main() {
  console.log('Testing Neon PostgreSQL Connection...');
  const timeRes = await db.$queryRaw`SELECT NOW() as current_time;`;
  console.log('1. Database time:', timeRes);

  const userCount = await db.user.count();
  console.log('2. Users table count:', userCount);

  const meetingCount = await db.meeting.count();
  console.log('3. Meetings table count:', meetingCount);

  console.log('🎉 Neon PostgreSQL is working 100% perfectly!');
  await db.$disconnect();
}

main().catch(async (e) => {
  console.error('Error:', e);
  await db.$disconnect();
  process.exit(1);
});
