import type { Row } from './db';
import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import * as db from './db';
import * as log from './logger';

const T = 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';
const TS = 'created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP';
const UP = `${TS}, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`;

type Step = string | ((conn: PoolConnection) => Promise<void>);
interface Migration { id: number; name: string; sql: Step[] }

const addColumn = (table: string, column: string, ddl: string): Step => async (conn) => {
  const [r] = await conn.query<RowDataPacket[]>('SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?', [table, column]);
  if (!Number(r[0] && r[0].n)) await conn.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
};

const addIndex = (table: string, name: string, cols: string): Step => async (conn) => {
  const [r] = await conn.query<RowDataPacket[]>('SELECT COUNT(*) AS n FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?', [table, name]);
  if (!Number(r[0] && r[0].n)) await conn.query(`CREATE INDEX ${name} ON ${table} (${cols})`);
};

const addUniqueIfClean = (table: string, name: string, col: string): Step => async (conn) => {
  const [r] = await conn.query<RowDataPacket[]>('SELECT COUNT(*) AS n FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?', [table, name]);
  if (Number(r[0] && r[0].n)) return;
  const [d] = await conn.query<RowDataPacket[]>(`SELECT COUNT(*) AS n FROM (SELECT ${col} FROM ${table} WHERE ${col} IS NOT NULL GROUP BY ${col} HAVING COUNT(*) > 1) x`);
  if (Number(d[0] && d[0].n)) { log.warn(`migrasi: indeks UNIQUE ${name} dilewati karena ${table}.${col} memuat nilai ganda. Bersihkan/periksa datanya, lalu jalankan manual: CREATE UNIQUE INDEX ${name} ON ${table} (${col})`); return; }
  await conn.query(`CREATE UNIQUE INDEX ${name} ON ${table} (${col})`);
};

const MIGRATIONS: Migration[] = [{
  id: 1, name: 'init',
  sql: [
    `CREATE TABLE IF NOT EXISTS users (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(20) NOT NULL, email VARCHAR(190) NOT NULL, name VARCHAR(80) NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      role ENUM('user','admin') NOT NULL DEFAULT 'user',
      status ENUM('active','disabled') NOT NULL DEFAULT 'active',
      balance BIGINT NOT NULL DEFAULT 0,
      failed_logins INT NOT NULL DEFAULT 0, locked_until DATETIME NULL, last_login_at DATETIME NULL,
      ${UP},
      UNIQUE KEY uq_users_username (username), UNIQUE KEY uq_users_email (email),
      CONSTRAINT chk_users_balance CHECK (balance >= 0)
    ) ${T}`,
    `CREATE TABLE IF NOT EXISTS sessions (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      user_id BIGINT UNSIGNED NOT NULL, token_hash CHAR(64) NOT NULL,
      ip VARCHAR(45) NULL, ua VARCHAR(255) NULL,
      ${TS}, last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, expires_at DATETIME NOT NULL,
      UNIQUE KEY uq_sessions_token (token_hash), KEY ix_sessions_user (user_id), KEY ix_sessions_exp (expires_at), KEY ix_sessions_seen (last_seen_at),
      CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ${T}`,
    `CREATE TABLE IF NOT EXISTS password_resets (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      user_id BIGINT UNSIGNED NOT NULL, token_hash CHAR(64) NOT NULL,
      expires_at DATETIME NOT NULL, used_at DATETIME NULL, ${TS},
      UNIQUE KEY uq_resets_token (token_hash), KEY ix_resets_user (user_id, created_at),
      CONSTRAINT fk_resets_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ${T}`,
    `CREATE TABLE IF NOT EXISTS settings (
      k VARCHAR(64) NOT NULL PRIMARY KEY, v TEXT NULL,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ${T}`,
    `CREATE TABLE IF NOT EXISTS media (
      id CHAR(24) NOT NULL PRIMARY KEY, mime VARCHAR(40) NOT NULL, size INT NOT NULL, data MEDIUMBLOB NOT NULL,
      created_by BIGINT UNSIGNED NULL, ${TS}
    ) ${T}`,
    `CREATE TABLE IF NOT EXISTS products (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      slug VARCHAR(120) NOT NULL, premku_id INT NULL,
      name VARCHAR(160) NOT NULL, category VARCHAR(60) NOT NULL DEFAULT 'Aplikasi Premium',
      description TEXT NULL, image_url VARCHAR(500) NULL,
      cost BIGINT NOT NULL DEFAULT 0, price BIGINT NOT NULL DEFAULT 0, price_locked TINYINT(1) NOT NULL DEFAULT 0,
      stock INT NOT NULL DEFAULT 0, stock_synced_at DATETIME NULL,
      active TINYINT(1) NOT NULL DEFAULT 1, ${UP},
      UNIQUE KEY uq_products_slug (slug), UNIQUE KEY uq_products_premku (premku_id), KEY ix_products_list (active, category)
    ) ${T}`,
    `CREATE TABLE IF NOT EXISTS orders (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      order_no VARCHAR(24) NOT NULL, user_id BIGINT UNSIGNED NOT NULL, product_id BIGINT UNSIGNED NOT NULL,
      product_name VARCHAR(160) NOT NULL, qty INT NOT NULL, unit_price BIGINT NOT NULL, total BIGINT NOT NULL,
      pay_method ENUM('qris','balance') NOT NULL,
      status ENUM('pending','paid','processing','success','failed','canceled','expired') NOT NULL DEFAULT 'pending',
      idem_key VARCHAR(64) NOT NULL, premku_ref VARCHAR(40) NOT NULL, premku_invoice VARCHAR(64) NULL,
      pay_invoice VARCHAR(64) NULL, pay_qr TEXT NULL, pay_unique INT NOT NULL DEFAULT 0, amount_due BIGINT NOT NULL DEFAULT 0,
      expires_at DATETIME NULL, accounts_enc MEDIUMTEXT NULL, fail_reason VARCHAR(255) NULL, refunded_at DATETIME NULL,
      attempts INT NOT NULL DEFAULT 0, last_check_at DATETIME NULL, paid_at DATETIME NULL, completed_at DATETIME NULL, ${UP},
      UNIQUE KEY uq_orders_no (order_no), UNIQUE KEY uq_orders_idem (user_id, idem_key), UNIQUE KEY uq_orders_ref (premku_ref),
      KEY ix_orders_user (user_id, created_at), KEY ix_orders_status (status, expires_at), KEY ix_orders_done (status, completed_at),
      CONSTRAINT fk_orders_user FOREIGN KEY (user_id) REFERENCES users(id),
      CONSTRAINT fk_orders_product FOREIGN KEY (product_id) REFERENCES products(id)
    ) ${T}`,
    `CREATE TABLE IF NOT EXISTS deposits (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      deposit_no VARCHAR(24) NOT NULL, user_id BIGINT UNSIGNED NOT NULL,
      amount BIGINT NOT NULL, unique_code INT NOT NULL DEFAULT 0, amount_due BIGINT NOT NULL DEFAULT 0,
      pay_invoice VARCHAR(64) NULL, qr TEXT NULL,
      status ENUM('pending','paid','canceled','expired','failed') NOT NULL DEFAULT 'pending',
      idem_key VARCHAR(64) NOT NULL, expires_at DATETIME NULL, credited_at DATETIME NULL, last_check_at DATETIME NULL, ${UP},
      UNIQUE KEY uq_deposits_no (deposit_no), UNIQUE KEY uq_deposits_idem (user_id, idem_key),
      KEY ix_deposits_user (user_id, created_at), KEY ix_deposits_status (status, expires_at),
      CONSTRAINT fk_deposits_user FOREIGN KEY (user_id) REFERENCES users(id)
    ) ${T}`,
    `CREATE TABLE IF NOT EXISTS ledger (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      user_id BIGINT UNSIGNED NOT NULL, type ENUM('deposit','purchase','refund','am','adjust') NOT NULL,
      amount BIGINT NOT NULL, balance_after BIGINT NOT NULL,
      ref_type VARCHAR(20) NOT NULL, ref_id VARCHAR(40) NOT NULL, note VARCHAR(160) NULL, ${TS},
      UNIQUE KEY uq_ledger_ref (ref_type, ref_id, type), KEY ix_ledger_user (user_id, created_at),
      CONSTRAINT fk_ledger_user FOREIGN KEY (user_id) REFERENCES users(id)
    ) ${T}`,
    `CREATE TABLE IF NOT EXISTS am_orders (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      order_no VARCHAR(24) NOT NULL, user_id BIGINT UNSIGNED NOT NULL, kind ENUM('single','bulk') NOT NULL,
      email VARCHAR(190) NULL, qty INT NOT NULL DEFAULT 1, unit_price BIGINT NOT NULL, total BIGINT NOT NULL,
      status ENUM('processing','pending_verify','success','failed','canceled','review') NOT NULL DEFAULT 'processing',
      idem_key VARCHAR(64) NOT NULL, premku_invoice VARCHAR(64) NULL, result_enc MEDIUMTEXT NULL,
      fail_reason VARCHAR(255) NULL, refunded_at DATETIME NULL, attempts INT NOT NULL DEFAULT 0, ${UP},
      UNIQUE KEY uq_am_no (order_no), UNIQUE KEY uq_am_idem (user_id, idem_key), KEY ix_am_user (user_id, created_at), KEY ix_am_status (status),
      CONSTRAINT fk_am_user FOREIGN KEY (user_id) REFERENCES users(id)
    ) ${T}`,
    `CREATE TABLE IF NOT EXISTS webhook_events (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      dedupe_key CHAR(64) NOT NULL, event VARCHAR(40) NOT NULL, ref_id VARCHAR(64) NULL, ${TS},
      UNIQUE KEY uq_webhook_dedupe (dedupe_key)
    ) ${T}`,
    `CREATE TABLE IF NOT EXISTS audit_log (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      user_id BIGINT UNSIGNED NULL, action VARCHAR(48) NOT NULL, ip VARCHAR(45) NULL, meta TEXT NULL, ${TS},
      KEY ix_audit_user (user_id, created_at), KEY ix_audit_action (action, created_at)
    ) ${T}`,
  ],
}, {
  id: 2, name: 'fitur_pembeli_monitoring_2fa',
  sql: [
    addColumn('users', 'totp_secret_enc', 'VARCHAR(255) NULL'),
    addColumn('users', 'totp_enabled', 'TINYINT(1) NOT NULL DEFAULT 0'),
    addColumn('users', 'totp_last_step', 'BIGINT NULL'),
    `CREATE TABLE IF NOT EXISTS recovery_codes (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      user_id BIGINT UNSIGNED NOT NULL, code_hash CHAR(64) NOT NULL, used_at DATETIME NULL, ${TS},
      UNIQUE KEY uq_recovery (user_id, code_hash),
      CONSTRAINT fk_recovery_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ${T}`,
    addColumn('orders', 'notified_at', 'DATETIME NULL'),
    addColumn('orders', 'notify_tries', 'INT NOT NULL DEFAULT 0'),
    "UPDATE orders SET notified_at = COALESCE(completed_at, NOW()) WHERE status = 'success' AND notified_at IS NULL",
    `CREATE TABLE IF NOT EXISTS alert_state (
      k VARCHAR(48) NOT NULL PRIMARY KEY,
      state ENUM('ok','firing') NOT NULL DEFAULT 'ok',
      fingerprint VARCHAR(64) NULL, last_sent_at DATETIME NULL, detail VARCHAR(255) NULL,
      since DATETIME NULL, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ${T}`,
    addIndex('orders', 'ix_orders_user_status', 'user_id, status, id'),
  ],
}, {
  id: 3, name: 'unik_pay_invoice',
  sql: [
    addUniqueIfClean('orders', 'uq_orders_pay_invoice', 'pay_invoice'),
    addUniqueIfClean('deposits', 'uq_deposits_pay_invoice', 'pay_invoice'),
  ],
}, {
  id: 4, name: 'login_google',
  sql: [
    addColumn('users', 'google_sub', 'VARCHAR(40) NULL'),
    addUniqueIfClean('users', 'uq_users_google_sub', 'google_sub'),
  ],
}];

async function run() {
  const conn = await db.pool.getConnection();
  try {
    const [[lock]] = await conn.query<RowDataPacket[]>("SELECT GET_LOCK('nivo_migrate', 30) AS l");
    if (!lock || !lock.l) throw new Error('tidak bisa mengambil lock migrasi');
    await conn.query(`CREATE TABLE IF NOT EXISTS schema_migrations (id INT NOT NULL PRIMARY KEY, name VARCHAR(64) NOT NULL, applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP) ${T}`);
    const [done] = await conn.query<RowDataPacket[]>('SELECT id FROM schema_migrations');
    const have = new Set(done.map((r: Row) => r.id));
    for (const m of MIGRATIONS) {
      if (have.has(m.id)) continue;
      for (const s of m.sql) { if (typeof s === 'string') await conn.query(s); else await s(conn); }
      await conn.query('INSERT INTO schema_migrations (id, name) VALUES (?, ?)', [m.id, m.name]);
      log.info('migrasi diterapkan', { id: m.id, name: m.name });
    }
  } finally {
    try { await conn.query("SELECT RELEASE_LOCK('nivo_migrate')"); } catch { /* abaikan: best-effort */ }
    conn.release();
  }
}

export { run };
