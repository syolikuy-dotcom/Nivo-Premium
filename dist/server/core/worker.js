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
exports.start = start;
exports.stop = stop;
const db = __importStar(require("./db"));
const log = __importStar(require("./logger"));
const orders = __importStar(require("../shop/orders"));
const deposits = __importStar(require("../shop/deposits"));
const am = __importStar(require("../shop/am"));
const notify = __importStar(require("../shop/notify"));
const monitor = __importStar(require("../shop/monitor"));
const heartbeat = __importStar(require("./heartbeat"));
let timer;
let janitor;
let watcher;
let busy = false;
let busySince = 0;
const HUNG_MS = 5 * 60e3;
const SWEEPS = [['orders', orders.sweep], ['deposits', deposits.sweep], ['am', am.sweep], ['notify', notify.sweep]];
async function tick() {
    if (busy) {
        if (Date.now() - busySince < HUNG_MS)
            return;
        log.error('worker: tick sebelumnya macet >5 menit, dilanjutkan paksa', { menit: Math.round((Date.now() - busySince) / 60e3) });
    }
    busy = true;
    busySince = Date.now();
    const mine = busySince;
    heartbeat.beat();
    for (const [name, fn] of SWEEPS) {
        try {
            await fn();
        }
        catch (e) {
            log.error('worker error', { sweep: name, msg: e.message });
        }
    }
    if (busySince === mine)
        busy = false;
    heartbeat.beat();
}
async function cleanup() {
    try {
        const now = new Date();
        await db.query('DELETE FROM sessions WHERE expires_at < ?', [now]);
        await db.query('DELETE FROM password_resets WHERE expires_at < ?', [new Date(now.getTime() - 864e5)]);
        await db.query('DELETE FROM webhook_events WHERE created_at < ?', [new Date(now.getTime() - 30 * 864e5)]);
        await db.query("DELETE FROM audit_log WHERE created_at < ? AND action IN ('login_failed','twofa_failed')", [new Date(now.getTime() - 90 * 864e5)]);
    }
    catch (e) {
        log.error('cleanup error', { msg: e.message });
    }
}
function start() {
    heartbeat.markStarted();
    timer = setInterval(tick, 10000);
    janitor = setInterval(cleanup, 3600e3);
    watcher = setInterval(() => { monitor.check(); }, 60e3);
    timer.unref();
    janitor.unref();
    watcher.unref();
    setTimeout(tick, 3000).unref();
    setTimeout(cleanup, 5000).unref();
    setTimeout(() => { monitor.check(); }, 20e3).unref();
}
function stop() { clearInterval(timer); clearInterval(janitor); clearInterval(watcher); }
