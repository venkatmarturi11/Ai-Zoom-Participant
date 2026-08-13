import { getDb } from '../client.js';
import type { ZoomAccount, AccountStatus } from '@prisma/client';

export const zoomAccountRepo = {
  async findActiveByUserId(userId: string): Promise<ZoomAccount | null> {
    return getDb().zoomAccount.findFirst({
      where: { userId, status: 'ACTIVE' },
    });
  },

  async storeTokens(data: {
    userId: string;
    zoomUserId: string;
    zoomEmail: string;
    accessTokenEncrypted: string;
    refreshTokenEncrypted: string;
    tokenExpiresAt: Date;
    scopes?: string;
  }): Promise<ZoomAccount> {
    return getDb().zoomAccount.upsert({
      where: {
        userId_zoomUserId: {
          userId: data.userId,
          zoomUserId: data.zoomUserId,
        },
      },
      create: {
        ...data,
        status: 'ACTIVE',
      },
      update: {
        accessTokenEncrypted: data.accessTokenEncrypted,
        refreshTokenEncrypted: data.refreshTokenEncrypted,
        tokenExpiresAt: data.tokenExpiresAt,
        scopes: data.scopes,
        status: 'ACTIVE',
      },
    });
  },

  async updateTokens(
    id: string,
    accessTokenEncrypted: string,
    refreshTokenEncrypted: string,
    tokenExpiresAt: Date,
  ): Promise<ZoomAccount> {
    return getDb().zoomAccount.update({
      where: { id },
      data: { accessTokenEncrypted, refreshTokenEncrypted, tokenExpiresAt },
    });
  },

  async updateStatus(id: string, status: AccountStatus): Promise<ZoomAccount> {
    return getDb().zoomAccount.update({
      where: { id },
      data: { status },
    });
  },

  async revoke(userId: string): Promise<void> {
    await getDb().zoomAccount.updateMany({
      where: { userId, status: 'ACTIVE' },
      data: { status: 'DISCONNECTED' },
    });
  },
};
