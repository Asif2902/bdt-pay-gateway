/**
 * SQLite-backed admin store.
 * Persists:
 *   - admin_sessions  (active JWT jti values for logout/revocation)
 *   - admin_audit_log (who did what and when)
 *
 * The DB file lives at DATA_DIR/admin.db (default: /home/user/app/data/admin.db)
 * so it survives sandbox restarts and is outside the git-tracked tree.
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DATA_DIR = process.env.ADMIN_DB_DIR ?? path.join(process.cwd(), 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'admin.db');

const db = new Database(DB_PATH);

// Enable WAL for better concurrent read performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── Schema ──────────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS admin_sessions (
    jti       TEXT PRIMARY KEY,
    issued_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    ip        TEXT
  );

  CREATE TABLE IF NOT EXISTS admin_audit_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    action     TEXT NOT NULL,
    target_type TEXT,
    target_id  TEXT,
    details    TEXT,
    ip         TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  -- Clean up expired sessions automatically
  CREATE INDEX IF NOT EXISTS idx_sessions_exp ON admin_sessions(expires_at);
  CREATE INDEX IF NOT EXISTS idx_audit_created ON admin_audit_log(created_at DESC);
`);

// ── Session helpers ──────────────────────────────────────────────────────────

const insertSession = db.prepare<{ jti: string; issued_at: number; expires_at: number; ip: string | null }>(
  `INSERT OR REPLACE INTO admin_sessions(jti, issued_at, expires_at, ip)
   VALUES (@jti, @issued_at, @expires_at, @ip)`,
);

const deleteSession = db.prepare<string>(
  `DELETE FROM admin_sessions WHERE jti = ?`,
);

const findSession = db.prepare<string>(
  `SELECT * FROM admin_sessions WHERE jti = ? AND expires_at > unixepoch()`,
);

const pruneExpired = db.prepare(
  `DELETE FROM admin_sessions WHERE expires_at <= unixepoch()`,
);

export function saveSession(jti: string, expiresAt: number, ip: string | null): void {
  pruneExpired.run();
  insertSession.run({ jti, issued_at: Math.floor(Date.now() / 1000), expires_at: expiresAt, ip });
}

export function revokeSession(jti: string): void {
  deleteSession.run(jti);
}

export function isSessionValid(jti: string): boolean {
  const row = findSession.get(jti);
  return row !== undefined;
}

// ── Audit log helpers ────────────────────────────────────────────────────────

const insertAudit = db.prepare<{
  action: string;
  target_type: string | null;
  target_id: string | null;
  details: string | null;
  ip: string | null;
}>(
  `INSERT INTO admin_audit_log(action, target_type, target_id, details, ip)
   VALUES (@action, @target_type, @target_id, @details, @ip)`,
);

const listAudit = db.prepare(
  `SELECT * FROM admin_audit_log ORDER BY created_at DESC LIMIT ? OFFSET ?`,
);

export interface AuditEntry {
  action: string;
  targetType?: string;
  targetId?: string;
  details?: Record<string, unknown>;
  ip?: string | null;
}

export function logAudit(entry: AuditEntry): void {
  insertAudit.run({
    action: entry.action,
    target_type: entry.targetType ?? null,
    target_id: entry.targetId ?? null,
    details: entry.details ? JSON.stringify(entry.details) : null,
    ip: entry.ip ?? null,
  });
}

export function getAuditLogs(page = 0, pageSize = 50): unknown[] {
  const rows = listAudit.all(pageSize, page * pageSize) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    ...r,
    details: r.details ? JSON.parse(r.details as string) : null,
  }));
}

export default db;
