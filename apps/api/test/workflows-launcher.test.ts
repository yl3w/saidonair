import { describe, expect, it } from "vitest";
import {
  createdInstances,
  foldStatus,
  type IngestParams,
  ingestLauncher,
  realLauncher,
  resetWorkflowFake,
} from "../src/lib/workflows";

const params = (attemptId: string, k = 0): IngestParams => ({
  attemptId,
  episodeId: "aaaaaaaaaaa",
  channelId: "UCAAAAAAAAAAAAAAAAAAAAAA",
  startDelaySec: k * 3,
});

describe("foldStatus", () => {
  it("folds the engine's statuses into active, gone, or missing", () => {
    for (const s of [
      "queued",
      "running",
      "paused",
      "waiting",
      "waitingForPause",
    ] as const) {
      expect(foldStatus(s)).toBe("active");
    }
    for (const s of ["complete", "errored", "terminated"] as const)
      expect(foldStatus(s)).toBe("gone");
    expect(foldStatus("unknown")).toBe("missing");
  });
});

describe("the launcher fake", () => {
  it("records creates, answers the default or a named status, and can refuse a create", async () => {
    const launcher = ingestLauncher({
      WORKFLOW_FAKE: JSON.stringify({
        default: "active",
        instances: { done: "gone", lost: "missing" },
        createThrows: ["boom", "bbbbbbbbbbb"],
      }),
    });
    await launcher.create(params("a1"));
    await launcher.create(params("a2", 1));
    expect(createdInstances()).toEqual([params("a1"), params("a2", 1)]);
    expect(await launcher.status("a1")).toBe("active");
    expect(await launcher.status("done")).toBe("gone");
    expect(await launcher.status("lost")).toBe("missing");
    await expect(launcher.create(params("boom"))).rejects.toThrow(
      /configured to fail/,
    );
    await expect(
      launcher.create({ ...params("a3"), episodeId: "bbbbbbbbbbb" }),
    ).rejects.toThrow(/configured to fail/);
    expect(createdInstances()).toHaveLength(2);
    resetWorkflowFake();
    expect(createdInstances()).toEqual([]);
  });

  it("requires a binding or the fake", () => {
    expect(() => ingestLauncher({})).toThrow(/INGEST_WORKFLOW binding/);
  });
});

describe("the launcher over a binding", () => {
  it("creates the instance under the attempt id and folds its status; a missing instance is missing", async () => {
    const calls: unknown[] = [];
    const statuses: Record<string, string> = { a1: "running", a2: "complete" };
    const stub = {
      async create(options: { id: string; params: IngestParams }) {
        calls.push(options);
        return { id: options.id };
      },
      async get(id: string) {
        const status = statuses[id];
        if (!status) throw new Error("instance.not_found");
        return {
          id,
          async status() {
            return { status };
          },
        };
      },
    } as unknown as Workflow<IngestParams>;
    const launcher = realLauncher(stub);
    await launcher.create(params("a1"));
    expect(calls).toEqual([{ id: "a1", params: params("a1") }]);
    expect(await launcher.status("a1")).toBe("active");
    expect(await launcher.status("a2")).toBe("gone");
    expect(await launcher.status("nope")).toBe("missing");
  });
});
