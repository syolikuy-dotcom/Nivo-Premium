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
exports.badAdminIpEntries = exports.badTrustedProxyEntries = exports.trustedHop = void 0;
exports.clientIp = clientIp;
exports.ensureIp = ensureIp;
exports.isSecure = isSecure;
exports.hostAllowed = hostAllowed;
exports.adminIpOk = adminIpOk;
const net = __importStar(require("net"));
const config_1 = require("../core/config");
const CF = new net.BlockList();
const V4 = [['173.245.48.0', 20], ['103.21.244.0', 22], ['103.22.200.0', 22], ['103.31.4.0', 22], ['141.101.64.0', 18], ['108.162.192.0', 18],
    ['190.93.240.0', 20], ['188.114.96.0', 20], ['197.234.240.0', 22], ['198.41.128.0', 17], ['162.158.0.0', 15], ['104.16.0.0', 13],
    ['104.24.0.0', 14], ['172.64.0.0', 13], ['131.0.72.0', 22]];
V4.forEach(([a, p]) => CF.addSubnet(a, p, 'ipv4'));
const V6 = [['2400:cb00::', 32], ['2606:4700::', 32], ['2803:f800::', 32], ['2405:b500::', 32], ['2405:8100::', 32], ['2a06:98c0::', 29], ['2c0f:f248::', 32]];
V6.forEach(([a, p]) => CF.addSubnet(a, p, 'ipv6'));
const norm = (a) => String(a || '').trim().replace(/^::ffff:/i, '');
function isLoopback(a) {
    const t = net.isIP(a);
    if (t === 4)
        return /^127\./.test(a);
    if (t === 6)
        return a.toLowerCase() === '::1';
    return false;
}
function isPrivate(a) {
    const t = net.isIP(a);
    if (t === 4)
        return /^(10\.|127\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a);
    if (t === 6) {
        const l = a.toLowerCase();
        return l === '::1' || l.startsWith('fc') || l.startsWith('fd') || l.startsWith('fe80');
    }
    return false;
}
function fillList(list, entries, onSpecial) {
    const bad = [];
    for (const raw of entries) {
        if (onSpecial && onSpecial(raw))
            continue;
        const [addr, bits] = raw.split('/');
        const t = net.isIP(norm(addr));
        const max = t === 4 ? 32 : 128;
        const n = bits === undefined ? max : Number(bits);
        if (!t || !Number.isInteger(n) || n < 0 || n > max) {
            bad.push(raw);
            continue;
        }
        try {
            if (bits === undefined)
                list.addAddress(norm(addr), t === 4 ? 'ipv4' : 'ipv6');
            else
                list.addSubnet(norm(addr), n, t === 4 ? 'ipv4' : 'ipv6');
        }
        catch {
            bad.push(raw);
        }
    }
    return bad;
}
const TRUSTED = new net.BlockList();
let trustPrivate = false;
const badEntries = fillList(TRUSTED, config_1.config.trustedProxies, (raw) => { if (raw === 'private') {
    trustPrivate = true;
    return true;
} return false; });
const badTrustedProxyEntries = () => badEntries.slice();
exports.badTrustedProxyEntries = badTrustedProxyEntries;
const ADMIN = new net.BlockList();
const badAdminEntries = fillList(ADMIN, config_1.config.adminIps);
const badAdminIpEntries = () => badAdminEntries.slice();
exports.badAdminIpEntries = badAdminIpEntries;
const trustedHop = (a) => {
    const t = net.isIP(a);
    if (t === 0)
        return false;
    const fam = t === 4 ? 'ipv4' : 'ipv6';
    return isLoopback(a) || (trustPrivate && isPrivate(a)) || CF.check(a, fam) || TRUSTED.check(a, fam);
};
exports.trustedHop = trustedHop;
const sockIp = (req) => norm(req.socket && req.socket.remoteAddress);
function clientIp(req) {
    const sock = sockIp(req);
    if (trustedHop(sock)) {
        if (config_1.config.behindCloudflare) {
            const h = norm(req.headers['cf-connecting-ip']);
            if (net.isIP(h))
                return h;
        }
        if (config_1.config.trustProxy > 0 && typeof req.headers['x-forwarded-for'] === 'string') {
            const parts = req.headers['x-forwarded-for'].split(',').map(norm).filter(Boolean);
            const ip = parts[Math.max(0, parts.length - config_1.config.trustProxy)] || '';
            if (net.isIP(ip))
                return ip;
        }
    }
    return sock || '0.0.0.0';
}
function ensureIp(req) {
    if (!req.ip)
        Object.defineProperty(req, 'ip', { value: clientIp(req), configurable: true, enumerable: true });
    return req.ip;
}
function isSecure(req) {
    if (req.socket && req.socket.encrypted)
        return true;
    if (!trustedHop(sockIp(req)))
        return false;
    const xfp = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
    if (xfp === 'https')
        return true;
    if (config_1.config.behindCloudflare) {
        try {
            return JSON.parse(String(req.headers['cf-visitor'] || '{}')).scheme === 'https';
        }
        catch {
            return false;
        }
    }
    return false;
}
function hostAllowed(hostIn, req) {
    const host = String(hostIn || '').toLowerCase();
    if (!host)
        return false;
    if (config_1.config.allowedHosts.includes(host))
        return true;
    return host === String(req.headers.host || '').toLowerCase();
}
function adminIpOk(req) {
    if (!config_1.config.adminIps.length)
        return true;
    const ip = norm(clientIp(req));
    const t = net.isIP(ip);
    return t !== 0 && ADMIN.check(ip, t === 4 ? 'ipv4' : 'ipv6');
}
