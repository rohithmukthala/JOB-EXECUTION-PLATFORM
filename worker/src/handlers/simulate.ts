export interface SimulatePayload { steps?: number; stepMs?: number; failRate?: number; }
export async function simulate(
  payload: SimulatePayload,
  ctx: { progress: (p: number) => Promise<void> },
) {
  const steps = payload.steps ?? 10;
  const stepMs = payload.stepMs ?? 500;
  const failRate = payload.failRate ?? 0;
  for (let i = 1; i <= steps; i++) {
    await new Promise((r) => setTimeout(r, stepMs));
    if (Math.random() < failRate) throw new Error(`simulated failure at step ${i}`);
    await ctx.progress(Math.round((i / steps) * 100));
  }
  return { steps, completedAt: new Date().toISOString() };
}
