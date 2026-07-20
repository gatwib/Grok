import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ENC_DIR, ROOT } from './shared.js';
import {
  parseKeyB64,
  parseSealedJson,
  unsealUtf8,
  type SealedBlob,
  type UnlockResponse,
} from './seal-crypto.js';

function envOr(key: string, def = ''): string {
  const fromProc = process.env[key]?.trim();
  if (fromProc) return fromProc;
  const envPath = join(ROOT, '.env');
  if (!existsSync(envPath)) return def;
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    if (!line.includes('=') || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (line.slice(0, i).trim() === key) return line.slice(i + 1).trim();
  }
  return def;
}

const temps = new Set<string>();

function trackTemp(dir: string): string {
  temps.add(dir);
  return dir;
}

export function cleanupSealedTemps(): void {
  for (const dir of temps) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
    }
  }
  temps.clear();
}

let hooksInstalled = false;
function installExitHooks(): void {
  if (hooksInstalled) return;
  hooksInstalled = true;
  const bye = () => cleanupSealedTemps();
  process.once('exit', bye);
  process.once('SIGINT', () => {
    bye();
    process.exit(130);
  });
  process.once('SIGTERM', () => {
    bye();
    process.exit(143);
  });
}

function materializeExt(scriptJs: string): string {
  const manifestPath = join(ENC_DIR, 'manifest.json');
  if (!existsSync(manifestPath)) {
    throw new Error(`missing ${manifestPath}`);
  }
  const dir = trackTemp(mkdtempSync(join(tmpdir(), 'wls-turnstile-')));
  writeFileSync(join(dir, 'script.js'), scriptJs, 'utf8');
  writeFileSync(join(dir, 'manifest.json'), readFileSync(manifestPath), 'utf8');
  installExitHooks();
  return dir;
}

async function fetchUnlockKey(kid: string): Promise<string> {
  const urlBase = envOr('SEAL_UNLOCK_URL');
  if (!urlBase) {
    throw new Error(
      'sealed extension needs SEAL_UNLOCK_URL (or local SEAL_KEY / plain turnstile/script.js)',
    );
  }
  const token = envOr('SEAL_TOKEN');
  const u = new URL(urlBase);
  u.searchParams.set('kid', kid);
  u.searchParams.set('app', 'wanglin-s-grok-signup');

  const res = await fetch(u, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`unlock HTTP ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}`);
  }

  const data = (await res.json()) as UnlockResponse;
  if (!data?.key) throw new Error('unlock response missing key');
  return data.key;
}

async function resolveKey(blob: SealedBlob): Promise<Buffer> {
  const local = envOr('SEAL_KEY');
  if (local) return parseKeyB64(local);
  const remote = await fetchUnlockKey(blob.kid || 'default');
  return parseKeyB64(remote);
}

export async function resolveTurnstileExt(): Promise<string> {
  const override = envOr('TURNSTILE_EXT_PATH');
  if (override) {
    const script = join(override, 'script.js');
    const manifest = join(override, 'manifest.json');
    if (!existsSync(script) || !existsSync(manifest)) {
      throw new Error(`TURNSTILE_EXT_PATH missing script.js/manifest.json: ${override}`);
    }
    return override;
  }

  const plain = join(ENC_DIR, 'script.js');
  const manifest = join(ENC_DIR, 'manifest.json');
  if (existsSync(plain) && existsSync(manifest)) {
    return ENC_DIR;
  }

  const sealedPath = join(ENC_DIR, 'script.sealed');
  if (!existsSync(sealedPath) || !existsSync(manifest)) {
    throw new Error(
      `missing turnstile assets (need script.js or script.sealed + manifest.json in ${ENC_DIR})`,
    );
  }

  const blob = parseSealedJson(readFileSync(sealedPath, 'utf8'));
  const key = await resolveKey(blob);
  const scriptJs = unsealUtf8(blob, key);
  return materializeExt(scriptJs);
}

export function ensureEncDir(): void {
  mkdirSync(ENC_DIR, { recursive: true });
}
