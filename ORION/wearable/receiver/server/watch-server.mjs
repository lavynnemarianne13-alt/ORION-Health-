import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { ExerciseStore, bad } from './exercise-store.mjs';
import { WellnessStore } from './wellness-store.mjs';
import { WatchStore } from './watch-store.mjs';
import { pathToFileURL, fileURLToPath } from 'node:url';

export function createWatchServer(token, databasePath = ":memory:", binding = null) {
  if (!token || token.length < 32) throw Error('A private watch token is required');
  const fields = { batimentos_bpm: [1, 300], oxigenacao_percentual: [1, 100], sono_minutos: [0, 1440], sleep_session_minutes: [0, 10080], sleep_session_active: [0, 1], sleep_motion_samples: [0, 1e9], sleep_hr_samples: [0, 1e9], sleep_session_id: [1, 1e12], sleep_session_started_at: [1, 1e15], sleep_session_ended_at: [0, 1e15] };
  const store = new WatchStore(databasePath, binding);
  const exercises = new ExerciseStore(store.db);
  const wellness = new WellnessStore(store.db);
  const server = http.createServer(async (req, res) => {
    const reply = (code, data) => {
      res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(data));
    };
    const expected = Buffer.from(`Bearer ${token}`);
    const supplied = Buffer.from(req.headers.authorization ?? '');
    if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return reply(401, { error: 'Unauthorized' });
    const path = req.url?.split('?')[0];
    if (req.method==='GET' && path==='/api/watch/check-ins') return reply(200,{check_ins:wellness.history()});
    if (req.method==='POST' && /^\/api\/watch\/check-ins\/[a-f0-9-]+\/response$/.test(path??'')) {
      try {
        if(req.headers['content-type']?.split(';')[0].trim()!=='application/json')throw bad('Expected JSON',415);
        let size=0;const chunks=[];
        for await(const chunk of req){size+=chunk.length;if(size>4096)throw bad('Payload too large',413);chunks.push(chunk);}
        let body;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw bad('Invalid JSON');}
        return reply(200,wellness.respond(path.split('/')[4],body??{}));
      }catch(error){return reply(error.status??500,{error:error.status?error.message:'Unable to save check-in'});}
    }
    if (path?.startsWith('/api/v1/sessions')) {
      try {
        const match = path.match(/^\/api\/v1\/sessions\/([a-f0-9-]+)\/(samples|phase|finish|summary|cancel)$/);
        if (req.method === 'GET') {
          if (path === '/api/v1/sessions') return reply(200, { sessions: exercises.list(new URL(req.url,'http://localhost').searchParams.get('athlete_id')) });
          if (match?.[2] === 'summary') return reply(200, exercises.summary(match[1]));
          throw bad('Not found',404);
        }
        if (req.method !== 'POST') throw bad('Method not allowed',405);
        if (req.headers['content-type']?.split(';')[0].trim() !== 'application/json') throw bad('Expected JSON',415);
        let size=0; const chunks=[];
        for await (const chunk of req) { size+=chunk.length; if(size>512*1024) throw bad('Payload too large',413); chunks.push(chunk); }
        let body; try { body=JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw bad('Invalid JSON'); }
        if (!body || typeof body!=='object' || Array.isArray(body)) throw bad('Invalid JSON object');
        if (path==='/api/v1/sessions') return reply(201,exercises.open(body));
        if (!match) throw bad('Not found',404);
        if (match[2]==='samples') return reply(200,exercises.samples(match[1],body));
        if (match[2]==='phase') return reply(200,exercises.phase(match[1],body.phase));
        if (match[2]==='cancel') return reply(200,exercises.cancel(match[1]));
        if (match[2]==='finish') return reply(200,exercises.finish(match[1],body));
        throw bad('Not found',404);
      } catch(error) { return reply(error.status??500,{error:error.status?error.message:'Unable to save exercise data'}); }
    }
    if (req.method === 'GET' && path === '/api/saude') {
      return reply(200, { ...store.latest(), ...(binding && { deviceId: binding.deviceId, athleteId: binding.athleteId }) });
    }
    if (req.method === 'GET' && path === '/api/watch/history') {
      const requested = Number(new URL(req.url, 'http://localhost').searchParams.get('limit') || 20);
      return reply(200, { readings: store.history(Number.isInteger(requested) && requested > 0 ? Math.min(requested,200) : 20), sessions: store.sessions() });
    }
    if (req.method === 'GET' && path === '/api/watch/status') {
      const addresses = Object.values(os.networkInterfaces()).flat()
        .filter(a => a && a.family === 'IPv4' && !a.internal)
        .map(a => `http://${a.address}:${req.socket.localPort}`);
      return reply(200, { addresses });
    }
    if (req.method !== 'POST' || path !== '/api/saude') return reply(404, { error: 'Not found' });
    if (req.headers['content-type']?.split(';')[0].trim() !== 'application/json') return reply(415, { error: 'Expected JSON' });
    try {
      let size = 0;
      const chunks = [];
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 4096) { reply(413, { error: 'Payload too large' }); return; }
        chunks.push(chunk);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!body || Array.isArray(body) || typeof body !== 'object') throw Error('Invalid JSON object');
      const entries = Object.entries(fields).filter(([key]) => Object.hasOwn(body, key));
      if (!entries.length) throw Error('No supported readings');
      for (const [key, [min, max]] of entries) {
        const value = body[key];
        if (value !== null && (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)) throw Error(`Invalid ${key}`);
      }
      if (body.origem != null && (typeof body.origem !== 'string' || body.origem.length > 200)) throw Error('Invalid source');
      const now = Date.now();
      store.record(entries, body.origem ?? 'ORION Wear', now, body);
      let checkIn=null;
      if(typeof body.batimentos_bpm==='number') {
        try {checkIn=wellness.evaluate(body.origem??'ORION Wear',now,body.heart_rate_accuracy);}catch{ /* Telemetry remains available if optional pattern analysis fails. */ }
      }
      reply(200, { ok: true, check_in: checkIn });
    } catch { if (!res.headersSent) reply(400, { error: 'Invalid health payload' }); }
  });
  server.on('close', () => store.close());
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.ORION_WATCH_PORT || 8001);
  const host = process.env.ORION_WATCH_HOST || '127.0.0.1';
  const tokenPath = process.env.ORION_WATCH_TOKEN_FILE || fileURLToPath(new URL('../.watch-token', import.meta.url));
  let token = process.env.ORION_WATCH_TOKEN?.trim();
  if (!token) {
    try { token = fs.readFileSync(tokenPath, 'utf8').trim(); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  if (!token || token.length < 32) {
    console.log('ORION Wear disabled: configure the private watch token.');
  } else {
    const dataDir = new URL('../data/', import.meta.url);
    fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    const databasePath = process.env.ORION_WATCH_DB_PATH || fileURLToPath(new URL('watch-history.sqlite', dataDir));
    const athleteId = process.env.ORION_WATCH_ATHLETE_ID;
    const deviceId = process.env.ORION_WATCH_DEVICE_ID || 'galaxy-watch4';
    if (athleteId && (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(athleteId) || !/^[a-zA-Z0-9._-]{1,80}$/.test(deviceId))) {
      throw Error('Invalid receiver crew or device association.');
    }
    const server = createWatchServer(token, databasePath, athleteId ? { athleteId, deviceId } : null);
    fs.chmodSync(databasePath, 0o600);
    server.listen(port, host, () => console.log(`ORION authenticated watch receiver ready on ${host}:${port}`));
  }
}
