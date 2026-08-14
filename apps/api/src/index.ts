import { createServer } from './server.js';
import { createLogger } from '@zoom-assistant/shared';

const log = createLogger({ module: 'api-entry' });

async function main() {
  const server = createServer();

  const port = Number(process.env['PORT'] ?? process.env['API_PORT'] ?? 3000);
  const host = process.env['API_HOST'] ?? '0.0.0.0';

  try {
    await server.listen({ port, host });
    log.info({ port, host }, `🚀 Fastify API server listening on http://${host}:${port}`);
  } catch (err) {
    log.fatal({ error: err }, 'Failed to start API server');
    process.exit(1);
  }
}

main();
