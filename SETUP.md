# SETUP — Panduan Restore Cepat (gatwib)

Catatan pribadi untuk restore cepat kalau folder lokal rusak/hilang.
Repo ini adalah versi yang **sudah diperbaiki dan berhasil jalan**.

---

## 🚀 Cara Restore (3 langkah)

Kalau folder GAC/Grok di desktop rusak atau hilang:

```bash
# 1. Clone repo
git clone https://github.com/gatwib/Grok.git
cd Grok

# 2. Install dependencies (WAJIB — node_modules tidak ikut di repo)
npm install

# 3. Jalankan
#    Double-click JALANKAN_GAC.bat
#    ATAU dari terminal:
npm run dev
```

Selesai. Semua config (`.env`) dan perbaikan sudah termasuk.

---

## 📋 Prasyarat

- **Node.js 18+** (dipakai versi 24 waktu setup)
- **Google Chrome** (asli, bukan Chromium) — path sudah di-set di `.env`:
  `C:\Program Files\Google\Chrome\Application\chrome.exe`
- **9router** jalan di `http://localhost:20128` dengan auth aktif (password: `123456`)

---

## 🖥️ Menu Program

Jalankan `JALANKAN_GAC.bat`, lalu pilih:

- `[1]` Create akun Grok (signup) → tanya jumlah akun + jumlah worker
  - **Set worker = 1** (laptop AMD A8 low-spec, hindari crash)
- `[2]` Add akun ke 9router (dari `email.txt`)
- `[0]` Exit

---

## 🔧 Perbaikan yang Sudah Dilakukan

Repo asli (`wanglinsaputra/GAC`) tidak jalan di setup ini. Yang sudah diperbaiki:

### 1. Fix Turnstile timeout (`src/shared.ts`)
- **Masalah:** `hardenPage` pakai User-Agent Linux (`X11; Linux x86_64`) padahal
  mesin Windows, sementara platform hints bilang `"Windows"`. Mismatch ini bikin
  Cloudflare Turnstile stuck → `[ERR] Turnstile timeout 40s`.
- **Fix:** User-Agent diubah ke `Windows NT 10.0; Win64; x64` biar konsisten.

### 2. Fix import 9router (`.env`)
- **Masalah:** `ROUTER9_PASS` kosong → login 9router gagal → menu [2] berhenti
  sebelum import. Endpoint `/api/auth/login` tetap validasi password walau tombol
  login UI dimatikan.
- **Fix:** `ROUTER9_PASS=123456` di `.env` (password 9router yang benar).

---

## 📁 Yang TIDAK Ada di Repo (di-ignore)

| Item | Kenapa | Cara dapat lagi |
|------|--------|-----------------|
| `node_modules/` | Standar git, berat | `npm install` |
| `email.txt` | Data akun sensitif (SSO cookie) | Bikin akun baru via menu [1] |

---

## ⚠️ Keamanan

Repo ini **HARUS tetap PRIVATE**. `.env` berisi:
- Password 9router (`123456`)
- `SEAL_TOKEN` milik author (unlock extension Turnstile)

Kalau repo mau dibuat publik suatu saat, **hapus `.env` dari git history dulu**
(pakai `git filter-repo` atau BFG), bukan cuma delete file — karena secret tetap
terekam di commit lama.

---

## 🔑 Config `.env` (referensi)

Nilai penting yang sudah di-set:

```ini
ROUTER9_URL=http://localhost:20128
ROUTER9_PASS=123456
TEMPMAIL_PROVIDER=ncaori,zoromail
PASSWORD=YourStrongPassword123          # password akun Grok yang dibuat, min 16 char
CHROME_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe
HEADLESS=false                          # jangan true — CF deteksi headless
SEAL_UNLOCK_URL=https://wanglins.6n6.web.id
SEAL_TOKEN=...                          # milik author, jangan sebar
```

---

*Dibuat sebagai catatan restore pribadi. Kode asli © WangLinS (Apache 2.0).*
