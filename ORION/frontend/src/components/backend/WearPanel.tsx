import { useEffect, useState } from 'react';
import { apiRequest } from '../../services/apiClient';

type Metric = { value: number | null; receivedAt: number; measuredAt?: number | null };
type Reading = { name: string; value: number | null; received_at: number; measured_at: number | null; exercise_session_id: string | null };
type WatchData = { configured: false } | {
  configured: true;
  latest: { deviceId: string; metrics: Record<string, Metric>; receivedAt: number | null; serverTime: number };
  history: { readings: Reading[] };
};
const labels: Record<string, string> = {
  batimentos_bpm: 'Heart rate (BPM)',
  oxigenacao_percentual: 'SpO₂ (%)',
  sleep_session_minutes: 'Observation duration (min)',
};

export default function WearPanel({ athleteId }: { athleteId: string | null }) {
  const [data, setData] = useState<WatchData | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!athleteId) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]);
        const response = await apiRequest<WatchData>(`/api/v1/athletes/${athleteId}/wear`, { signal, cache: 'no-store' });
        if (!controller.signal.aborted) { setData(response); setError(false); }
      } catch {
        if (!controller.signal.aborted) setError(true);
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
  return <section className="surface history-card">
    <div className="surface-heading"><h2>ORION Wear</h2></div>
    <p role="status">{!athleteId ? 'Select a crew profile in Overview.' : error ? 'Receiver unavailable. Reconnecting…' :
      !data ? 'Checking receiver…' : !data.configured ? 'No watch configured for this crew profile.' :
      live ? 'Receiving watch observations' : 'No recent watch observations'}</p>
    {data?.configured && <p>Device <code>{data.latest.deviceId}</code></p>}
    {lastUpdate != null && <p>Last receipt {new Date(lastUpdate).toLocaleString()}</p>}
    {data?.configured && <>
      <dl>{Object.entries(labels).map(([key, label]) => {
        const metric = data.latest.metrics[key];
        const recent = !error && metric && data.latest.serverTime - (metric.measuredAt ?? metric.receivedAt) < 30_000;
        const value = metric?.value ?? null;
        return <div key={key}><dt>{label}</dt><dd>{value === null ? 'Unavailable' : `${value}${recent ? '' : ' · last recorded'}`}</dd></div>;
      })}</dl>
      <h3>Recent observations</h3>
      <ul>{data.history.readings.filter(row => row.value !== null).map((row, index) =>
        <li key={index}>{new Date(row.measured_at ?? row.received_at).toLocaleString()} · {labels[row.name]} · {row.value}{row.exercise_session_id && <> · Session <code>{row.exercise_session_id}</code></>}</li>)}</ul>
    </>}
  </section>;
}
