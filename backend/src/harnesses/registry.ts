import { createCodexAdapter } from "./codex/codexAdapter.js";
import type { HarnessAdapter } from "./types.js";
import type { HarnessType } from "../types.js";

export type HarnessRegistry = Map<HarnessType, HarnessAdapter>;

export function createHarnessRegistry(): HarnessRegistry {
  const codex = createCodexAdapter();
  return new Map([[codex.type, codex]]);
}

export async function startHarnessRegistry(registry: HarnessRegistry): Promise<void> {
  await Promise.all(Array.from(registry.values(), (adapter) => adapter.start?.()));
}

export async function closeHarnessRegistry(registry: HarnessRegistry): Promise<void> {
  await Promise.allSettled(Array.from(registry.values(), (adapter) => adapter.close?.()));
}
