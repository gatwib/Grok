/**
 * PANEN script.js dari script.sealed (Jalur B - untuk self-hosting pribadi).
 * Memakai resolveTurnstileExt() asli GAC: unseal via SEAL_TOKEN yang valid,
 * lalu SIMPAN script.js plain ke turnstile/ supaya GAC tak perlu token lagi.
 *
 * Jalankan: tsx src/harvest-script.ts
 */
import { existsSync, readFileSync, copyFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ENC_DIR } from './shared.js';
import { resolveTurnstileExt, cleanupSealedTemps } from './seal-turnstile.js';

async function main() {
  const plainTarget = join(ENC_DIR, 'script.js');

  if (existsSync(plainTarget)) {
    console.log(`⚠️  turnstile/script.js SUDAH ADA (${statSync(plainTarget).size} bytes).`);
    console.log('   GAC sudah mandiri. Tidak perlu panen ulang.');
    return;
  }

  console.log('=== PANEN script.js (Jalur B) ===');
  console.log('1. Memanggil resolveTurnstileExt() (unseal via SEAL_TOKEN)...');

  let extDir: string;
  try {
    extDir = await resolveTurnstileExt();
  } catch (e) {
    console.error('❌ GAGAL unseal:', e instanceof Error ? e.message : String(e));
    console.error('   Pastikan SEAL_TOKEN & SEAL_UNLOCK_URL di .env masih valid,');
    console.error('   atau SEAL_KEY ada, atau turnstile/script.js sudah plain.');
    process.exit(1);
  }

  const harvested = join(extDir, 'script.js');
  if (!existsSync(harvested)) {
    console.error(`❌ script.js tidak ditemukan di temp: ${harvested}`);
    process.exit(1);
  }

  const size = statSync(harvested).size;
  console.log(`2. script.js ter-unseal di temp (${size} bytes): ${harvested}`);

  // simpan permanen ke turnstile/script.js
  copyFileSync(harvested, plainTarget);
  console.log(`3. ✅ DISIMPAN PERMANEN: ${plainTarget}`);

  // verifikasi hasil
  const savedSize = statSync(plainTarget).size;
  const preview = readFileSync(plainTarget, 'utf8').slice(0, 120).replace(/\n/g, ' ');
  console.log(`4. Verifikasi: ${savedSize} bytes, preview: "${preview}..."`);

  console.log('');
  console.log('=== SELESAI ===');
  console.log('GAC sekarang pakai turnstile/script.js plain.');
  console.log('resolveTurnstileExt() akan pilih file plain ini DULU (tak pernah fetch Worker author).');
  console.log('SEAL_TOKEN & SEAL_UNLOCK_URL tidak lagi dibutuhkan.');

  cleanupSealedTemps();
}

main().catch((e) => {
  console.error('ERROR:', e instanceof Error ? e.message : String(e));
  cleanupSealedTemps();
  process.exit(1);
});
