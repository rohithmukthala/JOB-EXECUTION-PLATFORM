import { simulate } from "./simulate.js";
import { fibonacci } from "./fibonacci.js";

export type Handler = (payload: any, ctx: { progress: (p: number) => Promise<void> }) => Promise<unknown>;
export const handlers: Record<string, Handler> = { simulate, fibonacci };
