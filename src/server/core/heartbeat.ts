import { once } from './singleton';

const hb = once('worker.heartbeat', () => ({ startedAt: 0, lastTickAt: 0 }));
export const markStarted = (): void => { hb.startedAt = Date.now(); hb.lastTickAt = Date.now(); };
export const beat = (): void => { hb.lastTickAt = Date.now(); };
export const get = (maxAgeMs = 120e3): { started: boolean; lastTickAt: number | null; stale: boolean } => ({
  started: hb.startedAt > 0, lastTickAt: hb.lastTickAt || null, stale: hb.startedAt > 0 && Date.now() - hb.lastTickAt > maxAgeMs,
});
