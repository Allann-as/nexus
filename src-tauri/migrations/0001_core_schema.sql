-- 0001_core_schema.sql
-- The "Node Pattern": every entity in NEXUS IS a node (identity, title, area,
-- timestamps, search, links). Type-specific data lives in 1:1 satellite tables.
-- Search, timeline, tags, links and trash therefore operate ONLY over `nodes`,
-- so new entity types never require new associative tables.
--
-- IMMUTABLE ONCE COMMITTED. Changed your mind? Write the next migration.
--
-- Conventions:
--   * ids        -> UUIDv7 as TEXT (time-ordered: efficient B-tree inserts)
--   * timestamps -> INTEGER epoch milliseconds, UTC
--   * days       -> TEXT 'YYYY-MM-DD' in the user's local time

CREATE TABLE areas (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    icon        TEXT NOT NULL DEFAULT 'circle',
    color       TEXT NOT NULL DEFAULT '#7C8CF8',
    sort_order  INTEGER NOT NULL DEFAULT 0,
    archived_at INTEGER
);

CREATE TABLE nodes (
    id          TEXT PRIMARY KEY,
    kind        TEXT NOT NULL CHECK (kind IN
                 ('note','task','project','goal','habit','routine',
                  'event','file','inbox_item')),
    title       TEXT NOT NULL,
    area_id     TEXT REFERENCES areas(id),
    parent_id   TEXT REFERENCES nodes(id),
    status      TEXT NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active','done','archived','dropped')),
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    archived_at INTEGER
);
CREATE INDEX idx_nodes_kind_status ON nodes(kind, status);
CREATE INDEX idx_nodes_area   ON nodes(area_id)   WHERE area_id   IS NOT NULL;
CREATE INDEX idx_nodes_parent ON nodes(parent_id) WHERE parent_id IS NOT NULL;

-- Universal N:N relation for everything the parent_id hierarchy does not cover.
CREATE TABLE links (
    source_id  TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    target_id  TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    link_type  TEXT NOT NULL DEFAULT 'related'
                 CHECK (link_type IN ('related','blocks','references','attached_to')),
    created_at INTEGER NOT NULL,
    PRIMARY KEY (source_id, target_id, link_type)
);
CREATE INDEX idx_links_target ON links(target_id);

CREATE TABLE tags (
    id   TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE
);

CREATE TABLE node_tags (
    node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    tag_id  TEXT NOT NULL REFERENCES tags(id)  ON DELETE CASCADE,
    PRIMARY KEY (node_id, tag_id)
);
CREATE INDEX idx_node_tags_tag ON node_tags(tag_id);

-- ===== SATELLITES (1:1 with nodes, PK = FK) =====

CREATE TABLE task_details (
    node_id        TEXT PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
    due_at         INTEGER,
    scheduled_at   INTEGER,
    duration_min   INTEGER,
    priority       INTEGER NOT NULL DEFAULT 2 CHECK (priority IN (1,2,3)),
    energy         TEXT CHECK (energy IN ('deep','shallow')),
    completed_at   INTEGER,
    checklist_json TEXT
);
CREATE INDEX idx_task_due   ON task_details(due_at)       WHERE completed_at IS NULL;
CREATE INDEX idx_task_sched ON task_details(scheduled_at) WHERE completed_at IS NULL;

CREATE TABLE habit_details (
    node_id       TEXT PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
    schedule_json TEXT NOT NULL,
    target_value  REAL,
    unit          TEXT,
    routine_id    TEXT REFERENCES nodes(id),
    routine_order INTEGER,
    reminder_time TEXT
);
CREATE INDEX idx_habit_routine ON habit_details(routine_id, routine_order)
    WHERE routine_id IS NOT NULL;

CREATE TABLE goal_details (
    node_id      TEXT PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
    metric_name  TEXT NOT NULL,
    start_value  REAL NOT NULL,
    target_value REAL NOT NULL,
    unit         TEXT NOT NULL,
    direction    TEXT NOT NULL CHECK (direction IN ('increase','decrease')),
    deadline     INTEGER
);

CREATE TABLE goal_checkpoints (
    id       TEXT PRIMARY KEY,
    goal_id  TEXT NOT NULL REFERENCES goal_details(node_id) ON DELETE CASCADE,
    value    REAL NOT NULL,
    noted_at INTEGER NOT NULL,
    note     TEXT
);
CREATE INDEX idx_checkpoints ON goal_checkpoints(goal_id, noted_at);

CREATE TABLE note_details (
    node_id   TEXT PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
    body_md   TEXT NOT NULL DEFAULT '',
    is_pinned INTEGER NOT NULL DEFAULT 0 CHECK (is_pinned IN (0,1))
);

CREATE TABLE file_details (
    node_id       TEXT PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
    relative_path TEXT NOT NULL,
    mime          TEXT NOT NULL,
    size_bytes    INTEGER NOT NULL,
    sha256        TEXT NOT NULL
);
CREATE INDEX idx_file_sha ON file_details(sha256);

CREATE TABLE event_details (
    node_id        TEXT PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
    starts_at      INTEGER NOT NULL,
    ends_at        INTEGER NOT NULL,
    all_day        INTEGER NOT NULL DEFAULT 0 CHECK (all_day IN (0,1)),
    rrule          TEXT,
    recurrence_end INTEGER,
    location       TEXT
);
CREATE INDEX idx_event_range ON event_details(starts_at, ends_at);
