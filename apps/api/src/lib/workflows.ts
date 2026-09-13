/**
 * The one path to the `INGEST_WORKFLOW` binding (AGENTS.md → Ingestion implementation): create one
 * instance per episode attempt, its id the attempt's id, and read an instance's status folded into
 * the three answers reconciliation needs. The test-only `WORKFLOW_FAKE` binding launches nothing,
 * records every `create`, and answers statuses from its options.
 */

export type IngestParams = {
  attemptId: string;
  videoId: string;
  channelId: string;
  /** The k-th attempt of a batch sleeps k × 3 seconds first (docs/PRD.md §4.2 rule 8). */
  startDelaySec: number;
};

/** What the engine's many statuses mean to reconciliation (docs/PRD.md §4.2 rules 15 and 17). */
export type InstanceStatus = "active" | "gone" | "missing";

export type IngestLauncher = {
  create(params: IngestParams): Promise<void>;
  status(attemptId: string): Promise<InstanceStatus>;
};

type EngineStatus = Awaited<ReturnType<WorkflowInstance["status"]>>["status"];

/** Queued, running, paused, or waiting instances are alive; finished ones are gone; the rest unknown. */
export function foldStatus(status: EngineStatus): InstanceStatus {
  switch (status) {
    case "queued":
    case "running":
    case "paused":
    case "waiting":
    case "waitingForPause":
      return "active";
    case "complete":
    case "errored":
    case "terminated":
      return "gone";
    default:
      return "missing";
  }
}

export function ingestLauncher(env: {
  INGEST_WORKFLOW?: Workflow<IngestParams>;
  WORKFLOW_FAKE?: string;
}): IngestLauncher {
  if (env.WORKFLOW_FAKE !== undefined)
    return fakeLauncher(parseFakeOptions(env.WORKFLOW_FAKE));
  if (!env.INGEST_WORKFLOW)
    throw new Error("INGEST_WORKFLOW binding is not configured");
  return realLauncher(env.INGEST_WORKFLOW);
}

/** The launcher over a binding. Exported so tests can drive it with a stub. */
export function realLauncher(binding: Workflow<IngestParams>): IngestLauncher {
  return {
    async create(params) {
      await binding.create({ id: params.attemptId, params });
    },
    async status(attemptId) {
      try {
        const instance = await binding.get(attemptId);
        return foldStatus((await instance.status()).status);
      } catch {
        // The engine has no such instance (or cannot say): to reconciliation that is "missing".
        return "missing";
      }
    },
  };
}

// --- the fake (WORKFLOW_FAKE) -------------------------------------------------------------------

type FakeOptions = {
  /** The status of any instance not named in `instances`. */
  default: InstanceStatus;
  /** Statuses by attempt id. */
  instances: Record<string, InstanceStatus>;
  /** Attempt ids or video ids whose `create` throws, for the WORKFLOW_LOST path. */
  createThrows: string[];
};

const created: IngestParams[] = [];

/** Every `create` the fake accepted since the last reset, in order. */
export function createdInstances(): IngestParams[] {
  return [...created];
}

export function resetWorkflowFake(): void {
  created.length = 0;
}

function parseFakeOptions(raw: string): FakeOptions {
  const value = JSON.parse(raw) as Partial<FakeOptions> | null;
  return {
    default: value?.default ?? "active",
    instances: value?.instances ?? {},
    createThrows: value?.createThrows ?? [],
  };
}

function fakeLauncher(options: FakeOptions): IngestLauncher {
  return {
    async create(params) {
      if (
        options.createThrows.includes(params.attemptId) ||
        options.createThrows.includes(params.videoId)
      ) {
        throw new Error("workflow fake: create is configured to fail");
      }
      created.push({ ...params });
    },
    async status(attemptId) {
      return options.instances[attemptId] ?? options.default;
    },
  };
}
