import { randomUUID } from 'node:crypto';

export function bad(message, status = 400) { return Object.assign(Error(message), { status }); }
const finite = (v, min, max) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const median = xs => { const a = [...xs].sort((a,b)=>a-b); return a.length ? (a[Math.floor((a.length-1)/2)]+a[Math.floor(a.length/2)])/2 : null; };
const spread = xs => { const a=[...xs].sort((a,b)=>a-b); return a.length >= 12 ? a[Math.floor((a.length-1)*.95)]-a[Math.floor((a.length-1)*.05)] : null; };

export class ExerciseStore {
  constructor(db) {
    this.db = db;
    db.exec(`CREATE TABLE IF NOT EXISTS exercise_sessions(
      id TEXT PRIMARY KEY, athlete_id TEXT NOT NULL, watch_source TEXT NOT NULL,
      exercise_code TEXT NOT NULL, protocol_id TEXT NOT NULL, equipment TEXT NOT NULL,
      load_kg REAL, camera_orientation TEXT NOT NULL, target_repetitions INTEGER NOT NULL,
      started_at INTEGER NOT NULL, ended_at INTEGER, recovery_end INTEGER,
      rep_count INTEGER, perceived_effort INTEGER, phase TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS exercise_phases(session_id TEXT NOT NULL, started_at INTEGER NOT NULL, ended_at INTEGER, phase TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS exercise_samples(session_id TEXT NOT NULL, frame_id INTEGER NOT NULL,
      captured_at INTEGER NOT NULL, received_at INTEGER NOT NULL, quality REAL NOT NULL,
      left_knee REAL NOT NULL, right_knee REAL NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL, model TEXT NOT NULL,
      PRIMARY KEY(session_id,frame_id));`);
  }
  session(id) {
    const row = this.db.prepare('SELECT * FROM exercise_sessions WHERE id=?').get(id);
    if (!row) throw bad('Session not found',404);
    return row;
  }
  open(body, now = Date.now()) {
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(body.athlete_id ?? '')) throw bad('Enter a pseudonymous profile ID');
    if (body.watch_confirmed !== true) throw bad('Confirm the watch belongs to this participant');
    if (body.rest_confirmed !== true) throw bad('Confirm the pre-exercise rest period');
    if (body.exercise_code !== 'squat' || body.protocol_id !== 'SQUAT-01') throw bad('Unsupported exercise protocol');
    if (!['bodyweight','resistance_device','free_weights'].includes(body.equipment)) throw bad('Select equipment');
    if (body.load_kg !== null && !finite(body.load_kg,0,500)) throw bad('Invalid recorded resistance');
    if (!['front','side','oblique'].includes(body.camera_orientation)) throw bad('Select camera setup');
    if (!Number.isInteger(body.target_repetitions) || !finite(body.target_repetitions,1,200)) throw bad('Invalid repetition target');
    const watch = this.db.prepare("SELECT source,received_at FROM latest WHERE name='batimentos_bpm' AND value IS NOT NULL").get();
    if (!watch || now-watch.received_at>30000) throw bad('Wait for a fresh watch heart-rate reading',409);
    const busy=this.db.prepare('SELECT id FROM exercise_sessions WHERE ended_at IS NULL OR recovery_end>? LIMIT 1').get(now);
    if (busy) throw bad('Finish the previous session and its 2-minute recovery first',409);
    const id=randomUUID();
    this.db.prepare('INSERT INTO exercise_sessions VALUES(?,?,?,?,?,?,?,?,?,?,NULL,NULL,NULL,NULL,?)')
      .run(id,body.athlete_id,watch.source,'squat','SQUAT-01',body.equipment,body.load_kg,body.camera_orientation,body.target_repetitions,now,'running');
    this.db.prepare('INSERT INTO exercise_phases VALUES(?,?,NULL,?)').run(id,now,'running');
    return { session_id:id };
  }
  samples(id, body, now=Date.now()) {
    const session=this.session(id);
    if (session.ended_at) throw bad('Session already finished',409);
    if (!Array.isArray(body.samples) || !body.samples.length || body.samples.length>500) throw bad('Expected 1–500 samples');
    const rows=body.samples.map(s=> {
      const t=Date.parse(s.captured_at_utc);
      if (!Number.isInteger(s.frame_id) || s.frame_id<0 || !Number.isFinite(t) || t<session.started_at-2000 || t>now+5000) throw bad('Invalid or delayed sample timestamp; check computer clock');
      if (!finite(s.pose_quality,0,1) || !finite(s.angles_deg?.left_knee,0,180) || !finite(s.angles_deg?.right_knee,0,180)) throw bad('Invalid pose sample');
      if (!Number.isInteger(s.image_width) || !finite(s.image_width,1,8192) || !Number.isInteger(s.image_height) || !finite(s.image_height,1,8192) || typeof s.landmarks_version!=='string' || s.landmarks_version.length>100) throw bad('Invalid acquisition metadata');
      return [id,s.frame_id,t,now,s.pose_quality,s.angles_deg.left_knee,s.angles_deg.right_knee,s.image_width,s.image_height,s.landmarks_version];
    });
    this.db.exec('BEGIN');
    try {
      const insert=this.db.prepare('INSERT OR IGNORE INTO exercise_samples VALUES(?,?,?,?,?,?,?,?,?,?)');
      rows.forEach(row=>insert.run(...row));this.db.exec('COMMIT');
    } catch(e) { this.db.exec('ROLLBACK');throw e; }
    return { ok:true };
  }
  phase(id, phase, now=Date.now()) {
    const session=this.session(id);
    if (session.ended_at) throw bad('Session already finished',409);
    if (!['running','paused'].includes(phase)) throw bad('Invalid phase');
    if (session.phase===phase) return {ok:true};
    this.db.prepare('UPDATE exercise_phases SET ended_at=? WHERE session_id=? AND ended_at IS NULL').run(now,id);
    this.db.prepare('INSERT INTO exercise_phases VALUES(?,?,NULL,?)').run(id,now,phase);
    this.db.prepare('UPDATE exercise_sessions SET phase=? WHERE id=?').run(phase,id);
    return {ok:true};
  }
  cancel(id, now=Date.now()) {
    const session=this.session(id);
    if (!session.ended_at) {
      this.db.prepare('UPDATE exercise_phases SET ended_at=? WHERE session_id=? AND ended_at IS NULL').run(now,id);
      this.db.prepare("UPDATE exercise_sessions SET ended_at=?, recovery_end=?, phase='cancelled' WHERE id=?").run(now,now,id);
    }
    return this.summary(id,now);
  }
  finish(id, body, now=Date.now()) {
    const session=this.session(id);
    if (session.ended_at) return this.summary(id,now);
    if (!Number.isInteger(body.rep_count) || !finite(body.rep_count,0,1000)) throw bad('Invalid repetition count');
    if (body.perceived_effort!==null && (!Number.isInteger(body.perceived_effort)||!finite(body.perceived_effort,0,10))) throw bad('Effort must be 0–10 or absent');
    this.db.prepare('UPDATE exercise_phases SET ended_at=? WHERE session_id=? AND ended_at IS NULL').run(now,id);
    this.db.prepare("UPDATE exercise_sessions SET ended_at=?,recovery_end=?,rep_count=?,perceived_effort=?,phase='finished' WHERE id=?").run(now,now+120000,body.rep_count,body.perceived_effort,id);
    return this.summary(id,now);
  }
  summary(id, now=Date.now()) {
    const s=this.session(id);
    const end=s.ended_at??now;
    const phases=this.db.prepare('SELECT * FROM exercise_phases WHERE session_id=? ORDER BY started_at').all(id);
    const phaseAt=t=>t<s.started_at?'before':t>end?'recovery':phases.find(p=>t>=p.started_at && t<(p.ended_at??now)+1)?.phase??'unassigned';
    const runningSeconds=phases.filter(p=>p.phase==='running').reduce((n,p)=>n+(Math.min(p.ended_at??now,end)-p.started_at)/1000,0);
    const rows=this.db.prepare('SELECT * FROM exercise_samples WHERE session_id=? ORDER BY captured_at').all(id);
    const valid=rows.filter(r=>r.quality>=.5 && phaseAt(r.captured_at)==='running');
    const readings=this.db.prepare("SELECT name,value,received_at FROM readings WHERE source=? AND name IN ('batimentos_bpm','oxigenacao_percentual') AND received_at>=? AND received_at<=? ORDER BY received_at").all(s.watch_source,s.started_at-30000,Math.min(now,s.recovery_end??now));
    const hr=readings.filter(r=>r.name==='batimentos_bpm'&&r.value!==null);
    const active=hr.filter(r=>phaseAt(r.received_at)==='running');
    const pre=hr.filter(r=>r.received_at<s.started_at);
    const final=active.filter(r=>r.received_at>=end-10000);
    const recovery=s.ended_at?hr.filter(r=>r.received_at>=end+55000&&r.received_at<=end+65000):[];
    const baseline=pre.length>=10?median(pre.map(r=>r.value)):null;
    const finalHr=final.length>=3?median(final.map(r=>r.value)):null;
    const recoveryHr=recovery.length>=3?median(recovery.map(r=>r.value)):null;
    const configuration=[...new Set(valid.map(r=>`${r.width}x${r.height}:${r.model}`))];
    return { ...s, active_seconds:runningSeconds, sample_count:rows.length, valid_sample_count:valid.length,
      acquisition:configuration.length===1?configuration[0]:null,
      angle_spread_left:spread(valid.map(r=>r.left_knee)), angle_spread_right:spread(valid.map(r=>r.right_knee)),
      reps_per_minute:s.rep_count!=null&&runningSeconds>0?s.rep_count*60/runningSeconds:null,
      hr_before:baseline, hr_during:active.length?active.reduce((n,r)=>n+r.value,0)/active.length:null,
      hr_peak:active.length?Math.max(...active.map(r=>r.value)):null,
      hr_recovery_60s:recoveryHr, hr_difference_60s:finalHr!==null&&recoveryHr!==null?finalHr-recoveryHr:null,
      hr_during_samples:active.length, recovery_pending:!!s.recovery_end&&now<s.recovery_end,
      timeline:readings.filter((_,i)=>i%Math.max(1,Math.ceil(readings.length/180))===0).map(r=>({...r,phase:phaseAt(r.received_at),seconds:Math.round((r.received_at-s.started_at)/1000)})),
      alignment:'server reception time', measurement_scope:'functional monitoring; no muscle mass or bone density measurement' };
  }
  list(athlete) {
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(athlete??'')) throw bad('Invalid profile ID');
    return this.db.prepare('SELECT id FROM exercise_sessions WHERE athlete_id=? ORDER BY started_at DESC LIMIT 20').all(athlete).map(row=>this.summary(row.id));
  }
}
