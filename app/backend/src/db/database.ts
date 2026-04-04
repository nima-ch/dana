import { Database } from "bun:sqlite"
import { join } from "path"
import { mkdirSync } from "fs"

function getDataDir(): string {
  return process.env.DATA_DIR || "/home/nima/dana/data"
}

let _db: Database | null = null

export function getDb(): Database {
  if (!_db) throw new Error("Database not initialized — call initDb() first")
  return _db
}

export function initDb(): Database {
  const dataDir = getDataDir()
  mkdirSync(dataDir, { recursive: true })
  const dbPath = join(dataDir, "dana.db")
  _db = new Database(dbPath)
  _db.run("PRAGMA journal_mode = WAL")
  _db.run("PRAGMA foreign_keys = ON")
  _db.run("PRAGMA synchronous = NORMAL")
  applySchema(_db)
  return _db
}

function applySchema(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS topics (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'draft',
      current_version INTEGER NOT NULL DEFAULT 0,
      models TEXT NOT NULL DEFAULT '{}',
      settings TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS parties (
      id TEXT NOT NULL,
      topic_id TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'non_state',
      description TEXT NOT NULL DEFAULT '',
      weight REAL NOT NULL DEFAULT 0,
      weight_factors TEXT NOT NULL DEFAULT '{}',
      weight_evidence TEXT NOT NULL DEFAULT '{}',
      agenda TEXT NOT NULL DEFAULT '',
      means TEXT NOT NULL DEFAULT '[]',
      circle TEXT NOT NULL DEFAULT '{"visible":[],"shadow":[]}',
      stance TEXT NOT NULL DEFAULT 'passive',
      vulnerabilities TEXT NOT NULL DEFAULT '[]',
      auto_discovered INTEGER NOT NULL DEFAULT 1,
      user_verified INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (id, topic_id),
      FOREIGN KEY (topic_id) REFERENCES topics(id) ON DELETE CASCADE
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS clues (
      id TEXT NOT NULL,
      topic_id TEXT NOT NULL,
      current_version INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'verified',
      added_by TEXT NOT NULL DEFAULT 'auto',
      added_at TEXT NOT NULL,
      last_updated_at TEXT NOT NULL,
      PRIMARY KEY (id, topic_id),
      FOREIGN KEY (topic_id) REFERENCES topics(id) ON DELETE CASCADE
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS clue_versions (
      clue_id TEXT NOT NULL,
      topic_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      date TEXT NOT NULL,
      title TEXT NOT NULL,
      raw_source TEXT NOT NULL DEFAULT '{}',
      source_credibility TEXT NOT NULL DEFAULT '{}',
      bias_corrected_summary TEXT NOT NULL DEFAULT '',
      relevance_score REAL NOT NULL DEFAULT 0,
      party_relevance TEXT NOT NULL DEFAULT '[]',
      domain_tags TEXT NOT NULL DEFAULT '[]',
      timeline_date TEXT NOT NULL DEFAULT '',
      clue_type TEXT NOT NULL DEFAULT 'event',
      change_note TEXT NOT NULL DEFAULT '',
      key_points TEXT NOT NULL DEFAULT '[]',
      PRIMARY KEY (clue_id, topic_id, version),
      FOREIGN KEY (clue_id, topic_id) REFERENCES clues(id, topic_id) ON DELETE CASCADE
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS states (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      topic_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      label TEXT NOT NULL,
      created_at TEXT NOT NULL,
      trigger TEXT NOT NULL,
      clue_snapshot TEXT NOT NULL DEFAULT '{}',
      forum_session_id TEXT,
      verdict_id TEXT,
      delta_from INTEGER,
      delta_summary TEXT,
      FOREIGN KEY (topic_id) REFERENCES topics(id) ON DELETE CASCADE
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS representatives (
      id TEXT NOT NULL,
      topic_id TEXT NOT NULL,
      party_id TEXT NOT NULL,
      persona_title TEXT NOT NULL DEFAULT '',
      persona_prompt TEXT NOT NULL DEFAULT '',
      speaking_weight REAL NOT NULL DEFAULT 0,
      speaking_budget TEXT NOT NULL DEFAULT '{}',
      auto_generated INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (id, topic_id),
      FOREIGN KEY (topic_id) REFERENCES topics(id) ON DELETE CASCADE
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS forum_sessions (
      id TEXT NOT NULL,
      topic_id TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      type TEXT NOT NULL DEFAULT 'full',
      status TEXT NOT NULL DEFAULT 'running',
      started_at TEXT NOT NULL,
      completed_at TEXT,
      PRIMARY KEY (id, topic_id),
      FOREIGN KEY (topic_id) REFERENCES topics(id) ON DELETE CASCADE
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS forum_rounds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      topic_id TEXT NOT NULL,
      round_number INTEGER NOT NULL,
      round_type TEXT NOT NULL
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS forum_turns (
      id TEXT NOT NULL,
      round_id INTEGER NOT NULL,
      topic_id TEXT NOT NULL,
      party_id TEXT NOT NULL,
      representative_id TEXT NOT NULL,
      party_name TEXT NOT NULL DEFAULT '',
      persona_title TEXT,
      position TEXT,
      evidence TEXT NOT NULL DEFAULT '[]',
      challenges TEXT NOT NULL DEFAULT '[]',
      concessions TEXT NOT NULL DEFAULT '[]',
      statement TEXT NOT NULL DEFAULT '',
      scenario_endorsement TEXT,
      clues_cited TEXT NOT NULL DEFAULT '[]',
      word_count INTEGER NOT NULL DEFAULT 0,
      round INTEGER NOT NULL DEFAULT 1,
      type TEXT NOT NULL DEFAULT 'opening_statements',
      created_at TEXT NOT NULL,
      PRIMARY KEY (id, topic_id),
      FOREIGN KEY (round_id) REFERENCES forum_rounds(id) ON DELETE CASCADE
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS forum_scenarios (
      id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      topic_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      proposed_by TEXT NOT NULL DEFAULT '',
      supported_by TEXT NOT NULL DEFAULT '[]',
      contested_by TEXT NOT NULL DEFAULT '[]',
      clues_cited TEXT NOT NULL DEFAULT '[]',
      benefiting_parties TEXT NOT NULL DEFAULT '[]',
      required_conditions TEXT NOT NULL DEFAULT '[]',
      falsification_conditions TEXT NOT NULL DEFAULT '[]',
      PRIMARY KEY (id, session_id, topic_id),
      FOREIGN KEY (session_id, topic_id) REFERENCES forum_sessions(id, topic_id) ON DELETE CASCADE
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS forum_scenario_summaries (
      session_id TEXT NOT NULL,
      topic_id TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '{}',
      PRIMARY KEY (session_id, topic_id),
      FOREIGN KEY (session_id, topic_id) REFERENCES forum_sessions(id, topic_id) ON DELETE CASCADE
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS expert_councils (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      topic_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      verdict_id TEXT,
      created_at TEXT NOT NULL,
      experts TEXT NOT NULL DEFAULT '[]',
      FOREIGN KEY (topic_id) REFERENCES topics(id) ON DELETE CASCADE
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS expert_assessments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      council_id INTEGER NOT NULL,
      topic_id TEXT NOT NULL,
      expert_id TEXT NOT NULL,
      expert_name TEXT NOT NULL,
      domain TEXT NOT NULL,
      scenario_assessments TEXT NOT NULL DEFAULT '[]',
      weight_challenges TEXT NOT NULL DEFAULT '[]',
      deliberation_text TEXT,
      FOREIGN KEY (council_id) REFERENCES expert_councils(id) ON DELETE CASCADE
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS final_verdicts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      council_id INTEGER NOT NULL,
      topic_id TEXT NOT NULL,
      synthesized_at TEXT NOT NULL,
      scenarios_ranked TEXT NOT NULL DEFAULT '[]',
      final_assessment TEXT NOT NULL DEFAULT '',
      confidence_note TEXT NOT NULL DEFAULT '',
      weight_challenge_decisions TEXT NOT NULL DEFAULT '[]',
      FOREIGN KEY (council_id) REFERENCES expert_councils(id) ON DELETE CASCADE
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS forum_scratchpads (
      representative_id TEXT NOT NULL,
      session_id        TEXT NOT NULL,
      topic_id          TEXT NOT NULL,
      party_id          TEXT NOT NULL,
      content           TEXT NOT NULL DEFAULT '{}',
      created_at        TEXT NOT NULL,
      PRIMARY KEY (representative_id, session_id, topic_id)
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS forum_supervisor_state (
      session_id        TEXT NOT NULL,
      topic_id          TEXT NOT NULL,
      turn_count        INTEGER NOT NULL DEFAULT 0,
      turn_distribution TEXT NOT NULL DEFAULT '{}',
      live_scenarios    TEXT NOT NULL DEFAULT '[]',
      compressed_history TEXT NOT NULL DEFAULT '',
      status            TEXT NOT NULL DEFAULT 'running',
      closure_reason    TEXT,
      updated_at        TEXT NOT NULL,
      PRIMARY KEY (session_id, topic_id)
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS prompt_configs (
      name TEXT PRIMARY KEY,
      model TEXT,
      tools TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT
    )
  `)

  // Migrations for existing databases
  try { db.run(`ALTER TABLE parties ADD COLUMN weight_evidence TEXT NOT NULL DEFAULT '{}'`) } catch { /* column already exists */ }
}
