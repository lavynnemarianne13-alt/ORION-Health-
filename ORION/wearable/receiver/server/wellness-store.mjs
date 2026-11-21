import { randomUUID } from 'node:crypto';
import { bad } from './exercise-store.mjs';
const median=values=>{const a=[...values].sort((a,b)=>a-b);return a.length?(a[Math.floor((a.length-1)/2)]+a[Math.floor(a.length/2)])/2:null;};
const covered=(rows,span,minCount,maxGap)=>rows.length>=minCount&&rows.at(-1).received_at-rows[0].received_at>=span&&rows.every((r,i)=>i===0||r.received_at-rows[i-1].received_at<=maxGap);

/** Experimental signal-change check-ins, never a diagnostic or emergency detector. */
export class WellnessStore {
  constructor(db) {
    this.db=db;
    db.exec(`CREATE TABLE IF NOT EXISTS wellness_checkins(id TEXT PRIMARY KEY,source TEXT NOT NULL,created_at INTEGER NOT NULL,baseline_bpm REAL NOT NULL,recent_bpm REAL NOT NULL,context TEXT NOT NULL,rule TEXT NOT NULL,response TEXT,response_at INTEGER);
      CREATE INDEX IF NOT EXISTS wellness_source_time ON wellness_checkins(source,created_at);`);
  }
  evaluate(source,now,accuracy) {
    const pending=this.db.prepare('SELECT * FROM wellness_checkins WHERE source=? AND response IS NULL AND created_at>? ORDER BY created_at DESC LIMIT 1').get(source,now-15*60000);
    if(pending)return pending;
    if(!Number.isInteger(accuracy)||accuracy<1||accuracy>3)return null;
    const last=this.db.prepare('SELECT created_at FROM wellness_checkins WHERE source=? ORDER BY created_at DESC LIMIT 1').get(source);
    if(last&&now-last.created_at<30*60000)return null;
    // Do not compare known exercise/recovery or recorded sleep against an unlabelled recent baseline.
    if(this.db.prepare('SELECT id FROM exercise_sessions WHERE watch_source=? AND (ended_at IS NULL OR recovery_end>?) LIMIT 1').get(source,now))return null;
    const sleep=this.db.prepare("SELECT value,received_at FROM latest WHERE source=? AND name='sleep_session_active'").get(source);
    if(sleep?.value===1&&now-sleep.received_at<90000)return null;
    const rows=this.db.prepare("SELECT value,received_at FROM readings WHERE source=? AND name='batimentos_bpm' AND value IS NOT NULL AND received_at>=? ORDER BY received_at").all(source,now-15*60000);
    const reference=rows.filter(r=>r.received_at<now-90000);
    const recent=rows.filter(r=>r.received_at>=now-60000);
    if(!covered(reference,5*60000,120,30000)||!covered(recent,50000,30,10000))return null;
    const baseline=median(reference.map(r=>r.value));
    const current=median(recent.map(r=>r.value));
    const mad=median(reference.map(r=>Math.abs(r.value-baseline)));
    // Product noise-reduction parameters only; not clinical limits or NASA standards.
    const threshold=Math.max(20,baseline*.30,6*mad);
    const direction=current>baseline?1:-1;
    if(Math.abs(current-baseline)<threshold||recent.filter(r=>(r.value-baseline)*direction>=threshold).length/recent.length<.8)return null;
    const id=randomUUID();
    this.db.prepare('INSERT INTO wellness_checkins VALUES(?,?,?,?,?,?,?,NULL,NULL)').run(id,source,now,baseline,current,'activity_not_confirmed','experimental-pattern-v1');
    return this.db.prepare('SELECT * FROM wellness_checkins WHERE id=?').get(id);
  }
  respond(id,body,now=Date.now()) {
    if(!['well','exercising','unwell','sensor_issue'].includes(body.response))throw bad('Invalid check-in response');
    const event=this.db.prepare('SELECT * FROM wellness_checkins WHERE id=?').get(id);
    if(!event||event.source!==body.source)throw bad('Check-in not found',404);
    if(event.response&&event.response!==body.response)throw bad('Check-in already answered',409);
    this.db.prepare('UPDATE wellness_checkins SET response=?,response_at=COALESCE(response_at,?) WHERE id=?').run(body.response,now,id);
    return {ok:true};
  }
  history(){return this.db.prepare('SELECT * FROM wellness_checkins ORDER BY created_at DESC LIMIT 100').all();}
}
