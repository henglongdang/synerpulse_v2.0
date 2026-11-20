import { defineConfig, mergeConfig } from 'vitest/config';
import base from './vitest.config';

// Same suite, but through the production node-postgres driver (see test/helpers.ts › openTestDatabase).
export default mergeConfig(base, defineConfig({ test: { env: { NODE_ENV: 'test', TEST_DRIVER: 'pg' } } }));
