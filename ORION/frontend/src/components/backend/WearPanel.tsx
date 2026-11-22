import { wearLabels } from '../../hooks/useWear';
import type { useWear } from '../../hooks/useWear';
import { Card, EmptyState, MetricCard, PageHeader } from '../ui/Surfaces';
import TrendChart from '../ui/TrendChart';

export default function WearPanel({ wear, crewName }: { wear: ReturnType<typeof useWear>; crewName?: string }) {
  const stats = [
    ['batimentos_bpm', 'Heart rate', 'bpm', 'heart'],
    ['oxigenacao_percentual', 'Blood oxygen', '%', 'droplet'],
    ['sleep_session_minutes', 'Observation session', 'min', 'history'],
  ] as const;
  return <>
    <PageHeader eyebrow="Connected devices" title="ORION Wear" subtitle="Samsung Galaxy Watch4 · Physiological observations"
      action={<span role="status" className={`pill ${wear.live ? 'good' : wear.error ? 'warn' : ''}`}>{wear.status}</span>}/>
    <div className="grid wear-stats">{stats.map(([key, label, unit, icon]) => {
      const metric = wear.metric(key);
      return <MetricCard key={key} label={label} value={metric.value} unit={unit} icon={icon}
        detail={metric.value == null ? 'No reading available' : metric.recent ? 'Recent device reading' : 'Last recorded reading'}/>;
    })}</div>
    <div className="grid dashboard-grid">
      <Card title="Heart rate observations">
        <TrendChart label="Heart rate in beats per minute" empty="At least two heart rate readings are needed to show a trend."
          points={wear.readings.flatMap(row => row.name === 'batimentos_bpm' && row.value != null ? [{ time: row.measured_at ?? row.received_at, value: row.value }] : [])}/>
      </Card>
      <Card title="Device connection">
        <dl className="service-list">
          <div><dt>Device</dt><dd>{wear.latest?.deviceId ?? 'Unlinked'}</dd></div>
          <div><dt>Connection</dt><dd>{wear.status}</dd></div>
          <div><dt>Crew association</dt><dd>{wear.latest ? crewName : 'Unavailable'}</dd></div>
          <div><dt>Last receipt</dt><dd>{wear.lastUpdate == null ? 'Unavailable' : new Date(wear.lastUpdate).toLocaleString('en-US')}</dd></div>
        </dl>
      </Card>
    </div>
    <Card title="Recent observations">
      {wear.readings.length ? <div className="table-scroll"><table><thead><tr><th scope="col">Measurement</th><th scope="col">Value</th><th scope="col">Time</th><th scope="col">Exercise session</th></tr></thead>
        <tbody>{[...wear.readings].sort((a, b) => (b.measured_at ?? b.received_at) - (a.measured_at ?? a.received_at)).map((row, index) =>
          <tr key={index}><td>{wearLabels[row.name] ?? row.name}</td><td>{row.value}</td><td>{new Date(row.measured_at ?? row.received_at).toLocaleString('en-US')}</td><td>{row.exercise_session_id ?? '—'}</td></tr>)}</tbody>
      </table></div> : <EmptyState>No observations are available for this crew member.</EmptyState>}
    </Card>
  </>;
}
