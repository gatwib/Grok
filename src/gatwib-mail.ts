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
import {
  GATWIB_MAIL_WORKER_URL as WORKER_URL,
  GATWIB_MAIL_API_KEY as API_KEY,
  GATWIB_MAIL_DOMAIN as DOMAIN,
} from './shared.js';

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

function randomLocal(): string {
  // alamat gaya nama orang Indonesia: nama.belakang + angka (natural, anti-bentrok)
  const first = [
    'budi', 'agus', 'dewi', 'rina', 'putri', 'andi', 'sari', 'dian', 'eka', 'rizki',
    'yuni', 'fitri', 'joko', 'wawan', 'nur', 'indah', 'bayu', 'hendra', 'ratna', 'adit',
    'lestari', 'wahyu', 'sinta', 'reza', 'fajar', 'maya', 'galih', 'tika', 'irfan', 'novi',
    'ahmad', 'siti', 'dwi', 'ayu', 'arif', 'linda', 'yoga', 'citra', 'doni', 'mega',
  ];
  const last = [
    'santoso', 'wijaya', 'saputra', 'pratama', 'nugroho', 'kusuma', 'hidayat', 'permana',
    'setiawan', 'utomo', 'lestari', 'purnama', 'ramadhan', 'firmansyah', 'gunawan', 'susanto',
    'wibowo', 'maulana', 'anggraini', 'haryanto', 'suryani', 'prasetyo', 'handoko', 'rahayu',
  ];
  const pick = (arr: string[]) => arr[Math.floor(Math.random() * arr.length)];
  const sep = Math.random() < 0.5 ? '.' : '';       // budi.santoso atau budisantoso
  const num = Math.floor(Math.random() * 9000) + 100; // 3-4 digit, mirip tahun/angka acak
  return `${pick(first)}${sep}${pick(last)}${num}`;
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
