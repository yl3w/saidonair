import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { app } from "../src/index";
import { SCALAR_CDN } from "../src/routes/docs";

type Operation = {
  tags?: string[];
  security?: unknown[];
  responses: Record<string, unknown>;
};
type Document = {
  openapi: string;
  info: { title: string };
  tags?: { name: string }[];
  paths: Record<string, Record<string, Operation>>;
  components: {
    schemas: Record<string, unknown>;
    securitySchemes: Record<string, unknown>;
  };
};

/** Hidden from the document on purpose: the document itself and the page that renders it. */
const HIDDEN = new Set(["/openapi.json", "/docs"]);

/**
 * Public by necessity. `/health` touches no storage; the three `/session/*` routes are how a caller
 * *obtains* a token, so none of them can require one (docs/specs/auth-phase.md §4.5). better-auth's
 * own `/auth/*` is the document's one declared exclusion — it carries `hide`, so it never appears
 * here at all. These may still answer 401: `/session/exchange` refuses a spent code with one.
 */
const PUBLIC_BY_NECESSITY = new Set([
  "get /health",
  "get /session/start",
  "get /session/handoff",
  "post /session/exchange",
]);

/**
 * Public by decision, 2026-09-21 (docs/specs/route-visibility.md §3): the catalog and the summaries
 * can be read before joining. Unlike the four above, a missing session is not an error on these at
 * all, so they keep their 400 and lose their 401 (§4.5).
 *
 * Keyed by method and path, not path alone: `/channels` now holds a public `get` beside a guarded
 * `post`, and a path-keyed set would demand `security: []` of the write too.
 */
const PUBLIC_READS = new Set([
  "get /channels",
  "get /channels/{id}",
  "get /channels/{id}/episodes",
  "get /channels/{id}/episodes/{episodeId}",
  "get /episodes/{episodeId}",
]);

const PUBLIC = new Set([...PUBLIC_BY_NECESSITY, ...PUBLIC_READS]);

/**
 * Every operation registered so far, as docs/specs/api-reference.md §3.3 lists it. Adding or removing
 * a route is a deliberate edit here, and a PRD row that never registered is visible.
 */
const OPERATIONS = [
  "get /health",
  "get /me",
  "get /session/start",
  "get /session/handoff",
  "post /session/exchange",
  "get /catalog",
  "get /channels",
  "post /channels",
  "get /channels/feed",
  "get /channels/{id}",
  "post /channels/{id}/request",
  "post /channels/{id}/approve",
  "post /channels/{id}/decline",
  "post /channels/{id}/pause",
  "post /channels/{id}/resume",
  "get /channels/{id}/followers",
  "get /channels/{id}/episodes",
  "get /channels/{id}/episodes/{episodeId}",
  "post /channels/{id}/episodes/{episodeId}/read",
  "delete /channels/{id}/episodes/{episodeId}/read",
  "post /channels/{id}/episodes/{episodeId}/retry",
  "post /channels/{id}/episodes/{episodeId}/skip",
  "get /episodes/{episodeId}",
  "get /channels/{id}/runs",
  "post /channels/{id}/runs",
  "get /follows",
  "put /follows/{channelId}",
  "delete /follows/{channelId}",
  "get /digest",
  "post /chats",
  "get /chats",
  "get /chats/{chatId}/messages",
  "post /chats/{chatId}/messages",
  "get /preferences",
  "put /preferences",
].sort();
const METHODS = new Set(["GET", "POST", "PUT", "DELETE", "PATCH"]);

/** Hono's `/:id` is OpenAPI's `/{id}`. */
const documentedPath = (path: string) => path.replace(/:(\w+)/g, "{$1}");

async function fetchDocument(): Promise<Document> {
  const response = await SELF.fetch("http://api/openapi.json");
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("application/json");
  return (await response.json()) as Document;
}

describe("GET /openapi.json", () => {
  it("is public and describes every registered route, and nothing else", async () => {
    const doc = await fetchDocument();
    expect(doc.openapi.startsWith("3.1")).toBe(true);

    // Every handler and middleware registration is a route entry; the Set collapses them per operation.
    const registered = new Set(
      app.routes
        .filter((route) => METHODS.has(route.method) && !HIDDEN.has(route.path))
        .map(
          (route) =>
            `${route.method.toLowerCase()} ${documentedPath(route.path)}`,
        ),
    );
    const documented = new Set(
      Object.entries(doc.paths).flatMap(([path, operations]) =>
        Object.keys(operations).map((method) => `${method} ${path}`),
      ),
    );
    expect([...documented].sort()).toEqual([...registered].sort());
    expect([...registered].sort()).toEqual(OPERATIONS);
  });

  it("is titled after the product and names the run collection `runs`", async () => {
    const doc = await fetchDocument();
    expect(doc.info.title).toBe("Said on Air API");
    expect(doc.paths["/channels/{id}/runs"]).toHaveProperty("get");
    for (const path of Object.keys(doc.paths)) {
      expect(path).not.toContain("ingestion-runs");
    }
    // Every declared tag is in use, and every used tag is declared: an empty group in Scalar is noise.
    const declared = (doc.tags ?? []).map((tag) => tag.name).sort();
    const used = [
      ...new Set(
        Object.values(doc.paths).flatMap((operations) =>
          Object.values(operations).flatMap(
            (operation) => operation.tags ?? [],
          ),
        ),
      ),
    ].sort();
    expect(declared).toEqual(used);
    // POST /channels verifies the id against YouTube's feed, so it can answer 502.
    expect(
      Object.keys(doc.paths["/channels"]?.post?.responses ?? {}),
    ).toContain("502");
  });

  it("documents 403 on the nine owner operations and nowhere else", async () => {
    const doc = await fetchDocument();
    // The owner surface, listed rather than counted: a route that starts or stops requiring the
    // owner is a deliberate edit here, exactly as OPERATIONS makes a new route one. The seven that
    // change the catalog joined in A8; the two reads on 2026-09-21 (docs/specs/route-visibility.md
    // §4.4) — an operations dashboard, and one reader's view of another reader's address.
    const OWNER_ONLY = new Set([
      "get /catalog",
      "post /channels/{id}/approve",
      "post /channels/{id}/decline",
      "post /channels/{id}/pause",
      "post /channels/{id}/resume",
      "post /channels/{id}/runs",
      "get /channels/{id}/followers",
      "post /channels/{id}/episodes/{episodeId}/retry",
      "post /channels/{id}/episodes/{episodeId}/skip",
    ]);
    const documented = new Set<string>();
    for (const [path, operations] of Object.entries(doc.paths)) {
      for (const [method, operation] of Object.entries(operations)) {
        if (Object.keys(operation.responses).includes("403")) {
          documented.add(`${method} ${path}`);
        }
      }
    }
    expect([...documented].sort()).toEqual([...OWNER_ONLY].sort());
    // UNAUTHENTICATED joined in A7, when a caller began having to prove who they are, and
    // FORBIDDEN in A8, when being someone stopped being the same as being allowed.
    expect(doc.components.schemas.ErrorCode).toMatchObject({
      enum: [
        "UNAUTHENTICATED",
        "FORBIDDEN",
        "INVALID_INPUT",
        "NOT_FOUND",
        "INVALID_STATE",
        "UPSTREAM_UNAVAILABLE",
      ],
    });
  });

  /**
   * PRD §8 bullet 13: "each route's responses parse against the shared schemas, so the document and
   * the Worker cannot disagree about a shape." Route tests check that one response at a time with
   * `expectShape`, and **which routes that leaves out was nobody's list** — the gap the M6 sweep
   * found (docs/specs/m6-hardening.md §6, G4). Every other list in this file is enumerated from the
   * router rather than kept by hand; this one was not kept at all.
   *
   * So: every success body is declared from a schema in `packages/shared`, and the document shows
   * it by referencing that schema's component. A route that invents an entity shape inline — the
   * drift this criterion exists to catch — appears here as a new name in `FLAT`, which is an edit
   * somebody has to justify rather than a silence.
   */
  it("builds every success body from the shared schemas, with two flat exceptions", async () => {
    const doc = await fetchDocument();

    // The two whose shared schema has no member worth a component of its own: `HealthResponse` is
    // a status string, `SessionExchangeResponse` is the token. Both still come from the shared
    // package — they are flat, not ad-hoc.
    const FLAT = new Set(["get /health", "post /session/exchange"]);
    // The two that answer only 302: a redirect has no body to shape (they are `/session/start`
    // and `/session/handoff`, and the success-response check above already allows their 3xx).
    const REDIRECT_ONLY = new Set([
      "get /session/start",
      "get /session/handoff",
    ]);

    const referencing: string[] = [];
    const flat: string[] = [];
    const bodiless: string[] = [];

    for (const [path, operations] of Object.entries(doc.paths)) {
      for (const [method, operation] of Object.entries(operations)) {
        const where = `${method} ${path}`;
        const success = Object.entries(operation.responses).find(([status]) =>
          /^2/.test(status),
        );
        const schema = (
          success?.[1] as
            | { content?: { "application/json"?: { schema?: unknown } } }
            | undefined
        )?.content?.["application/json"]?.schema;
        if (schema === undefined) {
          bodiless.push(where);
        } else if (JSON.stringify(schema).includes('"$ref"')) {
          referencing.push(where);
        } else {
          flat.push(where);
        }
      }
    }

    expect(new Set(bodiless)).toEqual(REDIRECT_ONLY);
    expect(new Set(flat)).toEqual(FLAT);
    // Everything else — every operation that returns an entity — names a shared component.
    expect(referencing.length).toBe(
      Object.values(doc.paths).reduce(
        (total, operations) => total + Object.keys(operations).length,
        0,
      ) -
        FLAT.size -
        REDIRECT_ONLY.size,
    );
    // And each component a success body names is one the shared package declares.
    for (const reference of JSON.stringify(doc.paths).matchAll(
      /#\/components\/schemas\/([A-Za-z0-9_]+)/g,
    )) {
      expect(
        doc.components.schemas,
        `${reference[1]} is declared`,
      ).toHaveProperty(reference[1] as string);
    }
  });

  it("gives every operation one tag, a success response, and the identity requirement", async () => {
    const doc = await fetchDocument();
    for (const [path, operations] of Object.entries(doc.paths)) {
      for (const [method, operation] of Object.entries(operations)) {
        const where = `${method} ${path}`;
        const statuses = Object.keys(operation.responses);
        expect(operation.tags?.length, `${where} has one tag`).toBe(1);
        expect(
          // A redirect is an outcome, not a failure: two of the session routes answer only 302.
          statuses.some((status) => /^[23]/.test(status)),
          `${where} has a success response`,
        ).toBe(true);
        if (PUBLIC.has(where)) {
          expect(operation.security, `${where} is public`).toEqual([]);
        } else {
          // The global `security` applies; the header can always be missing.
          expect(
            operation.security,
            `${where} uses the default`,
          ).toBeUndefined();
          expect(statuses, `${where} documents 400`).toContain("400");
          expect(statuses, `${where} documents 401`).toContain("401");
        }
        // The five keep their 400 — the input can still be wrong — and lose their 401, because a
        // missing session stopped being a failure on them (docs/specs/route-visibility.md §4.5).
        if (PUBLIC_READS.has(where)) {
          expect(statuses, `${where} documents 400`).toContain("400");
          expect(statuses, `${where} answers no 401`).not.toContain("401");
        }
      }
    }
  });

  it("declares the session scheme and the shared component schemas", async () => {
    const doc = await fetchDocument();
    expect(doc.components.securitySchemes.session).toEqual({
      type: "http",
      scheme: "bearer",
      description: expect.any(String),
    });
    // Zod extracts the schemas an operation's body refers to; the body's own root stays inline. So
    // the entities are components and the response envelopes and ErrorResponse are not.
    for (const name of [
      "ErrorCode",
      "Channel",
      "ChannelManagement",
      "EpisodeCounts",
      "Episode",
      "EpisodeSummary",
      "Takeaway",
      "EpisodeWaitReason",
      "AttemptOutcomeCode",
      "ProcessingIntent",
      "EpisodeIngestionAttempt",
      "EpisodeProcessing",
      "IngestionRun",
      "Follow",
      "Follower",
      "ChannelFeed",
      "Preferences",
      "DigestRow",
      "DigestEpisodesResponse",
      "DigestRowsResponse",
      "Catalog",
      "TranscriptProviderHealth",
    ]) {
      expect(doc.components.schemas, name).toHaveProperty(name);
    }
    // Zod emits `$defs`; hono-openapi lifts them into components. A leftover ref would not resolve.
    expect(JSON.stringify(doc)).not.toContain("#/$defs/");
  });
});

describe("the 2026-09-12 restart", () => {
  type Component = { enum?: string[]; properties?: Record<string, unknown> };
  const component = (doc: Document, name: string) =>
    doc.components.schemas[name] as Component | undefined;

  it("carries no removed member (docs/specs/api-reference.md §5.11)", async () => {
    const doc = await fetchDocument();
    for (const gone of [
      "EpisodeWaitingCode",
      "IngestionRunStatus",
      "IngestionRunEpisode",
      "IngestionRunEpisodeStatus",
      "IngestionRunSummary",
      "ChannelRequest",
      "RequestOutcome",
      "FollowOrigin",
      "CatalogState",
      "ChannelFailureCode",
      "ChannelAlreadyAvailableResponse",
      // Renamed to ProcessingIntent / intent / window* on 2026-09-12.
      "RecoveryMode",
    ]) {
      expect(doc.components.schemas, gone).not.toHaveProperty(gone);
    }
    expect(component(doc, "EpisodeSkipReason")?.enum).toEqual([
      "SHORT",
      "NON_ENGLISH",
      "UNPLAYABLE",
      "OWNER",
    ]);
    expect(component(doc, "IngestionRunKind")?.enum).toEqual([
      "initial",
      "scheduled",
    ]);
    // Fourteen since LIVE_OR_UPCOMING was retired on 2026-09-14.
    expect(component(doc, "AttemptOutcomeCode")?.enum).toHaveLength(14);
    expect(component(doc, "AttemptOutcomeCode")?.enum).not.toContain(
      "LIVE_OR_UPCOMING",
    );
    expect(component(doc, "EpisodeWaitReason")?.enum).toEqual([
      "CAPTIONS",
      "PROVIDER_LIMIT",
    ]);
    const properties = (name: string) =>
      Object.keys(component(doc, name)?.properties ?? {});
    expect(properties("EpisodeCounts")).toEqual([
      "available",
      "pending",
      "failed",
      "skipped",
    ]);
    expect(properties("EpisodeProcessing")).not.toContain("waitingCode");
    expect(properties("EpisodeProcessing")).not.toContain("processedAt");
    expect(properties("ChannelManagement")).not.toContain("episodes");
    for (const gone of [
      "status",
      "workflowId",
      "failureCode",
      "failureDetail",
      "episodes",
    ]) {
      expect(properties("IngestionRun"), gone).not.toContain(gone);
    }
    expect(properties("Catalog")).not.toContain("runs");
    expect(properties("Episode")).toEqual(
      expect.arrayContaining([
        "waitReason",
        "summaryAvailableAt",
        "read",
        "processing",
      ]),
    );
    // Renamed on 2026-09-15: the field describes the row, not the request that fetched it.
    expect(properties("Episode")).not.toContain("wasUnread");
    expect(component(doc, "ProcessingIntent")?.enum).toEqual([
      "publish",
      "replace",
    ]);
    for (const gone of [
      "recoveryMode",
      "recoveryStartedAt",
      "recoveryDeadlineAt",
    ]) {
      expect(properties("EpisodeProcessing"), gone).not.toContain(gone);
    }
  });
});

describe("GET /docs", () => {
  it("serves the Scalar page publicly, pinned to one script version, without Scalar's proxy", async () => {
    const response = await SELF.fetch("http://api/docs");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    const html = await response.text();
    expect(html).toContain(SCALAR_CDN);
    expect(html).toContain("/openapi.json");
    expect(html).toContain("<title>Said on Air API</title>");
    expect(html).not.toContain("proxy.scalar.com");
  });
});
