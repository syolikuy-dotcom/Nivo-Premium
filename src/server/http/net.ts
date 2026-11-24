import type { IncomingMessage } from 'http';
import * as net from 'net';
import { config } from '../core/config';

const CF = new net.BlockList();
const V4: [string, number][] = [['173.245.48.0', 20], ['103.21.244.0', 22], ['103.22.200.0', 22], ['103.31.4.0', 22], ['141.101.64.0', 18], ['108.162.192.0', 18],
  ['190.93.240.0', 20], ['188.114.96.0', 20], ['197.234.240.0', 22], ['198.41.128.0', 17], ['162.158.0.0', 15], ['104.16.0.0', 13],
  ['104.24.0.0', 14], ['172.64.0.0', 13], ['131.0.72.0', 22]];
V4.forEach(([a, p]) => CF.addSubnet(a, p, 'ipv4'));
const V6: [string, number][] = [['2400:cb00::', 32], ['2606:4700::', 32], ['2803:f800::', 32], ['2405:b500::', 32], ['2405:8100::', 32], ['2a06:98c0::', 29], ['2c0f:f248::', 32]];
V6.forEach(([a, p]) => CF.addSubnet(a, p, 'ipv6'));

const norm = (a: unknown): string => String(a || '').trim().replace(/^::ffff:/i, '');
function isLoopback(a: string): boolean {
  const t = net.isIP(a);
  if (t === 4) return /^127\./.test(a);
  if (t === 6) return a.toLowerCase() === '::1';
  return false;
}
function isPrivate(a: string): boolean {
  const t = net.isIP(a);
  if (t === 4) return /^(10\.|127\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a);
  if (t === 6) { const l = a.toLowerCase(); return l === '::1' || l.startsWith('fc') || l.startsWith('fd') || l.startsWith('fe80'); }
  return false;
}

/** Isi BlockList dari daftar "IP" atau "IP/bit" (IPv4/IPv6). Entri rusak dikembalikan agar bisa dilaporkan, tidak diam-diam diabaikan. */
function fillList(list: net.BlockList, entries: string[], onSpecial?: (raw: string) => boolean): string[] {
  const bad: string[] = [];
  for (const raw of entries) {
    if (onSpecial && onSpecial(raw)) continue;
    const [addr, bits] = raw.split('/');
    const t = net.isIP(norm(addr));
    const max = t === 4 ? 32 : 128;
    const n = bits === undefined ? max : Number(bits);
    if (!t || !Number.isInteger(n) || n < 0 || n > max) { bad.push(raw); continue; }
    try { if (bits === undefined) list.addAddress(norm(addr), t === 4 ? 'ipv4' : 'ipv6'); else list.addSubnet(norm(addr), n, t === 4 ? 'ipv4' : 'ipv6'); } catch { bad.push(raw); }
  }
  return bad;
}

const TRUSTED = new net.BlockList();
let trustPrivate = false;
const badEntries = fillList(TRUSTED, config.trustedProxies, (raw) => { if (raw === 'private') { trustPrivate = true; return true; } return false; });
const badTrustedProxyEntries = (): string[] => badEntries.slice();

const ADMIN = new net.BlockList();
const badAdminEntries = fillList(ADMIN, config.adminIps);
const badAdminIpEntries = (): string[] => badAdminEntries.slice();
const trustedHop = (a: string): boolean => {
  const t = net.isIP(a);
  if (t === 0) return false;
  const fam = t === 4 ? 'ipv4' : 'ipv6';
  return isLoopback(a) || (trustPrivate && isPrivate(a)) || CF.check(a, fam) || TRUSTED.check(a, fam);
};
const sockIp = (req: IncomingMessage) => norm(req.socket && req.socket.remoteAddress);

function clientIp(req: IncomingMessage): string {
  const sock = sockIp(req);
  if (trustedHop(sock)) {
    if (config.behindCloudflare) {
      const h = norm(req.headers['cf-connecting-ip']);
      if (net.isIP(h)) return h;
    }
    if (config.trustProxy > 0 && typeof req.headers['x-forwarded-for'] === 'string') {
      const parts = req.headers['x-forwarded-for'].split(',').map(norm).filter(Boolean);
      const ip = parts[Math.max(0, parts.length - config.trustProxy)] || '';
      if (net.isIP(ip)) return ip;
    }
  }
  return sock || '0.0.0.0';
}

function ensureIp(req: IncomingMessage): string {
  if (!req.ip) Object.defineProperty(req, 'ip', { value: clientIp(req), configurable: true, enumerable: true });
  return req.ip;
}

function isSecure(req: IncomingMessage): boolean {
  if (req.socket && (req.socket as { encrypted?: boolean }).encrypted) return true;
  if (!trustedHop(sockIp(req))) return false;
  const xfp = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  if (xfp === 'https') return true;
  if (config.behindCloudflare) { try { return JSON.parse(String(req.headers['cf-visitor'] || '{}')).scheme === 'https'; } catch { return false; } }
  return false;
}

function hostAllowed(hostIn: unknown, req: IncomingMessage): boolean {
  const host = String(hostIn || '').toLowerCase();
  if (!host) return false;
  if (config.allowedHosts.includes(host)) return true;
  return host === String(req.headers.host || '').toLowerCase();
}

/**
 * ADMIN_ALLOWED_IPS mendukung IP tunggal dan CIDR (IPv4/IPv6). Pencocokan memakai alamat biner, bukan perbandingan teks, jadi
 * penulisan IPv6 yang berbeda (huruf besar, tanpa singkatan "::") tetap cocok. Daftar terisi tapi semua entrinya rusak = admin
 * tertutup untuk semua orang (gagal-aman); index.js memberi peringatan keras saat start.
 */
function adminIpOk(req: IncomingMessage): boolean {
  if (!config.adminIps.length) return true;
  const ip = norm(clientIp(req)); const t = net.isIP(ip);
  return t !== 0 && ADMIN.check(ip, t === 4 ? 'ipv4' : 'ipv6');
}

export { clientIp, ensureIp, isSecure, hostAllowed, trustedHop, adminIpOk, badTrustedProxyEntries, badAdminIpEntries };
