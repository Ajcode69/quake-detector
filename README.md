# QuakeDetector 🌍

**A streaming-aware earthquake monitoring monolith** — built to demonstrate production-grade data pipeline design using Kafka, PostGIS, and Node.js.

> **Context:** This is a founding engineer-level assignment. The system is intentionally scoped as a monolith with streaming capabilities to demonstrate architectural judgment: knowing when to use Kafka minimally, when PostGIS spatial queries beat application-level geometry, and where to draw the line between "production-ready" and "overengineered."

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                        USGS GeoJSON Feed                        │
│                    (earthquake.usgs.gov)                         │
└──────────────────┬───────────────────────────────────────────────┘
                   │ poll every 60s (with exponential backoff)
                   ▼
┌──────────────────────────────────┐    ┌──────────────────────────┐
│     Process 1: Ingestion Worker  │    │  PostgreSQL / PostGIS    │
│                                  │    │  (Supabase)              │
│  ┌─────────────┐                 │    │                          │
│  │ USGS Poller │──upsert────────────► │  earthquakes (spatial)   │
│  │ + backoff   │                 │    │  user_locations           │
│  │ + staleness │                 │    │  alerts_log              │
│  └──────┬──────┘                 │    │  user_alert_rules        │
│         │ produce                │    │  poll_health             │
│         ▼                        │    └──────────────────────────┘
│  ┌──────────────┐                │              ▲
│  │ Kafka Topics │                │              │ read
│  │ (Redpanda)   │                │              │
│  │              │                │    ┌─────────┴────────────────┐
│  │ • raw        │──────────────────►  │  Process 2: API Server   │
│  │ • revisions  │                │    │                          │
│  │ • alerts     │                │    │  ┌────────────────────┐  │
│  └──────────────┘                │    │  │ Consumer: Persister│  │
│                                  │    │  │  → SSE broadcast   │  │
│  ┌──────────────┐                │    │  └────────────────────┘  │
│  │ Kafka Sweep  │ every 2 min    │    │  ┌────────────────────┐  │
│  │ kafkaPending │──re-produce──────►  │  │ Consumer: Evaluator│  │
│  └──────────────┘                │    │  │  → 3-tier alerts   │  │
└──────────────────────────────────┘    │  └────────────────────┘  │
                                        │  ┌────────────────────┐  │
                                        │  │ Consumer: Notifier │  │
┌──────────────────────────────────┐    │  │  → Telegram API    │  │
│     React Dashboard              │    │  └────────────────────┘  │
│     (Vite + Tailwind CSS v3)     │    │                          │
│                                  │◄──── SSE + REST API          │
│  • Location search (Nominatim)   │    │  Express.js              │
│  • Event feed (global/filtered)  │    │  Cron: retry sweep (5m)  │
│  • Live stream via SSE           │    │  Cron: daily digest (8am)│
└──────────────────────────────────┘    └──────────────────────────┘
```

### Two-process design

| Process | Responsibility | Entry point |
|---------|---------------|-------------|
| **Ingestion Worker** | Polls USGS, upserts to Postgres, produces to Kafka, handles backoff and source silence | `apps/ingestion/src/index.js` |
| **API Server** | Serves REST API, runs 3 Kafka consumer groups, broadcasts SSE, runs cron jobs | `apps/api/src/index.js` |

### Why Kafka for 3 events/minute?

Kafka is overkill for this throughput. We include it deliberately to showcase:

1. **Decoupled concerns** — ingestion doesn't know about alerts or SSE; consumers are independent
2. **Replay capability** — reprocessing a day of events doesn't require re-polling USGS
3. **Topic design** — `earthquake.raw`, `earthquake.revisions` (compacted), `earthquake.alerts` each have different retention and partitioning semantics
4. **Consumer groups** — persister, evaluator, notifier can fail independently without data loss

> In a real product at this scale, a simple Postgres LISTEN/NOTIFY would suffice. Kafka is here to demonstrate the streaming pattern, not because the scale demands it.

---

## Alert System: 3 Tiers

### Tier 1: General Alerts (all users)

| Rule | Trigger | Severity |
|------|---------|----------|
| Global magnitude | `mag ≥ 5.0` | warning/critical |
| Tsunami | `tsunami = 1` | critical |
| Source silence | USGS unreachable for 5+ polls | warning |

### Tier 2: Location-Based Alerts (per-user)

Each user monitors up to **3 locations** (city search via Nominatim geocoding). Alerts fire when an event occurs within their configured radius.

| Rule | Trigger | Default |
|------|---------|---------|
| Proximity | `mag ≥ user_min_mag` within `radius_km` | min_mag = 3.0, radius = 500km |
| Custom rules | Per-user overrides via `user_alert_rules` table | quiet hours, PAGER level filter |

**Severity escalation:** If a M3.5 event (info) is revised to M5.2 (critical), the dedup check allows re-alerting because the severity rank increased.

### Tier 3: Swarm Detection (spatial+temporal)

Detects clusters of seismicity near user locations:

```
Swarm = 5+ events within 50km radius in the last 6 hours
```

- PostGIS `ST_DWithin` cluster query runs after each new event
- Dedup key is tied to the **cluster center + time window bucket**, not individual events
- Alerts include count, max/avg magnitude, and distance from the user's location

---

## Key Design Decisions

### Deduplication

| Level | How |
|-------|-----|
| Event dedup | Upsert on `feature.id` (USGS primary key) |
| Alert dedup | `sha256(eventId:chatId)` with 1-hour cooldown + `ON CONFLICT DO NOTHING` |
| Swarm dedup | `sha256("swarm:{clusterCenter}:{chatId}:{windowBucket}")` — prevents re-alerting same cluster every event |
| Revision detection | Compares `mag, alert, mmi, sig, tsunami` — only produces to Kafka if these safety-critical fields changed |

### Failure Handling

| Failure | Response |
|---------|----------|
| USGS down | Exponential backoff: `min(60s × 2^failures, 10 min)` |
| Single event fails | Per-event try/catch — one bad event doesn't kill the batch |
| DB succeeds, Kafka fails | `kafkaPending = true` flag → sweep job re-produces every 2 min |
| Telegram delivery fails | 3x retry with exponential backoff → unsent sweep cron every 5 min |
| USGS silent for 5+ polls | Source silence system alert sent to all users (one-shot, not repeated) |

### Write Ordering: Consistency vs. Alert Latency

The ingestion worker writes to **both** Postgres and Kafka for every event. The write order depends on severity:

| Event type | Write order | Rationale |
|------------|------------|----------|
| **Critical** (M≥6.0 or tsunami) | **Kafka first**, then Postgres | Alert pipeline starts immediately — every second counts for life-safety |
| **Normal** (everything else) | **Postgres first**, then Kafka | Consistency over speed — ensure queryable record before streaming |

This is a deliberate CAP trade-off:
- If **Postgres is down**: normal events are lost, but critical events still reach Kafka and trigger alerts
- If **Kafka is down**: events persist in Postgres (API still serves them), marked `kafkaPending` for later re-produce
- The evaluator uses an **in-memory location cache** (refreshed every 60s) so it can evaluate alerts from Kafka without hitting Postgres at all

### In-Memory Location Cache

The evaluator needs user locations to determine WHO to alert. Instead of hitting Postgres on every event:

- `location.cache.js` loads all user locations into memory on startup
- Refreshes every 60 seconds (locations rarely change)
- Uses in-memory haversine for proximity matching (< 1ms vs. ~5ms PostGIS)
- If Postgres is slow/down during an event, the evaluator still works with stale cache

This makes the alert hot path: `Kafka read → in-memory proximity check → Kafka produce` — **zero Postgres dependency**.

### Spatial Queries

We use different strategies depending on latency requirements:

| Approach | Latency | Accuracy | Use case |
|----------|---------|----------|----------|
| PostGIS `ST_DWithin` | ~5ms | Geodesic (exact) | Event queries, swarm detection |
| In-memory haversine | < 1ms | Great-circle (±0.5%) | SSE broadcast, **alert evaluation** |

- PostGIS for correctness (event listing API, swarm cluster queries)
- Haversine for speed (evaluator hot path, SSE filtering)

### Location Search

- **Nominatim** (OpenStreetMap geocoder) — free, no API key
- Proxied through our API to avoid CORS and enforce server-side rate limiting (1 req/sec)
- User selects city → we store `{ label, lat, lon, radiusKm }` with PostGIS geography column

---

## Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| Runtime | Node.js (ES modules) | Native fetch, good Kafka/Postgres ecosystem |
| Database | PostgreSQL + PostGIS (Supabase) | Spatial queries are first-class, not an afterthought |
| Streaming | Apache Kafka (Redpanda) | Decoupled consumers, replay, topic semantics |
| ORM | Prisma | Type-safe reads, `$queryRaw` for PostGIS operations |
| Frontend | React + Vite + Tailwind CSS v3 | Fast dev, dark theme, responsive |
| Geocoding | Nominatim (OpenStreetMap) | Free, no API key, 1 req/sec is fine for our scale |
| Alerts | Telegram Bot API | Push notifications with rich Markdown formatting |

---

## Project Structure

```
quake-detector/
├── apps/
│   ├── ingestion/              # Process 1: USGS → Postgres → Kafka
│   │   └── src/
│   │       ├── services/       # earthquake.service.js, health.service.js
│   │       ├── index.js        # Entry: scheduler + backoff + kafka sweep
│   │       ├── poller.js       # USGS fetch cycle + source silence
│   │       ├── producer.js     # Kafka producer (idempotent)
│   │       └── backfill.js     # Historical import with checkpoints
│   ├── api/                    # Process 2: API + consumers + SSE
│   │   └── src/
│   │       ├── consumers/      # persister, evaluator, notifier
│   │       ├── routes/         # events, health, locations, geocode, sse
│   │       ├── services/       # earthquake, alert, location, health, swarm
│   │       └── index.js        # Entry: Express + Kafka + crons
│   └── web/                    # React dashboard
│       └── src/
│           ├── components/     # EventCard, StatCard, LocationSearch, LocationManager
│           ├── hooks/          # useEvents, useLiveEvents, useLocations
│           ├── api.js          # API client
│           └── App.jsx         # Main layout
├── shared/                     # Code shared between both processes
│   ├── db/
│   │   ├── client.js           # Prisma singleton
│   │   └── migrations/         # Raw SQL for PostGIS features
│   ├── kafka/
│   │   ├── client.js           # KafkaJS factory (SASL/SSL support)
│   │   └── topics.js           # Topic contracts
│   ├── config.js               # Centralized env config
│   ├── geocoder.js             # Nominatim wrapper with rate limiting
│   └── logger.js               # Pino structured logging
├── prisma/
│   └── schema.prisma           # Database schema (source of truth)
├── scripts/
│   ├── migrate.js              # Prisma push + raw SQL migrations
│   └── setup-topics.js         # Kafka topic provisioning
├── prisma.config.ts            # Prisma v7 config (DATABASE_URL)
├── docker-compose.yml          # Local Redpanda for Kafka
├── .env.example
└── package.json
```

---

## Getting Started

```bash
# 1. Install dependencies
npm install

# 2. Copy environment config
cp .env.example .env
# Edit .env with your Supabase URL, Telegram bot token, etc.

# 3. Start local Kafka (Redpanda)
docker compose up -d

# 4. Generate Prisma client
npm run generate

# 5. Push schema to database
npm run migrate

# 6. Create Kafka topics
npm run topics

# 7. Run all three processes
npm run dev
# → Ingestion worker polls USGS
# → API server on http://localhost:3000
# → Dashboard on http://localhost:5173
```

### Scripts

| Command | What |
|---------|------|
| `npm run dev` | Starts all 3 processes concurrently |
| `npm run api` | API server only |
| `npm run ingest` | Ingestion worker only |
| `npm run web` | Dashboard dev server only |
| `npm run backfill` | Import USGS monthly archive |
| `npm run migrate` | Push Prisma schema + raw SQL migrations |
| `npm run generate` | Regenerate Prisma client |
| `npm run studio` | Open Prisma Studio (DB browser) |
| `npm run topics` | Create Kafka topics |

---

## Learnings & Trade-offs

### 1. Kafka is a teaching tool here, not a necessity

At 3 events/minute, Postgres `LISTEN/NOTIFY` would be simpler and sufficient. We chose Kafka to demonstrate:
- Topic-per-concern design (`raw`, `revisions`, `alerts`)
- Consumer group isolation (one consumer crashing doesn't affect others)
- Replay (reprocess yesterday's events without re-polling USGS)
- Idempotent production and exactly-once delivery semantics

**In production**, you'd only add Kafka when either: (a) throughput exceeds what Postgres pub/sub handles (~10K events/sec), or (b) you need durable replay for data lake ingestion.

### 2. PostGIS vs. application-level geometry

We started with application-level haversine distance for SSE filtering (fast, no DB hit), but used PostGIS `ST_DWithin` for alert evaluation and event queries. The trade-off:

| Approach | Latency | Accuracy | Use case |
|----------|---------|----------|----------|
| PostGIS `ST_DWithin` | ~5ms per query | Geodesic (exact) | Alert evaluation, event queries |
| In-memory haversine | < 1ms | Great-circle (±0.5%) | SSE broadcast filtering |

### 3. Dedup is harder than it looks

USGS sends the same event multiple times as it gets refined. Our 3-layer dedup:
- **Event level:** upsert on `feature.id` — same event across polls is one DB row
- **Revision level:** only track changes to safety-critical fields (`mag, alert, tsunami, mmi, sig`) — cosmetic updates (felt count, review status) don't trigger re-evaluation
- **Alert level:** `sha256(eventId:chatId)` with severity escalation — if the same event goes from info→critical, the user gets re-alerted

### 4. The DB-Kafka consistency gap is real

If we write to Postgres but Kafka produce fails, the event exists in DB but consumers never see it. Our fix is pragmatic: a `kafkaPending` boolean column + a sweep job every 2 minutes. At enterprise scale, you'd use the transactional outbox pattern or Kafka Connect with CDC.

### 5. Swarm detection is a product judgment call

We detect swarms as "5+ events within 50km in 6 hours" — these numbers are configurable but deliberately conservative. False positives (alerting on normal aftershock sequences) are worse than false negatives (missing a rare swarm). The dedup key is spatial-temporal: `cluster_center + time_window_bucket`, so users get at most one swarm alert per region per 6-hour window.

### 6. Source silence matters more than you think

If USGS goes down, the system should not silently stop working. Our approach:
- Exponential backoff prevents hammering a down API
- After 5 consecutive failures, a one-shot source silence alert goes to all users
- The `poll_health` table provides audit trail for post-mortem

### 7. Write ordering is a product decision, not a technical one

We asked: "If Postgres is slow, should we delay the tsunami alert?" The answer is no. So critical events (M≥6.0, tsunami) produce to Kafka FIRST and persist to Postgres SECOND. Normal events do the opposite (Postgres-first for consistency). Combined with the in-memory location cache, this means a tsunami alert can fire without touching Postgres at all on the hot path.

---

## What I'd Do Differently in Production

1. **TypeScript** — the codebase is JS for speed, but TS would catch the `BigInt` serialization issues we hit with Prisma + Telegram chat IDs
2. **Outbox pattern** — replace the `kafkaPending` flag with a proper transactional outbox for guaranteed Kafka delivery
3. **Redis** — for dedup hash caching (currently in Postgres, which is fine at this scale but adds latency)
4. **Webhook mode** — if USGS ever offers WebSocket/webhook delivery, replace polling entirely
5. **Multi-tenancy** — the current auth model is just a Telegram chat ID in localStorage. Production needs proper API keys and rate limiting
6. **Monitoring** — Prometheus metrics for poll latency, consumer lag, alert delivery rate. Currently we only have `poll_health` table and structured logs

---

## License

MIT
