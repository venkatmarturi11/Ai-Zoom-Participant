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

/**
 * Auto-initialize database tables and enums on container startup if they don't exist yet.
 */
export async function initDatabaseSchema(): Promise<void> {
  const db = getDb();

  const statements = [
    `DO $$ BEGIN CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED'); EXCEPTION WHEN duplicate_object THEN null; END $$;`,
    `DO $$ BEGIN CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'DISCONNECTED', 'REVOKED', 'REFRESH_FAILED'); EXCEPTION WHEN duplicate_object THEN null; END $$;`,
    `DO $$ BEGIN CREATE TYPE "MeetingStatus" AS ENUM ('CREATED', 'SCHEDULED', 'STARTING', 'AUTHENTICATING', 'SDK_INITIALIZING', 'JOINING', 'WAITING_ROOM', 'CONNECTED', 'RECONNECTING', 'STOPPING', 'COMPLETED', 'FAILED', 'CANCELLED'); EXCEPTION WHEN duplicate_object THEN null; END $$;`,
    `DO $$ BEGIN CREATE TYPE "SessionStatus" AS ENUM ('CREATED', 'STARTING', 'CONNECTED', 'RECONNECTING', 'ENDING', 'COMPLETED', 'FAILED'); EXCEPTION WHEN duplicate_object THEN null; END $$;`,
    `DO $$ BEGIN CREATE TYPE "AuthType" AS ENUM ('ZAK', 'OBF'); EXCEPTION WHEN duplicate_object THEN null; END $$;`,

    `CREATE TABLE IF NOT EXISTS "users" (
      "id" TEXT NOT NULL,
      "telegram_user_id" BIGINT NOT NULL,
      "telegram_username" TEXT,
      "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
      "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "users_pkey" PRIMARY KEY ("id")
    );`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "users_telegram_user_id_key" ON "users"("telegram_user_id");`,

    `CREATE TABLE IF NOT EXISTS "zoom_accounts" (
      "id" TEXT NOT NULL,
      "user_id" TEXT NOT NULL,
      "zoom_user_id" TEXT NOT NULL,
      "zoom_email" TEXT NOT NULL,
      "access_token_encrypted" TEXT NOT NULL,
      "refresh_token_encrypted" TEXT NOT NULL,
      "token_expires_at" TIMESTAMP(3) NOT NULL,
      "scopes" TEXT,
      "status" "AccountStatus" NOT NULL DEFAULT 'ACTIVE',
      "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "zoom_accounts_pkey" PRIMARY KEY ("id"),
      CONSTRAINT "zoom_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
    );`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "zoom_accounts_user_id_zoom_user_id_key" ON "zoom_accounts"("user_id", "zoom_user_id");`,

    `CREATE TABLE IF NOT EXISTS "meetings" (
      "id" TEXT NOT NULL,
      "user_id" TEXT NOT NULL,
      "zoom_meeting_id" TEXT NOT NULL,
      "meeting_url" TEXT NOT NULL,
      "passcode_encrypted" TEXT,
      "topic" TEXT,
      "display_name" TEXT NOT NULL DEFAULT 'Meeting Assistant',
      "scheduled_at" TIMESTAMP(3),
      "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
      "actual_start" TIMESTAMP(3),
      "actual_end" TIMESTAMP(3),
      "status" "MeetingStatus" NOT NULL DEFAULT 'CREATED',
      "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "meetings_pkey" PRIMARY KEY ("id"),
      CONSTRAINT "meetings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
    );`,
    `CREATE INDEX IF NOT EXISTS "meetings_user_id_status_idx" ON "meetings"("user_id", "status");`,
    `CREATE INDEX IF NOT EXISTS "meetings_status_idx" ON "meetings"("status");`,

    `CREATE TABLE IF NOT EXISTS "bot_sessions" (
      "id" TEXT NOT NULL,
      "meeting_id" TEXT NOT NULL,
      "worker_id" TEXT,
      "authorizationType" "AuthType" NOT NULL DEFAULT 'OBF',
      "sdk_version" TEXT,
      "status" "SessionStatus" NOT NULL DEFAULT 'CREATED',
      "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "connected_at" TIMESTAMP(3),
      "ended_at" TIMESTAMP(3),
      "exit_reason" TEXT,
      "error_code" TEXT,
      CONSTRAINT "bot_sessions_pkey" PRIMARY KEY ("id"),
      CONSTRAINT "bot_sessions_meeting_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE
    );`,
    `CREATE INDEX IF NOT EXISTS "bot_sessions_meeting_id_idx" ON "bot_sessions"("meeting_id");`,

    `CREATE TABLE IF NOT EXISTS "oauth_states" (
      "state" TEXT NOT NULL,
      "telegram_user_id" BIGINT NOT NULL,
      "expires_at" TIMESTAMP(3) NOT NULL,
      "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "oauth_states_pkey" PRIMARY KEY ("state")
    );`,

    `CREATE TABLE IF NOT EXISTS "audit_logs" (
      "id" TEXT NOT NULL,
      "user_id" TEXT,
      "action" TEXT NOT NULL,
      "metadata" JSONB,
      "ip_address" TEXT,
      "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id"),
      CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
    );`,
    `CREATE INDEX IF NOT EXISTS "audit_logs_user_id_idx" ON "audit_logs"("user_id");`,
    `CREATE INDEX IF NOT EXISTS "audit_logs_action_idx" ON "audit_logs"("action");`,
    `CREATE INDEX IF NOT EXISTS "audit_logs_created_at_idx" ON "audit_logs"("created_at");`,
  ];

  for (const sql of statements) {
    try {
      await db.$executeRawUnsafe(sql);
    } catch (err: any) {
      console.error('DDL execute warning:', err?.message);
    }
  }
}

export { PrismaClient };
