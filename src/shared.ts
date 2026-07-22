import puppeteer, { type Browser, type Cookie, type Page } from 'puppeteer-core';
import {
  existsSync, readFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(__dirname, '..');

const _env: Record<string, string> = {};
const _envfile = join(ROOT, '.env');
if (existsSync(_envfile)) {
  for (const line of readFileSync(_envfile, 'utf8').split(/\r?\n/)) {
    if (line.includes('=') && !line.startsWith('#')) {
      const i = line.indexOf('=');
      _env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
  }
}
const envOr = (key: string, def: string) => _env[key] ?? process.env[key] ?? def;

export const PASSWORD = envOr('PASSWORD', '');
if (PASSWORD.length < 16) {
  console.error(
    `[config] PASSWORD too short (${PASSWORD.length} chars). Use >=16 with letters+digits.`,
  );
}
export const ENC_DIR = resolve(ROOT, 'turnstile');
export const OUT = join(ROOT, envOr('OUT_FILE', 'email.txt'));
export const SIGNUP = 'https://accounts.x.ai/sign-up?redirect=grok-com';
export const TEMPMAIL_PROVIDERS = envOr('TEMPMAIL_PROVIDER', '')
  .split(/[,|;]+/)
  .map((s) => s.trim())
  .filter(Boolean);
if (!TEMPMAIL_PROVIDERS.length) TEMPMAIL_PROVIDERS.push('');
export const ROUTER9 = envOr('ROUTER9_URL', '');
export const ROUTER9_PASS = envOr('ROUTER9_PASS', '');
export const CHROME_PATH = envOr('CHROME_PATH', '');
export const HEADLESS = /^(1|true|yes)$/i.test(envOr('HEADLESS', ''));

export interface AccountData {
  email: string;
  password: string;
  code: string;
  sso_cookies: Cookie[];
  final_url: string;
  timestamp: number;
}

export interface AccountError {
  error: string;
}

export type Result = AccountData | AccountError;

export function findChrome(): string {
  if (CHROME_PATH && existsSync(CHROME_PATH)) return CHROME_PATH;
  const candidates = [
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  throw new Error('Chrome not found. Install Google Chrome or set CHROME_PATH');
}

export async function launchChrome(opts: {
  profile: string;
  extPath?: string;
}): Promise<Browser> {
  const executablePath = findChrome();
  const args = [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--disable-blink-features=AutomationControlled',
    '--window-size=1280,1024',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-infobars',
    '--disable-features=IsolateOrigins,site-per-process,DisableLoadExtensionCommandLineSwitch',
  ];
  if (opts.extPath) {
    args.push(`--load-extension=${opts.extPath}`);
    args.push(`--disable-extensions-except=${opts.extPath}`);
  }
  const browser = await puppeteer.launch({
    executablePath,
    headless: HEADLESS,
    userDataDir: opts.profile,
    defaultViewport: { width: 1280, height: 1024 },
    args,
    ignoreDefaultArgs: ['--enable-automation'],
  });
  return browser;
}

export async function hardenPage(page: Page): Promise<void> {
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  );
  await page.setExtraHTTPHeaders({
    'sec-ch-ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'accept-language': 'en-US,en;q=0.9',
  });
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    (window as any).chrome = (window as any).chrome || { runtime: {} };
  });
}

export async function clearBrowserCookies(browser: Browser): Promise<void> {
  const page = (await browser.pages())[0] ?? (await browser.newPage());
  const client = await page.createCDPSession();
  await client.send('Network.clearBrowserCookies');
}

export async function getAllCookies(page: Page): Promise<Cookie[]> {
  const client = await page.createCDPSession();
  const { cookies } = await client.send('Network.getAllCookies') as { cookies: Cookie[] };
  return cookies ?? [];
}

export function sanitizeCookie(c: Cookie): Cookie {
  let sameSite: Cookie['sameSite'] = 'Lax';
  const ss = String(c.sameSite || 'Lax');
  if (ss === 'Strict' || ss === 'Lax' || ss === 'None') sameSite = ss;
  return {
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path || '/',
    expires: typeof c.expires === 'number' && c.expires > 0 ? c.expires : -1,
    size: c.size ?? c.name.length + c.value.length,
    httpOnly: !!c.httpOnly,
    secure: c.secure !== false,
    session: !(typeof c.expires === 'number' && c.expires > 0),
    sameSite,
  };
}

export function expandSsoCookies(cookies: Cookie[]): Cookie[] {
  const out: Cookie[] = [];
  const seen = new Set<string>();
  const push = (c: Cookie) => {
    const clean = sanitizeCookie(c);
    if (!clean.domain || !clean.name) return;
    const key = `${clean.name}|${clean.domain}|${clean.path || '/'}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(clean);
  };

  const authNames = /^(sso|sso-rw|x-userid)$/i;
  const isAuthDomain = (d: string) => {
    const x = d.toLowerCase().replace(/^\./, '');
    return x === 'grok.com' || x.endsWith('.grok.com') || x === 'x.ai' || x.endsWith('.x.ai');
  };
  const isNoiseHost = (d: string) => /grokipedia|grokusercontent/i.test(d);

  for (const c of cookies) {
    if (!c.domain || !authNames.test(c.name)) continue;
    if (isNoiseHost(c.domain) || !isAuthDomain(c.domain)) continue;
    push(c);
  }

  const targets = ['.grok.com', '.x.ai', 'auth.x.ai', 'accounts.x.ai'];
  for (const c of [...out]) {
    for (const domain of targets) {
      push({
        ...c,
        domain,
        path: c.path || '/',
        secure: true,
        sameSite: c.sameSite === 'None' ? 'None' : 'Lax',
      });
    }
  }
  return out;
}

export async function fillInput(page: Page, sel: string, value: string, timeout = 15_000): Promise<void> {
  await page.waitForSelector(sel, { timeout, visible: true });
  await page.focus(sel);
  await page.evaluate((s) => {
    const el = document.querySelector(s) as HTMLInputElement | null;
    if (el) {
      el.focus();
      el.value = '';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }, sel);
  await page.type(sel, value, { delay: 25 });
}

export async function clickText(page: Page, text: string, timeout = 8000): Promise<void> {
  const sels = [
    `button::-p-text(${text})`,
    `a::-p-text(${text})`,
    `[role="button"]::-p-text(${text})`,
    `::-p-text(${text})`,
  ];
  let lastErr = '';
  for (const sel of sels) {
    try {
      await page.locator(sel).setTimeout(timeout).click({ delay: 30 });
      return;
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
    }
  }
  let snippet = '';
  try {
    snippet = await page.evaluate(
      `(() => { const t = (document.body && document.body.innerText || '').replace(/\\s+/g, ' ').trim(); return t.slice(0, 180); })()`,
    ) as string;
  } catch {
  }
  throw new Error(`clickText timeout: "${text}"${lastErr ? ` (${lastErr.slice(0, 120)})` : ''}${snippet ? ` | page: ${snippet}` : ''}`);
}

export async function tryClickText(page: Page, text: string, timeout = 3000): Promise<boolean> {
  try {
    await clickText(page, text, timeout);
    return true;
  } catch {
    return false;
  }
}

export async function tryClickSel(page: Page, sel: string, timeout = 3000): Promise<boolean> {
  try {
    await page.waitForSelector(sel, { timeout, visible: true });
    await page.click(sel, { delay: 30 });
    return true;
  } catch {
    return false;
  }
}

export async function pageLooksBlocked(page: Page): Promise<string | null> {
  try {
    const info = await page.evaluate(() => {
      const title = document.title || '';
      const body = (document.body?.innerText || '').slice(0, 500);
      return { title, body, url: location.href };
    });
    const blob = `${info.title}\n${info.body}\n${info.url}`.toLowerCase();
    if (blob.includes('attention required') || blob.includes('cf-error') || blob.includes('sorry, you have been blocked')) {
      return `cloudflare block: ${info.title || info.url}`;
    }
    if (blob.includes('just a moment') || blob.includes('checking your browser')) {
      return `cloudflare challenge: ${info.title || info.url}`;
    }
    return null;
  } catch {
    return null;
  }
}

export const GRN = '\x1b[32m';
export const RED = '\x1b[31m';
export const YEL = '\x1b[33m';
export const CYN = '\x1b[36m';
export const DIM = '\x1b[2m';
export const BLD = '\x1b[1m';
export const RST = '\x1b[0m';
export const SP = '|/-\\';
export const W = 72;
export const BAR_FILLED = '#';
export const BAR_EMPTY = '-';

export function clearLine(): void {
  process.stdout.write('\r\x1b[K');
}

export function line(ch = '=', n = W): string {
  return ch.repeat(n);
}

export function banner(title: string): void {
  process.stdout.write(`\n${CYN}${line('=')}${RST}\n`);
  process.stdout.write(`${CYN}${BLD}  ${title}${RST}\n`);
  process.stdout.write(`${CYN}${line('=')}${RST}\n`);
}

export function section(title: string): void {
  process.stdout.write(`\n${DIM}${line('-')}${RST}\n`);
  process.stdout.write(`  ${BLD}${title}${RST}\n`);
  process.stdout.write(`${DIM}${line('-')}${RST}\n`);
}

export function header(count: number, total: number, okN: number, failN: number, tStart: number): void {
  const elapsed = (Date.now() / 1000) - tStart;
  banner('WANGLINS SIGNUP RUNNER');
  const state = count < total
    ? `RUNNING  ${count}/${total}`
    : `COMPLETE ${total}/${total}`;
  process.stdout.write(
    `  Status   ${state}\n` +
    `  Success  ${GRN}${okN}${RST}    Failed  ${RED}${failN}${RST}    Elapsed  ${elapsed.toFixed(1)}s\n`,
  );
  process.stdout.write(`${DIM}${line('-')}${RST}\n`);
}

export function tableSep(): void {
  process.stdout.write(`  ${DIM}${line('-', 68)}${RST}\n`);
}

export function row(idx: number, email: string, stepN: number, stepMsg: string, status: string, metric: string): void {
  const em = email.slice(0, 34).padEnd(34);
  const sn = String(stepN).padStart(2, '0');
  const sm = stepMsg.slice(0, 18).padEnd(18);
  process.stdout.write(
    `  ${DIM}#${String(idx).padStart(2, '0')}${RST}  ${em}  step ${CYN}${sn}${RST}  ${sm}  ${status.padEnd(10)}  ${DIM}${metric}${RST}\n`,
  );
}

export function progBar(cur: number, total: number, width = 30): string {
  if (total === 0) return `[${BAR_EMPTY.repeat(width)}]`;
  const filled = Math.min(width, Math.floor((cur / total) * width));
  return `[${GRN}${BAR_FILLED.repeat(filled)}${RST}${DIM}${BAR_EMPTY.repeat(width - filled)}${RST}]`;
}

export function footer(okN: number, total: number, tStart: number): void {
  section('SUMMARY');
  const rate = okN / Math.max(1, ((Date.now() / 1000) - tStart) / 60);
  const health = (okN / Math.max(1, total)) * 100;
  const bar = progBar(okN, total, 36);
  const pct = total ? Math.floor((okN / total) * 100) : 0;
  process.stdout.write(
    `  Success rate  ${health.toFixed(1)}%\n` +
    `  Throughput    ${rate.toFixed(1)} accounts/min\n` +
    `  Errors        ${total - okN}\n` +
    `  Progress      ${bar}  ${okN}/${total} (${pct}%)\n`,
  );
}

export function step(n: number, msg: string): void {
  process.stdout.write(`\n  ${CYN}[STEP ${String(n).padStart(2, '0')}]${RST} ${msg}\n`);
}
export function ok(msg: string): void { process.stdout.write(`    ${GRN}[OK]${RST}    ${msg}\n`); }
export function no(msg: string): void { process.stdout.write(`    ${RED}[ERR]${RST}   ${msg}\n`); }
export function wait(msg: string): void { process.stdout.write(`    ${YEL}[INFO]${RST}  ${msg}\n`); }
export function spin(frame: number, msg: string): void {
  process.stdout.write(`\r    ${CYN}[${SP[frame % SP.length]}]${RST}    ${msg}   `);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function ask(prompt: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolveAsk) => {
    rl.question(prompt, (ans) => {
      rl.close();
      resolveAsk(ans);
    });
  });
}

export function loadSsoAccounts(): AccountData[] {
  const accounts: AccountData[] = [];
  if (!existsSync(OUT)) return accounts;
  for (const l of readFileSync(OUT, 'utf8').split(/\r?\n/)) {
    if (l.trim() && l.includes('"email"')) {
      try { accounts.push(JSON.parse(l) as AccountData); } catch {
      }
    }
  }
  return accounts;
}

export async function askInt(prompt: string, def = 1): Promise<number> {
  while (true) {
    const ans = (await ask(prompt)).trim() || String(def);
    const n = parseInt(ans, 10);
    if (Number.isFinite(n) && n >= 1) return n;
    no('enter a number >= 1');
  }
}
