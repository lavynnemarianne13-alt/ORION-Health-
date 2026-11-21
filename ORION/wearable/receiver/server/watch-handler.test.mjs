import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import { createWatchServer } from './watch-server.mjs';

test('simulated watch protocol authenticates, validates and persists using the real request handler', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'orion-watch-handler-'));
  const path = join(folder, 'fixture.sqlite');
  const token = 'fixture-token-'.repeat(3);
  const binding = { athleteId: 'fixture-athlete', deviceId: 'fixture-watch' };
  let server = createWatchServer(token, path, binding);
  function request(method, url, data, authorized = true) {
    const headers = {
      authorization: authorized ? `Bearer ${token}` : undefined,
      'content-type': 'application/json',
    };
    const req = Object.assign(Readable.from(data ? [Buffer.from(JSON.stringify(data))] : []), { method, url, headers });
    return new Promise(resolve => {
      let code;
      server.emit('request', req, {
        writeHead(status) { code = status; this.headersSent = true; },
        end(bytes) { resolve({ code, body: JSON.parse(bytes) }); },
      });
    });
  }
  try {
    assert.equal((await request('GET', '/api/saude', null, false)).code, 401);
    assert.deepEqual((await request('GET', '/api/saude')).body.metrics, {});
    const collected = Date.now();
    const valid = await request('POST', '/api/saude', { batimentos_bpm: 79, oxigenacao_percentual: 97, atualizado_em: collected });
    assert.equal(valid.code, 200);
    assert.equal((await request('POST', '/api/saude', { batimentos_bpm: 81, oxigenacao_percentual: 101 })).code, 400);
    assert.equal((await request('GET', '/api/saude')).body.metrics.batimentos_bpm.value, 79);
    server.emit('close');
    server = null;
    assert.throws(() => createWatchServer(token, path, { ...binding, athleteId: 'other' }), /different crew profile/);
    server = createWatchServer(token, path, binding);
    const latest = (await request('GET', '/api/saude')).body;
    assert.equal(latest.deviceId, binding.deviceId);
    assert.equal(latest.metrics.oxigenacao_percentual.value, 97);
    const history = (await request('GET', '/api/watch/history')).body;
    assert.equal(history.readings.length, 2);
    assert.equal(history.readings[0].measured_at, collected);
  } finally {
    server?.emit('close');
    await rm(folder, { recursive: true, force: true });
  }
});
