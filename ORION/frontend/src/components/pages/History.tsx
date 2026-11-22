import { useState } from 'react';
import type { Athlete, ExerciseSession, SavedPlan } from '../../types/backend';
import type { BodyMeasurement } from '../../types/anthropometry';
import { wearLabels } from '../../hooks/useWear';
import type { useWear } from '../../hooks/useWear';
import { formatUsHeight, formatUsWeight } from '../../utils/imperial';
import SessionHistory from '../backend/SessionHistory';
import { Card, EmptyState, PageHeader } from '../ui/Surfaces';
import SegmentedControl from '../ui/SegmentedControl';
import { DAY_MS } from '../../utils/dates';

const categories = [
  { value: 'all', label: 'All' }, { value: 'body', label: 'Body' },
  { value: 'exercise', label: 'Exercise' }, { value: 'ai', label: 'AI drafts' },
  { value: 'wear', label: 'Wear' },
] as const;

export default function History({ athlete, ready, records, sessions, plans, wear, onRefresh, onReview, onProfile }: {
  athlete: Athlete | null; ready: boolean; records: BodyMeasurement[]; sessions: ExerciseSession[];
  plans: SavedPlan[] | null; wear: ReturnType<typeof useWear>;
  onRefresh: () => void; onReview: (id: string, reviewer: string) => Promise<boolean>; onProfile: () => void;
}) {
  const [category, setCategory] = useState<typeof categories[number]['value']>('all');
  const [period, setPeriod] = useState(0);
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now);
  const cutoff = period ? now - period * DAY_MS : -Infinity;
  const includes = (time: number, kind: typeof category) => time >= cutoff && (category === 'all' || category === kind);
  const body = records.filter(item => includes(Date.parse(item.recordedAt), 'body'));
  const exercise = sessions.filter(item => includes(Date.parse(item.ended_at_utc ?? item.started_at_utc), 'exercise'));
  const drafts = (plans ?? []).filter(item => includes(Date.parse(item.created_at), 'ai'));
  const readings = wear.readings.filter(item => includes(item.measured_at ?? item.received_at, 'wear'));
  const entries = [
    ...body.map(row => ({ key: row.id, time: Date.parse(row.recordedAt), name: `${formatUsWeight(row.weightKg)} · ${formatUsHeight(row.heightCm)}`, type: 'Body', status: 'Recorded' })),
    ...exercise.map(row => ({ key: row.session_id, time: Date.parse(row.ended_at_utc ?? row.started_at_utc), name: row.exercise_code.replaceAll('_', ' '), type: 'Exercise', status: row.status.replaceAll('_', ' ') })),
    ...drafts.map(row => ({ key: row.id, time: Date.parse(row.created_at), name: 'Workout draft', type: 'AI', status: row.payload.review ? 'Reviewed' : 'Review required' })),
    ...readings.map((row, index) => ({ key: 'wear-' + index, time: row.measured_at ?? row.received_at, name: `${wearLabels[row.name] ?? row.name} · ${row.value}`, type: 'Wear', status: 'Recorded' })),
  ].sort((a, b) => b.time - a.time);

  return <>
    <PageHeader eyebrow="Crew / longitudinal records" title="History" subtitle={athlete ? `Individual records for ${athlete.pseudonym}` : 'Select a crew member to view individual records.'}/>
    <Card title="Activity timeline" action={<div className="history-filters">
      <SegmentedControl label="Record category" options={categories} value={category} onChange={setCategory}/>
      <select aria-label="Record period" value={period} onChange={event => { setNow(Date.now()); setPeriod(Number(event.target.value)); }}>
        <option value={0}>All dates</option><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option>
      </select>
    </div>}>
      {entries.length ? <div className="table-scroll"><table className="timeline-table"><thead><tr><th scope="col">Record</th><th scope="col">Date</th><th scope="col">Category</th><th scope="col">Status</th></tr></thead>
        <tbody>{entries.map(row => <tr key={row.key}><td>{row.name}</td><td>{new Date(row.time).toLocaleString('en-US')}</td><td>{row.type}</td><td><span className={`pill ${row.status === 'Review required' ? 'warn' : ''}`}>{row.status}</span></td></tr>)}</tbody>
      </table></div> : <EmptyState>{!athlete ? 'No crew member selected.' : !ready ? 'The API is unavailable.' : 'No records match these filters.'}</EmptyState>}
      {(category === 'all' || category === 'wear') && athlete && <p className="muted-note" role="status">{wear.status}</p>}
    </Card>
    {(category === 'all' || category === 'ai') && <Card title="Workout drafts">
      {drafts.length === 0 && <EmptyState>{athlete && ready && plans === null ? 'Loading workout drafts…' : 'No workout drafts in the selected period.'}</EmptyState>}
      <div className="draft-list">{[...drafts].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)).map(({ id, created_at, payload }) => <article key={id} className="draft-detail">
        <div className="surface-heading"><h3>{new Date(created_at).toLocaleString('en-US')}</h3><span className={`pill ${payload.review ? 'good' : 'warn'}`}>{payload.review ? 'Reviewed' : 'Review required'}</span></div>
        <p>{payload.summary}</p><p className="muted-note">{payload.sessions_per_week ? `${payload.sessions_per_week} sessions/week · ` : ''}{payload.limitations}</p>
        <ul>{payload.options.map(option => <li key={option.exercise_id}><strong>{option.name}</strong> · {option.sets} sets × {option.repetitions_per_set} reps · {option.rest_seconds}s rest<p>{option.rationale} · {option.caution}</p></li>)}</ul>
        {payload.review ? <p>Professional review recorded for {payload.review.reviewer}.</p> : payload.options.length > 0 && <form className="review-form" onSubmit={async event => {
          event.preventDefault();
          const reviewer = String(new FormData(event.currentTarget).get('reviewer') ?? '');
          setReviewing(id);
          try { await onReview(id, reviewer); } finally { setReviewing(null); }
        }}>
          <label>Professional reviewer <input name="reviewer" required minLength={2} maxLength={80}/></label>
          <label><input type="checkbox" required/> A qualified professional approved this draft for use.</label>
          <button type="submit" className="button-dark" disabled={reviewing !== null || !ready}>Record review</button>
        </form>}
      </article>)}</div>
    </Card>}
    {(category === 'all' || category === 'exercise') && <SessionHistory athleteName={athlete?.pseudonym ?? null}
      sessions={[...exercise].sort((a, b) => Date.parse(b.ended_at_utc ?? b.started_at_utc) - Date.parse(a.ended_at_utc ?? a.started_at_utc))}
      ready={ready} onRefresh={onRefresh}/>}
    {body.length > 0 && <button type="button" onClick={onProfile}>Open measurement history →</button>}
  </>;
}
