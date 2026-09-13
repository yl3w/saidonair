import type { WorkflowStepConfig } from "cloudflare:workers";
import type { StepLike } from "../src/workflows/ingest";

/**
 * An inline step runner for the ingest pipeline: runs each `do` at once, re-invoking the callback on a
 * throw up to the step's `retries.limit`, records every step and every sleep, and never waits. Tests
 * assert which steps ran, how often, and what the pipeline slept for.
 */
export type FakeStep = StepLike & {
  calls: { name: string; attempts: number }[];
  sleeps: { name: string; seconds: number }[];
};

export function fakeStep(): FakeStep {
  const calls: FakeStep["calls"] = [];
  const sleeps: FakeStep["sleeps"] = [];
  return {
    calls,
    sleeps,
    async do<T>(
      name: string,
      config: WorkflowStepConfig,
      fn: () => Promise<T>,
    ): Promise<T> {
      const limit = config.retries?.limit ?? 0;
      for (let attempt = 1; ; attempt++) {
        try {
          const value = await fn();
          calls.push({ name, attempts: attempt });
          return value;
        } catch (error) {
          if (attempt > limit) {
            calls.push({ name, attempts: attempt });
            throw error;
          }
        }
      }
    },
    async sleep(name, seconds) {
      sleeps.push({ name, seconds });
    },
  };
}

/** The names of the steps that ran, in order. */
export function stepNames(step: FakeStep): string[] {
  return step.calls.map((call) => call.name);
}
