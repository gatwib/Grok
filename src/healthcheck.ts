/**
 * HEALTH CHECK — deteksi dini kalau halaman signup Grok berubah.
 * Buka SIGNUP, cek apakah field email + tombol yang GAC andalkan masih ada.
 * Jalankan berkala: tsx src/healthcheck.ts
 *
 * Exit 0 = sehat (GAC kemungkinan besar jalan)
 * Exit 1 = ADA yang berubah (perlu update selektor di .env)
 */
import { SIGNUP, TXT_EMAIL_BTN, findChrome, launchChrome, hardenPage } from './shared.js';
import type { Browser, Page } from 'puppeteer-core';

const GRN = '\x1b[32m';
const RED = '\x1b[31m';
const YEL = '\x1b[33m';
const RST = '\x1b[0m';

async function main() {
  console.log('=== GROK SIGNUP HEALTH CHECK ===');
  console.log(`URL: ${SIGNUP}\n`);

  const chrome = findChrome();
  if (!chrome) { console.error(`${RED}Chrome tidak ditemukan${RST}`); process.exit(2); }

  let browser: Browser | undefined;
  const problems: string[] = [];
  try {
    browser = await launchChrome({ profile: '', extPath: '' });
    const page: Page = await browser.newPage();
    await hardenPage(page);

    // 1. Halaman bisa dibuka?
    let httpOk = true;
    try {
      const resp = await page.goto(SIGNUP, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      const status = resp?.status() ?? 0;
      console.log(status < 400 ? `${GRN}[OK]${RST} halaman load (HTTP ${status})` : `${RED}[ERR]${RST} HTTP ${status}`);
      if (status >= 400) { problems.push(`URL ${SIGNUP} balas HTTP ${status} — mungkin Grok ganti URL signup`); httpOk = false; }
    } catch (e) {
      problems.push(`gagal buka ${SIGNUP}: ${e instanceof Error ? e.message : e} — cek SIGNUP_URL di .env`);
      httpOk = false;
      console.log(`${RED}[ERR]${RST} tak bisa buka halaman`);
    }

    if (httpOk) {
      await new Promise((r) => setTimeout(r, 5000));

      // Cek berbasis DETEKSI STRUKTUR (bukan harus isi form, karena cookie banner bisa menghalangi):
      // Yang penting: tombol/link "Sign up with email" yang GAC andalkan masih ADA di halaman?
      const structure = await page.evaluate((btnTexts: string[]) => {
        const allText = Array.from(document.querySelectorAll('button,[role=button],a,div,span'))
          .map((e) => (e.textContent || '').trim()).filter(Boolean);
        const foundBtn = btnTexts.find((t) =>
          allText.some((txt) => txt.toLowerCase() === t.toLowerCase()));
        const emailInput = !!document.querySelector(
          'input[type=email], input[name=email], input[autocomplete=email]');
        const title = document.title;
        const isSignupPage = /grok|sign\s?up|create.*account/i.test(title + ' ' + (document.body?.innerText || '').slice(0, 500));
        return { foundBtn: foundBtn || null, emailInput, title, isSignupPage };
      }, TXT_EMAIL_BTN);

      // Verdict: sehat kalau (halaman signup benar) DAN (ada tombol email ATAU field email langsung)
      const emailFound = !!structure.emailInput || !!structure.foundBtn;

      console.log(structure.isSignupPage
        ? `${GRN}[OK]${RST} halaman signup Grok terkonfirmasi (title: "${structure.title}")`
        : `${RED}[ERR]${RST} halaman TIDAK terlihat seperti signup Grok (title: "${structure.title}")`);
      if (!structure.isSignupPage) problems.push(`title "${structure.title}" tak cocok — mungkin Grok ganti URL/redesign. Cek SIGNUP_URL di .env`);

      console.log(structure.foundBtn
        ? `${GRN}[OK]${RST} tombol "${structure.foundBtn}" ditemukan (jalur email GAC ada)`
        : structure.emailInput
          ? `${GRN}[OK]${RST} field email langsung ada`
          : `${RED}[ERR]${RST} jalur email TIDAK ditemukan`);
      if (!emailFound) problems.push('tombol/field email tak ketemu — cek SEL_EMAIL / TXT_EMAIL_BTN di .env, atau Grok redesign form');

      // 3. Ada Turnstile di halaman?
      const hasTurnstile = await page.evaluate(() =>
        !!document.querySelector('input[name=cf-turnstile-response], .cf-turnstile, iframe[src*="turnstile"], iframe[src*="challenges.cloudflare"]'),
      );
      console.log(hasTurnstile ? `${GRN}[OK]${RST} Turnstile terdeteksi` : `${YEL}[WARN]${RST} Turnstile tak terdeteksi (mungkin muncul nanti / berubah)`);
    }
  } finally {
    await browser?.close().catch(() => undefined);
  }

  console.log('');
  if (problems.length === 0) {
    console.log(`${GRN}=== SEHAT ===${RST} Struktur signup Grok masih cocok dengan GAC. Aman dijalankan.`);
    process.exit(0);
  } else {
    console.log(`${RED}=== ADA MASALAH (${problems.length}) ===${RST}`);
    problems.forEach((p, i) => console.log(`  ${i + 1}. ${p}`));
    console.log(`\n${YEL}Tindakan:${RST} update selektor terkait di .env (SIGNUP_URL, SEL_EMAIL, dll) tanpa perlu ubah kode.`);
    process.exit(1);
  }
}

main().catch((e) => { console.error('FATAL:', e instanceof Error ? e.message : e); process.exit(2); });
