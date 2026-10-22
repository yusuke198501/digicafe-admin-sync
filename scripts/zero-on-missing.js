// Fixed labels only: do not leak request configs, responses or credentials.
export function valueOrDefault(label, read, fallback, warn = console.warn) {
  try { return read(); }
  catch { warn(`WARNING: ${label} を取得できないため代替値で継続します。`); return fallback; }
}
export function numberOrZero(label, read, warn = console.warn) {
  return valueOrDefault(label, () => {
    const value = read();
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error('Invalid metric');
    return value;
  }, 0, warn);
}
export async function requestOrNull(label, read, warn = console.warn) {
  try { return await read(); }
  catch { warn(`WARNING: ${label} の取得に失敗。該当する集計値は0で継続します。`); return null; }
}
