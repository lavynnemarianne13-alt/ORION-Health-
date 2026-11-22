import { useState } from 'react';
import type { BodyMeasurement } from '../../types/anthropometry';
import type { useBackend } from '../../hooks/useBackend';
import type { useWear } from '../../hooks/useWear';
import type { Page } from '../ui/OrbitDock';
import { kgToLb } from '../../utils/imperial';
import { Card, EmptyState, MetricCard, PageHeader } from '../ui/Surfaces';
import SegmentedControl from '../ui/SegmentedControl';
import TrendChart from '../ui/TrendChart';
import Icon from '../ui/Icon';
import { DAY_MS } from '../../utils/dates';

const periods = [7, 30, 90].map(value => ({ value, label: `${value}D` }));

export default function Overview({ backend, records, wear, vision, navigate, onManageCrew }: {
  backend: ReturnType<typeof useBackend>; records: BodyMeasurement[]; wear: ReturnType<typeof useWear>;
  vision: { yolo_configured: boolean; mediapipe_asset: boolean } | null; navigate: (page: Page) => void; onManageCrew: () => void;
}) {
  const [period, setPeriod] = useState(7);
  const { athlete, sessions } = backend;
  const weight = records[0]?.weightKg;
  const heart = wear.metric('batimentos_bpm');
  const oxygen = wear.metric('oxigenacao_percentual');
  const [now, setNow] = useState(Date.now);
  const recentSessions = sessions.filter(session => Date.parse(session.started_at_utc) >= now - 7 * DAY_MS);
  const finished = recentSessions.filter(session => session.status === 'finished').length;
  const completion = recentSessions.length ? finished / recentSessions.length : 0;
  const activity = [
    ...records.map(row => ({ key: row.id, time: Date.parse(row.recordedAt), name: 'Body measurements recorded', kind: 'scale' as const })),
    ...sessions.map(row => ({ key: row.session_id, time: Date.parse(row.ended_at_utc ?? row.started_at_utc),
      name: `${row.exercise_code.replaceAll('_', ' ')} · ${row.status.replaceAll('_', ' ')}`, kind: 'activity' as const })),
  ].sort((a, b) => b.time - a.time).slice(0, 4);
  return <>
    <PageHeader eyebrow="Mission control / crew health" title="Health overview" subtitle="Individual monitoring, movement and wearable observations."/>
    <Card className="hero-intro">
      <p className="eyebrow">Crew workspace</p>
      <h2>{athlete ? `Welcome back, ${athlete.pseudonym}.` : 'Welcome to ORION.'}</h2>
      <p>Review body measurements, follow exercise sessions and track available physiological observations.</p>
      <div className="hero-actions">
        <button type="button" className="button-dark" onClick={() => navigate('bodyprofile')}>View body profile <Icon name="arrow"/></button>
        <button type="button" onClick={() => navigate('movement')}>Open Movement</button>
        {!athlete && <button type="button" onClick={onManageCrew}>Manage crew</button>}
      </div>
    </Card>
    <div className="grid dashboard-stats">
      <MetricCard label="Body weight" icon="scale" value={weight == null ? null : kgToLb(weight).toFixed(1)} unit="lb" detail={weight == null ? 'No measurement recorded' : 'Latest body profile entry'}/>
      <MetricCard label="Heart rate" icon="heart" value={heart.value} unit="bpm" detail={heart.value == null ? 'No device reading' : heart.recent ? 'Recent device reading' : 'Last recorded reading'}/>
      <MetricCard label="Blood oxygen" icon="droplet" value={oxygen.value} unit="%" detail={oxygen.value == null ? 'No device reading' : oxygen.recent ? 'Recent device reading' : 'Last recorded reading'}/>
      <MetricCard label="Exercise sessions" icon="activity" value={athlete ? sessions.length : null} detail={athlete ? 'Stored sessions · up to 100' : 'Select a crew member'}/>
    </div>
    <div className="grid dashboard-grid">
      <Card title="Body weight trend" action={<SegmentedControl label="Weight period" options={periods} value={period} onChange={value => { setNow(Date.now()); setPeriod(value); }}/>}>
        <p className="muted-note">Recorded measurements · lb</p>
        <TrendChart label="Body weight in pounds" empty="At least two weight measurements in this period are needed to show a trend."
          points={records.map(row => ({ time: Date.parse(row.recordedAt), value: kgToLb(row.weightKg) })).filter(row => row.time >= now - period * DAY_MS)}/>
      </Card>
      <Card title="Exercise activity" action={<span className="pill">Last 7 days</span>}>
        {recentSessions.length ? <div className="exercise-ring" role="img" aria-label={`${finished} of ${recentSessions.length} recorded sessions completed`}>
          <svg viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="52"/><circle cx="60" cy="60" r="52" pathLength="100" strokeDasharray={`${completion * 100} 100`}/></svg>
          <div><strong>{finished}/{recentSessions.length}</strong><small>Completed</small></div>
        </div> : <EmptyState>No exercise sessions in the last seven days.</EmptyState>}
      </Card>
    </div>
    <div className="grid dashboard-columns">
      <Card title="Recent activity" action={<button type="button" onClick={() => navigate('history')}>View history</button>}>
        {activity.length ? <ul className="activity-list">{activity.map(item => <li key={item.key}>
          <span className="list-icon"><Icon name={item.kind}/></span><div><strong>{item.name}</strong><time>{new Date(item.time).toLocaleString('en-US')}</time></div>
        </li>)}</ul> : <EmptyState>No recent records for the selected crew member.</EmptyState>}
      </Card>
      <Card title="Module availability">
        <dl className="service-list">
          <div><dt>Body profile & records</dt><dd>{backend.apiState === 'ready' ? 'API connected' : backend.apiState === 'checking' ? 'Checking API…' : 'API unavailable'}</dd></div>
          <div><dt>Gemini planner</dt><dd>Checked when generating</dd></div>
          <div><dt>YOLO-Pose</dt><dd>{backend.apiState !== 'ready' ? 'API unavailable' : vision ? vision.yolo_configured ? 'Configured' : 'Unavailable' : 'Availability unverified'}</dd></div>
          <div><dt>MediaPipe</dt><dd>{backend.apiState === 'ready' && vision?.mediapipe_asset ? 'Local model available' : 'Browser fallback when available'}</dd></div>
          <div><dt>Galaxy Watch4</dt><dd>{wear.status}</dd></div>
        </dl>
      </Card>
    </div>
  </>;
}
