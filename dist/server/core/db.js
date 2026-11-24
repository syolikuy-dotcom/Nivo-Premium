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
exports.one = exports.query = exports.pool = void 0;
exports.tx = tx;
const mysql = __importStar(require("mysql2/promise"));
const config_1 = require("./config");
const singleton_1 = require("./singleton");
exports.pool = (0, singleton_1.once)('db.pool', () => {
    const p = mysql.createPool({
        host: config_1.config.db.host, port: config_1.config.db.port, user: config_1.config.db.user, password: config_1.config.db.password, database: config_1.config.db.database,
        waitForConnections: true, connectionLimit: config_1.config.db.pool, queueLimit: 200,
        charset: 'utf8mb4', timezone: 'Z', supportBigNumbers: true, bigNumberStrings: false,
        connectTimeout: 10000, enableKeepAlive: true, keepAliveInitialDelay: 10000, multipleStatements: false,
        ssl: config_1.config.db.ssl ? { rejectUnauthorized: config_1.config.db.sslVerify, minVersion: 'TLSv1.2', ...(config_1.config.db.sslCa ? { ca: config_1.config.db.sslCa } : {}) } : undefined,
    });
    p.pool.on('connection', (c) => { c.query("SET time_zone='+00:00'"); });
    return p;
});
const wrap = (conn) => ({
    async query(sql, params) { const [r] = await conn.query(sql, params); return r; },
    async one(sql, params) { const [r] = await conn.query(sql, params); return Array.isArray(r) ? (r[0] || null) : null; },
});
const base = wrap(exports.pool);
exports.query = base.query;
exports.one = base.one;
const TX_ATTEMPTS = 5;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function tx(fn) {
    for (let attempt = 1;; attempt++) {
        const conn = await exports.pool.getConnection();
        try {
            await conn.beginTransaction();
            const out = await fn(wrap(conn));
            await conn.commit();
            return out;
        }
        catch (e) {
            try {
                await conn.rollback();
            }
            catch { }
            if (e && e.code === 'ER_LOCK_DEADLOCK' && attempt < TX_ATTEMPTS) {
                await pause(5 * attempt + Math.random() * 25 * attempt);
                continue;
            }
            throw e;
        }
        finally {
            conn.release();
        }
    }
}
