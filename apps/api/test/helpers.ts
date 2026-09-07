import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { expect } from "vitest";
import { getRegistry } from "../src/do/registry";
import { getUserDO } from "../src/do/user";
import { type DomainErrorCode, domainErrorCode } from "../src/lib/errors";

/** Must match `miniflare.bindings.OWNER_EMAIL` in vitest.config.ts. */
export const OWNER = "owner@example.com";
export const ALICE = "alice@example.com";
export const BOB = "bob@example.com";

// Canonical-looking ids: "UC" + 22 URL-safe base64 characters.
export const CHANNEL_A = "UCAAAAAAAAAAAAAAAAAAAAAA";
export const CHANNEL_B = "UCBBBBBBBBBBBBBBBBBBBBBB";

// 11-character video ids.
export const VIDEO_A = "aaaaaaaaaaa";
export const VIDEO_B = "bbbbbbbbbbb";

/** `count` distinct valid video ids, for exercising parameter chunking. */
export function videoIds(count: number): string[] {
  return Array.from(
    { length: count },
    (_, i) => `v${String(i).padStart(10, "0")}`,
  );
}

export function registry() {
  return getRegistry(env);
}

export function userDO(email: string) {
  return getUserDO(env, email);
}

/** Asserts a DO RPC call fails with the given typed code, whatever crosses the RPC boundary. */
export async function expectDomainError(
  call: Promise<unknown>,
  code: DomainErrorCode,
): Promise<void> {
  let caught: unknown;
  try {
    await call;
  } catch (error) {
    caught = error;
  }
  expect(caught, `expected ${code} but the call succeeded`).toBeDefined();
  expect(domainErrorCode(caught)).toBe(code);
}

type ChannelState = {
  status: "pending" | "available" | "failed";
  failureCode?: string;
  availableAt?: number;
};

/** Ingestion is not implemented yet, so tests drive processing state with real SQL. */
export async function setChannelState(
  channelId: string,
  state: ChannelState,
): Promise<void> {
  await runInDurableObject(registry(), (_, ctx) => {
    ctx.storage.sql.exec(
      `UPDATE channels
       SET status = ?, failure_code = ?, available_at = COALESCE(?, available_at)
       WHERE channel_id = ?`,
      state.status,
      state.failureCode ?? null,
      state.availableAt ?? null,
      channelId,
    );
  });
}
