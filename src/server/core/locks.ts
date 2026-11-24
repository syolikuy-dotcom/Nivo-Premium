import { once } from './singleton';

const tails = once('locks.tails', () => new Map<string, Promise<unknown>>());

export async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = tails.get(key) || Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const chain = prev.then(() => gate);
  tails.set(key, chain);
  await prev;
  try { return await fn(); } finally { release(); if (tails.get(key) === chain) tails.delete(key); }
}
