import type { FastifyPluginAsync } from 'fastify';

export const healthRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/health', async (_req, reply) => {
    return reply.status(200).send({
      status: 'ok',
      timestamp: new Date().toISOString(),
      service: 'telegram-zoom-assistant-api',
    });
  });
};
