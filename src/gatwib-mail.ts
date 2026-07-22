/**
 * gatwib-mail — custom TempMailProvider untuk GAC
 *
 * Memakai domain sendiri (gatwib.my.id) via Cloudflare Email Worker,
 * bukan temp-mail publik. Email 100% unik, tidak pernah bentrok dengan
 * pengguna repo lain.
 *
 * Memenuhi interface TempMailProvider (lihat tempmail-wrapper.d.ts):
 *   generateEmail(), getInbox(), readMessage(), deleteEmail(), waitForEmail()
 *
 * Config via .env:
 *   GATWIB_MAIL_WORKER_URL = https://<worker>.workers.dev  (atau custom domain)
 *   GATWIB_MAIL_API_KEY    = <API_KEY yang sama dengan secret Worker>
 *   GATWIB_MAIL_DOMAIN     = gatwib.my.id
 */

interface Message {
  id: string;
  sender: string;
  subject: string;
  date: Date;
  preview?: string;
  hasAttachments?: boolean;
}
interface MessageDetail extends Message {
  bodyText?: string;
  bodyHtml?: string;
}

interface WorkerMail {
  id: string;
  to: string;
  from: string;
  subject: string;
  bodyText: string;
  date: string;
}

const WORKER_URL = (process.env.GATWIB_MAIL_WORKER_URL || '').replace(/\/$/, '');
const API_KEY = process.env.GATWIB_MAIL_API_KEY || '';
const DOMAIN = process.env.GATWIB_MAIL_DOMAIN || 'gatwib.my.id';

function randomLocal(): string {
  // alamat acak: huruf+angka, 12 char — praktis mustahil bentrok
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 12; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

async function fetchInbox(address: string): Promise<WorkerMail[]> {
  const url = `${WORKER_URL}/inbox?address=${encodeURIComponent(address)}`;
  const res = await fetch(url, { headers: { 'X-API-Key': API_KEY } });
  if (!res.ok) throw new Error(`worker inbox HTTP ${res.status}`);
  const data = (await res.json()) as { messages?: WorkerMail[] };
  return data.messages || [];
}

export function createGatwibProvider() {
  if (!WORKER_URL || !API_KEY) {
    throw new Error(
      'gatwib-mail: set GATWIB_MAIL_WORKER_URL & GATWIB_MAIL_API_KEY di .env',
    );
  }

  return {
    async generateEmail(): Promise<string> {
      return `${randomLocal()}@${DOMAIN}`;
    },

    async getInbox(email: string): Promise<Message[]> {
      const mails = await fetchInbox(email.toLowerCase());
      return mails.map((m) => ({
        id: `${m.id}::${email.toLowerCase()}`,
        sender: m.from,
        subject: m.subject,
        date: new Date(m.date),
        preview: m.bodyText?.slice(0, 200),
      }));
    },

    async readMessage(messageId: string): Promise<MessageDetail> {
      // id kita encode sbg "<uuid>::<address>" — ambil address, cari pesannya
      const [, address] = messageId.split('::');
      const mails = await fetchInbox((address || '').toLowerCase());
      const uuid = messageId.split('::')[0];
      const found = mails.find((m) => m.id === uuid) || mails[0];
      if (!found) throw new Error('gatwib-mail: message not found');
      return {
        id: messageId,
        sender: found.from,
        subject: found.subject,
        date: new Date(found.date),
        bodyText: found.bodyText,
        bodyHtml: found.bodyText,
      };
    },

    async deleteEmail(_email: string): Promise<boolean> {
      // KV auto-expire (TTL 1 jam); tidak perlu delete manual
      return true;
    },

    async waitForEmail(
      email: string,
      timeoutMs = 120000,
      intervalMs = 3000,
    ): Promise<Message | null> {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        const inbox = await this.getInbox(email);
        if (inbox.length > 0) return inbox[0];
        await new Promise((r) => setTimeout(r, intervalMs));
      }
      return null;
    },
  };
}
