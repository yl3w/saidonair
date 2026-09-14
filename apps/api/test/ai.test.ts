import { describe, expect, it } from "vitest";
import {
  ai,
  EMBEDDING_BATCH,
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL,
  FAKE_INVALID,
  FAKE_INVALID_ONCE,
  FAKE_THROW,
  realClient,
  resetAiFake,
  SUMMARY_MODEL,
} from "../src/lib/ai";
import {
  SUMMARY_RESPONSE_SCHEMA,
  SYNTHESIS_RESPONSE_SCHEMA,
} from "../src/lib/summary";
import {
  mapPrompt,
  PROMPT_VERSION,
  STRICTER_RETRY_SUFFIX,
  synthesisPrompt,
} from "../src/prompts/summary";

const fake = () => ai({ AI_FAKE: "{}" });

/** A stub binding answering canned outputs and recording what it was asked. */
function stub(answer: (model: string, inputs: unknown) => unknown) {
  const calls: { model: string; inputs: unknown }[] = [];
  const binding = {
    async run(model: string, inputs: unknown) {
      calls.push({ model, inputs });
      return answer(model, inputs);
    },
  } as unknown as Ai;
  return { binding, calls };
}

describe("the Workers AI fake", () => {
  it("embeds deterministically into unit vectors of the right width", async () => {
    const [a, b, c] = await fake().embed(["hello", "hello", "world"]);
    expect(a).toHaveLength(EMBEDDING_DIMENSIONS);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
    const norm = Math.sqrt((a ?? []).reduce((sum, v) => sum + v * v, 0));
    expect(norm).toBeCloseTo(1, 6);
  });

  it("answers canned JSON whose takeaways reuse the prompt's markers, and obeys the failure markers", async () => {
    const client = fake();
    const prompt = mapPrompt(
      "[0:00:05] first\n[0:01:10] second\n[0:02:00] third\n[0:03:00] fourth",
    );
    const parsed = JSON.parse(await client.summarizeSection(prompt)) as {
      takeaways: { at: string | null }[];
      topicTags: string[];
    };
    expect(parsed.takeaways.map((t) => t.at)).toEqual([
      "0:00:05",
      "0:01:10",
      "0:02:00",
    ]);
    expect(parsed.topicTags).toEqual(["canned", "test"]);

    // Invalid once: the first answer to that prompt is not JSON, the second is; a reset forgets it.
    const once = `${prompt} ${FAKE_INVALID_ONCE}`;
    const first = await client.summarizeSection(once);
    const second = await client.summarizeSection(once);
    expect(() => JSON.parse(first)).toThrow();
    expect(() => JSON.parse(second)).not.toThrow();
    resetAiFake();
    const third = await client.summarizeSection(once);
    expect(() => JSON.parse(third)).toThrow();

    // Invalid always, and a failure.
    const never = await client.synthesise(`${prompt} ${FAKE_INVALID}`);
    expect(() => JSON.parse(never)).toThrow();
    await expect(
      client.summarizeSection(`${prompt} ${FAKE_THROW}`),
    ).rejects.toThrow(/SUMMARY_FAILED/);
  });
});

describe("the Workers AI client", () => {
  it("sends texts to the embedding model and checks the vectors' width", async () => {
    const good = stub(() => ({
      shape: [2, EMBEDDING_DIMENSIONS],
      data: [fill(0.1), fill(0.2)],
    }));
    const vectors = await realClient(good.binding).embed(["a", "b"]);
    expect(vectors).toHaveLength(2);
    expect(good.calls[0]).toEqual({
      model: EMBEDDING_MODEL,
      inputs: { text: ["a", "b"] },
    });

    const narrow = stub(() => ({ data: [fill(0.1, 512)] }));
    await expect(realClient(narrow.binding).embed(["a"])).rejects.toThrow(
      /EMBEDDING_FAILED/,
    );
    const short = stub(() => ({ data: [fill(0.1)] }));
    await expect(realClient(short.binding).embed(["a", "b"])).rejects.toThrow(
      /EMBEDDING_FAILED/,
    );
    const nan = stub(() => ({ data: [fill(Number.NaN)] }));
    await expect(realClient(nan.binding).embed(["a"])).rejects.toThrow(
      /EMBEDDING_FAILED/,
    );
  });

  it("refuses an empty batch or more than the batch size before calling the binding", async () => {
    const s = stub(() => ({ data: [] }));
    await expect(realClient(s.binding).embed([])).rejects.toThrow(
      /EMBEDDING_FAILED/,
    );
    await expect(
      realClient(s.binding).embed(
        Array.from({ length: EMBEDDING_BATCH + 1 }, () => "x"),
      ),
    ).rejects.toThrow(/EMBEDDING_FAILED/);
    expect(s.calls).toHaveLength(0);
  });

  it("asks both summary calls for JSON against the schema and returns the answer as text", async () => {
    const s = stub(() => ({ response: '{"ok":true}' }));
    const client = realClient(s.binding);
    expect(await client.summarizeSection("map me")).toBe('{"ok":true}');
    expect(await client.synthesise("synthesise me")).toBe('{"ok":true}');
    expect(s.calls.map((c) => c.model)).toEqual([SUMMARY_MODEL, SUMMARY_MODEL]);
    // Each call carries its own schema: the synthesis one admits no takeaways at all.
    expect(s.calls[0]?.inputs).toMatchObject({
      response_format: {
        type: "json_schema",
        json_schema: SUMMARY_RESPONSE_SCHEMA,
      },
    });
    expect(s.calls[1]?.inputs).toMatchObject({
      response_format: {
        type: "json_schema",
        json_schema: SYNTHESIS_RESPONSE_SCHEMA,
      },
    });
    expect(s.calls[0]?.inputs).toMatchObject({
      messages: [{ role: "user", content: "map me" }],
    });

    // JSON mode answers a parsed object; the wrapper's contract stays text, so parseSummary is unchanged.
    const object = stub(() => ({ response: { executiveSummary: "One." } }));
    expect(await realClient(object.binding).summarizeSection("x")).toBe(
      '{"executiveSummary":"One."}',
    );
    const silent = stub(() => ({ usage: {} }));
    await expect(
      realClient(silent.binding).summarizeSection("x"),
    ).rejects.toThrow(/SUMMARY_FAILED/);
    const empty = stub(() => ({ response: null }));
    await expect(
      realClient(empty.binding).summarizeSection("x"),
    ).rejects.toThrow(/SUMMARY_FAILED/);
  });

  it("requires a binding or the fake", () => {
    expect(() => ai({})).toThrow(/AI binding/);
  });
});

describe("the prompts", () => {
  it("carry the v2 texts, a version, and number the sections for the reduce call", () => {
    expect(PROMPT_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}/);
    // The v1 version is taken; a summary's version names its prompts and its schema together.
    expect(PROMPT_VERSION).not.toBe("2026-09-13");

    const map = mapPrompt("[0:00:01] hello");
    // The owner's persona wording (2026-09-14): a transcript, and neither podcast nor YouTube.
    expect(map).toContain(
      "You are an expert editor summarising a transcript of an episode",
    );
    expect(map).toContain("STRICT REQUIREMENTS:");
    expect(map).toContain("Output ONLY a JSON object.");
    expect(map).toContain("must be enclosed in double quotes");
    expect(map).toContain('"takeaways": [{ "text": "…", "at": "[h:mm:ss]" }]');
    expect(map).toContain("3 to 6 objects");
    // v3: the faults measured across the twenty-episode corpus, named in the rules.
    expect(map).toContain('do not begin a sentence with "The conversation"');
    expect(map).toContain("No two takeaways may make the same point");
    expect(map).toContain("a definition of a term the reader could look up");
    expect(map).toContain("one or two words each");
    expect(map).toContain("[h:mm:ss] markers.\n\n[0:00:01] hello");
    // A `//` comment inside the skeleton would be copied into the answer and is not JSON.
    expect(map).not.toContain("//");

    const synth = synthesisPrompt(["{a}", "{b}"], [{ text: "chosen point" }]);
    expect(synth).toContain("consecutive sections of an episode");
    expect(synth).toContain("Section 1:\n{a}\n\nSection 2:\n{b}");
    // Two fields only: choosing takeaways is no longer its job.
    expect(synth).toContain('"topicTags": ["…"]');
    expect(synth).not.toContain('"takeaways"');
    expect(synth).toContain("- chosen point");
    expect(synth).toContain('never write "The key conclusion is"');

    expect(STRICTER_RETRY_SUFFIX).toContain("JSON object only");
    expect(STRICTER_RETRY_SUFFIX).toContain("double quotes");
  });
});

function fill(value: number, length = EMBEDDING_DIMENSIONS): number[] {
  return Array.from({ length }, () => value);
}
