import { useCallback, useEffect, useRef, useState } from 'react';
import BodyMap, { findRegion, regions } from './components/anatomy/BodyMap';
import type { BodyView, RegionId } from './components/anatomy/BodyMap';
import type { MovementRecording } from './components/movement/movementRecording';
import MovementStudio from './components/movement/MovementStudio';
import BodyProfile from './components/biometrics/BodyProfile';
import type { BodyMeasurement } from './types/anthropometry';
import { getRegionCircumference, formatNumber } from './utils/anthropometry';
import { cmToIn } from './utils/imperial';
import ProfilePanel from './components/backend/ProfilePanel';
import { useBackend } from './hooks/useBackend';
import { useWear } from './hooks/useWear';
import WearPanel from './components/backend/WearPanel';
import { apiRequest } from './services/apiClient';
import ExerciseAdvisor from './components/advisor/ExerciseAdvisor';
import type { SavedPlan } from './types/backend';
import OrbitDock from './components/ui/OrbitDock';
import type { Page } from './components/ui/OrbitDock';
import { Card, EmptyState, PageHeader } from './components/ui/Surfaces';
import Overview from './components/pages/Overview';
import History from './components/pages/History';
import './App.css';

function App() {
  const backend = useBackend();
  const [movementRecordings] = useState(() => new Map<string, MovementRecording>());
  const [page, setPage] = useState<Page>('overview');
  const [selected, setSelected] = useState<RegionId>('right_thigh');
  const [view, setView] = useState<BodyView>('front');
  const [visited, setVisited] = useState(() => new Set<Page>(['overview']));
  const [planRefresh, setPlanRefresh] = useState(0);
  const [movementLocks, setMovementLocks] = useState<Record<string, boolean>>({});
  const [crewPanelRequest, setCrewPanelRequest] = useState(0);
  const crewPanel = useRef<HTMLElement>(null);
  const [bodyRecordsByCrew, setBodyRecordsByCrew] = useState<Record<string, BodyMeasurement[]>>({});
  const currentCrewId = backend.athlete?.id ?? null;
  const bodyRecords = currentCrewId ? (bodyRecordsByCrew[currentCrewId] ?? []) : [];
  const wear = useWear(currentCrewId);
  const movementKey = currentCrewId ?? 'local';
  const crewLocked = !!movementLocks[movementKey];
  const latestBody = bodyRecords[0] ?? null;
  const [bodyError, setBodyError] = useState({ athleteId: '', message: '' });
  const [plans, setPlans] = useState<{ athleteId: string; entries: SavedPlan[] }>({ athleteId: '', entries: [] });
  const [vision, setVision] = useState<{ yolo_configured: boolean; mediapipe_asset: boolean } | null>(null);
  useEffect(() => {
    if (backend.apiState !== 'ready') return;
    const controller = new AbortController();
    const { signal } = controller;
    apiRequest<{ yolo_configured: boolean; mediapipe_asset: boolean }>('/api/v1/pose/availability', { signal })
      .then(status => { if (!signal.aborted) setVision(status); })
      .catch(() => { if (!signal.aborted) setVision(null); });
    return () => controller.abort();
  }, [backend.apiState]);
  useEffect(() => {
    if (!currentCrewId || backend.apiState !== 'ready') return;
    const controller = new AbortController();
    const { signal } = controller;
    apiRequest<BodyMeasurement[]>(`/api/v1/athletes/${currentCrewId}/measurements`, { signal })
      .then(records => { if (!signal.aborted) setBodyRecordsByCrew(previous => ({ ...previous, [currentCrewId]: records })); })
      .catch(error => { if (!signal.aborted) setBodyError({ athleteId: currentCrewId, message: error.message }); });
    return () => controller.abort();
  }, [currentCrewId, backend.apiState]);

  useEffect(() => {
    if (!currentCrewId || backend.apiState !== 'ready') return;
    const controller = new AbortController();
    const { signal } = controller;
    apiRequest<SavedPlan[]>(`/api/v1/athletes/${currentCrewId}/plans`, { signal })
        .then(entries => { if (!signal.aborted) setPlans({ athleteId: currentCrewId, entries }); })
        .catch(error => { if (!signal.aborted) setBodyError({ athleteId: currentCrewId, message: error.message }); });
    return () => controller.abort();
  }, [currentCrewId, backend.apiState, planRefresh]);

  async function addBodyRecord(record: BodyMeasurement) {
    const id = record.athleteId;
    setBodyError({ athleteId: id, message: '' });
    try {
      const saved = await apiRequest<BodyMeasurement>(`/api/v1/athletes/${id}/measurements`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(record),
      });
      setBodyRecordsByCrew(previous => ({ ...previous, [id]: [saved, ...(previous[id] ?? [])] }));
      return true;
    } catch (error) {
      setBodyError({ athleteId: id, message: (error as Error).message });
      return false;
    }
  }

  async function removeBodyRecord(recordId: string) {
    if (!currentCrewId) return;
    setBodyError({ athleteId: currentCrewId, message: '' });
    try {
      await apiRequest(`/api/v1/athletes/${currentCrewId}/measurements/${recordId}`, { method: 'DELETE' });
      setBodyRecordsByCrew(previous => ({ ...previous, [currentCrewId]: (previous[currentCrewId] ?? []).filter(item => item.id !== recordId) }));
    } catch (error) {
      setBodyError({ athleteId: currentCrewId, message: (error as Error).message });
    }
  }
  async function recordPlanReview(planId: string, reviewer: string) {
    if (!currentCrewId) return false;
    setBodyError({ athleteId: currentCrewId, message: '' });
    try {
      const review = await apiRequest<NonNullable<SavedPlan['payload']['review']>>(`/api/v1/athletes/${currentCrewId}/plans/${planId}/review`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewer, professionally_reviewed: true }),
      });
      setPlans(previous => previous.athleteId === currentCrewId ? { ...previous,
        entries: previous.entries.map(plan => plan.id === planId ? { ...plan, payload: { ...plan.payload, review } } : plan),
      } : previous);
      return true;
    } catch (error) {
      setBodyError({ athleteId: currentCrewId, message: (error as Error).message });
      return false;
    }
  }


  function navigate(next: Page) {
    setVisited(previous => previous.has(next) ? previous : new Set(previous).add(next));
    setPage(next);
    window.scrollTo(0, 0);
  }
  function manageCrew() {
    navigate('overview');
    setCrewPanelRequest(request => request + 1);
  }
  useEffect(() => {
    if (crewPanelRequest) {
      crewPanel.current?.focus({ preventScroll: true });
      crewPanel.current?.scrollIntoView({ block: 'start' });
    }
  }, [crewPanelRequest]);

  const setMovementLocked = useCallback((locked: boolean) => {
    setMovementLocks(previous => previous[movementKey] === locked ? previous : { ...previous, [movementKey]: locked });
  }, [movementKey]);

  function changeView(next: BodyView) {
    setView(next);
    if (next === 'back' && (selected === 'chest' || selected === 'abdomen')) setSelected('upper_back');
    if (next === 'front' && (selected === 'upper_back' || selected === 'lower_back')) setSelected('chest');
  }
  const region = findRegion(selected);
  function latestRegionReading(id: RegionId) {
    for (const record of bodyRecords) {
      const reading = getRegionCircumference(record, id);
      if (reading) return { ...reading, recordedAt: record.recordedAt };
    }
    return null;
  }
  const circumference = page === 'anatomy' ? latestRegionReading(selected) : null;
  const activePlans = plans.athleteId === currentCrewId ? plans.entries : null;
  const recordError = bodyError.athleteId === currentCrewId ? bodyError.message : '';
  return <div className="orion-app">
    <OrbitDock active={page} navigate={navigate} backend={backend} onManageCrew={manageCrew} crewLocked={crewLocked}/>
    <main className="content">
      {page !== 'overview' && backend.error && <p role="alert" className="ms-error">{backend.error}</p>}
      <div hidden={page !== 'overview'} className="orion-page">
        <Overview backend={backend} records={bodyRecords} wear={wear} vision={vision} navigate={navigate} onManageCrew={manageCrew}/>
        <section className="crew-panel-anchor" tabIndex={-1} ref={crewPanel} aria-label="Manage crew">
          <ProfilePanel apiState={backend.apiState} athlete={backend.athlete} working={backend.working} error={backend.error}
            onCreate={backend.createProfile} onOpen={backend.openProfile} onClear={backend.clearProfile}
            crewLocked={crewLocked} onRetry={() => void backend.checkConnection()}/>
        </section>
      </div>
      {visited.has('bodyprofile') && <div hidden={page !== 'bodyprofile'} className="orion-page">
        <PageHeader eyebrow="Crew / anthropometry" title="Body Profile" subtitle="Record and review individual physical measurements."
          action={<button onClick={() => navigate('anatomy')}>Open Body Atlas →</button>}/>
        {recordError && page === 'bodyprofile' && <p className="ms-error" role="alert">{recordError}</p>}
        <BodyProfile key={currentCrewId} athlete={backend.athlete} records={bodyRecords} onAdd={addBodyRecord} onRemove={removeBodyRecord} onSelectCrew={manageCrew}/>
      </div>}
      {page === 'anatomy' && <div className="orion-page">
        <PageHeader eyebrow="Crew / anatomical explorer" title="Body Atlas" subtitle="Select a body region to inspect available measurements."
          action={<span className="pill">Interactive schematic</span>}/>
        <div className="grid anatomy-page-grid">
          <Card title="Body regions" className="atlas-list">
            <p className="muted-note">Select a region on the body or in the list.</p>
            <div className="region-list" aria-label="Body regions">
              {regions.filter(item => view === 'front' ? !['upper_back', 'lower_back'].includes(item.id) : !['chest', 'abdomen'].includes(item.id)).map(item => {
                const reading = latestRegionReading(item.id);
                return <button type="button" key={item.id} aria-pressed={selected === item.id} onClick={() => setSelected(item.id)}>
                  <span>{item.name}</span><small>{reading ? `${formatNumber(cmToIn(reading.value))} in` : '—'}</small>
                </button>;
              })}
            </div>
          </Card>
          <Card className="anatomy-main"><BodyMap selected={selected} onSelect={setSelected} view={view} onViewChange={changeView}/></Card>
          <Card title="Selected region" className="anatomy-detail-card">
            <h3>{region.name}</h3><p className="muted-note">{region.category} · {region.side}</p>
            <div className="region-reading"><span className="caps">Latest linked measurement</span>
              <div className="metric-value">{circumference ? `${formatNumber(cmToIn(circumference.value))} in` : '—'}</div>
              <p>{circumference ? `${circumference.label} · ${new Date(circumference.recordedAt).toLocaleDateString('en-US')}` : 'No linked circumference available.'}</p>
            </div>
            <p className="clinical-note">This atlas maps anatomical regions to recorded observations. Regional clinical assessments are unavailable.</p>
            <div className="hero-actions">
              <button type="button" className="button-dark" onClick={() => navigate('bodyprofile')}>Open Body Profile →</button>
              <button type="button" onClick={() => navigate('movement')}>Open Movement</button>
            </div>
          </Card>
        </div>
      </div>}
      {visited.has('planner') && <div hidden={page !== 'planner'} className="orion-page">
        <PageHeader eyebrow="Exercise support / Google Gemini" title="AI Workout Planner" subtitle={backend.athlete ? `Structured exercise drafts for ${backend.athlete.pseudonym}.` : 'Structured exercise drafts for professional review.'}
          action={<span className="pill warn">Professional review required</span>}/>
        <div className="surface planner-banner"><h2>Personalized exercise proposals</h2><p className="muted-note">Profile context, available equipment and safety considerations.</p></div>
        {backend.athlete ? <ExerciseAdvisor key={currentCrewId} measurement={latestBody} athleteId={backend.athlete.id}
          onDraftSaved={() => setPlanRefresh(value => value + 1)}/> : <Card><EmptyState>Select a crew member to configure a workout draft.</EmptyState><button onClick={manageCrew}>Manage crew</button></Card>}
      </div>}
      {visited.has('movement') && <div hidden={page !== 'movement'} className="orion-page">
        <PageHeader eyebrow="Computer vision / exercise tracking" title="Movement" subtitle="Shared camera capture, pose estimation and exercise sessions."/>
        <MovementStudio key={movementKey} reviewedPlans={(activePlans ?? []).filter(plan => plan.payload.review)} recordings={movementRecordings}
          athlete={backend.athlete} backendReady={backend.apiState === 'ready'} sessions={backend.sessions}
          onSessionChanged={() => void backend.reloadSessions()} onCrewLock={setMovementLocked}
          sidebar={<>
            <Card title="Vision engines"><dl className="service-list">
              <div><dt>YOLO-Pose</dt><dd>{backend.apiState !== 'ready' ? 'API unavailable' : vision ? vision.yolo_configured ? 'Configured' : 'Unavailable' : 'Unverified'}</dd></div>
              <div><dt>MediaPipe</dt><dd>{backend.apiState === 'ready' && vision?.mediapipe_asset ? 'Local model available' : 'Browser fallback when available'}</dd></div>
            </dl></Card>
            <Card title="Session records"><button type="button" onClick={() => navigate('history')}>Open History →</button></Card>
          </>}/>
      </div>}
      {page === 'wear' && <div className="orion-page"><WearPanel wear={wear} crewName={backend.athlete?.pseudonym}/></div>}
      {visited.has('history') && <div hidden={page !== 'history'} className="orion-page">
        {recordError && page === 'history' && <p className="ms-error" role="alert">{recordError}</p>}
        <History athlete={backend.athlete} ready={backend.apiState === 'ready'} records={bodyRecords} sessions={backend.sessions}
          plans={activePlans} wear={wear} onRefresh={() => void backend.reloadSessions()} onReview={recordPlanReview} onProfile={() => navigate('bodyprofile')}/>
      </div>}
    </main>
    <footer className="app-footer"><span>ORION / Astronaut health monitoring</span><span>Research use only</span></footer>
  </div>;
}

export default App;
