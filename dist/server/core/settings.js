"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULTS = exports.publicSite = void 0;
exports.get = get;
exports.set = set;
const db = __importStar(require("./db"));
const config_1 = require("./config");
const singleton_1 = require("./singleton");
const DEFAULTS = {
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
exports.DEFAULTS = DEFAULTS;
const NUMERIC = ['markup_pct', 'markup_flat', 'am_price', 'min_deposit', 'max_deposit', 'low_balance_threshold', 'stuck_minutes'];
const st = (0, singleton_1.once)('settings.cache', () => ({ cache: null, at: 0 }));
async function get(force = false) {
    if (!force && st.cache && Date.now() - st.at < 10000)
        return st.cache;
    const rows = await db.query('SELECT k, v FROM settings');
    const raw = { ...DEFAULTS };
    for (const r of rows)
        if (r.k in DEFAULTS)
            raw[r.k] = r.v === null ? '' : r.v;
    for (const k of NUMERIC) {
        const n = Number(raw[k]);
        raw[k] = Number.isFinite(n) ? n : Number(DEFAULTS[k]);
    }
    const s = raw;
    st.cache = s;
    st.at = Date.now();
    return s;
}
async function set(obj) {
    const entries = Object.entries(obj).filter(([k]) => k in DEFAULTS);
    if (entries.length)
        await db.tx(async (t) => { for (const [k, v] of entries)
            await t.query('INSERT INTO settings (k, v) VALUES (?, ?) ON DUPLICATE KEY UPDATE v = VALUES(v)', [k, String(v)]); });
    return get(true);
}
const BRAND_ICON = '/icon.webp';
const publicSite = (s) => ({ name: s.site_name, tagline: s.tagline, logo: BRAND_ICON, notice: s.notice, wa: s.wa_number, email: s.contact_email, ig: s.instagram, turnstile: config_1.config.turnstile.enabled ? config_1.config.turnstile.siteKey : '', url: config_1.config.appUrl, google: config_1.config.google.enabled });
exports.publicSite = publicSite;
