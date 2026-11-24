'use strict';
// Env uji integrasi (DB lokal + supplier palsu). Tidak pernah membaca .env produksi.
const crypto = require('crypto');
const base = {
  NODE_ENV: 'production', PORT: '3100', APP_URL: 'http://localhost:3100', BIND_HOST: '127.0.0.1', TRUST_PROXY: '1',
  DB_HOST: process.env.IT_DB_HOST || '127.0.0.1', DB_PORT: process.env.IT_DB_PORT || '3306', DB_USER: process.env.IT_DB_USER || 'nivo',
  DB_PASSWORD: process.env.IT_DB_PASSWORD || 'testpass123', DB_NAME: process.env.IT_DB_NAME || 'nivo_test', DB_POOL: '10',
  SESSION_SECRET: crypto.createHash('sha256').update('it-session').digest('hex'),
  DATA_KEY: crypto.createHash('sha256').update('it-data').digest('hex'),
  PREMKU_BASE: 'http://127.0.0.1:4010/api', PREMKU_API_KEY: 'it-key', PREMKU_API_SECRET: 'whsec_test',
  ORDER_TTL_MIN: '5', ADMIN_USERNAME: 'admin', ADMIN_EMAIL: 'admin@nivo.local', ADMIN_PASSWORD: 'AdminPass123x',
  LOG_FORMAT: 'json', LOG_COLOR: 'false',
};
for (const [k, v] of Object.entries(base)) if (process.env[k] === undefined) process.env[k] = v;
module.exports = { base };
