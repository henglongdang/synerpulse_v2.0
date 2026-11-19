import { loadConfig, type Config } from './config';
import { openDatabase, type Database } from './db/client';
import { setDeps } from './lib/deps';
import { createConsoleEmail, createDisabledEmail, createSmtpEmail, type EmailService } from './services/email';
import { createDiskStorage, type StorageService } from './services/storage';

export async function bootstrap(overrides: { config?: Config; email?: EmailService; storage?: StorageService } = {}): Promise<{ database: Database; config: Config }> {
  const config = overrides.config ?? loadConfig();
  const database = await openDatabase({ databaseUrl: config.databaseUrl, pgliteDir: config.pgliteDir });
  await database.migrate();
  const email =
    overrides.email ??
    (config.emailTransport === 'smtp' && config.smtpUrl
      ? await createSmtpEmail(config.smtpUrl, config.emailFrom)
      : config.emailTransport === 'disabled'
        ? createDisabledEmail()
        : createConsoleEmail());
  const storage = overrides.storage ?? createDiskStorage(config.uploadDir);
  setDeps({ db: database.db, config, email, storage });
  return { database, config };
}
