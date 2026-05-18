# QuakeDetector

QuakeDetector is a real-time, location-based earthquake monitoring and alerting platform. Built to ingest continuous data from the USGS, it processes global seismic events, detects swarms, and routes low-latency, personalized alerts via Telegram.

## System Architecture
We utilize a decoupled, event-driven microservice architecture optimized for high I/O ingestion and CPU-bound spatial evaluation.

1. **Ingestion Worker (`apps/ingestion`)**: A continuous polling daemon (10s backoff). Its sole responsibility is to query USGS, normalize GeoJSON, and perform transactional upserts into PostgreSQL.
2. **API & Evaluator (`apps/api`)**: A clusterable Node.js server that maintains Server-Sent Events (SSE) connections with clients and runs a heavy Rules Engine to evaluate alert conditions (Global thresholds, Proximity, and Swarms).
3. **Storage**: PostgreSQL with PostGIS for geospatial indexing. 

---

## Architectural Justifications & Trade-offs (Founding Engineer Notes)

### 1. Choosing Postgres Pub/Sub (`LISTEN`/`NOTIFY`)
Initially, the system utilized Kafka (Redpanda) to pipe events from Ingestion to the Evaluator. We removed Kafka in favor of Postgres `LISTEN/NOTIFY`.
*   **The Problem:** The "Dual Write" problem. If the Ingestion worker writes to Postgres, but crashes before publishing to Kafka, the DB and the message broker are out of sync.
*   **The Solution:** By moving to Postgres `NOTIFY`, the database transaction and the broadcast signal are strictly coupled. Furthermore, removing Kafka eliminates a heavy infrastructure dependency, drastically reducing DevOps overhead for a startup. 
*   **Trade-off:** Postgres notifications are ephemeral. If the API server is offline, it misses the signal. To mitigate this, we rely on the persistent `alert_logs` table and a background "retry sweep" cron to guarantee delivery.

### 2. Decoupling Ingestion from Evaluation
It is tempting to place the Alert Evaluator logic inside the Ingestion worker to avoid firing a `NOTIFY` for every tiny earthquake. We explicitly avoided this.
*   **Why:** Alert evaluation involves heavy spatial math and DB queries. If a massive swarm hits and USGS returns 100 new earthquakes in one poll, evaluating them could block the Node.js event loop for seconds. This would delay the next USGS poll, causing our ingestion to fall behind real-time.
*   **Scaling:** By keeping them separate, we can run exactly **1** Ingestion worker (to prevent USGS rate-limiting) while scaling the API Server to **50+** instances to handle evaluation and SSE routing concurrently.

### 3. Spatial Optimization: In-Memory `rbush` vs. Database vs. Flat Arrays
When a new earthquake occurs, we must find all users whose alert radii overlap the event.
*   **The Flat Array (Naïve):** Running the Haversine formula on an array of 100,000 users takes roughly **~10ms** in Node.js. Running this 50 times a minute will introduce noticeable jitter to the single-threaded event loop, delaying web requests and SSE streams.
*   **The Database (`ST_DWithin`):** Querying Postgres for every single earthquake is I/O heavy and creates a tight bottleneck on the DB.
*   **The Solution (In-Memory Spatial Index):** We load user locations into memory and index them using an `rbush` R-Tree (Bounding Box grid). 
    *   *The Math:* Instead of an $O(N)$ loop checking 100,000 users, `rbush` performs an $O(\log N)$ search to find the ~50 users located in the same geographic bounding box. We then run the expensive trigonometry (Haversine) *only* on those 50 candidates, taking **< 0.05ms** and keeping the event loop completely unblocked.

### 4. Fast-Failing Swarm Detection (99% Cost Reduction)
Swarm detection (e.g., finding 5 earthquakes within 50km in 6 hours) requires an expensive `ST_DWithin` query against historical DB rows. 
*   **Optimization:** Before querying the database, the Evaluator checks our in-memory `rbush` cache. If no users are tracking the geographic area of the new earthquake, the array returns empty `[]`. We instantly abort the swarm logic. 
*   **Result:** Since the vast majority of global earthquakes occur in unpopulated oceans, this simple filter prevents 99% of global earthquakes from ever triggering an expensive database query.

### 5. Handling Data Mutability (The Revisions Edge Case)
The USGS frequently revises earthquake data (e.g., bumping a magnitude from `M4.5` to `M6.2` after seismologist review). 
*   If we treated events as immutable, we would fail to alert users of escalated threats.
*   Our ingestion worker performs `upserts`, diffs critical safety fields, logs an `EventRevision` record, and fires a specific `revision: true` notification. The evaluator intercepts this and re-evaluates the event, issuing an escalated 🔴 **REVISED ALERT** to users if new thresholds are crossed.

---

## Local Development
1. Ensure PostgreSQL (with PostGIS extension) is running.
2. Setup environment variables in `.env`.
3. `npx prisma db push`
4. Run ingestion worker: `npm run start:ingestion`
5. Run API server: `npm run start:api`
