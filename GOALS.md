# GAVEL XI Completion Contract

An item is checked only when it has automated coverage, browser verification, or both. The
attached product brief remains authoritative where this summary is terse.

## Foundation

- [x] Strict TypeScript pnpm/Turborepo with isolated web, server, shared, and game-engine packages
- [x] Validated shared HTTP/socket payload contracts and explicit authoritative game state machine
- [x] Environment example, secret hygiene, production-oriented PostgreSQL/Redis abstractions
- [x] Professional README covering architecture, rules, providers, setup, testing, and deployment

## Rooms and presence

- [x] Landing create/join flows require no account and validate/sanitize names and six-character codes
- [x] Memorable room codes, copy invite, host crown, ready presence, settings, and minimum-two start rule
- [x] Formation data presets, budget presets/custom, timer, increment, sound, strict/chaos, form lookback
- [x] Two to eight active directors; joins after start become spectators without changing pool size
- [x] Signed session token restores identity/state on refresh without duplicate members
- [x] Host disconnect grace period and deterministic transfer to earliest connected director

## Deterministic auction engine

- [x] Seed commitment is published before play and seed revealed with independent verification after play
- [x] Entire duplicate-free candidate pool and reveal order generated before first auction
- [x] Exactly N candidates per slot cycle: N-1 strong and one legitimate fallback, tiers never leaked
- [x] Repeated formation positions use independent cycles and complete correctly for every director
- [x] Active managers use their own candidate cycle and manager reserve model
- [x] One-card random reveals, compatibility eligibility, pass/bid/custom/quick bid controls
- [x] Server validates eligibility, increments, budget, idempotency, rate limits, sequence, and stale races
- [x] Authoritative monotonic timers and five-second anti-snipe extension in the final three seconds
- [x] All-pass sends a lot to the unsold vault; return reserve is exactly 50% and never halves twice
- [x] N-1 filled cycle triggers remaining candidate forced allocation and broadcasts it to every client
- [x] Strict max-safe-bid reserves minimum completion cost; chaos emergency allocation never goes negative
- [x] Every team completes with manager plus exactly eleven formation slots

## Data and evaluation

- [x] Normalized provider interfaces with Sportmonks/API-Football adapters and frozen room snapshots
- [x] Cache freshness/fallback chain; no fabricated external provenance; unavailable candidates excluded
- [x] Valuation provider exposes value, source, URL/date, confidence, and honest value type
- [x] Position-aware current-form scoring for GK/CB/FB/DM/CM/AM/winger/ST and configured weights
- [x] Checkpoint after every four resolved cycles with fully numerical provisional analysis
- [x] Exactly 100 named metrics across ten categories, 0–100 scores for every team, dynamic ranking
- [x] Structured manager/player role fit drives tactics rather than manager-name bonuses
- [x] Dynamic awards, bargains/overpays, auction efficiency, league/knockout/final projections
- [x] Pairwise match predictions have numerical simulation inputs before narrative

## Product experience

- [x] Premium responsive landing, lobby, stadium backdrop, room essentials, and accessible controls
- [x] Original staged card reveal with position/nation/club/photo fallback/value/opening price provenance
- [x] Synchronized bid/outbid, sold, unsold, return, forced-deal, and final-call states/animations/sound cues
- [x] Team Check supports my/all teams without pausing; host room check occurs between auctions
- [x] Broadcast-style checkpoint; final formations; staged evaluation/podium; all-100-metrics explorer
- [x] Replay timeline and persistent screenshot-friendly shareable result route
- [x] Mobile-first controls, keyboard bidding, reduced motion, contrast, live regions, no hover-only information
- [x] Development-only debug panel protects hidden candidates from ordinary clients

## Verification

- [x] Engine tests cover N=2 full completion and N=3 auction/pass/unsold/return/forced flows
- [x] Engine tests cover N=4, exactly eight CB candidates across two cycles, two CBs per team
- [x] Tests cover simultaneous bids, idempotency, stale sequences, budget boundaries, and sold consistency
- [x] Tests cover repeated unsold price, emergency allocation, strict max safe bid, and completion invariants
- [x] Integration tests cover reconnect, host transfer, spectators, checkpoints, 100 metrics, and event replay
- [x] Four isolated Playwright contexts stay synchronized through bids and a shared sold animation
- [x] Playwright covers full playable game, refresh recovery, team check, checkpoint, final results, and metrics
- [x] Desktop and mobile screenshots visually checked for clipping, overflow, hierarchy, and readability
- [x] No significant browser console errors; lint, typecheck, unit/integration, E2E, and production builds pass
- [ ] Final repository is committed and pushed successfully to `origin/main`
