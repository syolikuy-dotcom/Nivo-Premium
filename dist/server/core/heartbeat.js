"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.get = exports.beat = exports.markStarted = void 0;
const singleton_1 = require("./singleton");
const hb = (0, singleton_1.once)('worker.heartbeat', () => ({ startedAt: 0, lastTickAt: 0 }));
const markStarted = () => { hb.startedAt = Date.now(); hb.lastTickAt = Date.now(); };
exports.markStarted = markStarted;
const beat = () => { hb.lastTickAt = Date.now(); };
exports.beat = beat;
const get = (maxAgeMs = 120e3) => ({
    started: hb.startedAt > 0, lastTickAt: hb.lastTickAt || null, stale: hb.startedAt > 0 && Date.now() - hb.lastTickAt > maxAgeMs,
});
exports.get = get;
