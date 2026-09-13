import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import app from "../src/index";
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
    expect(registered.size).toBeGreaterThan(15);
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

  it("gives every operation one tag, a success response, and the identity requirement", async () => {
    const doc = await fetchDocument();
    for (const [path, operations] of Object.entries(doc.paths)) {
      for (const [method, operation] of Object.entries(operations)) {
        const where = `${method} ${path}`;
        const statuses = Object.keys(operation.responses);
        expect(operation.tags?.length, `${where} has one tag`).toBe(1);
        expect(
          statuses.some((status) => status.startsWith("2")),
          `${where} has a success response`,
        ).toBe(true);
        if (path === "/health") {
          expect(operation.security, `${where} is public`).toEqual([]);
        } else {
          // The global `security` applies; the header can always be missing.
          expect(
            operation.security,
            `${where} uses the default`,
          ).toBeUndefined();
          expect(statuses, `${where} documents 400`).toContain("400");
        }
      }
    }
  });

  it("declares the identity header and the shared component schemas", async () => {
    const doc = await fetchDocument();
    expect(doc.components.securitySchemes.userEmail).toEqual({
      type: "apiKey",
      in: "header",
      name: "X-User-Email",
      description: expect.any(String),
    });
    // Zod extracts the schemas an operation's body refers to; the body's own root stays inline. So
    // the entities are components and the response envelopes and ErrorResponse are not.
    for (const name of [
      "Channel",
      "ChannelManagement",
      "Episode",
      "EpisodeSummary",
      "Follow",
      "Follower",
      "Catalog",
      "IngestionRun",
    ]) {
      expect(doc.components.schemas, name).toHaveProperty(name);
    }
    // Zod emits `$defs`; hono-openapi lifts them into components. A leftover ref would not resolve.
    expect(JSON.stringify(doc)).not.toContain("#/$defs/");
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
