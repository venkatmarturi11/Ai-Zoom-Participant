import { PrismaClient } from '@prisma/client';

let prisma: PrismaClient | undefined;

/**
 * Singleton Prisma client.
 * Prevents creating multiple connections during hot-reload in development.
 */
export function getDb(): PrismaClient {
  if (!prisma) {
    prisma = new PrismaClient({
      log: process.env['NODE_ENV'] === 'development' ? ['query', 'warn', 'error'] : ['error'],
    });
  }
  return prisma;
}

/**
 * Gracefully disconnect the Prisma client.
 * Call during shutdown.
 */
export async function disconnectDb(): Promise<void> {
  if (prisma) {
    await prisma.$disconnect();
    prisma = undefined;
  }
}

export { PrismaClient };
