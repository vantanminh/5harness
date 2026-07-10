-- Phase A durable schema (npm-harness)
-- Bookkeeping + tables needed for future intake/story/decision commands.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS intake (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
    input_type    TEXT    NOT NULL
                         CHECK(input_type IN (
                           'new_spec','spec_slice','change_request',
                           'new_initiative','maintenance','harness_improvement'
                         )),
    summary       TEXT    NOT NULL,
    risk_lane     TEXT    NOT NULL
                         CHECK(risk_lane IN ('tiny','normal','high_risk')),
    risk_flags    TEXT,
    affected_docs TEXT,
    story_id      TEXT,
    notes         TEXT
);

CREATE TABLE IF NOT EXISTS story (
    id                TEXT PRIMARY KEY,
    title             TEXT NOT NULL,
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    risk_lane         TEXT NOT NULL
                      CHECK(risk_lane IN ('tiny','normal','high_risk')),
    contract_doc      TEXT,
    status            TEXT NOT NULL DEFAULT 'planned'
                      CHECK(status IN (
                        'planned','in_progress','implemented','changed','retired'
                      )),
    unit_proof        INTEGER NOT NULL DEFAULT 0,
    integration_proof INTEGER NOT NULL DEFAULT 0,
    e2e_proof         INTEGER NOT NULL DEFAULT 0,
    platform_proof    INTEGER NOT NULL DEFAULT 0,
    verify_command    TEXT,
    evidence          TEXT,
    notes             TEXT
);

CREATE TABLE IF NOT EXISTS decision (
    id                    TEXT PRIMARY KEY,
    title                 TEXT NOT NULL,
    created_at            TEXT NOT NULL DEFAULT (datetime('now')),
    status                TEXT NOT NULL DEFAULT 'proposed'
                          CHECK(status IN (
                            'proposed','accepted','superseded','rejected'
                          )),
    doc_path              TEXT,
    verify_command        TEXT,
    last_verified_at      TEXT,
    last_verified_result  TEXT
                          CHECK(last_verified_result IN ('pass','fail') OR
                                last_verified_result IS NULL),
    notes                 TEXT
);

CREATE TABLE IF NOT EXISTS backlog (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at            TEXT    NOT NULL DEFAULT (datetime('now')),
    title                 TEXT    NOT NULL,
    discovered_while      TEXT,
    current_pain          TEXT,
    suggested_improvement TEXT,
    risk                  TEXT    CHECK(risk IN ('tiny','normal','high_risk')),
    status                TEXT    NOT NULL DEFAULT 'proposed'
                          CHECK(status IN (
                            'proposed','accepted','implemented','rejected'
                          )),
    predicted_impact      TEXT,
    actual_outcome        TEXT,
    notes                 TEXT
);

CREATE TABLE IF NOT EXISTS trace (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
    task_summary    TEXT    NOT NULL,
    intake_id       INTEGER REFERENCES intake(id),
    story_id        TEXT    REFERENCES story(id),
    agent           TEXT,
    actions_taken   TEXT,
    files_read      TEXT,
    files_changed   TEXT,
    decisions_made  TEXT,
    errors          TEXT,
    outcome         TEXT    CHECK(outcome IN (
                        'completed','blocked','partial','failed'
                    ) OR outcome IS NULL),
    duration_ms     INTEGER,
    notes           TEXT
);
