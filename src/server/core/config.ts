import * as fs from 'fs';
import * as dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const flag = (def: boolean) => z.preprocess((v) => (v === undefined ? def : /^(1|true|yes|on)$/i.test(String(v))), z.boolean());

const schema = z.object({
  NODE_ENV: z.string().default('production'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  APP_URL: z.string().url().optional(),
  TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(1),
  BIND_HOST: z.string().default('0.0.0.0'),
  TRUSTED_PROXY_IPS: z.string().default(''),
  DB_HOST: z.string().min(1),
  DB_PORT: z.coerce.number().int().default(3306),
  DB_USER: z.string().min(1),
  DB_PASSWORD: z.string().min(1),
  DB_NAME: z.string().min(1),
  DB_POOL: z.coerce.number().int().min(1).max(30).default(8),
  DB_SSL: flag(false),
  DB_SSL_VERIFY: z.string().optional(),
  DB_SSL_CA: z.string().default(''),
  SESSION_SECRET: z.string().min(32, 'minimal 32 karakter (jalankan: npm run gen-secrets)'),
  DATA_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/, 'harus 64 karakter hex (jalankan: npm run gen-secrets)'),
  PREMKU_BASE: z.string().url().default('https://premku.com/api'),
  PREMKU_API_KEY: z.string().default(''),
  PREMKU_API_SECRET: z.string().default(''),
  SMTP_HOST: z.string().default(''),
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_SECURE: flag(false),
  SMTP_USER: z.string().default(''),
  SMTP_PASS: z.string().default(''),
  SMTP_FROM: z.string().default(''),
  ORDER_TTL_MIN: z.coerce.number().int().min(2).max(60).default(5),
  IMAGE_HOSTS: z.string().default('cdn.premku.com'),
  BEHIND_CLOUDFLARE: flag(false),
  ALLOWED_HOSTS: z.string().default(''),
  GOOGLE_CLIENT_ID: z.string().default(''),
  GOOGLE_CLIENT_SECRET: z.string().default(''),
  TURNSTILE_SITE_KEY: z.string().default(''),
  TURNSTILE_SECRET_KEY: z.string().default(''),
  ADMIN_ALLOWED_IPS: z.string().default(''),
  ADMIN_USERNAME: z.string().default('admin'),
  ADMIN_EMAIL: z.string().default(''),
  ADMIN_PASSWORD: z.string().default(''),
  ADMIN_REQUIRE_2FA: flag(false),
  LOG_STATIC: flag(false),
  LOG_FORMAT: z.string().default('pretty'),
  LOG_COLOR: flag(true),
});

const raw: Record<string, string | undefined> = { ...process.env, PORT: process.env.SERVER_PORT || process.env.PORT };
for (const k of Object.keys(raw)) if (raw[k] === '') delete raw[k];

const parsed = schema.safeParse(raw);
if (!parsed.success) {
  console.error('Konfigurasi .env tidak valid:');
  for (const i of parsed.error.issues) console.error(` - ${i.path.join('.')}: ${i.message}`);
  process.exit(1);
}
const e = parsed.data;
const sslVerify = e.DB_SSL_VERIFY === undefined ? e.DB_SSL : /^(1|true|yes|on)$/i.test(e.DB_SSL_VERIFY);
let sslCa: string | undefined;
if (e.DB_SSL_CA) {
  try { sslCa = fs.readFileSync(e.DB_SSL_CA, 'utf8'); } catch (err) { console.error(`DB_SSL_CA tidak bisa dibaca (${e.DB_SSL_CA}): ${err.message}`); process.exit(1); }
}
const appUrl = (e.APP_URL || `http://localhost:${e.PORT}`).replace(/\/+$/, '');

export const config = Object.freeze({
  env: e.NODE_ENV,
  isProd: e.NODE_ENV === 'production',
  port: e.PORT,
  appUrl,
  appHost: new URL(appUrl).host,
  secureCookies: appUrl.startsWith('https://'),
  trustProxy: e.TRUST_PROXY,
  bindHost: e.BIND_HOST,
  trustedProxies: e.TRUSTED_PROXY_IPS.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean),
  db: { host: e.DB_HOST, port: e.DB_PORT, user: e.DB_USER, password: e.DB_PASSWORD, database: e.DB_NAME, pool: e.DB_POOL, ssl: e.DB_SSL, sslVerify, sslCa },
  sessionSecret: e.SESSION_SECRET,
  dataKey: e.DATA_KEY,
  premku: { base: e.PREMKU_BASE.replace(/\/+$/, ''), apiKey: e.PREMKU_API_KEY, apiSecret: e.PREMKU_API_SECRET },
  smtp: { host: e.SMTP_HOST, port: e.SMTP_PORT, secure: e.SMTP_SECURE, user: e.SMTP_USER, pass: e.SMTP_PASS, from: e.SMTP_FROM, enabled: Boolean(e.SMTP_HOST && e.SMTP_FROM) },
  orderTtlMin: e.ORDER_TTL_MIN,
  imageHosts: e.IMAGE_HOSTS.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
  behindCloudflare: e.BEHIND_CLOUDFLARE,
  allowedHosts: [new URL(appUrl).host.toLowerCase(), ...e.ALLOWED_HOSTS.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)],
  turnstile: { siteKey: e.TURNSTILE_SITE_KEY, secret: e.TURNSTILE_SECRET_KEY, enabled: Boolean(e.TURNSTILE_SITE_KEY && e.TURNSTILE_SECRET_KEY) },
  google: { clientId: e.GOOGLE_CLIENT_ID, secret: e.GOOGLE_CLIENT_SECRET, enabled: Boolean(e.GOOGLE_CLIENT_ID && e.GOOGLE_CLIENT_SECRET) },
  adminIps: e.ADMIN_ALLOWED_IPS.split(',').map((s) => s.trim()).filter(Boolean),
  admin: { username: e.ADMIN_USERNAME, email: e.ADMIN_EMAIL, password: e.ADMIN_PASSWORD, require2fa: e.ADMIN_REQUIRE_2FA },
  log: { statics: e.LOG_STATIC, json: e.LOG_FORMAT === 'json', color: e.LOG_COLOR },
});
