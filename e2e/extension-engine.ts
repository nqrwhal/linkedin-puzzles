import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type BrowserContext } from 'playwright-core';
import { web, type BrowserProvider } from '@e2e-dev/web';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const leases = new Map<string, { context: BrowserContext; profile: string }>();

// A fresh persistent profile is required for Chromium's actual MV3 extension.
// The e2e engine attaches to it using its documented per-attempt CDP provider.
const provider: BrowserProvider = {
  name: 'linkedin-extension',
  scope: 'attempt',
  async acquire(request) {
    request.signal.throwIfAborted();
    const profile = await mkdtemp(join(tmpdir(), 'linkedin-e2e-'));
    let context: BrowserContext | undefined;
    try {
      context = await chromium.launchPersistentContext(profile, {
        channel: 'chromium', headless: true,
        args: [`--load-extension=${root}`, `--disable-extensions-except=${root}`,
          '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1'],
      });
      // Even a missing fixture must fail closed: these tests never contact LinkedIn.
      await context.route('**/*', route => route.abort());
      request.signal.throwIfAborted();
      const [port, path] = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).trim().split('\n');
      leases.set(profile, { context, profile });
      return { id: profile, cdpEndpoint: `ws://127.0.0.1:${port}${path}` };
    } catch (error) {
      await context?.close().catch(() => {});
      await rm(profile, { recursive: true, force: true });
      throw error;
    }
  },
  async release(lease) {
    const held = leases.get(lease.id);
    if (!held) return;
    leases.delete(lease.id);
    try { await held.context.close(); }
    finally { await rm(held.profile, { recursive: true, force: true }); }
  },
};

export const extensionEngine = web({ browser: provider });
