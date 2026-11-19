import { bootstrap } from './bootstrap';
import { createApp } from './app';
import { deps } from './lib/deps';
import { logger } from './lib/logger';
import { startAlertScheduler } from './modules/alerts/service';
import { purgeExpiredSessions } from './modules/auth/session';

async function main() {
  const { database, config } = await bootstrap();
  const app = createApp();
  const server = app.listen(config.port, () => {
    logger.info(
      `FamilyPulse API listening on :${config.port} (${config.env}) · database: ${database.driver}${database.driver === 'pglite' ? ` (${config.pgliteDir})` : ''} · email: ${deps().email.transport}${config.webDistDir ? ` · serving web app from ${config.webDistDir}` : ''}`,
    );
  });
  const stopScheduler = startAlertScheduler();
  const purge = setInterval(() => void purgeExpiredSessions().catch(() => undefined), 6 * 3_600_000);
  purge.unref();

  const shutdown = (signal: string) => {
    logger.info(`${signal} received, shutting down`);
    stopScheduler();
    server.close(() => {
      void database.close().finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.fatal({ err: { message: err.message, stack: err.stack } }, 'failed to start');
  process.exit(1);
});
