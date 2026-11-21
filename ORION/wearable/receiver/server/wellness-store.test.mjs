import test from 'node:test';
import assert from 'node:assert/strict';
import { WatchStore } from './watch-store.mjs';
import { ExerciseStore } from './exercise-store.mjs';
import { WellnessStore } from './wellness-store.mjs';
function setup(){const store=new WatchStore(':memory:');new ExerciseStore(store.db);const wellness=new WellnessStore(store.db);return {store,wellness};}
function feed(store,now,recent=110){for(let s=-900;s<=0;s+=2)store.record([['batimentos_bpm']],'watch',now+s*1000,{batimentos_bpm:s>=-60?recent:70});}

test('persistent change creates a question, not a diagnosis; responses and cooldown persist',()=>{
 const {store,wellness}=setup();const t=Date.now();
 try{
  feed(store,t);const question=wellness.evaluate('watch',t,3);
  assert.ok(question?.id);assert.equal(question.baseline_bpm,70);assert.equal(question.recent_bpm,110);
  assert.equal(wellness.evaluate('watch',t+1000,3).id,question.id);
  assert.throws(()=>wellness.respond(question.id,{source:'other',response:'well'}),/not found/);
  wellness.respond(question.id,{source:'watch',response:'exercising'},t+2000);
  assert.equal(wellness.evaluate('watch',t+3000,3),null);
  assert.equal(wellness.history()[0].response,'exercising');
 }finally{store.close();}
});
test('isolated spikes, sparse readings and unreliable measurements do not create check-ins',()=>{
 for(const kind of ['spike','sparse','unreliable','normal']){
  const {store,wellness}=setup();const t=Date.now();try{
   if(kind==='sparse')store.record([['batimentos_bpm']],'watch',t,{batimentos_bpm:150});
   else {feed(store,t,kind==='unreliable'?110:70);if(kind==='spike')store.record([['batimentos_bpm']],'watch',t+1,{batimentos_bpm:180});}
   assert.equal(wellness.evaluate('watch',t+1,kind==='unreliable'?0:3),null,kind);
  }finally{store.close();}
 }
});
test('known exercise and active sleep do not use the unlabelled reference',()=>{
 for(const state of ['exercise','sleep']){const {store,wellness}=setup();const t=Date.now();try{
  feed(store,t);
  if(state==='sleep')store.record([['sleep_session_active']],'watch',t,{sleep_session_active:1});
  else {const exercise=new ExerciseStore(store.db);exercise.open({athlete_id:'A',watch_confirmed:true,rest_confirmed:true,exercise_code:'squat',protocol_id:'SQUAT-01',equipment:'bodyweight',load_kg:null,camera_orientation:'front',target_repetitions:10},t);}
  assert.equal(wellness.evaluate('watch',t,3),null);
 }finally{store.close();}}
});
