// Turnstile Patcher v3 — perkuat anti-deteksi (spoof lebih banyak sinyal browser).
// Basis: override MouseEvent.screenX/Y (asli). Tambahan: sinyal lain yang sering dicek.
// Semua ringan, jalan di document_start, MAIN world, all frames.

function getRandomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// --- 1. Koordinat mouse acak (ASLI — inti yang terbukti jalan) ---
const screenX = getRandomInt(800, 1200);
const screenY = getRandomInt(400, 600);
try {
  Object.defineProperty(MouseEvent.prototype, 'screenX', { get: () => screenX });
  Object.defineProperty(MouseEvent.prototype, 'screenY', { get: () => screenY });
} catch (e) { /* noop */ }

// --- 2. Sembunyikan sinyal webdriver/automation (bot flag utama) ---
try {
  Object.defineProperty(navigator, 'webdriver', { get: () => false });
} catch (e) { /* noop */ }
try {
  // hapus jejak Chrome DevTools Protocol / puppeteer
  delete navigator.__proto__.webdriver;
} catch (e) { /* noop */ }

// --- 3. Pastikan window.chrome ada (headless sering tak punya, tanda bot) ---
try {
  if (!window.chrome) {
    window.chrome = { runtime: {}, loadTimes: function () {}, csi: function () {} };
  }
} catch (e) { /* noop */ }

// --- 4. Spoof plugins & languages (headless sering kosong = tanda bot) ---
try {
  if (!navigator.plugins || navigator.plugins.length === 0) {
    Object.defineProperty(navigator, 'plugins', {
      get: () => [
        { name: 'Chrome PDF Plugin' },
        { name: 'Chrome PDF Viewer' },
        { name: 'Native Client' },
      ],
    });
  }
} catch (e) { /* noop */ }
try {
  if (!navigator.languages || navigator.languages.length === 0) {
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
  }
} catch (e) { /* noop */ }

// --- 5. Spoof hardwareConcurrency & deviceMemory realistis (bukan 0/aneh) ---
try {
  if (!navigator.hardwareConcurrency || navigator.hardwareConcurrency < 2) {
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 4 });
  }
} catch (e) { /* noop */ }
try {
  if (!navigator.deviceMemory) {
    Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
  }
} catch (e) { /* noop */ }

// --- 6. Spoof permissions.query (headless sering beri jawaban aneh) ---
try {
  const origQuery = navigator.permissions && navigator.permissions.query;
  if (origQuery) {
    navigator.permissions.query = function (params) {
      if (params && params.name === 'notifications') {
        return Promise.resolve({ state: Notification.permission || 'default' });
      }
      return origQuery.call(navigator.permissions, params);
    };
  }
} catch (e) { /* noop */ }

// --- 7. MouseEvent movementX/Y & pageX/Y realistis (bukan 0 statik) ---
try {
  Object.defineProperty(MouseEvent.prototype, 'movementX', { get: () => getRandomInt(-2, 2) });
  Object.defineProperty(MouseEvent.prototype, 'movementY', { get: () => getRandomInt(-2, 2) });
} catch (e) { /* noop */ }
