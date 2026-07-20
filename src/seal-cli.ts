import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  generateKeyB64,
  parseKeyB64,
  parseSealedJson,
  sealUtf8,
  unsealUtf8,
} from './seal-crypto.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENC_DIR = resolve(ROOT, 'turnstile');

function loadEnvKey(): string {
  const fromEnv = process.env.SEAL_KEY?.trim() ?? '';
  if (fromEnv) return fromEnv;
  const envPath = join(ROOT, '.env');
  if (!existsSync(envPath)) return '';
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    if (!line.includes('=') || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (line.slice(0, i).trim() === 'SEAL_KEY') return line.slice(i + 1).trim();
  }
  return '';
}

function main(): void {
  const args = process.argv.slice(2);
  const genKey = args.includes('--gen-key');
  const verify = args.includes('--verify');
  const kidArg = args.find((a) => a.startsWith('--kid='));
  const kid = kidArg ? kidArg.slice('--kid='.length) : 'default';

  let keyB64 = loadEnvKey();
  if (genKey && !keyB64) {
    keyB64 = generateKeyB64();
    console.log('Generated SEAL_KEY (store in password manager + Worker secret, never commit):\n');
    console.log(keyB64);
    console.log('');
  }
  if (!keyB64) {
    console.error('Missing SEAL_KEY. Set env/SEAL_KEY in .env, or pass --gen-key');
    process.exit(1);
  }

  const key = parseKeyB64(keyB64);
  const plainPath = join(ENC_DIR, 'script.js');
  const sealedPath = join(ENC_DIR, 'script.sealed');

  if (verify) {
    if (!existsSync(sealedPath)) {
      console.error(`missing ${sealedPath}`);
      process.exit(1);
    }
    const blob = parseSealedJson(readFileSync(sealedPath, 'utf8'));
    const plain = unsealUtf8(blob, key);
    console.log(`verify ok: kid=${blob.kid} bytes=${plain.length}`);
    return;
  }

  if (!existsSync(plainPath)) {
    console.error(`missing ${plainPath} (author plain source)`);
    process.exit(1);
  }

  const plain = readFileSync(plainPath, 'utf8');
  const blob = sealUtf8(plain, key, kid);
  writeFileSync(sealedPath, `${JSON.stringify(blob, null, 2)}\n`, 'utf8');
  console.log(`sealed → ${sealedPath}`);
  console.log(`kid=${blob.kid} ct_bytes=${Buffer.from(blob.ct, 'base64').length}`);
  console.log('Commit script.sealed + manifest.json. Keep script.js + SEAL_KEY private.');
  console.log('Put the same SEAL_KEY on your unlock Worker.');
}

main();
