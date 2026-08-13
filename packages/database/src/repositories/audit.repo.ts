import { getDb } from '../client.js';

export const auditRepo = {
  async log(params: {
    userId?: string;
    action: string;
    metadata?: Record<string, unknown>;
    ipAddress?: string;
  }): Promise<void> {
    await getDb().auditLog.create({
      data: {
        userId: params.userId,
        action: params.action,
        metadata: (params.metadata as any) ?? undefined,
        ipAddress: params.ipAddress,
      },
    });
  },
};
