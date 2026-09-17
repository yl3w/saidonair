import { describe, expect, it } from "vitest";
import {
  ai,
  CHAT_MAX_TOKENS,
  CHAT_MODEL,
  EMBEDDING_BATCH,
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL,
  FAKE_INVALID,
  FAKE_INVALID_ONCE,
  FAKE_IRRELEVANT,
  FAKE_RERANK_THROW,
  FAKE_THROW,
  FAKE_TRUNCATE,
  RERANK_MODEL,
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

describe("chat answers", () => {
  it("answers prose, echoes the question, and reports nothing truncated", async () => {
    const { text, truncated } = await fake().answer(
      "context\nWhat did they say?",
    );
    expect(text).toContain("What did they say?");
    expect(truncated).toBe(false);
  });

  it("drives the truncation and failure paths from prompt markers", async () => {
    const cut = await fake().answer(`a question ${FAKE_TRUNCATE}`);
    expect(cut.truncated).toBe(true);
    expect(cut.text).not.toMatch(/[.!?]$/);

    await expect(fake().answer(`a question ${FAKE_THROW}`)).rejects.toThrow(
      /ANSWER_FAILED/,
    );

    // The JSON-mode markers mean "unparseable JSON"; prose has nothing to parse.
    const invalid = await fake().answer(`a question ${FAKE_INVALID}`);
    expect(invalid.truncated).toBe(false);
  });

  it("asks the chat model with no response_format", async () => {
    const s = stub(() => ({ response: "An answer." }));
    const { text, truncated } = await realClient(s.binding).answer("ask");

    expect(text).toBe("An answer.");
    expect(truncated).toBe(false);
    expect(s.calls[0]?.model).toBe(CHAT_MODEL);
    expect(s.calls[0]?.inputs).toEqual({
      messages: [{ role: "user", content: "ask" }],
      max_tokens: CHAT_MAX_TOKENS,
    });
    expect(s.calls[0]?.inputs).not.toHaveProperty("response_format");
  });

  it("reads truncation from finish_reason, and from the token count when it is absent", async () => {
    // What the runtime actually answers: a full chat.completion (probed 2026-09-16).
    const length = stub(() => ({
      response: "Cut off mid",
      choices: [{ finish_reason: "length" }],
      usage: { completion_tokens: CHAT_MAX_TOKENS },
    }));
    expect((await realClient(length.binding).answer("ask")).truncated).toBe(
      true,
    );

    const stop = stub(() => ({
      response: "Complete.",
      choices: [{ finish_reason: "stop" }],
      usage: { completion_tokens: 12 },
    }));
    expect((await realClient(stop.binding).answer("ask")).truncated).toBe(
      false,
    );

    // The fallback that keeps a dropped finish_reason from reporting every answer complete.
    const noReason = stub(() => ({
      response: "Cut off mid",
      usage: { completion_tokens: CHAT_MAX_TOKENS },
    }));
    expect((await realClient(noReason.binding).answer("ask")).truncated).toBe(
      true,
    );

    const declaredOnly = stub(() => ({
      response: "Complete.",
      usage: { completion_tokens: 12 },
    }));
    expect(
      (await realClient(declaredOnly.binding).answer("ask")).truncated,
    ).toBe(false);

    // Neither signal present: nothing is claimed.
    const bare = stub(() => ({ response: "Complete." }));
    expect((await realClient(bare.binding).answer("ask")).truncated).toBe(
      false,
    );
  });

  it("fails when the model returns no response", async () => {
    const empty = stub(() => ({ choices: [{ finish_reason: "stop" }] }));
    await expect(realClient(empty.binding).answer("ask")).rejects.toThrow(
      /ANSWER_FAILED/,
    );
  });
});

describe("reranking", () => {
  it("asks for a score per passage and returns them in input order", async () => {
    // Deliberately shuffled, and deliberately not the order asked: the rows carry their own index,
    // and reading them positionally would mis-attribute every score.
    const s = stub(() => ({
      response: [
        { id: 2, score: 0.9 },
        { id: 0, score: 0.1 },
        { id: 1, score: 0.5 },
      ],
    }));
    const scores = await realClient(s.binding).rerank("q", ["a", "b", "c"]);

    expect(scores).toEqual([0.1, 0.5, 0.9]);
    expect(s.calls[0]?.model).toBe(RERANK_MODEL);
    expect(s.calls[0]?.inputs).toEqual({
      query: "q",
      contexts: [{ text: "a" }, { text: "b" }, { text: "c" }],
      // The whole point: a smaller top_k leaves the tail unscored, which reads as irrelevant.
      top_k: 3,
    });
  });

  it("scores a passage the model left out as zero rather than failing", async () => {
    const s = stub(() => ({ response: [{ id: 1, score: 0.4 }] }));
    expect(await realClient(s.binding).rerank("q", ["a", "b"])).toEqual([
      0, 0.4,
    ]);
  });

  it("ignores rows naming an index or a score it cannot use", async () => {
    const s = stub(() => ({
      response: [
        { id: 9, score: 0.9 },
        { id: 0, score: "high" },
        { id: 1, score: Number.NaN },
        null,
      ],
    }));
    expect(await realClient(s.binding).rerank("q", ["a", "b"])).toEqual([0, 0]);
  });

  it("calls no model for no passages", async () => {
    const s = stub(() => ({ response: [] }));
    expect(await realClient(s.binding).rerank("q", [])).toEqual([]);
    expect(s.calls).toHaveLength(0);
  });

  it("fails when the model returns no scores", async () => {
    const s = stub(() => ({ response: "not an array" }));
    await expect(realClient(s.binding).rerank("q", ["a"])).rejects.toThrow(
      /RERANK_FAILED/,
    );
  });

  it("fakes descending scores, a zero for the marked passage, and a throw on the query", async () => {
    expect(await fake().rerank("q", ["a", "b", "c"])).toEqual([1, 0.5, 1 / 3]);
    expect(await fake().rerank("q", ["a", `b ${FAKE_IRRELEVANT}`])).toEqual([
      1, 0,
    ]);
    await expect(
      fake().rerank(`q ${FAKE_RERANK_THROW}`, ["a"]),
    ).rejects.toThrow(/RERANK_FAILED/);
    // Its own marker, because the question reaches the answering prompt verbatim: the shared
    // FAKE_THROW would fail the answer as well, and the fallback under test would never be seen.
    expect(await fake().rerank(`q ${FAKE_THROW}`, ["a"])).toEqual([1]);
  });
});
