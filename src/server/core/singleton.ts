export function once<T>(name: string, init: () => T): T {
  const k = Symbol.for(`nivo:${name}`);
  const g = globalThis as unknown as Record<symbol, unknown>;
  if (!(k in g)) g[k] = init();
  return g[k] as T;
}
