import * as db from './db';
import type { SiteInfo, SiteSettings } from '../../shared/types';
import { config } from './config';
import { once } from './singleton';

const DEFAULTS: Record<keyof SiteSettings, string> = {
  site_name: 'Nivo Premium',
  tagline: 'Produk digital premium. Bayar, langsung terima.',
  logo_url: '/icon.webp',
  notice: '',
  wa_number: '',
  contact_email: '',
  instagram: '',
  markup_pct: '10',
  markup_flat: '0',
  am_price: '950',
  min_deposit: '10000',
  max_deposit: '2000000',
  low_balance_threshold: '50000',
  stuck_minutes: '15',
  alert_email: '',
};
const NUMERIC: (keyof SiteSettings)[] = ['markup_pct', 'markup_flat', 'am_price', 'min_deposit', 'max_deposit', 'low_balance_threshold', 'stuck_minutes'];

const st = once('settings.cache', () => ({ cache: null as SiteSettings | null, at: 0 }));
async function get(force = false): Promise<SiteSettings> {
  if (!force && st.cache && Date.now() - st.at < 10000) return st.cache;
  const rows = await db.query('SELECT k, v FROM settings');
  const raw: Record<string, any> = { ...DEFAULTS };
  for (const r of rows) if (r.k in DEFAULTS) raw[r.k] = r.v === null ? '' : r.v;
  for (const k of NUMERIC) { const n = Number(raw[k]); raw[k] = Number.isFinite(n) ? n : Number(DEFAULTS[k]); }
  const s = raw as SiteSettings;
  st.cache = s; st.at = Date.now();
  return s;
}
async function set(obj: Partial<SiteSettings>): Promise<SiteSettings> {
  const entries = Object.entries(obj).filter(([k]) => k in DEFAULTS);
  // Satu transaksi: gagal di tengah tidak meninggalkan pengaturan setengah tersimpan (mis. min_deposit baru dengan max_deposit lama).
  if (entries.length) await db.tx(async (t) => { for (const [k, v] of entries) await t.query('INSERT INTO settings (k, v) VALUES (?, ?) ON DUPLICATE KEY UPDATE v = VALUES(v)', [k, String(v)]); });
  return get(true);
}
const BRAND_ICON = '/icon.webp';
const publicSite = (s: SiteSettings): SiteInfo => ({ name: s.site_name, tagline: s.tagline, logo: BRAND_ICON, notice: s.notice, wa: s.wa_number, email: s.contact_email, ig: s.instagram, turnstile: config.turnstile.enabled ? config.turnstile.siteKey : '', url: config.appUrl, google: config.google.enabled });

export { get, set, publicSite, DEFAULTS };
