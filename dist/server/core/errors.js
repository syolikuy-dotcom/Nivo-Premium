"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isDup = exports.AppError = void 0;
class AppError extends Error {
    status;
    code;
    constructor(status, code, message) { super(message); this.name = 'AppError'; this.status = status; this.code = code; }
}
exports.AppError = AppError;
const isDup = (e, key) => Boolean(e && e.code === 'ER_DUP_ENTRY' && (!key || String(e.sqlMessage || '').includes(key)));
exports.isDup = isDup;
