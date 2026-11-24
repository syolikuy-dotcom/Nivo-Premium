"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.withLock = withLock;
const singleton_1 = require("./singleton");
const tails = (0, singleton_1.once)('locks.tails', () => new Map());
async function withLock(key, fn) {
    const prev = tails.get(key) || Promise.resolve();
    let release;
    const gate = new Promise((r) => { release = r; });
    const chain = prev.then(() => gate);
    tails.set(key, chain);
    await prev;
    try {
        return await fn();
    }
    finally {
        release();
        if (tails.get(key) === chain)
            tails.delete(key);
    }
}
