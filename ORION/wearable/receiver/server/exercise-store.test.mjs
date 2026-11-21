import test from 'node:test';
import assert from 'node:assert/strict';
import { WatchStore } from './watch-store.mjs';
import { ExerciseStore } from './exercise-store.mjs';

test('exercise joins only its watch/time window, excludes pauses, and observes recovery',()=>{
  const watch=new WatchStore(':memory:');
  const exercise=new ExerciseStore(watch.db);
  const start=Date.now();
  const source='watch-A';
  const hr=(value,t,origin=source)=>watch.record([['batimentos_bpm']],origin,t,{batimentos_bpm:value});
  const context={athlete_id:'AST-01',watch_confirmed:true,rest_confirmed:true,exercise_code:'squat',protocol_id:'SQUAT-01',equipment:'bodyweight',load_kg:null,camera_orientation:'side',target_repetitions:10};
  try {
    assert.throws(()=>exercise.open(context,start),/fresh/);
    for(let i=30;i>0;i--)hr(70,start-i*1000);
    assert.throws(()=>exercise.open({...context,watch_confirmed:false},start),/Confirm/);
    const {session_id:id}=exercise.open(context,start);
    assert.throws(()=>exercise.open(context,start+1),/previous/);
    const samples=Array.from({length:20},(_,i)=>({frame_id:i,captured_at_utc:new Date(start+i*200).toISOString(),pose_quality:.9,angles_deg:{left_knee:90+i*4,right_knee:92+i*4},image_width:640,image_height:480,landmarks_version:'test'}));
    exercise.samples(id,{samples},start+4000);
    exercise.samples(id,{samples},start+4000);
    assert.throws(()=>exercise.samples(id,{samples:[{...samples[0],frame_id:99,pose_quality:Infinity}]},start+4000),/Invalid/);
    hr(100,start+1000);hr(100,start+2000);
    exercise.phase(id,'paused',start+5000);
    hr(200,start+6000);
    exercise.phase(id,'running',start+10000);
    hr(110,start+11000);hr(110,start+12000);hr(110,start+14000);
    exercise.finish(id,{rep_count:2,perceived_effort:3},start+15000);
    for(let i=73;i<=77;i++)hr(90,start+i*1000);
    hr(250,start+16000,'watch-B');
    const summary=exercise.summary(id,start+80000);
    assert.equal(summary.sample_count,20);
    assert.equal(summary.active_seconds,10);
    assert.equal(summary.hr_before,70);
    assert.equal(summary.hr_during_samples,5);
    assert.equal(summary.hr_peak,110);
    assert.equal(summary.hr_recovery_60s,90);
    assert.equal(summary.hr_difference_60s,20);
    assert.equal(summary.rep_count,2);
    assert.equal(summary.timeline.some(r=>r.phase==='paused'&&r.value===200),true);
    assert.equal(summary.timeline.some(r=>r.value===250),false);
    assert.equal(exercise.list('OTHER').length,0);
    assert.equal(exercise.list('AST-01').length,1);
    assert.throws(()=>exercise.samples(id,{samples},start+80000),/finished/);
  }finally{watch.close();}
});

test('absence of watch recovery or valid pose stays absent, not zero',()=>{
  const watch=new WatchStore(':memory:');const exercise=new ExerciseStore(watch.db);const t=Date.now();
  try {
    watch.record([['batimentos_bpm']],'watch',t,{batimentos_bpm:80});
    const {session_id:id}=exercise.open({athlete_id:'A',watch_confirmed:true,rest_confirmed:true,exercise_code:'squat',protocol_id:'SQUAT-01',equipment:'bodyweight',load_kg:null,camera_orientation:'front',target_repetitions:10},t);
    exercise.finish(id,{rep_count:0,perceived_effort:null},t+1000);
    const result=exercise.summary(id,t+70000);
    assert.equal(result.hr_before,null);assert.equal(result.hr_recovery_60s,null);assert.equal(result.hr_difference_60s,null);assert.equal(result.angle_spread_left,null);
  }finally{watch.close();}
});


test('abandoned session can be closed without inventing a repetition count',()=>{
  const watch=new WatchStore(':memory:');const exercise=new ExerciseStore(watch.db);const t=Date.now();
  try {
    watch.record([['batimentos_bpm']],'watch',t,{batimentos_bpm:80});
    const context={athlete_id:'A',watch_confirmed:true,rest_confirmed:true,exercise_code:'squat',protocol_id:'SQUAT-01',equipment:'bodyweight',load_kg:null,camera_orientation:'front',target_repetitions:10};
    const {session_id:id}=exercise.open(context,t);
    const closed=exercise.cancel(id,t+5000);
    assert.equal(closed.rep_count,null);assert.equal(closed.phase,'cancelled');
    assert.ok(exercise.open(context,t+6000).session_id);
  }finally{watch.close();}
});
