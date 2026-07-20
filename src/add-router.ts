
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ROUTER9, ROUTER9_PASS, OUT,
  type AccountData,
  launchChrome, hardenPage, clearBrowserCookies, expandSsoCookies,
  tryClickText,
  GRN, RED, YEL, BLD, RST, DIM,
  banner, section, ok, no, wait, spin, clearLine, sleep, ask,
  loadSsoAccounts, askInt,
} from './shared.js';

const ROUTER9_PROVIDER = 'grok-cli';

type DeviceCodeRes = {
  device_code: string;
  user_code: string;
  verification_uri?: string;
  verification_uri_complete?: string;
  codeVerifier: string;
  interval?: number;
  expires_in?: number;
};

type PollRes = {
  success: boolean;
  pending?: boolean;
  error?: string;
  errorDescription?: string;
};

type Conn = { provider?: string; email?: string | null };

class Router9 {
  private base: string;
  private password: string;
  private cookie = '';

  constructor(base = ROUTER9, password = ROUTER9_PASS) {
    this.base = base.replace(/\/$/, '');
    this.password = password;
  }

  private async req(method: string, path: string, body?: unknown): Promise<any> {
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(this.cookie ? { Cookie: this.cookie } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });

    const setCookie = typeof res.headers.getSetCookie === 'function'
      ? res.headers.getSetCookie()
      : (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')!] : []);
    for (const raw of setCookie) {
      const part = String(raw).split(';')[0];
      if (part.startsWith('auth_token=')) this.cookie = part;
    }

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error((data as { error?: string }).error || `HTTP ${res.status}`) as Error & {
        status?: number;
        data?: unknown;
      };
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  async login(): Promise<boolean> {
    try {
      const data = await this.req('POST', '/api/auth/login', { password: this.password });
      return !!data.success && !!this.cookie;
    } catch {
      return false;
    }
  }

  async listProviders(): Promise<Conn[]> {
    const data = await this.req('GET', '/api/providers');
    return (data.connections ?? data) as Conn[];
  }

  async deviceCode(): Promise<DeviceCodeRes> {
    return this.req('GET', `/api/oauth/${ROUTER9_PROVIDER}/device-code`);
  }

  async poll(deviceCode: string, codeVerifier: string): Promise<PollRes> {
    try {
      const data = await this.req('POST', `/api/oauth/${ROUTER9_PROVIDER}/poll`, {
        deviceCode,
        codeVerifier,
      });
      return {
        success: !!data.success,
        pending: !!data.pending,
        error: data.error,
        errorDescription: data.errorDescription,
      };
    } catch (e: any) {
      const d = e?.data;
      if (d && (d.pending || d.error === 'authorization_pending' || d.error === 'slow_down')) {
        return { success: false, pending: true, error: d.error };
      }
      return {
        success: false,
        pending: false,
        error: d?.error || e?.message || String(e),
      };
    }
  }
}

export async function addToRouter(accounts: AccountData[]): Promise<void> {
  banner('9ROUTER ADD');
  wait(`ROUTER9_URL=${ROUTER9}`);
  const r9 = new Router9(ROUTER9, ROUTER9_PASS);

  try {
    if (!(await r9.login())) {
      no('9router login failed (wrong password?)');
      return;
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const cause = e instanceof Error && e.cause instanceof Error ? e.cause.message : '';
    no(`9router unreachable: ${msg}${cause ? ` (${cause})` : ''}`);
    wait('start 9router first, or set ROUTER9_URL in .env to a live host');
    return;
  }
  ok('9router login');

  let existing: Set<string>;
  try {
    const conns = await r9.listProviders();
    existing = new Set(
      conns
        .filter((c) => c.provider === ROUTER9_PROVIDER)
        .map((c) => c.email)
        .filter(Boolean) as string[],
    );
  } catch (e) {
    no(`list providers fail: ${e instanceof Error ? e.message : String(e)}`);
    return;
  }
  ok(`existing grok-cli: ${existing.size}`);

  const profile = join(tmpdir(), `wanglin-s-router-${Date.now()}`);
  mkdirSync(profile, { recursive: true });
  const browser = await launchChrome({ profile });

  let added = 0;
  let skipped = 0;
  let failed = 0;

  try {
    for (let i = 0; i < accounts.length; i++) {
      const acc = accounts[i];
      const email = acc.email;
      process.stdout.write(`\n  ${BLD}[${i + 1}/${accounts.length}]${RST} ${email}\n`);

      if (existing.has(email)) {
        wait('already exists, skip');
        skipped += 1;
        continue;
      }

      try {
        await clearBrowserCookies(browser);
        const page = await browser.newPage();
        await hardenPage(page);

        const cookies = expandSsoCookies(acc.sso_cookies ?? []);
        const ssoCookies = cookies.filter((c) => /^(sso|sso-rw)$/i.test(c.name));
        if (!ssoCookies.length) {
          no('no sso cookies in output file - re-register account');
          await page.close();
          failed += 1;
          continue;
        }
        wait(`inject cookies: ${cookies.length}`);
        await page.setCookie(...cookies);

        const d = await r9.deviceCode();
        if (!d.device_code || !d.codeVerifier) {
          no('device-code response invalid (needs device_code + codeVerifier)');
          await page.close();
          failed += 1;
          continue;
        }
        const userCode = d.user_code;
        const verifyUrl = d.verification_uri_complete || d.verification_uri;
        if (!verifyUrl) {
          no('no verification_uri');
          await page.close();
          failed += 1;
          continue;
        }
        wait(`user_code: ${userCode}`);

        await page.goto(verifyUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
        await sleep(3000);

        const hasLoginInput = await page.evaluate(
          () => !!document.querySelector('input[type=email], input[type=password]'),
        );
        if (hasLoginInput) {
          no('SSO expired, need login');
          await page.close();
          failed += 1;
          continue;
        }

        const clicked = await tryClickText(page, 'Continue', 5000);
        if (!clicked) {
          no('Continue button not found');
          await page.close();
          failed += 1;
          continue;
        }
        ok('continue');
        await sleep(3000);

        if (await tryClickText(page, 'Allow', 8000)) {
          ok('allow');
          await sleep(2000);
        } else if (await tryClickText(page, 'Allow All', 3000)) {
          ok('allow all');
          await sleep(2000);
        } else {
          no('Allow button not found');
          await page.close();
          failed += 1;
          continue;
        }
        await sleep(2000);
        await page.close().catch(() => undefined);

        wait('polling 9router...');
        let pollOk = false;
        const max = 60;
        for (let t = 0; t < max; t++) {
          const res = await r9.poll(d.device_code, d.codeVerifier);
          if (res.success) {
            ok('added to 9router');
            added += 1;
            existing.add(email);
            pollOk = true;
            break;
          }
          if (!res.pending) {
            no(`poll error: ${res.error}${res.errorDescription ? ` - ${res.errorDescription}` : ''}`);
            failed += 1;
            pollOk = true;
            break;
          }
          spin(t, `poll ${t + 1}/${max} pending...`);
          await sleep(5000);
        }
        clearLine();
        if (!pollOk) {
          no('poll timeout 5min');
          failed += 1;
        }
      } catch (e) {
        no(`err: ${e instanceof Error ? e.message : String(e)}`);
        failed += 1;
      }
    }
  } finally {
    await browser.close().catch(() => undefined);
  }

  section('9ROUTER SUMMARY');
  process.stdout.write(
    `  Added    ${GRN}${added}${RST}\n` +
    `  Skipped  ${YEL}${skipped}${RST}\n` +
    `  Failed   ${RED}${failed}${RST}\n`,
  );
}

export async function runAddRouterMenu(): Promise<void> {
  const accounts = loadSsoAccounts();
  if (!accounts.length) {
    no(`no accounts in ${OUT} - create some first (menu 1)`);
    return;
  }
  wait(`${accounts.length} account(s) in ${OUT}`);
  const n = await askInt(
    `  ${YEL}[?]${RST} How many latest accounts to add to 9router? [all=${accounts.length}] `,
    accounts.length,
  );
  const list = accounts.slice(-Math.min(n, accounts.length));
  wait(`adding ${list.length} account(s)`);
  await addToRouter(list);
}

