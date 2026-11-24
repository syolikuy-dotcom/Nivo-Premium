'use strict';
process.chdir(__dirname);
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawnSync } = require('child_process');

const dev = process.env.NODE_ENV === 'development';
const say = (lvl, msg) => console[lvl === 'info' ? 'log' : lvl](`[${lvl}] ${msg}`);

function sh(label, script, args) {
  say('info', `${label} (butuh beberapa saat)...`);
  return spawnSync(process.execPath, [require.resolve(script), ...args], { cwd: __dirname, stdio: 'inherit', env: process.env });
}

function newestMtime(targets) {
  let newest = 0;
  const walk = (p) => {
    let st; try { st = fs.statSync(p); } catch { return; }
    if (st.isDirectory()) { for (const n of fs.readdirSync(p)) walk(path.join(p, n)); return; }
    if (st.mtimeMs > newest) newest = st.mtimeMs;
  };
  targets.forEach((t) => walk(path.join(__dirname, t)));
  return newest;
}
function isStale(marker, sources) {
  let built; try { built = fs.statSync(marker).mtimeMs; } catch { return true; }
  return newestMtime(sources) > built + 1000;
}

function ensureServerBuilt() {
  const marker = path.join(__dirname, 'dist', 'server', 'core', 'config.js');
  if (!dev && !isStale(marker, ['src/server', 'src/shared', 'tsconfig.server.json'])) return;
  const r = sh('Mengompilasi kode server TypeScript', 'typescript/bin/tsc', ['-p', 'tsconfig.server.json']);
  if (!fs.existsSync(marker)) { say('error', 'Kompilasi server gagal. Pastikan "npm install" sudah dijalankan, lalu coba lagi.'); process.exit(1); }
  if (r.status !== 0) say('warn', 'tsc melaporkan error tipe (kode tetap dikompilasi). Periksa dengan: npm run typecheck');
  const now = new Date(); try { fs.utimesSync(marker, now, now); } catch { /* abaikan: best-effort */ }
}

function ensureNextBuilt() {
  const marker = path.join(__dirname, '.next', 'BUILD_ID');
  if (dev || !isStale(marker, ['src', 'public/manifest.webmanifest', 'next.config.js', 'tailwind.config.js', 'postcss.config.js', 'package.json'])) return;
  const r = sh('Build produksi belum ada atau kedaluwarsa, menjalankan "next build"', 'next/dist/bin/next', ['build']);
  if (r.status !== 0) { say('error', '"next build" gagal. Cek pesan di atas dan RAM server (minimal ~1GB), lalu restart.'); process.exit(1); }
}

ensureServerBuilt();
ensureNextBuilt();

const dist = (name) => require(path.join(__dirname, 'dist', 'server', name));
const { config } = dist('core/config');
const log = dist('core/logger');
const db = dist('core/db');
const worker = dist('core/worker');
const edge = dist('http/edge');
const { run: migrate } = dist('core/migrate');
const { ensureAdmin } = dist('auth/bootstrap-admin');
const premku = dist('shop/premku');

function checkPremku() {
  if (!config.premku.apiKey) return log.warn('Premku: PREMKU_API_KEY belum diisi, produk tidak bisa disinkronkan');
  return premku.profile().then((r) => {
    const d = r.data || {};
    log.info('Premku terhubung', { akun: d.username, saldo: d.saldo, webhook: config.premku.apiSecret ? 'siap' : 'PREMKU_API_SECRET kosong' });
  }, (e) => log.warn(`Premku belum terhubung: ${e.message}. Cek PREMKU_API_KEY dan IP whitelist di profil Premku (tambahkan IP server ini).`));
}

function securityChecks() {
  const w = (m) => log.warn(`KEAMANAN: ${m}`);
  try {
    const st = fs.statSync(path.join(__dirname, '.env'));
    if (process.platform !== 'win32' && (st.mode & 0o077) !== 0) w('Berkas .env bisa dibaca user lain di server ini. Jalankan: chmod 600 .env');
  } catch { /* abaikan: best-effort */ }
  if (config.isProd && !config.appUrl.startsWith('https://')) w('APP_URL masih http:// — cookie tidak Secure, link reset password & login lewat HTTP polos. Pasang HTTPS (Cloudflare) lalu ganti APP_URL=https://...');
  if (config.db.ssl && !config.db.sslVerify) w('DB_SSL=true tetapi DB_SSL_VERIFY=false — koneksi terenkripsi namun sertifikat server DB TIDAK diperiksa, jadi penyadap di jaringan masih bisa menyamar sebagai DB. Isi DB_SSL_CA=/path/ca.pem (atau hapus DB_SSL_VERIFY=false bila DB memakai sertifikat resmi).');
  if (!/^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|localhost$|::1$)/.test(config.db.host) && !config.db.ssl) w('Database di host publik tapi DB_SSL=false — password & data dikirim tanpa enkripsi. Set DB_SSL=true dan batasi akses MySQL hanya dari IP server ini.');
  const bad = dist('http/net').badTrustedProxyEntries();
  if (bad.length) w(`TRUSTED_PROXY_IPS memuat entri tidak valid (diabaikan): ${bad.join(', ')}`);
  const badAdmin = dist('http/net').badAdminIpEntries();
  if (badAdmin.length) w(`ADMIN_ALLOWED_IPS memuat entri tidak valid (diabaikan): ${badAdmin.join(', ')}${badAdmin.length === config.adminIps.length ? ' — SEMUA entri rusak, panel /admin tertutup untuk semua orang sampai diperbaiki.' : ''} Format: IP atau IP/bit (contoh 203.0.113.9 atau 203.0.113.0/24).`);
  if (config.bindHost === '0.0.0.0' && config.trustedProxies.length === 0 && config.trustProxy > 0) log.info('Header proxy (CF-Connecting-IP / X-Forwarded-For) hanya dipercaya dari loopback & IP Cloudflare. Bila proxy/tunnel kamu terhubung dari IP lain (mis. gateway Docker 172.x), isi TRUSTED_PROXY_IPS=<ip proxy>.');
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  if (nodeMajor < 22 || nodeMajor % 2 === 1) w(`Node.js ${process.versions.node} sudah tidak menerima patch keamanan (rilis ganjil/EOL). Pakai Node 22 LTS atau 24 LTS versi terbaru.`);
  if (!config.turnstile.enabled) w('Turnstile belum aktif — login/daftar/lupa password tanpa CAPTCHA.');
  if (config.admin.password) w('ADMIN_PASSWORD masih ada di .env — hapus setelah login pertama.');
  if (!config.adminIps.length) w('ADMIN_ALLOWED_IPS kosong — panel /admin bisa dicoba dari IP mana pun (tetap butuh login). Isi dengan IP kamu bila IP-nya tetap.');
  if (!dist('auth/security').hasArgon()) w('@node-rs/argon2 tidak terpasang — password memakai scrypt cadangan. Jalankan: npm ci');
  if (!config.behindCloudflare && config.trustProxy > 0 && config.appUrl.startsWith('https://')) w('APP_URL https tapi BEHIND_CLOUDFLARE=false — IP asli pengunjung bisa salah terbaca, batas percobaan login jadi kurang efektif.');
}

async function dbChecks() {
  const w = (m) => log.warn(`KEAMANAN: ${m}`);
  try {
    const r = await db.one("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND status = 'active' AND totp_enabled = 0");
    if (Number(r.n) > 0) w(`${r.n} akun admin belum mengaktifkan 2FA (Akun saya → Autentikasi dua langkah). Set ADMIN_REQUIRE_2FA=true untuk mewajibkannya.`);
  } catch (e) { log.warn('cek 2FA admin dilewati', { msg: e.message }); }
  if (!config.smtp.enabled) log.warn('Notifikasi email nonaktif: SMTP belum diisi. Alert admin (saldo menipis, supplier down, pesanan macet) dan email konfirmasi pembeli hanya tercatat di log/dashboard.');
}

async function main() {
  securityChecks();
  await migrate();
  await dbChecks();
  await ensureAdmin().catch((e) => log.error('pembuatan admin otomatis gagal', { msg: e.message }));
  const next = require('next');
  const nextApp = next({ dev, dir: __dirname });
  const handle = nextApp.getRequestHandler();
  await nextApp.prepare();

  const server = http.createServer(edge.createListener(handle));
  server.keepAliveTimeout = 65000; server.headersTimeout = 66000;
  server.requestTimeout = 60000;
  server.maxHeadersCount = 60;
  if (dev && typeof nextApp.getUpgradeHandler === 'function') { const up = nextApp.getUpgradeHandler(); server.on('upgrade', (req, sock, head) => up(req, sock, head)); }
  server.listen(config.port, config.bindHost, () => { log.info('Nivo Premium berjalan', { port: config.port, url: config.appUrl, mode: dev ? 'dev' : 'production' }); worker.start(); checkPremku(); });

  let stopping = false;
  const stop = (sig) => {
    if (stopping) return; stopping = true; // sinyal ganda (mis. SIGINT lalu SIGTERM) tidak boleh menutup pool dua kali
    log.info('berhenti', { sig }); worker.stop();
    server.close(() => db.pool.end().catch(() => {}).finally(() => process.exit(0)));
    setTimeout(() => process.exit(0), 10000).unref();
  };
  process.on('SIGTERM', () => stop('SIGTERM')); process.on('SIGINT', () => stop('SIGINT'));
}
process.on('unhandledRejection', (e) => log.error('unhandledRejection', { msg: e && e.message, stack: e && e.stack }));
process.on('uncaughtException', (e) => { log.error('uncaughtException', { msg: e.message, stack: e.stack }); });
main().catch((e) => { log.error('gagal start', { msg: e.message }); process.exit(1); });
