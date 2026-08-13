import { getDb } from '../client.js';
import type { User, UserStatus } from '@prisma/client';

export const userRepo = {
  async findByTelegramId(telegramUserId: bigint): Promise<User | null> {
    return getDb().user.findUnique({
      where: { telegramUserId },
    });
  },

  async upsert(telegramUserId: bigint, telegramUsername?: string): Promise<User> {
    return getDb().user.upsert({
      where: { telegramUserId },
      create: { telegramUserId, telegramUsername },
      update: { telegramUsername, updatedAt: new Date() },
    });
  },

  async updateStatus(id: string, status: UserStatus): Promise<User> {
    return getDb().user.update({
      where: { id },
      data: { status },
    });
  },
};
