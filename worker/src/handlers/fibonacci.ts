export interface FibPayload { n?: number; }
export async function fibonacci(payload: FibPayload, ctx: { progress: (p: number) => Promise<void> }) {
  const n = payload.n ?? 30;
  let a = 0n, b = 1n;
  for (let i = 0; i < n; i++) {
    [a, b] = [b, a + b];
    if (i % Math.max(1, Math.floor(n / 10)) === 0) await ctx.progress(Math.round((i / n) * 100));
  }
  return { n, value: a.toString() };
}
