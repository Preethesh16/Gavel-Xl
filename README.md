# GAVEL XI

**Build the XI. Break the Bank.**

GAVEL XI is a real-time multiplayer football squad-building auction game for two to eight Sporting
Directors. A server-generated card rises on every screen, eligible directors bid against the clock,
and every completed XI is evaluated over 100 position-aware football metrics. The uncertainty is the
game: the pool is fixed and committed before play, but nobody sees the next card.

This repository is a functioning product, not a static mock. It includes a deterministic game engine,
authoritative Socket.IO service, responsive Next.js client, PostgreSQL/Redis production adapters,
football-data and valuation provider boundaries, optional structured Groq narrative enrichment,
event replay, and automated multi-browser coverage. A bundled development provider makes the full
flow playable without paid API credentials; it is clearly labelled and never presented as externally
verified live data.

## Product tour

| Live auction                                          | Final verdict                                          |
| ----------------------------------------------------- | ------------------------------------------------------ |
| ![Live auction](docs/screenshots/desktop-auction.png) | ![Final verdict](docs/screenshots/desktop-results.png) |

Mobile layouts are exercised at a phone viewport: [landing](docs/screenshots/mobile-landing.png),
[auction](docs/screenshots/mobile-auction.png), and [results](docs/screenshots/mobile-results.png).

## Architecture

```text
apps/web             Next.js interface, local session recovery, motion, sound and accessibility
apps/server          Fastify + Socket.IO authority, rooms, timers, providers, repositories and replay
packages/game-engine Pure seeded rules, auction state, budgets, pool generation and evaluation
packages/shared      Zod wire schemas and shared TypeScript socket/view contracts
```

The browser sends intentions—bid, pass, ready—not state. The server checks the participant session,
auction sequence, eligibility, increment, idempotency key, rate limit, and safe budget before mutating
an auction. Engine code has no browser, Socket.IO, Redis, or database dependency and is covered at the
rule boundary.

For a zero-setup development run, the backend uses process-local repository and lock adapters. When
`DATABASE_URL` and `REDIS_URL` are configured, it automatically switches to Prisma/PostgreSQL and
Redis: room/replay commits use revision-checked transactions, locks renew with ownership tokens,
timers are wake-time fenced, and the Socket.IO Redis adapter fans events across workers. Startup
reconciles stale presence after an abrupt process loss. Normalized relational projections remain
queryable while an exact canonical payload guarantees deterministic restart recovery.

## Prerequisites

- Node.js 20.11 or later
- pnpm 9.15.5 (`corepack prepare pnpm@9.15.5 --activate`)
- Optional: Docker for PostgreSQL and Redis
- Optional: Sportmonks or API-Football credentials for externally sourced snapshots
- Optional: a Groq API key for schema-validated football-analysis copy

## Quick start

```bash
corepack prepare pnpm@9.15.5 --activate
pnpm install
cp .env.example .env
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). The realtime service listens on port 4000 and
exposes a health endpoint at [http://localhost:4000/health](http://localhost:4000/health).

To run the backing services:

```bash
docker compose up -d postgres redis
pnpm --filter @gavel-xi/server db:migrate
```

The in-memory development path is deliberately available when both URLs are blank, so a new
contributor can still play and run the browser suite without Docker. A configured adapter fails fast
instead of silently falling back. The server CLI loads the repository-root `.env`; an explicitly
exported process variable takes precedence.

## Environment

Copy `.env.example`; never commit the resulting `.env`.

| Variable                 | Purpose                                                                         |
| ------------------------ | ------------------------------------------------------------------------------- |
| `DATABASE_URL`           | PostgreSQL connection used by the durable repository/migrations                 |
| `REDIS_URL`              | Redis connection used by atomic auction/presence adapters                       |
| `FOOTBALL_DATA_PROVIDER` | `catalog`, `auto`, `sportmonks`, `api-football`, `football-data-org`, or `demo` |
| `SPORTMONKS_API_TOKEN`   | Sportmonks credential; server-only                                              |
| `API_FOOTBALL_KEY`       | API-Football credential; server-only                                            |
| `VALUATION_PROVIDER`     | Supported value: `game-estimate`; unknown modes fail configuration              |
| `VALUATION_API_KEY`      | Reserved for a future licensed valuation adapter                                |
| `GROQ_API_KEY`           | Optional structured football-copy enrichment; never numerical authority         |
| `GROQ_MODEL`             | Groq model; defaults to `openai/gpt-oss-20b`                                    |
| `GROQ_TIMEOUT_MS`        | Bounded enrichment deadline; defaults to `15000`                                |
| `NEXT_PUBLIC_APP_URL`    | Browser-visible canonical client URL                                            |
| `NEXT_PUBLIC_SERVER_URL` | Browser-visible realtime server URL                                             |
| `SERVER_URL`             | Internal backend URL used to render public result routes                        |
| `CLIENT_ORIGIN`          | Comma-separated allowed Socket.IO/HTTP client origins                           |
| `PORT`                   | Backend port, normally `4000`                                                   |
| `SESSION_SECRET`         | Empty locally for a random key; production: `openssl rand -hex 32`              |

All provider values retain source, retrieval time, valuation date, confidence, and a value type. A
game estimate is displayed as **GAVEL XI Estimate**, never as market value. Each room freezes one data
snapshot so values and ratings cannot drift midway through an auction. If a live provider fails, new
rooms follow fresh cache → stale cache → alternate provider → candidate exclusion; active games keep
their frozen snapshot.

If `GROQ_API_KEY` is present, the server requests only short strengths, weaknesses, existing-award
details, and head-to-head explanations through a strict JSON Schema. Output is validated, cached,
time-bounded, and merged through a copy-only allowlist. Scores, ranks, winners, goals, ownership, and
all other authoritative values are rebuilt from the deterministic engine; network or schema failure
returns the deterministic copy unchanged.

## Game rules

- A room needs 2–8 ready Sporting Directors. A later join is a read-only spectator.
- Each formation is data: eleven slot cycles plus a separate manager cycle. Repeated positions (for
  example two CBs) remain independent even though both are presented as `CB`.
- With `N` directors, every cycle has exactly `N` candidates: `N - 1` high-profile choices and one
  legitimate fallback. Tiers and future identities stay server-only.
- The complete pool and reveal sequence are produced from one seed before play. The SHA-256 seed
  commitment is public at kickoff; the seed is revealed on completion.
- A valid late bid extends the timer to the configured anti-snipe window. A stale auction sequence or
  repeated idempotency key cannot become a second accepted bid.
- If all eligible directors pass, the card enters the unsold vault. Its first and every subsequent
  return uses exactly 50% of the original reserve—it never approaches zero by repeated halving.
- Once all but one director have filled a cycle, the final candidate is allocated to the remaining
  director. Strict mode protects the minimum cost of unfinished mandatory slots; chaos mode caps an
  unaffordable forced deal at the remaining balance and records an emergency allocation.
- After every four resolved cycles, a numerical provisional Scout Report interrupts between cards.
- Completed XIs receive 0–100 scores for every one of 100 named metrics in ten categories. Narrative
  can explain the numbers but cannot change them. Rankings, awards, league points, knockout strength,
  one-match finals and head-to-head scores all derive from those inputs.

## Development commands

```bash
pnpm dev             # web and realtime backend
pnpm typecheck       # strict TypeScript across every workspace
pnpm lint            # workspace lint/static checks
pnpm test            # deterministic engine and server integration suites
pnpm test:e2e        # isolated multi-browser contexts through real Socket.IO
pnpm build           # production builds
pnpm check           # formatting + lint + typecheck + tests + builds
```

Install the Playwright browser once when needed:

```bash
pnpm exec playwright install chromium
```

The browser suite uses separate contexts (separate storage, cookies, sockets and identities) for
Preetesh, Abhinav, Imran and TestUser4. It verifies shared presence, accepted bids, outbid state, sold
events, refresh recovery, spectator restrictions and responsive surfaces. Screenshots and traces land
under `test-results/` and `playwright-report/` on failure.

The PostgreSQL/Redis suite is opt-in locally so the zero-service unit run stays fast. After starting
the backing services and applying the migration, run:

```bash
TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/gavel_xi?schema=public' \
TEST_REDIS_URL='redis://127.0.0.1:6379' \
pnpm --filter @gavel-xi/server exec vitest run test/durable-adapters.integration.test.ts
```

It covers exact restart recovery, namespaced normalized projections, stale-worker CAS rejection,
Redis TTL/rate/renewable-lock behavior, cross-worker Socket.IO fanout, and duplicate timer fencing.
CI runs it against clean PostgreSQL and Redis services on every change.

## Data providers

Provider adapters return normalized player/manager snapshots only; auction and evaluation code never
depends on a vendor response shape. The preferred production path is Sportmonks with API-Football as
an alternate. The development adapter is a finite, versioned fixture intended for gameplay and tests,
not a claim about present-day clubs or prices. No restricted website is scraped, and card imagery
falls back to an original silhouette/initial treatment when a licensed URL is unavailable.

`catalog` mode is the quota-free production alternative. It stores an open Transfermarkt-derived
snapshot in PostgreSQL and serves every draft without a third-party request. It provides imported
identity, club, exact position and market-value fields; role/form signals are explicitly
market-derived estimates, not live match statistics. Refresh it deliberately with
`catalog:bootstrap` plus `catalog:import` when a newer open snapshot is required.

Adding a provider means implementing the football data and/or valuation interface, mapping into the
normalized snapshot, preserving provenance, and adding contract tests. Credentials stay in the
backend environment.

## Persistence and operations

The schema models rooms, members, games/settings, formations, frozen data snapshots, candidates and
cycles, lots, bids, unsold entries, squads, budget ledger entries, checkpoints, evaluations, 100 metric
scores, awards and replay events. Timer ticks stay ephemeral; meaningful actions are logged. Completed
results have a stable read-only route suitable for sharing and screenshots.

The development-only debug surface exposes state/snapshot age/sequence and connectivity only to an
authenticated current host, and is absent in production. The public room view strips unrevealed
candidates, seed, and tier information; private safe-bid limits travel only on per-member socket
channels. Do not use the local in-memory adapter as a scaled production topology.

## Deployment

Build the web app on Vercel or any Node host. Run the Socket.IO backend on a persistent Node service
(Fly, Railway, Render, Kubernetes, or equivalent) with sticky sessions or Redis-backed Socket.IO
pub/sub. Use managed PostgreSQL (for example Neon/Supabase) and managed Redis (for example Upstash).
The code does not require those particular vendors.

Before production launch:

1. Configure HTTPS origins and strong session secrets.
2. Apply the Prisma migrations to PostgreSQL.
3. Enable Redis locks/pub-sub for every realtime instance.
4. Configure the durable open catalog or a licensed/current football provider and review its usage rights.
5. Disable development provider/debug routes.
6. Run `pnpm check` and `pnpm test:e2e` against the deployed topology.

## Accessibility and visual design

The interface does not rely on sound, color, animation, or hover to convey an auction result. Controls
are semantic and keyboard reachable; auction state is announced through live regions; contrast and
touch targets are mobile-first; and `prefers-reduced-motion` collapses cinematic sequences without
changing the rules. Sound remains opt-in after a user gesture and globally togglable.

## Completion tracking

[GOALS.md](./GOALS.md) is the build contract distilled from the full product brief. A checkbox is only
closed with automated evidence, browser verification, or both.
