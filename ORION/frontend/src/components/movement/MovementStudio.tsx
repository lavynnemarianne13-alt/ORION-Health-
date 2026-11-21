import { useEffect, useRef, useState } from 'react';
import { backendApi } from '../../services/backendApi';
import type { AssessmentReport, Athlete, ExerciseSession, MotionSample, PoseEngine, SavedPlan, SessionCreated } from '../../types/backend';
import { createMediaPipeDetector } from './mediaPipeClient';
import { clearPoseOverlay, drawPoseOverlay, poseMetrics } from './poseClient';
import { createOrionPoseDetector } from './orionPoseClient';
import type { PoseDetector } from './poseClient';
import { ExerciseRepCounter, exerciseOptions, setupGuidance, supportsExerciseCounting } from './exerciseCounter';
import type { ExerciseCode, ExerciseSide, CounterSnapshot } from './exerciseCounter';
import { feedbackText, MovementAssessment } from './movementAssessment';
import { exerciseProtocols, isRecordable, MovementRecording } from './movementRecording';
import './MovementStudio.css';

function toClock(seconds: number) { const m = Math.floor(seconds / 60); return `${String(m).padStart(2, '0')}:${String(seconds % 60).padStart(2,'0')}`; }
const message = (e: unknown) => e instanceof Error ? e.message : 'Unexpected error.';

type Props = {
  athlete: Athlete | null;
  reviewedPlans: SavedPlan[];
  backendReady: boolean;
  sessions: ExerciseSession[];
  onSessionChanged: () => void;
  recordings: Map<string, MovementRecording>;
};
export default function MovementStudio({ athlete, backendReady, sessions, onSessionChanged, recordings, reviewedPlans }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const secondaryOverlayRef = useRef<HTMLCanvasElement>(null);
  const secondaryDetectorRef = useRef<PoseDetector | null>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const poseDetectorRef = useRef<PoseDetector | null>(null);
  const frameRef = useRef<number | null>(null);
  const loadingTokenRef = useRef(0);
  const lastPoseFrameRef = useRef(0);
  const lastMetricsUpdateRef = useRef(0);
  const exerciseCounterRef = useRef(new ExerciseRepCounter('squat', 'left'));
  const assessmentRef = useRef(new MovementAssessment());
  const activeRecordingRef = useRef<MovementRecording | null>(null);
  const capturePausedRef = useRef(false);
  const [report, setReport] = useState<AssessmentReport | null>(null);
  const [counterSnapshot, setCounterSnapshot] = useState<CounterSnapshot | null>(null);
  const startedAtRef = useRef<number | null>(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [poseStatus, setPoseStatus] = useState<'idle' | 'loading' | 'running'>('idle');
  const [poseSource, setPoseSource] = useState<PoseEngine>('orion');
  const [compareYolo, setCompareYolo] = useState(false);
  const [comparison, setComparison] = useState('');
  const [poseError, setPoseError] = useState('');
  const [activeModel, setActiveModel] = useState('');
  const [liveMetrics, setLiveMetrics] = useState<ReturnType<typeof poseMetrics> | null>(null);
  const [exercise, setExercise] = useState<ExerciseCode>('squat');
  const [exerciseSide, setExerciseSide] = useState<ExerciseSide>('left');
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [baseElapsed, setBaseElapsed] = useState(0);
  const [currentSession, setCurrentSession] = useState<SessionCreated | null>(null);
  const [load, setLoad] = useState('');
  const [planId, setPlanId] = useState('');
  const [completedSets, setCompletedSets] = useState<number[]>([]);
  const [target, setTarget] = useState('');
  const [serverBusy, setServerBusy] = useState(false);
  const [serverError, setServerError] = useState('');
  const [serverMessage, setServerMessage] = useState('');
  const [sampleFile, setSampleFile] = useState<File | null>(null);
  const [sampleCount, setSampleCount] = useState<number | null>(null);

  useEffect(() => {
    if (!running) return;
    const tick = () => setElapsed(baseElapsed + Math.floor((Date.now() - (startedAtRef.current ?? Date.now())) / 1000));
    tick(); const id = window.setInterval(tick, 250); return () => window.clearInterval(id);
  }, [running, baseElapsed]);
  const releaseTracker = () => {
    loadingTokenRef.current += 1;
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    poseDetectorRef.current?.close(); poseDetectorRef.current = null;
    secondaryDetectorRef.current?.close(); secondaryDetectorRef.current = null;
    clearPoseOverlay(overlayRef.current);
    clearPoseOverlay(secondaryOverlayRef.current);
  };
  useEffect(() => () => {
    loadingTokenRef.current += 1;
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    poseDetectorRef.current?.close(); poseDetectorRef.current = null;
    secondaryDetectorRef.current?.close(); secondaryDetectorRef.current = null;
    activeRecordingRef.current?.counter.interrupt();
    activeRecordingRef.current?.assessment.interrupt();
    streamRef.current?.getTracks().forEach(track => track.stop());
  }, []);

  const stopPoseTracking = () => {
    releaseTracker(); exerciseCounterRef.current.interrupt(); assessmentRef.current.interrupt();
    setCounterSnapshot(prev => prev ? { ...prev, phase: 'waiting', trackingValid: false, guidance: 'Tracking stopped.', angle: null } : null);
    setPoseStatus('idle'); setLiveMetrics(null); setPoseError('');
  };
  const resetExerciseCounter = () => {
    exerciseCounterRef.current.reset();
    assessmentRef.current = new MovementAssessment();
    setReport(null); setCounterSnapshot(null);
  };
  const chooseExercise = (code: ExerciseCode) => {
    exerciseCounterRef.current = new ExerciseRepCounter(code, exerciseSide);
    resetExerciseCounter();
    setExercise(code); setPlanId(''); resetTimer();
  };
  const chooseSide = (side: ExerciseSide) => {
    exerciseCounterRef.current = new ExerciseRepCounter(exercise, side);
    resetExerciseCounter();
    setExerciseSide(side);
  };
  const startPoseTracking = async () => {
    if (!cameraOn || !videoRef.current || poseStatus !== 'idle') return;
    setPoseStatus('loading'); setPoseError(''); setComparison('');
    const token = ++loadingTokenRef.current;
    try {
      const detector = await (poseSource === 'orion' ? createOrionPoseDetector() : createMediaPipeDetector());
      if (token !== loadingTokenRef.current || !streamRef.current || !videoRef.current) { detector.close(); return; }
      poseDetectorRef.current = detector;
      setActiveModel(poseSource === 'orion' ? 'ORION YOLO-POSE'
        : `MEDIAPIPE ${detector.landmarksVersion.split('-')[2].toUpperCase()}`);
      if (poseSource === 'mediapipe' && compareYolo) {
        void createOrionPoseDetector().then(secondary => {
          if (token !== loadingTokenRef.current) { secondary.close(); return; }
          secondaryDetectorRef.current = secondary;
          setComparison('YOLO comparison active');
        }).catch(error => {
          if (token === loadingTokenRef.current) setComparison(`YOLO unavailable: ${message(error)}`);
        });
      }
      setPoseStatus('running');
      lastPoseFrameRef.current = 0; lastMetricsUpdateRef.current = 0;
      let evaluatedVideoTime = -1;
      const frame = async (timestamp: number) => {
        if (token !== loadingTokenRef.current) return;
        const video = videoRef.current, model = poseDetectorRef.current;
        if (video && model && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.currentTime !== evaluatedVideoTime && timestamp - lastPoseFrameRef.current >= 120) {
          lastPoseFrameRef.current = timestamp;
          evaluatedVideoTime = video.currentTime;
          try {
            const counter = exerciseCounterRef.current;
            const assessment = assessmentRef.current;
            const recording = activeRecordingRef.current;
            const capturedAt = performance.timeOrigin + timestamp;
            const secondary = secondaryDetectorRef.current;
            const comparisonTask = secondary
              ? Promise.resolve(secondary.detectForVideo(video, timestamp)).catch(() => null)
              : undefined;
            const result = await model.detectForVideo(video, timestamp);
            const comparisonResult = await comparisonTask;
            if (token !== loadingTokenRef.current) return;
            if (secondary && comparisonResult === null) {
              secondary.close();
              secondaryDetectorRef.current = null;
              setComparison('YOLO comparison interrupted. Restart tracking to retry.');
            }
            if (comparisonResult?.landmarks[0] && secondaryOverlayRef.current) {
              drawPoseOverlay(secondaryOverlayRef.current, video, comparisonResult.landmarks[0], '#f7b36d', comparisonResult.detection);
            } else clearPoseOverlay(secondaryOverlayRef.current);
            const detected = result.landmarks?.[0];
            if (detected) drawPoseOverlay(overlayRef.current!, video, detected, undefined, result.detection);
            else clearPoseOverlay(overlayRef.current);
            const metrics = detected ? poseMetrics(detected, video.videoWidth / video.videoHeight) : null;
            if (counter !== exerciseCounterRef.current || assessment !== assessmentRef.current || capturePausedRef.current) {
              frameRef.current = requestAnimationFrame(frame);
              return;
            }
            const next = counter.update(metrics, timestamp);
            assessment.update(counter.code, metrics, next);
            if (metrics && recording) {
              recording.capture(metrics, timestamp, capturedAt, video.videoWidth, video.videoHeight, model.landmarksVersion);
            }
            if (next) {
              setCounterSnapshot(previous => !previous || previous.reps !== next.reps || previous.attempts !== next.attempts || previous.phase !== next.phase || previous.guidance !== next.guidance || previous.trackingValid !== next.trackingValid ? next : previous);
            }
            if (timestamp - lastMetricsUpdateRef.current >= 250) {
              lastMetricsUpdateRef.current = timestamp;
              setLiveMetrics(metrics);
              setReport(assessment.report());
            }
          } catch (error) {
            if (token !== loadingTokenRef.current) return;
            releaseTracker(); exerciseCounterRef.current.interrupt(); assessmentRef.current.interrupt();
            setCounterSnapshot(prev => prev ? { ...prev, phase: 'waiting', trackingValid: false, guidance: 'Pose processing stopped.', angle: null } : null);
            setPoseStatus('idle'); setLiveMetrics(null);
            setPoseError(`Pose processing stopped: ${message(error)}`);
            return;
          }
        }
        frameRef.current = requestAnimationFrame(frame);
      };
      frameRef.current = requestAnimationFrame(frame);
    } catch (error) {
      if (token !== loadingTokenRef.current) return;
      setPoseStatus('idle');
      setPoseError(`Could not load the selected pose model. ${message(error)}`);
    }
  };

  const turnCameraOff = () => {
    stopPoseTracking();
    streamRef.current?.getTracks().forEach(track => track.stop()); streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraOn(false);
  };
  const turnCameraOn = async () => {
    setCameraError('');
    if (!navigator.mediaDevices?.getUserMedia) { setCameraError('Camera requires localhost or HTTPS.'); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'user' } });
      streamRef.current = stream;
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
      setCameraOn(true);
    } catch { turnCameraOff(); setCameraError('Camera unavailable. Check permissions.'); }
  };
  const toggleTimer = () => {
    if (running) {
      const t = baseElapsed + Math.floor((Date.now() - (startedAtRef.current ?? Date.now())) / 1000);
      setElapsed(t); setBaseElapsed(t); startedAtRef.current = null; setRunning(false);
    } else { startedAtRef.current = Date.now(); setRunning(true); }
  };
  const resetTimer = () => { setRunning(false); setElapsed(0); setBaseElapsed(0); startedAtRef.current = null; };

  const attachRecording = (sessionId: string, code: ExerciseCode, side: ExerciseSide) => {
    const recording = recordings.get(sessionId) ?? new MovementRecording(code, side);
    recordings.set(sessionId, recording);
    activeRecordingRef.current = recording;
    exerciseCounterRef.current = recording.counter;
    assessmentRef.current = recording.assessment;
    setCounterSnapshot(null);
    setCompletedSets([...recording.sets]);
    setReport(recording.assessment.report());
  };

  const startSession = async () => {
    if (!athlete || !backendReady || !isRecordable(exercise)) return;
    if (load.trim() !== '' && (!Number.isFinite(Number(load)) || Number(load) < 0)) { setServerError('Enter a non-negative load.'); return; }
    if (target.trim() !== '' && (!Number.isInteger(Number(target)) || Number(target) <= 0)) { setServerError('Target reps must be a positive integer.'); return; }
    setServerBusy(true); setServerError(''); setServerMessage('');
    try {
      const created = await backendApi.createSession({
        athlete_id: athlete.id,
        exercise_code: exercise,
        protocol_id: exerciseProtocols[exercise],
        pose_engine: poseSource,
        tracked_side: exercise === 'squat' ? undefined : exerciseSide,
        plan_id: planId || undefined,
        load_kg: load.trim() ? Number(load) : undefined,
        target_repetitions: target.trim() ? Number(target) : undefined,
      });
      attachRecording(created.session_id, exercise, exerciseSide);
      setCurrentSession(created); setSampleCount(null);
      setServerMessage('Session open. Finish it to save the assessment and derived measurements.');
      onSessionChanged();
    } catch (e) { setServerError(message(e)); } finally { setServerBusy(false); }
  };

  const resumeSession = (item: ExerciseSession) => {
    if (!isRecordable(item.exercise_code)) return;
    stopPoseTracking();
    const side = item.tracked_side ?? 'left';
    setExercise(item.exercise_code);
    setExerciseSide(side);
    if (item.pose_engine) {
      setPoseSource(item.pose_engine);
      attachRecording(item.session_id, item.exercise_code, side);
    } else {
      exerciseCounterRef.current = new ExerciseRepCounter(item.exercise_code, side);
      resetExerciseCounter();
    }
    setCurrentSession({ session_id: item.session_id, status: 'in_progress', started_at_utc: item.started_at_utc, protocol_version: '1', pose_engine: item.pose_engine });
    setServerError(''); setSampleCount(null);
    setServerMessage(item.pose_engine
      ? 'Session resumed. Start pose tracking to continue recording.'
      : 'Legacy session opened. You can finish it or import recorded measurements.');
  };

  const finishSession = async () => {
    if (!currentSession) return;
    capturePausedRef.current = true;
    setServerBusy(true); setServerError('');
    const recording = activeRecordingRef.current;
    try {
      const finished = await backendApi.finishSession(currentSession.session_id, recording ? {
        result: recording.assessment.report(),
        samples: recording.samples,
        sets: recording.sets,
      } : undefined);
      recordings.delete(currentSession.session_id);
      activeRecordingRef.current = null;
      exerciseCounterRef.current = new ExerciseRepCounter(exercise, exerciseSide);
      resetExerciseCounter();
      setServerMessage(finished.assessment_result
        ? `Session saved with ${finished.rep_count} valid repetitions. Open History to review the result.`
        : 'Session finished. Open History to review the record.');
      setCurrentSession(null); setSampleFile(null); resetTimer(); onSessionChanged();
    } catch (e) {
      setServerError(message(e));
    } finally {
      capturePausedRef.current = false;
      setServerBusy(false);
    }
  };
  const uploadSamples = async () => {
    if (!sampleFile || !currentSession) return;
    setServerBusy(true); setServerError(''); setServerMessage('');
    try {
      const raw: unknown = JSON.parse(await sampleFile.text());
      const obj = raw as {samples?: unknown};
      const samples = Array.isArray(raw) ? raw : obj && typeof obj === 'object' && Array.isArray(obj.samples) ? obj.samples : null;
      if (!samples || samples.length < 1 || samples.length > 50) throw new Error('Provide a JSON array of 1–50 real pose samples, or an object with a samples array.');
      const result = await backendApi.uploadSamples(currentSession.session_id, samples as MotionSample[]);
      setSampleCount(previous => (previous ?? 0) + result.inserted);
      setServerMessage(`Motion samples saved in SQLite: ${result.inserted} new, ${result.duplicates} duplicate.`);
    } catch (e) { setServerError(message(e)); } finally { setServerBusy(false); }
  };
  const openSessions = sessions.filter(s => s.status === 'in_progress' && isRecordable(s.exercise_code));
  const recordable = isRecordable(exercise);
  const planExercise = exercise === 'squat' ? 'resistance_squat' : exercise === 'knee' ? 'knee_extension' : null;
  const matchingPlans = reviewedPlans.flatMap(plan => {
    const option = plan.payload.options.find(item => item.exercise_id === planExercise);
    return option ? [{ plan, option }] : [];
  });
  const currentSetRepetitions = (report?.valid_repetitions ?? 0) - completedSets.reduce((sum, reps) => sum + reps, 0);

  function completeSet() {
    const recording = activeRecordingRef.current;
    if (!recording || currentSetRepetitions < 1 || recording.sets.length >= 100) return;
    recording.sets.push(currentSetRepetitions);
    setCompletedSets([...recording.sets]);
  }

  return <div className="movement-studio">
    <div className="ms-toolbar">
      <label className="ms-field" htmlFor="movement-exercise"><span>EXERCISE</span><select id="movement-exercise" value={exercise} disabled={!!currentSession || serverBusy} onChange={e => chooseExercise(e.target.value as ExerciseCode)}>{exerciseOptions.map(e => <option value={e.value} key={e.value}>{e.label}</option>)}</select></label>
      {exercise !== 'squat' && supportsExerciseCounting(exercise) && <label className="ms-field ms-field--side" htmlFor="movement-side"><span>TRACKED SIDE</span><select id="movement-side" value={exerciseSide} disabled={!!currentSession || serverBusy} onChange={e => chooseSide(e.target.value as ExerciseSide)}><option value="left">Left</option><option value="right">Right</option></select></label>}
      <div className="ms-session-badge"><i className={currentSession ? 'ms-live-dot' : ''}/>{currentSession ? 'BACKEND SESSION OPEN' : backendReady ? 'API CONNECTED' : 'LOCAL CAMERA PREVIEW'}</div>
    </div>
    <div className="ms-camera-frame"><div className="ms-camera-head"><span>CAMERA / LOCAL PREVIEW</span><span>{poseStatus === 'running' ? `${activeModel} · LIVE 2D` : poseStatus === 'loading' ? 'LOADING MODEL' : 'POSE TRACKING OFF'}</span></div><video ref={videoRef} autoPlay muted playsInline className={cameraOn ? 'ms-video ms-video--visible' : 'ms-video'}/><canvas ref={overlayRef} className="ms-pose-overlay" aria-hidden="true"/><canvas ref={secondaryOverlayRef} className="ms-pose-overlay" aria-hidden="true"/>{!cameraOn && <div className="ms-camera-empty"><h3>Live camera workspace</h3><p>Enable the camera and start pose tracking to see the live skeleton.</p></div>}</div>
    <div className="ms-controls">
      <label className="ms-field"><span>POSE MODEL</span><select value={poseSource} disabled={poseStatus !== 'idle' || !!currentSession?.pose_engine || serverBusy} onChange={event => {
        setPoseSource(event.target.value === 'orion' ? 'orion' : 'mediapipe');
        setPoseError('');
        if (!currentSession) resetExerciseCounter();
      }}>
        <option value="orion">Orion Dataset · YOLO-Pose</option>
        <option value="mediapipe">MediaPipe</option>
      </select></label>
      {poseSource === 'mediapipe' && <label><input type="checkbox" checked={compareYolo} disabled={poseStatus !== 'idle'} onChange={event => setCompareYolo(event.target.checked)}/> Compare YOLO overlay</label>}
      <button className={cameraOn ? 'ms-button ms-button--outline' : 'ms-button ms-button--primary'} type="button" onClick={cameraOn ? turnCameraOff : turnCameraOn}>{cameraOn ? 'Turn off camera' : 'Enable camera'}</button><button className={poseStatus === 'running' ? 'ms-button ms-button--outline' : 'ms-button ms-button--primary'} type="button" disabled={!cameraOn || poseStatus === 'loading'} onClick={poseStatus === 'running' ? stopPoseTracking : startPoseTracking}>{poseStatus === 'loading' ? 'Loading model…' : poseStatus === 'running' ? 'Stop pose tracking' : 'Start pose tracking'}</button><div className="ms-timer-group"><span className="ms-time">{toClock(elapsed)}</span><button className="ms-button ms-button--outline" type="button" onClick={toggleTimer}>{running ? 'Pause local timer' : elapsed ? 'Resume local timer' : 'Start local timer'}</button><button className="ms-reset" type="button" onClick={resetTimer} disabled={!elapsed && !running}>Reset</button></div></div>
    {cameraError && <p className="ms-error" role="alert">{cameraError}</p>}
    {poseStatus === 'running' && comparison && <p role="status">{comparison}</p>}
    {poseError && <p className="ms-error" role="alert">{poseError}</p>}
    {poseStatus === 'running' && <p className="ms-pose-hint" role="status">{liveMetrics?.visiblePoints ? 'Tracking visible body landmarks.' : 'No reliable pose yet. Position your full body in view.'}</p>}
    <section className="ms-squat-panel" aria-label="Experimental exercise repetition counter">
      <div className="ms-squat-info">
        <span className="ms-squat-label">MOVEMENT ASSESSMENT</span>
        <strong>{!supportsExerciseCounting(exercise) ? 'COUNTER UNAVAILABLE' : poseStatus === 'running' ? (counterSnapshot?.phase ?? 'waiting').replaceAll('_', ' ').toUpperCase() : 'INACTIVE'}</strong>
        <p aria-live="polite">{!supportsExerciseCounting(exercise) ? setupGuidance[exercise] : poseStatus !== 'running' ? 'Start the camera and pose tracking to count locally.' : counterSnapshot?.guidance ?? setupGuidance[exercise]}</p>
        <small>{setupGuidance[exercise]} · Experimental 2D angles</small>
      </div>
      <div className="ms-squat-actions"><div className="ms-squat-reps"><span>VALID / ATTEMPTED</span><strong>{recordable ? `${report?.valid_repetitions ?? 0} / ${report?.repetitions ?? 0}` : '—'}</strong></div><button type="button" className="ms-button ms-button--outline" onClick={resetExerciseCounter} disabled={!supportsExerciseCounting(exercise) || !!currentSession || serverBusy}>Reset count</button></div>
    </section>
    <div className="ms-pose-hint" aria-live="polite">
      {!recordable ? 'Assessment is unavailable for this exercise.' : report?.feedback.length ? report.feedback.map(code => <p key={code}>{feedbackText[code]}</p>)
        : report?.repetitions ? 'Completed attempts meet the configured 2D rules.'
        : 'Insufficient data for assessment. Complete a tracked attempt to see a result.'}
      {report?.tracking_quality != null && <p>Trackable frames: {Math.round(report.tracking_quality * 100)}%</p>}
    </div>
    <section className="ms-api-workspace" aria-label="Server exercise recording"><h3>Exercise recording</h3><p>Finish the session to save its movement assessment and sampled joint angles.</p>
      {!athlete && <p className="ms-api-info">Select or create a crew profile in Overview before recording a session.</p>}
      {!recordable && <p className="ms-api-info">Recording and assessment rules are unavailable for this exercise.</p>}
      {currentSession ? <><p>Sets recorded: {completedSets.length} · Repetitions in current set: {currentSetRepetitions}</p><button type="button" className="ms-button ms-button--outline" onClick={completeSet} disabled={currentSetRepetitions < 1 || serverBusy}>Record set</button><p className="ms-session-id">Active session: <code>{currentSession.session_id}</code></p><button type="button" className="ms-button ms-button--primary" onClick={finishSession} disabled={serverBusy || !backendReady}>Finish server session</button>
        <details className="ms-samples"><summary>Optional: import pose measurements (JSON)</summary><p>Only use samples created by a real pose-tracking pipeline. No values will be fabricated. Batch size: 1–50. Fields: frame_id, captured_at_utc, pose_quality, angles_deg, image_width, image_height, landmarks_version.</p><input type="file" accept=".json,application/json" onChange={e => setSampleFile(e.target.files?.[0] ?? null)}/><button type="button" className="ms-button ms-button--outline" onClick={uploadSamples} disabled={!sampleFile || serverBusy}>Save samples to API</button>{sampleCount !== null && <small>Inserted this visit: {sampleCount}</small>}</details></>
      : <>{matchingPlans.length > 0 && <label>Reviewed workout <select value={planId} onChange={event => {
        const next = event.target.value;
        setPlanId(next);
        const option = matchingPlans.find(({ plan }) => plan.id === next)?.option;
        setTarget(option ? String(option.repetitions_per_set) : '');
      }}><option value="">Manual exercise</option>{matchingPlans.map(({ plan, option }) =>
        <option key={plan.id} value={plan.id}>{option.name} · {option.sets} sets × {option.repetitions_per_set} reps · {option.rest_seconds}s rest</option>)}</select></label>}
      <div className="ms-form-row"><label>LOAD (KG, OPTIONAL)<input inputMode="decimal" type="number" min="0" step="any" value={load} onChange={e => setLoad(e.target.value)} placeholder="No load"/></label><label>TARGET REPS (OPTIONAL)<input inputMode="numeric" type="number" min="1" step="1" value={target} onChange={e => setTarget(e.target.value)} placeholder="No target"/></label></div><button type="button" className="ms-button ms-button--primary" onClick={startSession} disabled={!athlete || !backendReady || !recordable || serverBusy}>Start server session</button>{openSessions.map(item => <button type="button" key={item.session_id} disabled={serverBusy} className="ms-button ms-button--outline" onClick={() => resumeSession(item)}>Resume {item.exercise_code} · {new Date(item.started_at_utc).toLocaleString()}</button>)}</>}
      {serverError && <p className="ms-error" role="alert">{serverError}</p>}{serverMessage && <p className="ms-api-info" role="status">{serverMessage}</p>}
    </section>
    <div className="ms-metrics"><div><span>LEFT KNEE · 2D</span><strong>{liveMetrics?.leftKnee === null || liveMetrics?.leftKnee === undefined ? '—' : `${liveMetrics.leftKnee}°`}</strong><small>Camera projection</small></div><div><span>RIGHT KNEE · 2D</span><strong>{liveMetrics?.rightKnee === null || liveMetrics?.rightKnee === undefined ? '—' : `${liveMetrics.rightKnee}°`}</strong><small>Camera projection</small></div><div><span>LANDMARK VISIBILITY</span><strong>{liveMetrics?.averageVisibility == null ? '—' : `${Math.round(liveMetrics.averageVisibility * 100)}%`}</strong><small>Not clinical pose quality</small></div></div><div className="ms-secondary-metrics">Elbows (2D): left <strong>{liveMetrics?.leftElbow == null ? '—' : `${liveMetrics.leftElbow}°`}</strong> · right <strong>{liveMetrics?.rightElbow == null ? '—' : `${liveMetrics.rightElbow}°`}</strong></div>
    <p className="ms-note">Pose angles are experimental 2D camera projections, not validated clinical measurements. Orion YOLO-Pose sends frames to the configured ORION API for processing in memory. MediaPipe processes frames in the browser. The exercise rules use measured 2D movement for research feedback. Finished sessions store derived metrics and results.</p>
  </div>;
}
