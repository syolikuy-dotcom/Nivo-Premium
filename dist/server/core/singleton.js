"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.once = once;
function once(name, init) {
    const k = Symbol.for(`nivo:${name}`);
    const g = globalThis;
    if (!(k in g))
        g[k] = init();
    return g[k];
}
