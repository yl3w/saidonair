# Product Requirements Document (PRD)

**Product:** Multi-User Personal Media Digest Assistant
**Status:** v2 — supersedes the original 16-hour PRD
**Companion:** `AGENTS.md` (engineering conventions; overrides this document where they disagree)

---

## 1. Summary

A personal, long-lived, multi-user tool that removes content overload from subscribed YouTube channels and podcasts.
The system ingests new video transcripts 2–3× daily, summarizes each with Llama 3.3 on Workers AI, embeds transcript
chunks into Cloudflare Vectorize, and exposes a text-only web app where a user sees today's digest, browses their
channels, and asks questions across everything they subscribe to. It runs entirely on Cloudflare.

This is built for a small, trusted set of users (household / personal). It is **not** a hackathon demo and **not** a
public product: maintainability and data isolation between users matter more than speed of delivery.

### Goals
- A user opens the app and sees, in under five seconds, what was published in their channels since yesterday.
- A user can ask "what did any of my channels say about X?" and get an answer citing video and timestamp.
- Adding a channel is a paste-and-forget action.
- Each user's data is fully isolated from every other user's.

### Non-goals (v2)
Authentication, per-channel chat, notifications or email delivery, non-YouTube sources, transcript generation for
videos without captions (Whisper), admin tooling, rate limiting, mobile apps, rich media in the UI.

---

## 2. Users & identity

- Users are identified by **email only**, passed as an `X-User-Email` header. There is no authentication by design;
  the deployment is trusted. The UI must never describe this as "signing in."
- Unknown emails are **auto-registered** on first request. Registration adds the email to the Global Registry, which
  is what enrolls a user in scheduled ingestion.
- All user data lives in that user's Durable Object and that user's Vectorize namespace. No cross-user read path exists.

---

## 3. Architecture

```
+----------------------------------------------------------------------------+
|             Cloudflare Pages — Vite + Preact + TypeScript (text only)       |
|   Screens: /  (Account)   /home (Digest · Chat · Channels)   /channel/:id   |
+----------------------------------------------------------------------------+
                                     |  HTTPS + X-User-Email (typed client, packages/shared)
                                     v
+----------------------------------------------------------------------------+
|                    Cloudflare Worker — Hono API router                      |
|   middleware: normalize email → auto-register → attach per-user DO stub     |
+----------------------------------------------------------------------------+
        |                          |                              |
        v                          v                              v
+---------------------+   +-------------------------+   +-----------------------------+
| Global Registry DO  |   | Per-User DO             |   | Workers AI                  |
| (SQLite)            |   | idFromName(email)       |   | llama-3.3-70b-instruct      |
| - global_users      |   | (SQLite, migrations/)   |   | bge-base-en-v1 (768d)       |
+---------------------+   | - channels (status…)    |   +-----------------------------+
        ^                 | - processed_videos      |                 ^
        |                 | - summaries (read_at)   |                 v
        |                 | - chat_messages         |   +-----------------------------+
        |                 | - user_preferences      |   | Vectorize  index: media-rag |
        |                 +-------------------------+   | namespace: <email>          |
        |                          ^                    | metadata idx: channelId,    |
        |                          |                    |               videoId       |
        |                          |                    +-----------------------------+
        |                          |                                  ^
+----------------------------------------------------+               |
| Cloudflare Workflow: ingest { email, channelId }   |---------------+
|  RSS → transcript → chunk → embed → upsert →       |
|  summarize → cross-reference → write DO → status   |
+----------------------------------------------------+
        ^
        |  one instance per (user, channel)
+---------------------+
| Cron Trigger        |  schedule: TODO(owner)
| (same Worker)       |
+---------------------+
```

### Stack

| Concern | Choice |
|---|---|
| Monorepo | pnpm workspaces + Turborepo (`apps/api`, `apps/web`, `packages/shared`) |
| Toolchain | Volta pins Node; `packageManager` field pins pnpm |
| API | Cloudflare Worker, Hono, TypeScript strict |
| State | Durable Objects with SQLite; additive-only numbered migrations |
| Orchestration | Cloudflare Workflows for ingestion; Cron Trigger for scheduling |
| LLM | Workers AI `@cf/meta/llama-3.3-70b-instruct-fp8-fast` |
| Embeddings | Workers AI `@cf/baai/bge-base-en-v1` — 768 dims, 512-token input cap |
| Vectors | Vectorize `media-rag`, cosine, `namespace: <email>`, metadata indexes on `channelId` and `videoId` |
| UI | Cloudflare Pages, Vite + Preact + TypeScript, `preact-iso` routing, plain CSS |
| Tests | Vitest + `@cloudflare/vitest-pool-workers` — isolation and pure-function focus |
| Lint/format | Biome |

---

## 4. Functional requirements

### 4.1 Account (screen `/`)
- Single email input labeled "Who is this for?" plus a list of previously used emails from `localStorage`.
- Selecting an email stores it locally and routes to `/home`. Returning users skip this screen.
- "Switch account" is reachable from every other screen.

### 4.2 Home (screen `/home`)
Three regions, top to bottom.

**Today's digest.** All summaries published in the last 24 hours across all channels, newest first. Each entry
shows channel title, video title, a ≤3-sentence executive summary, 3–5 key takeaways, topic tags, related past
videos (if any), and a link to the video. Viewing the digest marks those summaries read. Empty state: "Nothing new
since yesterday."

**Chat.** One global conversation thread per user. Retrieval spans the user's entire namespace — chat is
deliberately **not** scoped to a channel. Each reply lists its sources as `channel · video title · timestamp`,
linking to `https://youtu.be/<videoId>?t=<startSec>`. Chat history persists in the user's Durable Object and is
injected as context along with the user's preference rules (e.g. "focus on engineering details").

**Channels.** A list of the user's channels: title, status (`pending` / `active` / `error`), last ingested time,
video count, unread count. Each row opens `/channel/:id`. An "Add channel" input accepts any YouTube channel URL
form (`@handle`, `/channel/UC…`, `/c/…`); the row appears immediately as `pending` and the list polls while any
channel is pending. Removing a channel is a soft delete. Empty state explains what to paste.

### 4.3 Channel (screen `/channel/:id`)
Channel header (title, status, counts) and its summaries as a feed, newest first. Viewing marks them read.
**No chat input** — chat is global and lives on Home. Back link to `/home`.

### 4.4 Ingestion
- **Cold start:** adding a channel launches an ingest Workflow for that `{ email, channelId }`, limited to the
  channel's 5–10 most recent RSS entries. On completion or failure the Workflow writes `status` back to the channel row.
- **Scheduled:** a Cron Trigger (cadence: **TODO — owner decision**) lists registered emails from the Registry and
  launches one Workflow per (user, active channel). Each external call is its own retryable step; steps are idempotent
  and skip videos already in `processed_videos`.
- **Transcript source:** implementation is open (`fetchTranscript(videoId)` contract in `AGENTS.md`) but must run
  under the Workers runtime. Videos without captions are recorded and skipped, not treated as errors.
- **Chunking:** hybrid — group ~60 s of speech, cap at ~400 tokens, split on segment boundaries, overlap 1–2
  segments, never exceed 480 tokens. Every vector carries `videoId`, `channelId`, `channelTitle`, `title`,
  `startSec`, `endSec`, `text`, `publishedAt`.
- **Summarization:** per video, Llama 3.3 produces JSON: 3–5 takeaways, ≤3-sentence summary, topic tags.
  Output is validated; one retry on invalid JSON, then stored raw with a flag.
- **Cross-references:** after summarizing, query the video's own embedding (k=3, same namespace, excluding itself)
  and attach matching past video titles to the summary.

### 4.5 Q&A
Embed the question → Vectorize query (`namespace: email`, `topK: 3`, all metadata) → build context from chunk text →
add preference rules and recent chat history → Llama 3.3 → answer with `videoId` + `startSec` citations.

---

## 5. API

All routes require `X-User-Email`; 400 if missing or malformed. JSON only.

| Method & path | Purpose |
|---|---|
| `POST /chat` `{ message }` | Q&A or digest command; returns `{ reply, sources[] }` |
| `GET /chat/history?limit=` | Global thread |
| `GET /digest?since=` | Summaries across all channels; default last 24 h; marks returned items read |
| `POST /channels` `{ url }` | Resolve URL → channel id, insert as `pending`, start cold-start Workflow |
| `GET /channels` | Rows with status, `lastIngestedAt`, `videoCount`, `unreadCount` |
| `GET /channels/:id` | Channel + recent summaries; marks them read |
| `DELETE /channels/:id` | Soft delete (mark inactive) |
| `GET /preferences` · `PUT /preferences` | System-prompt rules for the user |

Request/response types are shared between API and UI via `packages/shared`.

---

## 6. Data isolation requirements
- Every Vectorize call carries `namespace: <email>`. A missing namespace is a defect, not a default.
- Every read/write of user data goes through that user's Durable Object.
- Automated tests must demonstrate that actions by one user leave another user's DO state and vector namespace
  untouched. These tests are extended whenever a new route or data path is added.

---

## 7. Operational constraints
- Only YouTube (public RSS and captions) and Cloudflare services are called. No other third-party or paid APIs.
- Schema changes are additive only; no destructive migrations or commands without owner approval.
- Transcript text and chat content are never logged.
- Vectorize index and metadata indexes are created once, by the owner, **before** the first ingestion.

---

## 8. Success criteria (v2)
- Two registered users, overlapping channel subscriptions: each sees only their own digest, chat history, and
  channel list; Q&A never surfaces the other's data (covered by tests).
- Adding a channel shows `pending` within one second and `active` with summaries within a few minutes.
- Home loads today's digest in under five seconds for a user with 20 channels.
- A question about a specific episode returns a correct answer with a working timestamp link.
- `pnpm check` (typecheck, lint, test) passes on every commit.

---

## 9. Open decisions (owner)
1. Cron cadence and times.
2. Retention for summaries and chat history — until decided, keep everything.
3. Whether Home's chat input should be pinned to the bottom of the viewport when the digest is long.

---

## 10. Milestones

```
M1  Foundation        pnpm/Turbo/Volta scaffold · Hono Worker · middleware · Registry DO · migrations runner
M2  Ingestion         RSS + channel resolution · transcript module (verified in wrangler dev) · chunking · embeddings
M3  Intelligence      summarization + JSON validation · cross-references · Q&A with citations · Workflow + status
M4  UI                Vite/Preact app · Account · Home (digest, chat, channels) · Channel screen · Pages deploy
M5  Hardening         isolation tests · pure-function tests · cron wiring · docs
```
