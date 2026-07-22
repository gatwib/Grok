import type { Browser, Cookie, Page } from 'puppeteer-core';
import { createProvider } from '@wanglinsaputra/tempmail-wrapper';
import { createGatwibProvider } from './gatwib-mail.js';
import { AsyncLocalStorage } from 'node:async_hooks';
import { mkdirSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  PASSWORD, OUT, SIGNUP, AUTO_ADD_9ROUTER, TURNSTILE_TIMEOUT_S, TURNSTILE_RETRIES,
  SEL_EMAIL, SEL_CODE, SEL_GIVEN, SEL_FAMILY, SEL_PASSWORD, TXT_EMAIL_BTN, TXT_SUBMIT_BTN,
  type AccountData, type Result,
  findChrome, launchChrome, hardenPage, clearBrowserCookies, getAllCookies,
  fillInput, clickText, tryClickText, pageLooksBlocked,
  GRN, RED, YEL, CYN, DIM, RST, SP,
  header, tableSep, row, footer, section, ask,
  step as _step, ok as _ok, no as _no, wait as _wait, spin as _spin, clearLine as _clearLine, sleep,
} from './shared.js';
import { addToRouter } from './add-router.js';
import { cleanupSealedTemps, resolveTurnstileExt } from './seal-turnstile.js';

type WorkerStore = { id: number; multi: boolean };
const workerCtx = new AsyncLocalStorage<WorkerStore>();

function wpre(): string {
  const s = workerCtx.getStore();
  return s?.multi ? `${DIM}[W${s.id}]${RST} ` : '';
}
function step(n: number, msg: string): void { _step(n, `${wpre()}${msg}`); }
function ok(msg: string): void { _ok(`${wpre()}${msg}`); }
function no(msg: string): void { _no(`${wpre()}${msg}`); }
function wait(msg: string): void { _wait(`${wpre()}${msg}`); }
function clearLine(): void {
  const s = workerCtx.getStore();
  if (s?.multi) return;
  _clearLine();
}
function spin(frame: number, msg: string): void {
  const s = workerCtx.getStore();
  if (s?.multi) {
    if (frame % 15 === 0) _wait(`${wpre()}${msg}`);
    return;
  }
  _spin(frame, msg);
}

let appendChain: Promise<void> = Promise.resolve();
function appendOut(line: string): Promise<void> {
  appendChain = appendChain.then(() => {
    appendFileSync(OUT, line);
  }).catch(() => undefined);
  return appendChain;
}

function extractOtp(text: string): string | null {
  if (!text) return null;
  let g = text.match(/code:\s*([A-Z0-9]{3}-[A-Z0-9]{3})/i);
  if (g) return g[1].replace(/-/g, '');
  g = text.match(/code:\s*([A-Z0-9]{6})/i);
  if (g) return g[1];
  g = text.match(/\b([A-Z0-9]{3}-[A-Z0-9]{3})\b/i);
  if (g) return g[1].replace(/-/g, '');
  g = text.match(/\b([A-Z0-9]{6})\b/);
  if (g) return g[1];
  return null;
}

type TempMailClient = ReturnType<typeof createProvider>;

class Mail {
  private client!: TempMailClient;
  provider = '';
  addr = '';

  async create(): Promise<string> {
    // pakai provider email pribadi gatwib.my.id (bukan tempmail publik)
    this.client = createGatwibProvider() as unknown as TempMailClient;
    this.provider = 'gatwib-mail';
    this.addr = await this.client.generateEmail();
    return this.addr;
  }

  private async readDetail(msgId: string) {
    return await this.client.readMessage(msgId);
  }

  async peekCode(): Promise<string | null> {
    const inbox = await this.client.getInbox(this.addr);
    for (const m of inbox) {
      const fromSubject = extractOtp(m.subject || m.preview || '');
      if (fromSubject) return fromSubject;
      try {
        const d = await this.readDetail(m.id);
        const code = extractOtp([d.subject, d.bodyText, d.bodyHtml].filter(Boolean).join('\n'));
        if (code) return code;
      } catch {
      }
    }
    return null;
  }
}

async function runOne(browser: Browser): Promise<AccountData> {
  const page = await browser.newPage();
  await hardenPage(page);
  try {
    return await flow(page);
  } finally {
    await page.close().catch(() => undefined);
  }
}

async function flow(page: Page): Promise<AccountData> {
  step(1, 'Open signup');
  await page.goto(SIGNUP, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  // tunggu HANYA kalau ada Cloudflare interstitial (jangan jeda buta).
  // Cek cepat tiap 500ms, keluar begitu halaman siap (biasanya <1 detik, tak ada CF).
  for (let i = 0; i < 30; i++) {
    const blocked = await pageLooksBlocked(page);
    if (!blocked) break;
    if (blocked.startsWith('cloudflare block')) throw new Error(blocked);
    if (i % 2 === 0) spin(i, `waiting CF ${Math.floor(i / 2) + 1}s`);
    await sleep(500);
  }
  clearLine();
  await tryClickText(page, 'Accept All Cookies', 2000);
  await tryClickText(page, 'Accept all cookies', 1000);
  const blocked = await pageLooksBlocked(page);
  if (blocked?.startsWith('cloudflare block')) throw new Error(blocked);
  ok('page loaded');

  step(2, 'Sign up with email');
  const emailSel = SEL_EMAIL;
  const emailReady = await page.$(emailSel);
  if (!emailReady) {
    const variants = TXT_EMAIL_BTN;
    let okClick = false;
    let last = '';
    for (const v of variants) {
      try {
        await clickText(page, v, 5000);
        okClick = true;
        break;
      } catch (e) {
        last = e instanceof Error ? e.message : String(e);
      }
    }
    if (!okClick) throw new Error(last || 'Sign up with email not found');
  }
  await page.waitForSelector(emailSel, { timeout: 12_000, visible: true });
  ok('email form');

  step(3, 'Create temp email');
  wait(`provider: gatwib-mail (gatwib.my.id)`);
  const mail = new Mail();
  const addr = await mail.create();
  wait(`${addr}  ${DIM}via ${mail.provider}${RST}`);
  await fillInput(page, emailSel, addr);
  await page.keyboard.press('Enter');
  try {
    await page.waitForSelector(SEL_CODE, { timeout: 20_000, visible: true });
  } catch {
    for (const t of TXT_SUBMIT_BTN) { if (await tryClickText(page, t, 1500)) break; }
    await page.waitForSelector(SEL_CODE, { timeout: 15_000, visible: true });
  }
  ok('email submitted');

  step(4, 'Wait for OTP');
  const t0 = Date.now();
  let sp = 0;
  let code: string | null = null;
  while ((Date.now() - t0) / 1000 < 120) {
    code = await mail.peekCode();
    if (code) break;
    spin(sp, `waiting OTP ${Math.floor((Date.now() - t0) / 1000)}s`);
    sp += 1;
    await sleep(300);
  }
  clearLine();
  if (!code) throw new Error('OTP timeout 120s');
  ok(`OTP: ${code}`);

  step(5, 'Submit OTP');
  await fillInput(page, SEL_CODE, code);
  await sleep(300);
  await page.keyboard.press('Enter');
  await page.waitForSelector(SEL_GIVEN, { timeout: 20_000, visible: true });
  ok('verified');

  step(6, 'Fill name & password');
  const local = addr.split('@')[0];
  const parts = local.split(/[._\-]/);
  const given = (parts[0] || 'User').charAt(0).toUpperCase() + (parts[0] || 'User').slice(1).toLowerCase();
  const famRaw = parts.length > 1 ? parts[1] : 'Putra';
  const family = famRaw.charAt(0).toUpperCase() + famRaw.slice(1).toLowerCase();
  wait(`${given} ${family}`);
  await fillInput(page, SEL_GIVEN, given);
  await fillInput(page, SEL_FAMILY, family);
  await fillInput(page, SEL_PASSWORD, PASSWORD);
  ok('form filled');

  step(7, 'Solve turnstile & submit');
  let tok = '';
  const maxTurnstileRetries = TURNSTILE_RETRIES;
  for (let attempt = 1; attempt <= maxTurnstileRetries && !tok; attempt++) {
    for (let i = 0; i < TURNSTILE_TIMEOUT_S; i++) {
      tok = await page.evaluate(
        `(() => {
          const el = document.querySelector('input[name=cf-turnstile-response]');
          return (el && el.value) || '';
        })()`,
      ) as string;
      if (tok) break;
      if (i % 10 === 0 && i > 0) spin(i, `waiting turnstile ${i}s/${TURNSTILE_TIMEOUT_S}s (try ${attempt}/${maxTurnstileRetries})`);
      await sleep(1000);
    }
    clearLine();
    if (tok) break;
    // timeout attempt ini — kalau masih ada percobaan, coba "bangunkan" Turnstile
    if (attempt < maxTurnstileRetries) {
      wait(`turnstile timeout (try ${attempt}), mencoba ulang...`);
      // klik area turnstile / reload widget agar challenge di-render ulang
      await page.evaluate(
        `(() => {
          try {
            const w = document.querySelector('.cf-turnstile, [class*=turnstile]');
            if (w && typeof w.click === 'function') w.click();
            if (window.turnstile && typeof window.turnstile.reset === 'function') window.turnstile.reset();
          } catch (e) {}
        })()`,
      ).catch(() => undefined);
      await sleep(3000);
    }
  }
  if (!tok) throw new Error(`Turnstile timeout ${TURNSTILE_TIMEOUT_S}s x${maxTurnstileRetries} tries`);
  ok('turnstile solved');

  const emptyFields = await page.evaluate(
    `(() => {
      const empty = (s) => { const el = document.querySelector(s.split(',')[0].trim()); return !el || !el.value; };
      return {
        given: empty(${JSON.stringify(SEL_GIVEN)}),
        family: empty(${JSON.stringify(SEL_FAMILY)}),
        password: empty(${JSON.stringify(SEL_PASSWORD)}),
      };
    })()`,
  ) as { given: boolean; family: boolean; password: boolean };
  if (emptyFields.given) await fillInput(page, SEL_GIVEN, given);
  if (emptyFields.family) await fillInput(page, SEL_FAMILY, family);
  if (emptyFields.password) await fillInput(page, SEL_PASSWORD, PASSWORD);

  const submitSignup = async (): Promise<void> => {
    const clicked = await page.evaluate(
      `(() => {
        const btns = Array.from(document.querySelectorAll('button, [role="button"], input[type=submit]'));
        const match = btns.find((b) => /complete\\s*sign\\s*up|create\\s*account|sign\\s*up/i.test(
          ((b.textContent || b.value || '') + '').replace(/\\s+/g, ' ').trim()
        ));
        if (!match) return false;
        if (match.disabled) {
          match.removeAttribute('disabled');
          match.disabled = false;
        }
        match.click();
        return true;
      })()`,
    ) as boolean;
    if (clicked) return;
    const formOk = await page.evaluate(
      `(() => {
        const form = document.querySelector('form');
        if (!form) return false;
        if (typeof form.requestSubmit === 'function') form.requestSubmit();
        else form.submit();
        return true;
      })()`,
    ) as boolean;
    if (formOk) return;
    await clickText(page, 'Complete sign up', 10_000);
  };

  const urlBefore = page.url();
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 25_000 }).catch(() => null),
    submitSignup(),
  ]);
  ok('submitted');

  step(8, 'Finish redirect');
  let lastBody = '';
  let redirected = false;
  let forcedGrok = false;
  const isGrok = (u: string) => /(?:^|[/.])grok\.com(?:[/:?]|$)/i.test(u);
  const leftSignup = (u: string) => {
    if (!u) return false;
    if (isGrok(u)) return true;
    if (/accounts\.x\.ai|auth\.x\.ai/i.test(u) && !/\/sign-up/i.test(u)) return true;
    return false;
  };
  const hasSso = async (): Promise<Cookie[]> => {
    try {
      const all = await getAllCookies(page);
      return all.filter((c) => /^(sso|sso-rw)$/i.test(c.name));
    } catch {
      return [];
    }
  };
  const forceGrok = async (_why: string): Promise<boolean> => {
    if (forcedGrok) return isGrok(page.url());
    forcedGrok = true;
    wait('opening app');
    try {
      await page.goto('https://grok.com/', { waitUntil: 'domcontentloaded', timeout: 15_000 });
    } catch {
    }
    await sleep(800);
    if (isGrok(page.url())) {
      ok('redirect ok');
      return true;
    }
    const sso = await hasSso();
    if (sso.length) {
      ok('SSO ready');
      return true;
    }
    no('redirect failed');
    return false;
  };
  const pageText = async (): Promise<string> => {
    for (let a = 0; a < 4; a++) {
      try {
        return await page.evaluate(
          `(() => (document.body && document.body.innerText || '').slice(0, 2000))()`,
        ) as string;
      } catch (e) {
        const m = e instanceof Error ? e.message : String(e);
        if (/context was destroyed|execution context|navigat|Target closed|Session closed/i.test(m)) {
          await sleep(300);
          continue;
        }
        return '';
      }
    }
    return '';
  };
  const pageHasForm = async (): Promise<boolean> => {
    try {
      return await page.evaluate(
        `(() => !!document.querySelector('input[name=password], input[name=givenName]'))()`,
      ) as boolean;
    } catch {
      return false;
    }
  };
  const formError = (txt: string): string | null => {
    const low = txt.toLowerCase();
    const needles = [
      'existing account', 'already exists', 'account already',
      'associated with this email',
      'too weak', 'password must',
      'cannot accept', 'not accept', 'disposable',
      'if you think this is an error',
      'please contact support@x.ai',
    ];
    for (const err of needles) {
      const idx = low.indexOf(err);
      if (idx >= 0) return txt.slice(Math.max(0, idx - 40), idx + 80).replace(/\s+/g, ' ').trim();
    }
    return null;
  };
  const isAccountExists = (fe: string) =>
    /existing account|already exists|account already|associated with this email/i.test(fe);
  const isFatalFormErr = (fe: string) =>
    isAccountExists(fe)
    || /cannot accept|not accept|disposable|too weak|password must|if you think this is an error|please contact support@x\.ai/i.test(fe);

  {
    const u0 = page.url();
    if (isGrok(u0)) {
      ok('redirect ok');
      redirected = true;
    } else if (leftSignup(u0)) {
      redirected = await forceGrok('left signup');
    }
  }

  for (let i = 0; i < 20 && !redirected; i++) {
    await sleep(1500);
    let url = '';
    try { url = page.url(); } catch { continue; }
    if (isGrok(url)) {
      ok('redirect ok');
      redirected = true;
      break;
    }
    if (leftSignup(url) && url !== urlBefore) {
      redirected = await forceGrok('left signup');
      if (redirected) break;
    }

    if (leftSignup(url) || i >= 3) {
      const sso = await hasSso();
      if (sso.length) {
        ok('SSO ready');
        redirected = await forceGrok('SSO present');
        if (!redirected) redirected = true;
        break;
      }
    }

    const txt = await pageText();
    const fe = formError(txt);
    if (fe && isAccountExists(fe)) throw new Error(`account exists: ${fe}`);
    if (fe && isFatalFormErr(fe)) throw new Error(`signup rejected: ${fe}`);
    if (fe && fe !== lastBody) {
      no('form error');
      lastBody = fe;
    }

    const stillForm = await pageHasForm();
    if (stillForm && i === 3) {
      wait('still on form - resubmit');
      let tok2 = '';
      for (let t = 0; t < 12; t++) {
        try {
          tok2 = await page.evaluate(
            `(() => {
              const el = document.querySelector('input[name=cf-turnstile-response]');
              return (el && el.value) || '';
            })()`,
          ) as string;
        } catch {
          tok2 = '';
          break;
        }
        if (tok2) break;
        await sleep(800);
      }
      if (tok2) {
        await Promise.all([
          page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15_000 }).catch(() => null),
          submitSignup(),
        ]);
      } else if (stillForm) {
        no('turnstile empty on resubmit');
      }
    }

    spin(i, `wait redirect ${i + 1}/20`);
  }
  clearLine();

  let allCookies = await getAllCookies(page);
  if (!redirected) {
    const sso = allCookies.filter((c) => /^(sso|sso-rw)$/i.test(c.name));
    if (sso.length) {
      ok('SSO ready');
      if (!forcedGrok) {
        try {
          await page.goto('https://grok.com/', { waitUntil: 'domcontentloaded', timeout: 12_000 });
          allCookies = await getAllCookies(page);
        } catch {
        }
      }
      redirected = true;
    } else {
      throw new Error('no redirect');
    }
  } else if (!isGrok(page.url()) && !forcedGrok) {
    await forceGrok('finalize');
    allCookies = await getAllCookies(page);
  } else {
    allCookies = await getAllCookies(page);
  }

  step(9, 'Save credentials');
  const data: AccountData = {
    email: addr,
    password: PASSWORD,
    code,
    sso_cookies: allCookies,
    final_url: page.url(),
    timestamp: Math.floor(Date.now() / 1000),
  };
  await appendOut(JSON.stringify(data) + '\n');
  ok('saved');
  return data;
}

export async function runCreateAccounts(count: number, workers = 1): Promise<void> {
  const tStart = Date.now() / 1000;
  const nWorkers = Math.max(1, Math.min(workers, count));
  header(0, count, 0, 0, tStart);
  const results: Result[] = new Array(count);
  let okN = 0;
  let failN = 0;
  let skipN = 0;
  let doneN = 0;
  let nextJob = 0;
  const logLines: Array<[string, string, string]> = [];

  section('PREPARE');
  wait('loading turnstile extension...');
  let extPath: string;
  try {
    extPath = await resolveTurnstileExt();
  } catch (e) {
    no(`turnstile: ${e instanceof Error ? e.message : String(e)}`);
    return;
  }
  ok('extension ready');
  wait(`chrome: ${findChrome()}`);
  wait(`workers: ${nWorkers} (parallel Chrome)  jobs: ${count}`);

  const runWorker = async (wid: number): Promise<void> => {
    const multi = nWorkers > 1;
    await workerCtx.run({ id: wid, multi }, async () => {
      const profile = join(tmpdir(), `wanglin-s-pw-${Date.now()}-w${wid}`);
      mkdirSync(profile, { recursive: true });
      let browser: Browser | undefined;
      try {
        browser = await launchChrome({ profile, extPath });
        ok('chrome launched');
        while (true) {
          const job = nextJob++;
          if (job >= count) break;
          const tAcc = Date.now() / 1000;
          wait(`job ${job + 1}/${count} start`);
          try {
            const res = await runOne(browser);
            results[job] = res;
            okN += 1;
            const elapsed = `${((Date.now() / 1000) - tAcc).toFixed(1)}s`;
            tableSep();
            row(job + 1, res.email, 9, 'done', `${GRN}SUCCESS${RST}`, elapsed);
            tableSep();
            logLines.push([`[${String(job + 1).padStart(3, '0')}]${multi ? ` W${wid}` : ''} ${res.email} (${elapsed})`, GRN, 'DONE']);
          } catch (e) {
            const elapsed = `${((Date.now() / 1000) - tAcc).toFixed(1)}s`;
            const msg = e instanceof Error ? e.message : String(e);
            if (/^account exists:/i.test(msg) || /already exists|existing account/i.test(msg)) {
              skipN += 1;
              wait(`skip (already exists): ${msg.replace(/^account exists:\s*/i, '').slice(0, 100)}`);
              tableSep();
              row(job + 1, '--exists--', 8, 'already exists', `${YEL}SKIP${RST}`, elapsed);
              tableSep();
              logLines.push([`[${String(job + 1).padStart(3, '0')}]${multi ? ` W${wid}` : ''} already exists - skip (${elapsed})`, YEL, 'SKIP']);
              results[job] = { error: msg };
            } else {
              failN += 1;
              no(msg);
              tableSep();
              row(job + 1, '--failed--', 0, 'error', `${RED}FAILED${RST}`, elapsed);
              tableSep();
              logLines.push([`[${String(job + 1).padStart(3, '0')}]${multi ? ` W${wid}` : ''} ${msg} (${elapsed})`, RED, 'FAIL']);
              results[job] = { error: msg };
            }
          }
          doneN += 1;
          try { await clearBrowserCookies(browser); } catch {
          }
          process.stdout.write(
            `  ${DIM}ok=${okN}  skip=${skipN}  fail=${failN}  done=${doneN}/${count}  elapsed=${Math.floor((Date.now() / 1000) - tStart)}s${RST}\n`,
          );
        }
      } finally {
        if (browser) await browser.close().catch(() => undefined);
      }
    });
  };

  try {
    await Promise.all(Array.from({ length: nWorkers }, (_, i) => runWorker(i + 1)));

    section('RUN LOG');
    for (const [msg, color, tag] of logLines) {
      process.stdout.write(`  ${color}${tag.padEnd(6)}${RST} ${msg}\n`);
    }
    footer(okN, count, tStart);

    const successAccs = results.filter((r): r is AccountData => !!r && 'email' in r);
    if (successAccs.length) {
      process.stdout.write('\n');
      if (AUTO_ADD_9ROUTER) {
        // otomatis: langsung tambah ke 9router tanpa konfirmasi y/N
        process.stdout.write(
          `  ${YEL}[auto]${RST} Adding ${successAccs.length} account(s) to 9router...\n`,
        );
        await addToRouter(successAccs);
      } else {
        let ans = '';
        try {
          ans = (await ask(`  ${YEL}[?]${RST} Add ${successAccs.length} account(s) to 9router? [y/N] `)).trim().toLowerCase();
        } catch {
          ans = '';
        }
        if (ans === 'y') await addToRouter(successAccs);
      }
    }
  } finally {
    cleanupSealedTemps();
  }
}
