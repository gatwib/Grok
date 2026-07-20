<div align="center">

# WangLinS Auto Sign-Up Grok

### Automated Grok (x.ai) Account Registration + 9Router Integration

**Puppeteer-core · Real Chrome · Turnstile Bypass · OAuth Device Flow**

**Author: WangLinS**

---

![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue?logo=typescript&logoColor=white)
![Puppeteer](https://img.shields.io/badge/Puppeteer--core-latest-green?logo=puppeteer&logoColor=white)
![Chrome](https://img.shields.io/badge/Chrome-Stable-orange?logo=googlechrome&logoColor=white)
![Platform](https://img.shields.io/badge/Platform-Linux-lightgrey?logo=linux&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-yellow)

</div>

---

## Fitur

| Fitur | Status |
|-------|--------|
| Auto-register akun Grok (x.ai) | ✅ |
| Temp mail (`@wanglinsaputra/tempmail-wrapper`, 16 provider) | ✅ |
| Auto OTP verification | ✅ |
| Turnstile bypass (Chrome extension) | ✅ |
| SSO cookies save | ✅ |
| 9Router OAuth device flow | ✅ |
| Dashboard UI (progress, logs, stats) | ✅ |
| Batch registration | ✅ |
| Add existing accounts to 9Router | ✅ |

---

## Prasyarat

| Tool | Versi |
|------|-------|
| Node.js | 18+ |
| Google Chrome | Stable |

> `HEADLESS=false` recommended — x.ai often blocks headless Chrome.

---

## Install

```bash
npm install
# butuh Google Chrome system (bukan download Chromium)
# Linux: google-chrome-stable | Windows: set CHROME_PATH
cp .env.example .env
# edit .env (lihat tabel di bawah)
```

---

## Konfigurasi `.env` (untuk user)

Isi yang **wajib / biasa dipakai** orang yang clone repo:

| Key | Wajib? | Contoh | Keterangan |
|-----|--------|--------|------------|
| `PASSWORD` | ✅ | `YourStrongPassword123` | Password akun Grok yang dibuat. **Min 16 char**, huruf+angka |
| `TEMPMAIL_PROVIDER` | ✅ | `ncaori,zoromail` | Provider temp mail. Multi: pisah koma. Proven OK: `ncaori` |
| `SEAL_UNLOCK_URL` | ✅ (signup) | `https://wanglins.6n6.web.id` | API unlock extension Turnstile (sealed) |
| `SEAL_TOKEN` | ✅ (signup) | *(minta ke author)* | Bearer token unlock. Tanpa ini signup gagal load extension |
| `ROUTER9_URL` | opsional | `http://127.0.0.1:20128` | Base URL 9Router. Perlu kalau mau add akun ke 9Router |
| `ROUTER9_PASS` | opsional | `your_password` | Password login 9Router |
| `HEADLESS` | opsional | `false` | `false` = jendela Chrome (recommended). `true` sering kena CF |
| `CHROME_PATH` | opsional | path ke `chrome.exe` / `google-chrome` | Kosong = auto-detect |
| `OUT_FILE` | opsional | `email.txt` | File output akun (default `email.txt`) |

### Contoh `.env` minimal (user)

```ini
PASSWORD=YourStrongPassword123
TEMPMAIL_PROVIDER=ncaori,zoromail
HEADLESS=false

SEAL_UNLOCK_URL=https://wanglins.6n6.web.id
SEAL_TOKEN=e4k-0Dil5dKU82VlBLzp50AdWmWVPCdc

# Opsional — hanya kalau pakai menu add ke 9Router
ROUTER9_URL=http://127.0.0.1:20128
ROUTER9_PASS=your_9router_password
```

### Jangan diisi user (author only)

| Key | Kenapa |
|-----|--------|
| `SEAL_KEY` | Kunci AES author. Hanya di server unlock + mesin author.|
| `TURNSTILE_EXT_PATH` | Override folder extension plain (dev author) |

Provider list: `mail.tm`, `guerrillamail`, `yopmail`, `dropmail`, `1secemail`, `ncaori`, `zoromail`, dll.  
x.ai memblokir banyak domain disposable — utamakan `ncaori`.

---

## Penggunaan

```bash
npm run dev
```

Menu:

```
1) Create akun Grok (signup)     → tanya berapa akun
2) Add akun ke 9Router           → dari email.txt, tanya berapa terakhir
0) Exit
```

## Flow

1. Buka accounts.x.ai/sign-up  
2. Temp email via `TEMPMAIL_PROVIDER`  
3. OTP poll → verify  
4. Nama + password  
5. Turnstile (extension sealed → unlock via `SEAL_UNLOCK_URL` + `SEAL_TOKEN`)  
6. Submit → grok.com  
7. Save SSO → `email.txt`  
8. Opsional: OAuth device flow → 9Router  

---

## Notes

| Item | Detail |
|------|--------|
| Speed | ±17–20s / akun |
| Chrome | real Google Chrome via `puppeteer-core` (`CHROME_PATH` optional) |
| Headless | set `HEADLESS` in `.env` — prefer `false` |
| Proxy | Jangan — CF block |
| Turnstile | `turnstile/script.sealed` di repo; plain `script.js` tidak di-publish |
| Unlock | butuh net 1x ke `SEAL_UNLOCK_URL` saat start create akun |

---

<div align="center">

**WangLinS** · Educational purposes only.

</div>
