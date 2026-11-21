import { DatabaseSync } from 'node:sqlite';

export class WatchStore {
  constructor(path, binding = null) {
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS latest(name TEXT PRIMARY KEY, value REAL, received_at INTEGER NOT NULL, source TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS readings(id INTEGER PRIMARY KEY, name TEXT NOT NULL, value REAL, received_at INTEGER NOT NULL, measured_at INTEGER, source TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS readings_time ON readings(received_at);
      CREATE TABLE IF NOT EXISTS sleep_sessions(source TEXT NOT NULL, session_id INTEGER NOT NULL, started_at INTEGER NOT NULL, ended_at INTEGER, duration_minutes REAL NOT NULL, hr_samples INTEGER NOT NULL, motion_samples INTEGER NOT NULL, received_at INTEGER NOT NULL, PRIMARY KEY(source,session_id));`);
    if (binding) {
      this.db.exec('CREATE TABLE IF NOT EXISTS receiver_binding (id INTEGER PRIMARY KEY CHECK(id=1), athlete_id TEXT NOT NULL, device_id TEXT NOT NULL)');
      this.db.prepare('INSERT OR IGNORE INTO receiver_binding VALUES (1, ?, ?)').run(binding.athleteId, binding.deviceId);
      const saved = this.db.prepare('SELECT athlete_id,device_id FROM receiver_binding WHERE id=1').get();
      if (saved.athlete_id !== binding.athleteId || saved.device_id !== binding.deviceId) {
        this.close();
        throw Error('The watch database is already associated with a different crew profile or device.');
      }
    }
  }
  latest() {
    const metrics = {};
    let receivedAt = null, source = null;
    const measured = this.db.prepare('SELECT measured_at FROM readings WHERE name=? AND received_at=? ORDER BY id DESC LIMIT 1');
    for (const row of this.db.prepare('SELECT * FROM latest').all()) {
      metrics[row.name] = { value: row.value, receivedAt: row.received_at };
      const timestamp = measured.get(row.name, row.received_at)?.measured_at;
      if (timestamp != null) metrics[row.name].measuredAt = timestamp;
      if (receivedAt === null || row.received_at >= receivedAt) { receivedAt = row.received_at; source = row.source; }
    }
    if (metrics.oxigenacao_percentual?.value == null) {
      const oxygen = this.db.prepare("SELECT value,received_at,measured_at FROM readings WHERE name='oxigenacao_percentual' AND value IS NOT NULL ORDER BY id DESC LIMIT 1").get();
      if (oxygen) metrics.oxigenacao_percentual = { value: oxygen.value, receivedAt: oxygen.received_at, measuredAt: oxygen.measured_at };
    }
    return { metrics, receivedAt, source, serverTime: Date.now() };
  }
  record(entries, source, now, body) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const timestamp = body.atualizado_em;
      const measured = typeof timestamp === 'number' || (typeof timestamp === 'string' && /^\d+$/.test(timestamp)) ? Number(timestamp) : NaN;
      const measuredAt = Number.isSafeInteger(measured) && measured > 0 && measured <= now + 60000 ? measured : null;
      for (const [name] of entries) {
        const old = this.db.prepare('SELECT value FROM latest WHERE name=?').get(name);
        const value = body[name];
        if (!name.startsWith('sleep_') || !old || old.value !== value) {
          this.db.prepare('INSERT INTO readings(name,value,received_at,measured_at,source) VALUES(?,?,?,?,?)').run(name,value,now,measuredAt,source);
        }
        this.db.prepare('INSERT INTO latest VALUES(?,?,?,?) ON CONFLICT(name) DO UPDATE SET value=excluded.value,received_at=excluded.received_at,source=excluded.source').run(name,value,now,source);
      }
      if (body.sleep_session_id > 0 && body.sleep_session_started_at > 0 && body.sleep_session_minutes != null) {
        this.db.prepare(`INSERT INTO sleep_sessions VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(source,session_id) DO UPDATE SET
          ended_at=excluded.ended_at,duration_minutes=excluded.duration_minutes,hr_samples=excluded.hr_samples,motion_samples=excluded.motion_samples,received_at=excluded.received_at`)
          .run(source,body.sleep_session_id,body.sleep_session_started_at,body.sleep_session_ended_at || null,body.sleep_session_minutes,body.sleep_hr_samples ?? 0,body.sleep_motion_samples ?? 0,now);
      }
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  history(limit) { return this.db.prepare("SELECT name,value,received_at,measured_at,source FROM readings WHERE name IN ('batimentos_bpm','oxigenacao_percentual','sleep_session_minutes') ORDER BY id DESC LIMIT ?").all(limit); }
  sessions() { return this.db.prepare('SELECT * FROM sleep_sessions ORDER BY started_at DESC LIMIT 50').all(); }
  close() { this.db.close(); }
}
