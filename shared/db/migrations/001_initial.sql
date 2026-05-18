-- ============================================================
-- QuakeDetector — Initial Schema
-- Requires: PostGIS extension (enabled by default on Supabase)
-- ============================================================

CREATE EXTENSION IF NOT EXISTS postgis;

-- ── Core event table ────────────────────────────────────────
-- Maps 1:1 to USGS GeoJSON feature properties + geometry.
CREATE TABLE IF NOT EXISTS earthquakes (
    id          TEXT PRIMARY KEY,                 -- USGS event id, e.g. 'us2025abc'

    -- Surfaced fields (product judgment: these matter most)
    mag         NUMERIC,                          -- magnitude
    mag_type    TEXT,                              -- ml, md, mw, etc.
    place       TEXT,                              -- human-readable location
    event_time  TIMESTAMPTZ NOT NULL,             -- when the quake occurred
    updated_at  TIMESTAMPTZ,                      -- last USGS revision timestamp
    sig         INTEGER,                           -- significance 0-1000 (composite score)
    mmi         NUMERIC,                           -- Modified Mercalli Intensity (ground shaking)
    cdi         NUMERIC,                           -- Community Decimal Intensity
    alert       TEXT,                              -- PAGER: green/yellow/orange/red
    tsunami     SMALLINT DEFAULT 0,               -- 0 or 1
    felt        INTEGER,                           -- number of felt reports
    depth       NUMERIC,                           -- km below surface
    status      TEXT,                              -- 'automatic' or 'reviewed'

    -- Stored for audit / dedup / quality (not surfaced on dashboard)
    net         TEXT,                              -- network code: us, ak, ci, nc, etc.
    code        TEXT,                              -- network-specific event code
    ids         TEXT,                              -- comma-delimited list of associated ids
    sources     TEXT,                              -- comma-delimited contributing networks
    types       TEXT,                              -- comma-delimited available product types
    nst         INTEGER,                           -- number of seismic stations used
    dmin        NUMERIC,                           -- distance to nearest station (degrees)
    rms         NUMERIC,                           -- root-mean-square travel time residual
    gap         NUMERIC,                           -- azimuthal gap (degrees)
    event_type  TEXT DEFAULT 'earthquake',         -- earthquake, quarry blast, etc.
    url         TEXT,                              -- USGS event page link
    detail_url  TEXT,                              -- GeoJSON detail endpoint

    -- PostGIS geography for spatial queries
    geog        GEOGRAPHY(Point, 4326),

    ingested_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes: time-range queries, spatial proximity, significance ranking
CREATE INDEX IF NOT EXISTS idx_eq_time  ON earthquakes (event_time DESC);
CREATE INDEX IF NOT EXISTS idx_eq_geog  ON earthquakes USING GIST (geog);
CREATE INDEX IF NOT EXISTS idx_eq_sig   ON earthquakes (sig DESC);
CREATE INDEX IF NOT EXISTS idx_eq_net   ON earthquakes (net);

-- ── Event revisions ─────────────────────────────────────────
-- Tracks field-level diffs when USGS revises an event.
CREATE TABLE IF NOT EXISTS event_revisions (
    id          SERIAL PRIMARY KEY,
    event_id    TEXT NOT NULL REFERENCES earthquakes(id) ON DELETE CASCADE,
    field_name  TEXT NOT NULL,                    -- 'mag', 'alert', 'mmi', etc.
    old_value   TEXT,
    new_value   TEXT,
    revised_at  TIMESTAMPTZ DEFAULT NOW(),
    alert_reeval BOOLEAN DEFAULT FALSE            -- did this trigger alert re-evaluation?
);

CREATE INDEX IF NOT EXISTS idx_rev_event ON event_revisions (event_id);

-- ── User locations ──────────────────────────────────────────
-- Each row is a monitored location tied to a Telegram chat.
CREATE TABLE IF NOT EXISTS user_locations (
    id              SERIAL PRIMARY KEY,
    label           TEXT NOT NULL,                -- 'Home - Tokyo', 'Office - LA'
    latitude        NUMERIC NOT NULL,
    longitude       NUMERIC NOT NULL,
    geog            GEOGRAPHY(Point, 4326),
    radius_km       INTEGER DEFAULT 500,          -- alert radius
    telegram_chat_id BIGINT NOT NULL,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_loc_geog ON user_locations USING GIST (geog);

-- ── Alert audit log ─────────────────────────────────────────
-- Every alert ever sent or attempted. Dedup key prevents duplicates.
CREATE TABLE IF NOT EXISTS alerts_log (
    id          SERIAL PRIMARY KEY,
    event_id    TEXT NOT NULL REFERENCES earthquakes(id) ON DELETE CASCADE,
    chat_id     BIGINT NOT NULL,
    rule_type   TEXT NOT NULL,                    -- 'global', 'proximity', 'tsunami', 'revision'
    severity    TEXT NOT NULL,                    -- 'info', 'warning', 'critical'
    message     TEXT,
    sent        BOOLEAN DEFAULT FALSE,
    sent_at     TIMESTAMPTZ,
    is_revision BOOLEAN DEFAULT FALSE,
    dedup_hash  TEXT UNIQUE,                      -- sha256(event_id:chat_id) — prevents duplicates
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alert_event ON alerts_log (event_id);
CREATE INDEX IF NOT EXISTS idx_alert_unsent ON alerts_log (sent) WHERE sent = FALSE;

-- ── Poll health ─────────────────────────────────────────────
-- One row per poll cycle. The system's own heartbeat.
CREATE TABLE IF NOT EXISTS poll_health (
    id              SERIAL PRIMARY KEY,
    polled_at       TIMESTAMPTZ DEFAULT NOW(),
    status          TEXT NOT NULL,                -- 'success', 'error', 'stale'
    events_fetched  INTEGER DEFAULT 0,
    new_events      INTEGER DEFAULT 0,
    revisions       INTEGER DEFAULT 0,
    response_ms     INTEGER,
    error_message   TEXT
);

-- ── Checkpoints ─────────────────────────────────────────────
-- Key-value store for backfill progress, last poll timestamp, etc.
CREATE TABLE IF NOT EXISTS checkpoints (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL,
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);
