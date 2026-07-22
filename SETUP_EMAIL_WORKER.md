# SETUP EMAIL WORKER — gatwib.my.id (Email pribadi untuk GAC)

Panduan deploy Cloudflare Email Worker supaya `*@gatwib.my.id` bisa dipakai
sebagai email unik di GAC. Semua lewat DASHBOARD (tanpa wrangler CLI, karena
jaringan lambat). Kerjakan di browser HP.

---

## Ringkasan arsitektur

```
Email masuk ke abc123@gatwib.my.id
   ↓ (Cloudflare Email Routing)
Email Worker (email-worker.js)
   ↓ simpan ke KV (MAILBOX), TTL 1 jam
HTTP API:  GET /inbox?address=abc123@gatwib.my.id
   ↓
GAC (provider gatwib-mail.ts) baca OTP otomatis
```

---

## LANGKAH 1 — Buat KV Namespace (tempat simpan email)

1. Dashboard Cloudflare → menu kiri → **Storage & Databases** → **KV**
   (atau **Workers & Pages** → **KV**)
2. Klik **"Create a namespace"**
3. Nama: `MAILBOX`
4. **Create** → selesai. (Nanti kita bind ke Worker di langkah 3.)

---

## LANGKAH 2 — Buat Worker

1. **Workers & Pages** → **Create application** → **Create Worker**
2. Kasih nama, misal: `gatwib-mail`
3. **Deploy** (deploy dulu kode default "Hello World", nanti diganti)
4. Setelah ter-deploy → klik **"Edit code"**
5. **HAPUS semua kode** default, **paste** isi file `worker/email-worker.js`
   (ada di folder GAC ini)
6. **Deploy** (tombol kanan atas)

---

## LANGKAH 3 — Bind KV + set API_KEY ke Worker

Masuk ke Worker `gatwib-mail` → tab **Settings** → **Variables & Bindings**:

**A. Bind KV namespace:**
- Bagian **KV Namespace Bindings** → **Add binding**
- Variable name: `MAILBOX`
- KV namespace: pilih `MAILBOX` (yang dibuat di langkah 1)
- **Save**

**B. Tambah secret API_KEY:**
- Bagian **Environment Variables** → **Add variable**
- Name: `API_KEY`
- Value: `gatwib_mail_hUls05kl7Ks5KpTpE39blyo1eQtgJmpK`
- Centang **Encrypt** (jadikan secret)
- **Save and deploy**

---

## LANGKAH 4 — Arahkan Email Routing ke Worker

1. Domain `gatwib.my.id` → **Email** → **Email Routing** → tab **Routing rules**
2. Cari **"Catch-all address"** (biar SEMUA alamat @gatwib.my.id ketangkap)
3. **Edit** catch-all → Action: pilih **"Send to a Worker"**
4. Pilih Worker: `gatwib-mail`
5. **Save** + pastikan catch-all **Enabled**

> Dengan catch-all → Worker, alamat acak apa pun (`abc123@gatwib.my.id`)
> otomatis ketangkap tanpa perlu didaftarkan satu-satu.

---

## LANGKAH 5 — Catat URL Worker & test

1. URL Worker ada di Overview Worker, bentuknya:
   `https://gatwib-mail.<subdomain>.workers.dev`
2. Test health (dari HP browser atau kabari saya URL-nya):
   `https://gatwib-mail.<subdomain>.workers.dev/health?key=gatwib_mail_hUls05kl7Ks5KpTpE39blyo1eQtgJmpK`
   → harus muncul `{"ok":true,...}`

**Kabari saya URL Worker-nya**, nanti saya isikan ke `.env` GAC + test kirim
email percobaan untuk memastikan OTP ketangkap.

---

## Config .env yang sudah disiapkan (tinggal isi WORKER_URL)

```ini
GATWIB_MAIL_WORKER_URL=https://gatwib-mail.XXXX.workers.dev
GATWIB_MAIL_API_KEY=gatwib_mail_hUls05kl7Ks5KpTpE39blyo1eQtgJmpK
GATWIB_MAIL_DOMAIN=gatwib.my.id
```

---

## Keamanan
- `API_KEY` ini rahasia — hanya untuk kamu & script GAC. Jangan sebar.
- Repo `Grok` (backup) harus tetap PRIVATE karena `.env` memuat key ini.
- Worker hanya menyimpan email 1 jam (TTL), lalu auto-hapus.
