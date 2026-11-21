import { useState } from 'react';
import { backendApi } from '../../services/backendApi';
import type { ExerciseSession, MotionSample } from '../../types/backend';
import { exerciseOptions } from '../movement/exerciseCounter';
import { feedbackText } from '../movement/movementAssessment';

const assessmentLabels = {
  insufficient_data: 'Insufficient data',
  needs_correction: 'Needs correction',
  meets_configured_rules: 'Meets configured rules',
};

function SavedMeasurements({ sessionId }: { sessionId: string }) {
  const [samples, setSamples] = useState<MotionSample[]>([]);
  const [offset, setOffset] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = async (page: number) => {
    setBusy(true);
    setError('');
    try {
      setSamples(await backendApi.getSamples(sessionId, page));
      setOffset(page);
      setLoaded(true);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not retrieve measurements.');
    } finally {
      setBusy(false);
    }
  };
  return <details className="ms-samples" onToggle={event => {
    if (event.currentTarget.open && !loaded && !busy) void load(0);
  }}>
    <summary>Saved joint measurements</summary>
    {error && <p role="alert">{error} <button type="button" onClick={() => void load(offset)}>Retry</button></p>}
    {busy && <p role="status">Loading measurements…</p>}
    {loaded && samples.length === 0 && <p>No measurements on this page.</p>}
    {samples.length > 0 && <ol start={offset + 1}>{samples.map(sample => <li key={sample.frame_id}>
      {new Date(sample.captured_at_utc).toLocaleTimeString()} · {sample.landmarks_version} · {Math.round(sample.pose_quality * 100)}% landmark score
      <br />{Object.entries(sample.angles_deg).map(([joint, angle]) =>
        `${joint.replace(/([A-Z])/g, ' $1').replaceAll('_', ' ').toLowerCase()} ${angle}°`).join(' · ')}
    </li>)}</ol>}
    {offset > 0 && <button type="button" disabled={busy} onClick={() => void load(offset - 25)}>Previous</button>}
    {samples.length === 25 && <button type="button" disabled={busy} onClick={() => void load(offset + 25)}>Next</button>}
  </details>;
}

type Props = { athleteName: string | null; sessions: ExerciseSession[]; ready: boolean; onRefresh: () => void };

export default function SessionHistory({ athleteName, sessions, ready, onRefresh }: Props) {
  return <section className="surface backend-panel" aria-label="Server exercise sessions">
    <div className="backend-panel-heading"><div><span className="section-number">SQLITE / SERVER RECORDS</span><h2>Exercise sessions {athleteName ? `· ${athleteName}` : ''}</h2></div><button type="button" className="ms-button ms-button--outline" onClick={onRefresh} disabled={!ready || !athleteName}>Refresh</button></div>
    {!athleteName ? <p className="backend-empty">Choose a crew profile in Overview to view its session history.</p>
    : !sessions.length ? <p className="backend-empty">No sessions have been recorded for this profile.</p>
    : <div className="backend-session-list">{sessions.map(record => {
      const result = record.assessment_result;
      const title = exerciseOptions.find(option => option.value === record.exercise_code)?.label ?? record.exercise_code;
      return <article key={record.session_id} className="backend-session-row"><div>
        <strong>{title} · {record.protocol_id}</strong><small>{new Date(record.started_at_utc).toLocaleString('en-US')}</small>
        <small>{record.pose_engine === 'orion' ? 'Orion YOLO-Pose' : record.pose_engine === 'mediapipe' ? 'MediaPipe' : 'Engine unrecorded'}{record.tracked_side ? ` · ${record.tracked_side} side` : ''}{record.duration_seconds != null ? ` · ${record.duration_seconds} s` : ''}</small>
        <code>{record.session_id}</code>
        {record.sets?.length ? <small>Sets: {record.sets.join(", ")} repetitions</small> : null}
        {record.plan_id && <small>Reviewed plan <code>{record.plan_id}</code></small>}
        <SavedMeasurements sessionId={record.session_id}/>
      </div><div>
        <span className="backend-session-status">{record.status.replaceAll('_', ' ')}</span>
        {result ? <>
          <strong>{assessmentLabels[result.assessment]}</strong>
          <small>{result.valid_repetitions} valid / {result.repetitions} completed attempts</small>
          {result.tracking_quality != null && <small>Trackable frames: {Math.round(result.tracking_quality * 100)}%</small>}
          {result.feedback.map(code => <small key={code}>{feedbackText[code]}</small>)}
        </> : <small>{record.status === 'finished' ? 'No assessment was saved.' : 'Assessment pending'}</small>}
      </div></article>;
    })}</div>}
    <p className="backend-disclaimer">Showing up to 100 recent sessions for the selected profile.</p>
  </section>;
}
