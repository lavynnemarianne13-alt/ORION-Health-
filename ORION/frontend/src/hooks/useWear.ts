import { useEffect, useState } from 'react';
import { apiRequest } from '../services/apiClient';

type Metric = { value: number | null; receivedAt: number; measuredAt?: number | null };
export type Reading = { name: string; value: number | null; received_at: number; measured_at: number | null; exercise_session_id: string | null };
type WatchData = { configured: false } | {
  configured: true;
  latest: { deviceId: string; metrics: Record<string, Metric>; receivedAt: number | null; serverTime: number };
  history: { readings: Reading[] };
};
export const wearLabels: Record<string, string> = {
  batimentos_bpm: 'Heart rate (BPM)',
  oxigenacao_percentual: 'SpO₂ (%)',
  sleep_session_minutes: 'Observation duration (min)',
};

export function useWear(athleteId: string | null) {
  const [snapshot, setSnapshot] = useState<{ athleteId: string; data: WatchData | null; error: boolean } | null>(null);
  const data = snapshot?.athleteId === athleteId ? snapshot.data : null;
  const error = snapshot?.athleteId === athleteId && snapshot.error;
  useEffect(() => {
    if (!athleteId) return;
    const id = athleteId;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]);
        const response = await apiRequest<WatchData>(`/api/v1/athletes/${athleteId}/wear`, { signal, cache: 'no-store' });
        if (!controller.signal.aborted) { setSnapshot({ athleteId: id, data: response, error: false }); }
      } catch {
        if (!controller.signal.aborted) setSnapshot(previous => ({ athleteId: id, data: previous?.athleteId === id ? previous.data : null, error: true }));
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(poll, 3000);
      }
    }
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [athleteId]);
  const live = !error && data?.configured && data.latest.receivedAt != null &&
    data.latest.serverTime - data.latest.receivedAt < 30_000;
  const lastUpdate = data?.configured ? data.latest.receivedAt : null;

  const status = !athleteId ? 'Select a crew member' : error ? 'Receiver unavailable · reconnecting' :
    !data ? 'Checking receiver…' : !data.configured ? 'No watch configured for this crew member' :
    live ? 'Receiving watch observations' : 'No recent watch observations';
  const latest = data?.configured ? data.latest : null;
  function metric(key: string) {
    const entry = latest?.metrics[key];
    return {
      value: entry?.value ?? null,
      recent: !!(entry && latest && !error && latest.serverTime - (entry.measuredAt ?? entry.receivedAt) < 30_000),
    };
  }
  return { status, live: !!live, error: !!error, latest, lastUpdate, metric,
    readings: data?.configured ? data.history.readings.filter(row => row.value !== null) : [] };
}
