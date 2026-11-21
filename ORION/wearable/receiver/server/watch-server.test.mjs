import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWatchServer } from './watch-server.mjs';

test('watch readings remain independent; invalid updates are atomic', async () => {
  const token = 'private-test-key-'.repeat(4);
  const server = createWatchServer(token);
  const headers = { Authorization: `Bearer ${token}` };
  const get = url => fetch(url, { headers });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/saude`;
  const post = body => fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  try {
    assert.equal((await fetch(base)).status, 401);
    assert.deepEqual((await (await get(base)).json()).metrics, {});
    assert.equal((await post({ oxigenacao_percentual: 97 })).status, 200);
    const oxygen = (await (await get(base)).json()).metrics.oxigenacao_percentual;
    assert.equal((await post({ batimentos_bpm: 80 })).status, 200);
    let data = await (await get(base)).json();
    assert.deepEqual(data.metrics.oxigenacao_percentual, oxygen);
    assert.equal(data.metrics.batimentos_bpm.value, 80);
    assert.equal((await post({ batimentos_bpm: 90, oxigenacao_percentual: 101 })).status, 400);
    data = await (await get(base)).json();
    assert.equal(data.metrics.batimentos_bpm.value, 80);
    assert.equal((await post({ batimentos_bpm: null })).status, 200);
    assert.equal((await (await get(base)).json()).metrics.batimentos_bpm.value, null);
    const oversized = await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: 'x'.repeat(5000) });
    assert.equal(oversized.status, 413);
  } finally { await new Promise(resolve => server.close(resolve)); }
});


test('health and sleep history survive receiver restart', async () => {
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = await mkdtemp(join(tmpdir(), 'orion-watch-test-'));
  const token = 'private-restart-test-'.repeat(4);
  const path = join(dir,'history.sqlite');
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  async function open() {
    const server = createWatchServer(token,path);
    await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
    return { server, base: `http://127.0.0.1:${server.address().port}` };
  }
  let instance;
  try {
    instance = await open();
    const body = { batimentos_bpm: 81, sleep_session_id: 1, sleep_session_started_at: 1700000000000, sleep_session_ended_at: 1700003600000, sleep_session_minutes: 60, sleep_session_active: 0, sleep_hr_samples: 30, sleep_motion_samples: 100 };
    assert.equal((await fetch(instance.base+'/api/saude',{method:'POST',headers,body:JSON.stringify(body)})).status,200);
    await new Promise(resolve => instance.server.close(resolve));
    instance = await open();
    const latest = await (await fetch(instance.base+'/api/saude',{headers})).json();
    assert.equal(latest.metrics.batimentos_bpm.value,81);
    const history = await (await fetch(instance.base+'/api/watch/history',{headers})).json();
    assert.equal(history.readings.find(r=>r.name==='batimentos_bpm').value,81);
    assert.equal(history.sessions[0].duration_minutes,60);
    assert.equal(history.sessions[0].ended_at,1700003600000);
  } finally {
    if (instance?.server.listening) await new Promise(resolve=>instance.server.close(resolve));
    await rm(dir,{recursive:true,force:true});
  }
});
