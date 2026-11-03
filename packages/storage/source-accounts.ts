import type { DatabaseSync } from 'node:sqlite';

/** Return an account only when every import referencing an artifact agrees explicitly. */
export function resolveArtifactAccount(db: DatabaseSync, artifactId: number): string | null {
  if (![4, 5, 6, 7, 8, 9, 10].includes(Number(db.prepare('PRAGMA user_version').get()?.user_version))) return null;
  const references = db.prepare(`SELECT d.account_id FROM artifacts a
    JOIN import_files f ON f.kind = a.kind AND f.digest = a.digest
    LEFT JOIN import_account_decisions d ON d.session_id = f.session_id AND d.revision = (
      SELECT MAX(previous.revision) FROM import_account_decisions previous WHERE previous.session_id = f.session_id
    ) WHERE a.id = ?`).all(artifactId);
  if (!references.length || references.some((row) => typeof row.account_id !== 'string')) return null;
  const accounts = new Set(references.map((row) => row.account_id as string));
  return accounts.size === 1 ? [...accounts][0]! : null;
}

/** An unassigned completed import is never silently merged into an existing account. */
export function unassignedSessions(db: DatabaseSync): string[] {
  if (![4, 5, 6, 7, 8, 9, 10].includes(Number(db.prepare('PRAGMA user_version').get()?.user_version))) return [];
  return db.prepare(`SELECT s.id FROM import_sessions s WHERE s.state = 'complete'
    AND NOT EXISTS (SELECT 1 FROM import_account_decisions d WHERE d.session_id = s.id) ORDER BY s.id`).all().map((row) => {
    if (typeof row.id !== 'string') throw new Error('Nieprawidłowa sesja');
    return row.id;
  });
}

/** The caller confirms a frozen list; a changed assignment causes the whole transaction to fail. */
export function assignSessions(db: DatabaseSync, accountId: string, sessions: readonly string[]): void {
  if (!sessions.length || new Set(sessions).size !== sessions.length) throw new Error('account_plan_changed');
  db.exec('BEGIN IMMEDIATE');
  try {
    if (!db.prepare('SELECT id FROM source_accounts WHERE id = ?').get(accountId)) throw new Error('account_plan_changed');
    const available = new Set(unassignedSessions(db));
    if (sessions.some((id) => !available.has(id))) throw new Error('account_plan_changed');
    const insert = db.prepare("INSERT INTO import_account_decisions VALUES (?, 1, ?, 'user_confirmed', ?)");
    const created = new Date().toISOString();
    for (const id of sessions) insert.run(id, accountId, created);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
