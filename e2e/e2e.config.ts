import type { E2EConfig } from 'e2e';
import { extensionEngine } from './extension-engine.ts';

export default {
  projectId: 'linkedin-puzzle-solver',
  targets: [{ name: 'extension', engine: extensionEngine, app: { url: 'https://www.linkedin.com' } }],
  tests: ['tests/**/*.e2e.ts'],
  workers: 2,
  retries: 0,
  timeout: 45000,
  assertionTimeout: 18000,
  reporters: ['list', 'markdown', 'junit'],
  trace: 'on',
  cache: 'off',
} satisfies E2EConfig;
