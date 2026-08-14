import type { FastifyPluginAsync } from 'fastify';

export const healthRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/', async (_req, reply) => {
    return reply.type('text/html').send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Telegram Zoom Assistant API</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            background: #0f172a;
            color: #f8fafc;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            margin: 0;
          }
          .card {
            background: #1e293b;
            padding: 2.5rem;
            border-radius: 1rem;
            box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);
            max-width: 480px;
            width: 90%;
            text-align: center;
            border: 1px solid #334155;
          }
          .badge {
            background: #0284c7;
            color: #e0f2fe;
            font-size: 0.85rem;
            font-weight: 600;
            padding: 0.25rem 0.75rem;
            border-radius: 9999px;
            display: inline-block;
            margin-bottom: 1rem;
          }
          h1 { color: #38bdf8; margin: 0 0 0.5rem 0; font-size: 1.75rem; }
          p { color: #94a3b8; font-size: 0.95rem; line-height: 1.5; }
          .status {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 0.5rem;
            margin: 1.5rem 0;
            padding: 0.75rem;
            background: #0f172a;
            border-radius: 0.5rem;
            color: #4ade80;
            font-weight: 600;
          }
          .dot {
            width: 10px;
            height: 10px;
            background: #22c55e;
            border-radius: 50%;
            box-shadow: 0 0 10px #22c55e;
          }
          .links { display: flex; flex-direction: column; gap: 0.5rem; margin-top: 1.5rem; }
          a {
            color: #38bdf8;
            text-decoration: none;
            font-size: 0.9rem;
          }
          a:hover { text-decoration: underline; }
        </style>
      </head>
      <body>
        <div class="card">
          <span class="badge">ONLINE</span>
          <h1>🤖 Zoom Assistant API</h1>
          <p>Official Telegram-controlled Zoom Attendance Bot backend API service is active.</p>
          <div class="status">
            <span class="dot"></span>
            <span>API Status: 200 OK</span>
          </div>
          <div class="links">
            <a href="/health">Check Health Status (/health)</a>
          </div>
        </div>
      </body>
      </html>
    `);
  });

  fastify.get('/health', async (_req, reply) => {
    return reply.status(200).send({
      status: 'ok',
      timestamp: new Date().toISOString(),
      service: 'telegram-zoom-assistant-api',
    });
  });
};
