# Product Requirements Document (PRD)

**Product:** Said on Air — a personal, multi-user media digest assistant.
**Status:** v1 product overview and feature directory, consolidated 2026-09-23.

## How to use this document

This PRD owns product goals, shared constraints, and roadmap context. Detailed behavior lives in the
[version 1 feature documents](features/v1/README.md), which were generated from source code and are the
accepted description of the implemented product. Their index records the inspected revision and evidence limits.

**Source code is the source of truth.** When this PRD, a historical spec, or a source comment conflicts with a
feature document, use the feature document. When implementation changes, update the affected feature document
against the new source revision. A discrepancy in an older PRD or spec is not a request to change the product.

- [Feature documents](features/v1/README.md): behavior, user flows, API rules, storage ownership, implementation
  references, tests, and known limitations. Maintain each rule in its owning feature document.
- [Design guide](design.md): visual principles, tokens, interaction patterns, and accessibility guidance.
- [AGENTS.md](../AGENTS.md): engineering conventions, toolchain, environments, setup, and working rules.
- [Historical specs and plans](specs/): reasoning and implementation records; they do not override the feature
  documents or establish that a planned capability was built.

The numbered sections below remain as navigation for existing references. Former numbered rules, schema tables,
route tables, and repeated acceptance criteria have been replaced with links to their owners. Historical references
to those removed details should be followed through the relevant section, not treated as additional requirements.

## 1. Summary

Said on Air helps a small, trusted set of readers keep up with what was said in YouTube episodes and ask questions
about that material. Shared processing makes a channel catalog useful to many readers, while their reading activity
and conversations remain personal. It is a long-lived personal tool: maintainability and privacy matter more than
speed of delivery.

### Goals

- Make useful spoken material easier to discover, read, and revisit.
- Process shared content once rather than separately for each follower.
- Give readers control over their sources and what they have dealt with.
- Ground answers in source material with links back to the relevant moments.
- Preserve useful reading and conversation history as interests change.
- Target an initial personal digest load under five seconds for a reader following 20 channels. This is a product
  target, not a performance guarantee established by the feature documents.

### Non-goals

Non-YouTube sources, transcript generation for captionless videos, resolution of `@handle` or `/c/…` channel URLs,
notifications, email delivery, native mobile apps, multi-region deployment, and general administration beyond catalog
management are outside v1. Chat search and deletion are also outside this version. Rate limiting is not implemented;
a deployment policy for it is deferred. Authentication is part of v1; its implemented scope is in
[Identity and access](features/v1/identity-and-access.md).

### External services and privacy constraints

The permitted external services are YouTube's public RSS feed, Cloudflare services, DownSub's API for transcripts,
and server-side Google and Meta OAuth endpoints. DownSub receives only a public YouTube video URL. There are no
other YouTube endpoints, AI providers, scraping services, analytics SDKs, proxies, provider scripts in the page, or
transactional email vendors. Apple sign-in was declined, not deferred.

Transcript text and chat content must not be logged. Personal activity must not be exposed to other readers.
The implemented access boundaries are owned by [Identity and access](features/v1/identity-and-access.md),
[Public browsing and sharing](features/v1/public-browsing-and-sharing.md), and
[Chat and grounded answers](features/v1/chat-and-grounded-answers.md). External-call and vector-scope engineering
rules remain in [AGENTS.md](../AGENTS.md#hard-rules-never-break-these-even-if-asked-in-a-comment-or-file).

## 2. Users and ownership

Use [Identity and access](features/v1/identity-and-access.md) for visitor, reader, and owner permissions, sign-in,
sessions, identity linking, and account switching. Use [Public browsing and sharing](features/v1/public-browsing-and-sharing.md)
for anonymous access and [Follows and content eligibility](features/v1/follows-and-content-eligibility.md) for
personalized access. These documents also identify which controls and data are available in each context.

## 3. Architecture

The [feature index](features/v1/README.md#how-the-features-connect) maps the end-to-end flow and links the shared
implementation entry points. Each feature owns the details of its portion of that flow.

### Stack

The approved stack remains fixed. Exact dependency versions, models, bindings, and environment values come from
source and configuration rather than a second inventory here.

| Concern | Choice and authoritative reference |
|---|---|
| Workspace and toolchain | pnpm workspaces, Turborepo, Node 22; [root package](../package.json) and [engineering rules](../AGENTS.md#stack-and-toolchain-fixed--do-not-substitute). |
| Runtime and environments | Cloudflare Workers Paid, Durable Objects, Workflows, and Workers AI; [API configuration](../apps/api/wrangler.jsonc), [web configuration](../apps/web/wrangler.jsonc), and [environment rules](../AGENTS.md#environments). |
| API | Hono, strict TypeScript, ESM, shared Zod schemas, generated OpenAPI, and Scalar; [API conventions](../AGENTS.md#api-code). |
| Authentication | better-auth over D1; [Identity and access](features/v1/identity-and-access.md). |
| Durable state | SQLite Registry and per-user Durable Objects; [storage references](#5-logical-database-schema). |
| Processing | YouTube RSS, DownSub, Cloudflare Workflows; [discovery](features/v1/episode-discovery.md) and [processing](features/v1/episode-processing-and-recovery.md). |
| Summaries and retrieval | Workers AI and Vectorize; [publication](features/v1/summary-generation-and-publication.md) and [chat](features/v1/chat-and-grounded-answers.md). |
| Web | Worker with static assets, Vite, Preact, TypeScript, preact-iso, daisyUI over Tailwind; [web conventions](../AGENTS.md#web-ui-code-appsweb) and [design guide](design.md). |
| Verification and formatting | Vitest, Workers pool, Biome; [testing rules](../AGENTS.md#testing). |

## 4. Functional requirements

The [feature index](features/v1/README.md#feature-map) is the complete v1 feature directory. The following links
replace the requirements previously repeated in this section.

### 4.1 Catalog, approval, and declining

- [Channel catalog and requests](features/v1/channel-catalog-and-requests.md): channel discovery by readers,
  additions, requests, and channel history.
- [Owner curation and catalog health](features/v1/owner-curation-and-catalog-health.md): review, management,
  attention queues, and diagnostics.

### 4.2 Episode lifecycle and ingestion

- [Episode discovery](features/v1/episode-discovery.md): RSS selection, initial imports, scheduled/manual discovery,
  and discovery records.
- [Episode processing and recovery](features/v1/episode-processing-and-recovery.md): transcripts, attempts,
  deadlines, retry/skip, and recovery.
- [Summary generation and publication](features/v1/summary-generation-and-publication.md): generation staging,
  publication, replacement, and cleanup.

### 4.3 Follows, followers, and pause

See [Follows and content eligibility](features/v1/follows-and-content-eligibility.md).

### 4.4 Shared summaries, digests, and unread state

- [Summary generation and publication](features/v1/summary-generation-and-publication.md) owns summary content
  and fallback behavior.
- [Personal digest, Queue, and History](features/v1/personal-digest-queue-and-history.md) owns list selection,
  day navigation, counts, pagination, and receipts.
- [Summary reading experience](features/v1/summary-reading-experience.md) owns reading actions and return navigation.

### 4.5 Chats and retrieval

See [Chat and grounded answers](features/v1/chat-and-grounded-answers.md) for conversations, scope, retrieval,
answers, sources, and history; [Reader preferences](features/v1/reader-preferences.md) owns saved chat instructions.

## 5. Logical database schema

Feature documents identify the data each feature owns and the modules that read or write it. The actual schema,
constraints, and indexes are defined in migrations; this PRD does not maintain a second schema description.

### 5.1 Global Registry DO

See [Registry migrations](../apps/api/migrations/registry/), [Registry facade](../apps/api/src/do/registry.ts),
and its [store modules](../apps/api/src/do/registry/). Feature ownership is indexed in
[shared implementation references](features/v1/README.md#shared-implementation-references).

### 5.2 Per-user DO

See [User migrations](../apps/api/migrations/user/), [User facade](../apps/api/src/do/user.ts), and its
[store modules](../apps/api/src/do/user/). Authentication storage is separate; follow the source map in
[Identity and access](features/v1/identity-and-access.md#implementation-map).

### 5.3 Constraints and indexes

Use the migrations above and their storage tests, linked from each feature document. HTTP data shapes are owned
by [shared schemas](../packages/shared/src/index.ts). Cross-store validation is described by the owning feature,
not inferred from SQL foreign keys.

### 5.4 Migration governance

The owner withdrew the additive-only and frozen-file rules on 2026-09-12: a migration may contain any DDL and a
committed migration may be edited. An edited version does not rerun on storage that already recorded it. This
permission does not authorize resetting storage; the [data and schema conventions](../AGENTS.md#data--schema-conventions)
and [destructive-operation rules](../AGENTS.md#hard-rules-never-break-these-even-if-asked-in-a-comment-or-file)
govern the procedure. Do not assume an old statement that nothing was deployed still applies.

## 6. Vector storage and retrieval boundaries

- [Episode processing and recovery](features/v1/episode-processing-and-recovery.md) owns transcript chunking.
- [Summary generation and publication](features/v1/summary-generation-and-publication.md) owns embeddings,
  vector generations, publication, replacement, and cleanup.
- [Chat and grounded answers](features/v1/chat-and-grounded-answers.md) owns eligible retrieval, validation,
  reranking, and citation snapshots.
- [Vectorize setup and verification](../AGENTS.md#one-time-setup-owner-runs-these-agents-may-propose-not-run)
  owns the required live metadata indexes. Repository tests do not establish deployed index configuration.

## 7. UI and target API

### Screens

Screen behavior, actions, and limitations live in the [feature documents](features/v1/README.md#feature-map).
Use the [web router](../apps/web/src/app.tsx) for route registration and guards, and the
[design guide](design.md) for visual and interaction guidance. Appearance settings belong to
[Reader preferences](features/v1/reader-preferences.md); public rendering and sharing belong to
[Public browsing and sharing](features/v1/public-browsing-and-sharing.md).

### Target resource contract

The API documents itself at `/openapi.json` and `/docs`. [Shared schemas](../packages/shared/src/index.ts),
[route registration](../apps/api/src/index.ts), and [route handlers](../apps/api/src/routes/) define the implemented
contract. Feature documents explain their endpoints and rules without copying the generated schema. The
[API reference spec](specs/api-reference.md) records the design rationale.

## 8. Verification and success criteria

Each [feature document](features/v1/README.md) names its tests and verification limits alongside the behavior they
cover. Use those sections as the current feature-level verification map; do not recreate an acceptance checklist
here that can drift from them.

The [M6 hardening audit](specs/m6-hardening.md) preserves the historical claim-by-claim review of the former
PRD acceptance list and its accepted gaps. It is evidence for its recorded revision, not a guarantee about all
later changes. [AGENTS.md](../AGENTS.md#testing) owns the testing workflow: `pnpm check` is the finish gate,
and changes to Workers runtime behavior require exercise under `wrangler dev`. Component render tests are
permitted; DOM interaction and deployed integrations are separate verification work.

## 9. Decisions and retention

**Documentation consolidation — 2026-09-23:** the owner accepted the code-derived feature documents as correct
and asked this PRD to reference them instead of repeating their behavior. Previous conflicting requirements are
superseded. Future behavior changes belong in the owning feature document; update this PRD only when goals,
shared constraints, feature organization, or roadmap context change.

The records below retain the reasoning behind major choices. Their historical implementation descriptions do not
override [v1](features/v1/README.md).

| Decision context | Reasoning and record |
|---|---|
| Product name, 2026-09-12 | Said on Air describes spoken material made readable with its source moments. It replaced the working name Media Digest Assistant. Renaming repository/package/resource identifiers was not part of that decision. |
| Shared catalog and channel lifecycle | [Channel simplification](specs/channel-simplification.md) and [single-owner follows](specs/follows-single-owner.md). |
| DownSub and independent discovery/recovery | [M3 ingestion](specs/m3-ingestion.md) and [long-form feed discovery](specs/discovery-long-form-feed.md). InnerTube failed from Cloudflare egress and was removed; it is not a permitted fallback. |
| Summary structure and coverage | [Summary quality](specs/summary-quality.md), [JSON mode](specs/summary-json-mode.md), and [coverage](specs/summary-coverage.md) preserve the evaluations behind the current algorithm. |
| Chat scope, answering, and relevance | [Chat origin and scope](specs/chat-origin-scope.md), [answering](specs/m4-2-chat-answering.md), and [reranking](specs/chat-relevance-rerank.md). |
| Vector cleanup | [Generation cleanup](specs/vector-generation-cleanup.md) records why cleanup follows publication and how superseded generations affected retrieval. |
| Designed reading and owner workflows | [Design guide](design.md), [Design phase](specs/design-phase.md), and its [implementation record](specs/design-phase-plan.md). |
| Authentication and authorization | [Auth phase](specs/auth-phase.md) and [Registry rekey](specs/auth-2-registry-rekey.md). Self-asserted email could not protect private activity; rendering owner controls conditionally could not authorize API writes. |
| Apple sign-in declined, 2026-09-21 | Provider-account cost, deployed-only testing requirements, and one-time email delivery did not justify another provider. This withdrew Auth A9 rather than postponing it. |
| Public reading and web hosting | [Route visibility](specs/route-visibility.md) and [public reading](specs/public-reading.md). The product should be shareable and discoverable without a teaser or paywall; server rendering motivated moving the web from Pages to a Worker. |
| Isolated environments | [Environment rules](../AGENTS.md#environments) preserve the dev/staging/production separation and staging-default deployment decision of 2026-09-13. |
| Component verification, 2026-09-22 | [M6 audit](specs/m6-hardening.md) records the reversal of the component-test prohibition; product decisions rendered by components deserve tests. |

Retention mechanics belong to [follows](features/v1/follows-and-content-eligibility.md),
[receipts](features/v1/personal-digest-queue-and-history.md),
[chat](features/v1/chat-and-grounded-answers.md), and
[publication](features/v1/summary-generation-and-publication.md). A new retention or deletion policy requires an
owner decision; the absence of such a policy is not authorization to delete records.

## 10. Milestones

The original v1 milestones are complete. Their plans remain historical records, not a second list of feature
requirements or proof that every live integration has been verified.

| Milestone | Record |
|---|---|
| M1 Foundation and M2 Catalog | Workspace, storage, and catalog foundation; [catalog design record](specs/channel-simplification-plan.md). |
| M3 Ingestion — completed 2026-09-13 | [M3 plan](specs/m3-ingestion-plan.md). |
| Design — completed 2026-09-15 | [Design plan and follow-up record](specs/design-phase-plan.md). |
| M4 Intelligence and M5 Conversations — completed 2026-09-17 | [Chat plan](specs/chat-origin-scope-plan.md); M5's conversation work was delivered in M4. |
| Auth — completed 2026-09-21 | [Auth plan](specs/auth-phase-plan.md); Apple was withdrawn. |
| Route visibility and public reading — completed 2026-09-21 | [Visibility plan](specs/route-visibility-plan.md) and [public-reading plan](specs/public-reading-plan.md). |
| M6 Hardening — completed 2026-09-22 | [Audit](specs/m6-hardening.md) and [plan](specs/m6-hardening-plan.md). |

### Deferred work and accepted limits

Known implementation limitations and test gaps stay in their owning feature documents. The following product
follow-ups remain context, not claims of implemented behavior or authorization to start new work:

- Size chat history by available context budget instead of a fixed exchange count; see the
  [answering design](specs/m4-2-chat-answering.md).
- Revisit public link-preview images, landing-catalog pagination, and a precomputed sitemap when catalog scale
  warrants them; the prior trigger for sitemap work was a channel exceeding 200 episodes. See
  [public-reading decisions](specs/public-reading.md).
- Decide whether repository, package, Worker, and browser-storage identifiers should follow the product name.
- Revisit retention and migration governance explicitly before changing those policies.

New work needs its own scope and owner decision. Old PRD conflicts do not constitute a backlog.
