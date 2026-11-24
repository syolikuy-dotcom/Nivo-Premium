import * as db from '../core/db';
import * as premku from './premku';
import { MAX_ATTEMPTS } from './orders';
import * as settings from '../core/settings';
import * as mailer from '../auth/mailer';
import { recipients, deliver, notifyAdmins } from '../auth/admin-notice';
import * as sec from '../auth/security';
import * as log from '../core/logger';
import * as heartbeat from '../core/heartbeat';
import { config } from '../core/config';
import { once } from '../core/singleton';
import { rupiah, dateTime } from '../../shared/format';
import type { HealthView, StuckRow } from '../../shared/types';

const PROFILE_EVERY_MS = 5 * 60e3;
const PROFILE_MIN_MS = 15e3;
const DOWN_GRACE_MS = 3 * 60e3;

const M = once('monitor.state', () => ({
  lastProfileAt: 0, checking: false,
  cache: null as { at: number; v: HealthView } | null,
  lastTry: {} as Record<string, number>,
}));

async function stuckOrders(minutes: number): Promise<{ total: number; rows: StuckRow[] }> {
  const cutoff = new Date(Date.now() - minutes * 60e3);
  const [o, a, oc, ac] = await Promise.all([
    db.query(`SELECT o.order_no, o.product_name, o.status, o.fail_reason, COALESCE(o.paid_at, o.created_at) AS since, u.username
                FROM orders o JOIN users u ON u.id = o.user_id
               WHERE o.status IN ('paid','processing') AND (COALESCE(o.paid_at, o.created_at) < ? OR o.attempts >= ?) ORDER BY o.id LIMIT 30`, [cutoff, MAX_ATTEMPTS]),
    db.query(`SELECT a.order_no, a.kind, a.email, a.status, a.fail_reason, a.created_at AS since, u.username
                FROM am_orders a JOIN users u ON u.id = a.user_id
               WHERE a.status = 'review' OR (a.status = 'processing' AND a.updated_at < ?) ORDER BY a.id LIMIT 30`, [cutoff]),
    db.one("SELECT COUNT(*) AS n FROM orders WHERE status IN ('paid','processing') AND (COALESCE(paid_at, created_at) < ? OR attempts >= ?)", [cutoff, MAX_ATTEMPTS]),
    db.one("SELECT COUNT(*) AS n FROM am_orders WHERE status = 'review' OR (status = 'processing' AND updated_at < ?)", [cutoff]),
  ]);
  const mins = (d: unknown) => Math.max(0, Math.floor((Date.now() - new Date(d as string).getTime()) / 60e3));
  const rows: StuckRow[] = [
    ...o.map((r: any): StuckRow => ({ kind: 'order', no: r.order_no, product: r.product_name, status: r.status, minutes: mins(r.since), reason: r.fail_reason, username: r.username })),
    ...a.map((r: any): StuckRow => ({ kind: 'am', no: r.order_no, product: r.kind === 'bulk' ? 'Akun AM (bulk)' : `Akun AM ${r.email || ''}`.trim(), status: r.status, minutes: mins(r.since), reason: r.fail_reason, username: r.username })),
  ];
  return { total: Number(oc!.n) + Number(ac!.n), rows };
}

async function refreshSupplier(force = false): Promise<void> {
  if (!config.premku.apiKey) return;
  const age = Date.now() - M.lastProfileAt;
  if (age < (force ? PROFILE_MIN_MS : PROFILE_EVERY_MS)) return;
  M.lastProfileAt = Date.now();
  await premku.profile().catch(() => {  });
}

const iso = (ms: number | null | undefined): string | null => (ms ? new Date(ms).toISOString() : null);

async function collect(): Promise<HealthView> {
  const s = await settings.get();
  const h = premku.health(); const bal = premku.lastBalance();
  const [stuck, alerts, adm, to] = await Promise.all([
    stuckOrders(s.stuck_minutes),
    db.query('SELECT k, state, since, last_sent_at, detail FROM alert_state ORDER BY k'),
    db.one("SELECT COUNT(*) AS total, COALESCE(SUM(totp_enabled), 0) AS with2fa FROM users WHERE role = 'admin' AND status = 'active'"),
    recipients(),
  ]);
  const hb = heartbeat.get();
  return {
    at: new Date().toISOString(),
    supplier: { state: h.state, saldo: bal ? bal.value : null, saldoAt: bal ? iso(bal.at) : null, lastOkAt: iso(h.lastOkAt), lastError: h.lastError, failures: h.consecutiveFailures, breakerOpen: h.breakerOpen, queued: h.queued },
    threshold: s.low_balance_threshold,
    lowBalance: s.low_balance_threshold > 0 && bal !== null && bal.value < s.low_balance_threshold,
    stuck: { total: stuck.total, rows: stuck.rows, minutes: s.stuck_minutes },
    worker: { lastTickAt: iso(hb.lastTickAt), stale: hb.stale },
    smtp: mailer.smtpEnabled(), alertRecipients: mailer.smtpEnabled() ? to.length : 0,
    alerts: alerts.map((r: any) => ({ key: r.k, state: r.state, since: r.since ? new Date(r.since).toISOString() : null, lastSentAt: r.last_sent_at ? new Date(r.last_sent_at).toISOString() : null, detail: r.detail })),
    admins: { total: Number(adm!.total), with2fa: Number(adm!.with2fa) },
  };
}

async function snapshot({ refresh = false } = {}): Promise<HealthView> {
  await refreshSupplier(refresh);
  if (!refresh && M.cache && Date.now() - M.cache.at < 20e3) return M.cache.v;
  const v = await collect();
  M.cache = { at: Date.now(), v };
  return v;
}

interface Alert {
  key: string; firing: boolean; fingerprint: string; reminderMs: number; minGapMs: number;
  subject: string; body: string; recovered: { subject: string; body: string }; detail: string;
}
async function raise(a: Alert): Promise<void> {
  const row = await db.one('SELECT state, fingerprint, last_sent_at, since FROM alert_state WHERE k = ?', [a.key]);
  const was = Boolean(row && row.state === 'firing');
  if (a.firing) {
    const sentAgo = row && row.last_sent_at ? Date.now() - new Date(row.last_sent_at).getTime() : Infinity;
    const changed = was && row!.fingerprint !== a.fingerprint;
    const due = !was || sentAgo >= a.reminderMs || (changed && sentAgo >= a.minGapMs);
    if (!due) return;
    if (was && Date.now() - (M.lastTry[a.key] || 0) < 5 * 60e3 && !changed) return;
    M.lastTry[a.key] = Date.now();
    const d = await deliver(a.subject, a.body);
    const sentAt = d === 'failed' ? null : new Date();
    await db.query(
      "INSERT INTO alert_state (k, state, fingerprint, last_sent_at, detail, since) VALUES (?, 'firing', ?, ?, ?, ?) ON DUPLICATE KEY UPDATE state = 'firing', fingerprint = VALUES(fingerprint), last_sent_at = VALUES(last_sent_at), detail = VALUES(detail), since = IF(?, since, VALUES(since))",
      [a.key, a.fingerprint, sentAt, a.detail.slice(0, 250), new Date(), was ? 1 : 0]);
  } else if (was) {
    await deliver(a.recovered.subject, a.recovered.body, 'info');
    await db.query("UPDATE alert_state SET state = 'ok', fingerprint = NULL, detail = ?, since = NULL WHERE k = ?", [a.recovered.subject.slice(0, 250), a.key]);
  }
}

const hours = (n: number) => n * 3600e3;
async function evaluate(v: HealthView): Promise<void> {
  const url = `${config.appUrl}/admin`;
  const sup = v.supplier;

  await raise({
    key: 'supplier_balance', firing: v.lowBalance, fingerprint: 'low', reminderMs: hours(6), minGapMs: 0,
    subject: 'Saldo Premku menipis',
    body: [
      'Saldo Premku di bawah batas alert.', '',
      `Saldo saat ini : ${sup.saldo === null ? '-' : rupiah(sup.saldo)}`, `Batas alert    : ${rupiah(v.threshold)}`, '',
      'Segera top up di dashboard Premku. Bila saldo habis, supplier menolak pesanan yang sudah dibayar pembeli dan sistem otomatis me-refund ke saldo pembeli.',
      `Ringkasan: ${url}`,
    ].join('\n'),
    recovered: { subject: 'Saldo Premku pulih', body: `Saldo Premku kembali di atas batas alert (${sup.saldo === null ? '-' : rupiah(sup.saldo)}).` },
    detail: `Saldo ${sup.saldo === null ? '-' : rupiah(sup.saldo)} < ${rupiah(v.threshold)}`,
  });

  const bad = (sup.state === 'down' || sup.state === 'auth');
  const sinceMs = premku.health().since;
  await raise({
    key: 'supplier_down', firing: bad && Date.now() - sinceMs >= DOWN_GRACE_MS, fingerprint: sup.state, reminderMs: hours(2), minGapMs: 0,
    subject: sup.state === 'auth' ? 'Premku menolak API key / IP server' : 'Premku tidak dapat dihubungi',
    body: [
      sup.state === 'auth' ? 'Premku menolak permintaan (API key salah atau IP server belum di-whitelist).' : 'Premku terdeteksi gangguan (down / tidak merespons).', '',
      `Sejak          : ${dateTime(sinceMs)} WIB`, `Terakhir sehat : ${sup.lastOkAt ? `${dateTime(sup.lastOkAt)} WIB` : '-'}`, `Galat terakhir : ${sup.lastError || '-'}`, `Gagal berturut : ${sup.failures}`, '',
      sup.state === 'auth'
        ? 'Periksa PREMKU_API_KEY di .env dan daftarkan IP server di IP Whitelist profil Premku.'
        : 'Pesanan yang sudah dibayar tetap aman: sistem mencoba ulang otomatis dengan ref_id yang sama (saldo tidak terpotong dua kali) begitu Premku pulih.',
      `Ringkasan: ${url}`,
    ].join('\n'),
    recovered: { subject: 'Premku pulih', body: 'Premku kembali merespons normal. Pesanan tertunda diproses otomatis.' },
    detail: `${sup.state}: ${sup.lastError || '-'}`,
  });

  const lines = v.stuck.rows.slice(0, 15).map((r) => `- ${r.no}  ${r.product}  [${r.status}]  @${r.username}  ${r.minutes} mnt${r.reason ? `  (${r.reason})` : ''}`);
  const fp = sec.sha256(v.stuck.rows.map((r) => r.no).sort().join(',')).slice(0, 16);
  await raise({
    key: 'orders_stuck', firing: v.stuck.total > 0, fingerprint: fp, reminderMs: hours(3), minGapMs: 15 * 60e3,
    subject: `${v.stuck.total} pesanan macet`,
    body: [
      `${v.stuck.total} pesanan sudah dibayar tetapi belum terkirim > ${v.stuck.minutes} menit, atau butuh dicek admin:`, '', ...lines,
      v.stuck.total > lines.length ? `… dan ${v.stuck.total - lines.length} lainnya` : '', '',
      'Buka Admin → Ringkasan untuk “Coba lagi” atau Refund. Pastikan dulu di dashboard Premku bahwa supplier belum mengirim akun sebelum refund.',
      `Ringkasan: ${url}`,
    ].filter((x, i, arr) => x !== '' || arr[i - 1] !== '').join('\n'),
    recovered: { subject: 'Tidak ada pesanan macet', body: 'Semua pesanan yang tertahan sudah terkirim atau ditangani.' },
    detail: `${v.stuck.total} pesanan macet`,
  });
}

async function check(): Promise<void> {
  if (M.checking) return;
  M.checking = true;
  try {
    await refreshSupplier(false);
    const v = await collect();
    M.cache = { at: Date.now(), v };
    await evaluate(v);
  } catch (e) { log.error('monitor gagal', { msg: e.message }); }
  finally { M.checking = false; }
}

async function liveness(): Promise<{ ok: boolean; db: boolean; worker: boolean }> {
  let dbOk = false;
  try { await db.one('SELECT 1 AS ok'); dbOk = true; } catch { /* abaikan: best-effort */ }
  const hb = heartbeat.get(300e3);
  return { ok: dbOk && !hb.stale, db: dbOk, worker: !hb.stale };
}

export { snapshot, check, notifyAdmins, liveness, recipients };
