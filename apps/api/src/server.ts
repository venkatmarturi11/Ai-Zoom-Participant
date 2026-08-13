import Fastify from 'fastify';
import cors from '@fastify/cors';
import { healthRoutes } from './routes/health.js';
import { oauthRoutes } from './routes/oauth-callback.js';
import { createLogger } from '@zoom-assistant/shared';

const log = createLogger({ module: 'api-server' });

export function createServer() {
  const fastify = Fastify({
    logger: false, // We use pino logger explicitly
  });

  fastify.register(cors, {
    origin: true,
  });

  // Register route plugins
  fastify.register(healthRoutes);
  fastify.register(oauthRoutes);

  // Global error handler
  fastify.setErrorHandler((error, _request, reply) => {
    log.error({ error: error.message, stack: error.stack }, 'API error');
    reply.status(error.statusCode ?? 500).send({
      error: error.name ?? 'InternalError',
      message: error.message ?? 'An unexpected error occurred',
    });
  });

  return fastify;
}
