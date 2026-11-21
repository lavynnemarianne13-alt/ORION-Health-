import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import BodyMap, { findRegion } from './components/anatomy/BodyMap';
import type { BodyView, RegionId } from './components/anatomy/BodyMap';
import type { MovementRecording } from './components/movement/movementRecording';
import MovementStudio from './components/movement/MovementStudio';
import BodyProfile from './components/biometrics/BodyProfile';
import type { BodyMeasurement } from './types/anthropometry';
import { getRegionCircumference, formatNumber } from './utils/anthropometry';
import { cmToIn, formatUsHeight, formatUsWeight } from './utils/imperial';
import ProfilePanel from './components/backend/ProfilePanel';
import SessionHistory from './components/backend/SessionHistory';
import { useBackend } from './hooks/useBackend';
import WearPanel from './components/backend/WearPanel';
import { apiRequest } from './services/apiClient';
import ExerciseAdvisor from './components/advisor/ExerciseAdvisor';
import type { SavedPlan } from './types/backend';
import './App.css';

type Page = 'overview' | 'bodyprofile' | 'anatomy' | 'movement' | 'history' | 'integrations' | 'wear' | 'planner';

const navigation: { id: Page; title: string; icon: string; detail: string }[] = [
  { id: 'overview', title: 'Overview', icon: 'overview', detail: 'Mission dashboard' },
  { id: 'bodyprofile', title: 'Body profile', icon: 'user', detail: 'Individual measurements' },
  { id: 'anatomy', title: 'Body atlas', icon: 'body', detail: 'Regions and assessments' },
  { id: 'planner', title: 'AI Workout Planner', icon: 'cpu', detail: 'Drafts for professional review' },
  { id: 'wear', title: 'ORION Wear', icon: 'activity', detail: 'Watch measurements' },
  { id: 'movement', title: 'Movement', icon: 'activity', detail: 'Camera monitoring' },
  { id: 'history', title: 'History', icon: 'history', detail: 'Records and trends' },
  { id: 'integrations', title: 'Integrations', icon: 'grid', detail: 'Technical connections' }
];

const iconMarkup: Record<string, ReactNode> = {
  overview: <><rect x="3" y="3" width="7" height="7" rx="1.2"/><rect x="14" y="3" width="7" height="7" rx="1.2"/><rect x="3" y="14" width="7" height="7" rx="1.2"/><rect x="14" y="14" width="7" height="7" rx="1.2"/></>,
  body: <><circle cx="12" cy="4.5" r="2"/><path d="M8 21v-6l-3-3 2-4 5 2 5-2 2 4-3 3v6M8 15h8M12 10v7"/></>,
  activity: <path d="M2 12h4l3-7 4 14 3-7h6"/>,
  history: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l4 2"/></>,
  grid: <><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 9v12"/></>,
  arrow: <path d="M5 12h14m-6-6 6 6-6 6"/>,
  diagonal: <path d="M6 18 18 6M8 6h10v10"/>,
  chevron: <path d="m6 9 6 6 6-6"/>,
  camera: <><path d="M4 7h4l2-3h4l2 3h4v13H4Z"/><circle cx="12" cy="13" r="3.5"/></>,
  shield: <><path d="M12 2 4 6v6c0 5 3 8 8 10 5-2 8-5 8-10V6Z"/><path d="m8 12 3 3 5-6"/></>,
  database: <><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 2 4 3 9 3s9-1 9-3V5M3 12c0 2 4 3 9 3s9-1 9-3"/></>,
  cpu: <><rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 1v5m6-5v5M9 18v5m6-5v5M1 9h5M1 15h5m12-6h5m-5 6h5"/><rect x="10" y="10" width="4" height="4" rx=".6"/></>,
  info: <><circle cx="12" cy="12" r="10"/><path d="M12 11v5m0-8h.01"/></>,
  circlecheck: <><circle cx="12" cy="12" r="10"/><path d="m7 12 3.5 3.5L17 9"/></>,
  menu: <path d="M4 7h16M4 12h16M4 17h16"/>,
  close: <path d="M5 5l14 14M19 5 5 19"/>,
  user: <><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3-7 8-7s8 3 8 7"/></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 10h18"/></>,
  layers: <><path d="m12 3 9 5-9 5-9-5 9-5Zm-9 10 9 5 9-5M3 18l9 5 9-5"/></>,
  alert: <><path d="m12 3 10 18H2Z"/><path d="M12 9v5m0 3h.01"/></>
};
function Icon({ name, size = 19, className = '' }: { name: string; size?: number; className?: string }) {
  return <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{iconMarkup[name] || iconMarkup.info}</svg>;
}

function Figure({ index, label, description }: { index: string; label: string; description: string }) {
  return <article className="figure"><div className="figure-top"><span>{label}</span><Icon name="diagonal" size={17}/></div><strong>{index}</strong><p>{description}</p></article>;
}

function DemoTrend() {
  const values = [33, 39, 35, 47, 42, 45, 40, 54, 50, 56, 48, 59];
  const points = values.map((y, i) => `${20 + i * 29},${110 - y}`).join(' ');
  return <div className="trend-figure"><div className="trend-header"><span>Illustrative longitudinal trend</span><span className="demo-pill">SYNTHETIC DATA</span></div><svg viewBox="0 0 380 145" preserveAspectRatio="none" aria-label="Illustrative trend chart; no real measurements"><defs><linearGradient id="trendArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#9ba7b4" stopOpacity=".38"/><stop offset="1" stopColor="#9ba7b4" stopOpacity="0"/></linearGradient></defs>{[33, 63, 93, 123].map(y => <line key={y} x1="18" x2="366" y1={y} y2={y} stroke="#dee1e5" strokeDasharray="3 6"/>)}<polygon points={`20,130 ${points} 339,130`} fill="url(#trendArea)"/><polyline points={points} fill="none" stroke="#455567" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke"/><circle cx="339" cy="51" r="5" fill="#455567" stroke="#f5f7fa" strokeWidth="3"/></svg><div className="trend-months"><span>WK 01</span><span>WK 04</span><span>WK 08</span><span>WK 12</span></div></div>;
}

function RegionDetails({ regionId, latestBody, onNavigate }: { regionId: RegionId; latestBody: BodyMeasurement | null; onNavigate: (page: Page) => void }) {
  const region = findRegion(regionId);
  const circumference = getRegionCircumference(latestBody, regionId);
  return <div className="region-detail">
    <div className="eyebrow eyebrow--green">SELECTED REGION <span className="small-arrow">↗</span></div>
    <h2>{region.name}</h2>
    <div className="region-detail-meta"><span>{region.category}</span><span>·</span><span>Side: {region.side}</span></div>
    <div className="region-status"><span className="status-neutral"/> <span>No clinical assessment available</span></div>
    <div className="detail-separator"/>
    <div className="detail-section-title">Body profile <span>{latestBody ? 'Manual measurements' : 'Not recorded'}</span></div>
    {circumference ? <div className="bp-region-reading"><strong>{formatNumber(cmToIn(circumference.value))} in</strong><span>{circumference.label}</span></div> : <p className="muted-note">No linked circumference measurement for this region.</p>}
    <button type="button" className="text-action" onClick={() => onNavigate('bodyprofile')}>Open body profile <Icon name="arrow" size={17}/></button>
    <div className="detail-separator"/>
    <div className="detail-section-title">Functional monitoring <span>In development</span></div>
    <p className="muted-note">Joint angles and exercise tracking are available in the Movement workspace. Region-specific longitudinal analysis is not yet validated.</p>
    <button type="button" className="text-action" onClick={() => onNavigate('movement')}>Open movement <Icon name="arrow" size={17}/></button>
    <p className="clinical-note"><Icon name="info" size={16}/> No available data does not mean this region is healthy.</p>
  </div>;
}

function App() {
  const backend = useBackend();
  const [movementRecordings] = useState(() => new Map<string, MovementRecording>());
  const [page, setPage] = useState<Page>('overview');
  const [selected, setSelected] = useState<RegionId>('right_thigh');
  const [view, setView] = useState<BodyView>('front');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [bodyRecordsByCrew, setBodyRecordsByCrew] = useState<Record<string, BodyMeasurement[]>>({});
  const currentCrewId = backend.athlete?.id ?? null;
  const bodyRecords = currentCrewId ? (bodyRecordsByCrew[currentCrewId] ?? []) : [];
  const latestBody = bodyRecords[0] ?? null;
  const [bodyError, setBodyError] = useState({ athleteId: '', message: '' });
  const [plans, setPlans] = useState<{ athleteId: string; entries: SavedPlan[] }>({ athleteId: '', entries: [] });
  const [vision, setVision] = useState<{ yolo_configured: boolean; mediapipe_asset: boolean } | null>(null);
  useEffect(() => {
    if (backend.apiState !== 'ready' || page !== 'integrations') return;
    const controller = new AbortController();
    const { signal } = controller;
    apiRequest<{ yolo_configured: boolean; mediapipe_asset: boolean }>('/api/v1/pose/availability', { signal })
      .then(status => { if (!signal.aborted) setVision(status); })
      .catch(() => { if (!signal.aborted) setVision(null); });
    return () => controller.abort();
  }, [page, backend.apiState]);
  useEffect(() => {
    if (!currentCrewId || backend.apiState !== 'ready') return;
    const controller = new AbortController();
    const { signal } = controller;
    apiRequest<BodyMeasurement[]>(`/api/v1/athletes/${currentCrewId}/measurements`, { signal })
      .then(records => { if (!signal.aborted) setBodyRecordsByCrew(previous => ({ ...previous, [currentCrewId]: records })); })
      .catch(error => { if (!signal.aborted) setBodyError({ athleteId: currentCrewId, message: error.message }); });
    if (page === 'history' || page === 'movement') {
      apiRequest<SavedPlan[]>(`/api/v1/athletes/${currentCrewId}/plans`, { signal })
        .then(entries => { if (!signal.aborted) setPlans({ athleteId: currentCrewId, entries }); })
        .catch(error => { if (!signal.aborted) setBodyError({ athleteId: currentCrewId, message: error.message }); });
    }
    return () => controller.abort();
  }, [currentCrewId, backend.apiState, page]);

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
    if (!currentCrewId) return;
    try {
      const review = await apiRequest<NonNullable<SavedPlan['payload']['review']>>(`/api/v1/athletes/${currentCrewId}/plans/${planId}/review`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewer, professionally_reviewed: true }),
      });
      setPlans(previous => previous.athleteId === currentCrewId ? { ...previous,
        entries: previous.entries.map(plan => plan.id === planId ? { ...plan, payload: { ...plan.payload, review } } : plan),
      } : previous);
    } catch (error) {
      setBodyError({ athleteId: currentCrewId, message: (error as Error).message });
    }
  }

  const navigate = (next: Page) => { setPage(next); setSidebarOpen(false); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const changeView = (next: BodyView) => { setView(next); if (next === 'back' && ['chest','abdomen'].includes(selected)) setSelected('upper_back'); if (next === 'front' && ['upper_back','lower_back'].includes(selected)) setSelected('chest'); };
  const pageDetails = navigation.find(item => item.id === page)!;
  return <div className="orion-app">
    {sidebarOpen && <button className="sidebar-scrim" aria-label="Close navigation" onClick={() => setSidebarOpen(false)}/>}
    <aside className={`sidebar ${sidebarOpen ? 'sidebar--open' : ''}`}>
      <div className="brand"><div className="brand-mark"><span className="brand-mark-orbit"/><span className="brand-mark-center"/></div><div className="brand-words"><strong>ORION</strong><small>HUMAN PERFORMANCE LAB</small></div></div>
      <div className="sidebar-rule"/>
      <p className="sidebar-label">WORKSPACE</p>
      <nav className="side-nav" aria-label="Main navigation">
        {navigation.map(item => <button key={item.id} className={`side-link ${page === item.id ? 'side-link--active' : ''}`} onClick={() => navigate(item.id)} aria-current={page === item.id ? 'page' : undefined}><Icon name={item.icon} size={19}/><span>{item.title}</span>{page === item.id && <span className="side-link-indicator"/>}</button>)}
      </nav>
      <div className="sidebar-bottom"><div className="project-note"><div className="project-note-top"><span className="project-note-dot"/> RESEARCH PROTOTYPE</div><strong>Built to evolve.</strong><p>FastAPI, movement tracking, and individual body profiles are available.</p></div><div className="sidebar-version"><span>© ORION</span><span>FRONTEND / RELEASE 1</span></div></div>
    </aside>
    <div className="app-body">
      <header className="topbar"><div className="topbar-left"><button className="mobile-menu" onClick={() => setSidebarOpen(true)} aria-label="Open navigation"><Icon name="menu"/></button><span className="topbar-path">PLATFORM</span><span className="crumb-divider">/</span><span className="topbar-current">{pageDetails.title}</span></div><div className="topbar-right"><span className="topbar-date">ORION / RESEARCH CONSOLE</span><span className="prototype-chip"><i/> {backend.apiState === 'ready' ? 'API CONNECTED / RESEARCH' : backend.apiState === 'checking' ? 'API CHECKING' : 'API OFFLINE / LIMITED'}</span><button className="profile-chip" title="Open crew profiles" onClick={() => navigate('overview')}><Icon name="user" size={17}/><span>{backend.athlete?.pseudonym || 'SELECT CREW'}</span></button></div></header>
      <main className="content">
        {page === 'overview' && <>
          <div className="section-intro"><div><p className="overline">MUSCULOSKELETAL MONITORING PLATFORM</p><h1>Overview<span className="title-period">.</span></h1><p className="intro-caption">A unified workspace for movement, anthropometry, and individual observations.</p></div><span className="edition-label">ORION / RESEARCH EDITION</span></div>
          <section className="hero"><div className="hero-copy"><div className="hero-overline"><span className="hero-spark"/> HUMAN HEALTH INTELLIGENCE</div><h2>See the movement.<br/><em>Understand the pattern.</em></h2><p>Movement and body-profile records organized around each crew member and anatomical region.</p><div className="hero-actions"><button className="hero-primary" onClick={() => navigate('anatomy')}>Explore body atlas <Icon name="arrow" size={17}/></button><button className="hero-secondary" onClick={() => navigate('bodyprofile')}>View body profile <Icon name="diagonal" size={16}/></button></div></div><div className="hero-visual" aria-hidden="true"><div className="hero-ring hero-ring--outer"/><div className="hero-ring hero-ring--middle"/><div className="hero-ring hero-ring--inner"/><div className="hero-visual-core"><div className="hero-core-line"/><span>ORION</span><small>DATA / HUMAN</small></div><span className="hero-coordinate hero-coordinate--one">01 / SIGNAL</span><span className="hero-coordinate hero-coordinate--two">02 / MOTION</span><span className="hero-target"/></div></section>
          <div className="metric-section-heading"><div><span className="section-number">01</span><h2>System indicators</h2></div><span className="section-support">Live session and profile counts require an active crew profile</span></div>
          <ProfilePanel apiState={backend.apiState} athlete={backend.athlete} working={backend.working} error={backend.error} onCreate={backend.createProfile} onOpen={backend.openProfile} onClear={backend.clearProfile} onRetry={() => void backend.checkConnection()}/><section className="figures-grid"><Figure index={backend.athlete ? "01" : "—"} label="ACTIVE PROFILE" description={backend.athlete ? backend.athlete.pseudonym : "No crew profile selected"}/><Figure index={backend.athlete ? String(backend.sessions.length).padStart(2, "0") : "—"} label="MOVEMENT" description="Recent sessions from SQLite (up to 100)"/><Figure index={String(bodyRecords.length).padStart(2, '0')} label="BODY RECORDS" description="Anthropometry entries in SQLite"/><Figure index="—" label="OBSERVATIONS" description="Reviewed alerts"/></section>
          <section className="surface bp-overview-strip"><div><span className="section-number">INDIVIDUAL BASELINE</span><h2>{latestBody ? `${formatUsHeight(latestBody.heightCm)} · ${formatUsWeight(latestBody.weightKg)}` : 'Your body profile starts here.'}</h2><p>{backend.athlete ? `Measurements for ${backend.athlete.pseudonym} · ${bodyRecords.length} local record(s)` : 'Select a crew member to record height, weight, circumferences and optional external BIA results.'}</p></div><button type="button" className="button-dark" onClick={() => navigate('bodyprofile')}>Open body profile <Icon name="arrow" size={16}/></button></section><div className="dashboard-main-grid"><section className="surface atlas-overview"><div className="surface-heading"><div><span className="section-number">02 / ATLAS</span><h2>One body. Connected records.</h2><p>Choose an anatomical region to explore its records.</p></div><button className="subtle-icon-button" onClick={() => navigate('anatomy')} title="Open full atlas" aria-label="Open full atlas"><Icon name="diagonal"/></button></div><div className="atlas-preview-layout"><BodyMap compact selected={selected} onSelect={setSelected} view={view} onViewChange={changeView}/><div className="atlas-preview-details"><div className="preview-selected-overline">IN FOCUS</div><h3>{findRegion(selected).name}</h3><span className="muted-label">{getRegionCircumference(latestBody, selected) ? "Body measurement available" : "No regional measurement recorded"}</span><p>Explore manual body measurements and experimental movement indicators by anatomical region.</p><button className="text-action" onClick={() => navigate('anatomy')}>View region details <Icon name="arrow" size={17}/></button></div></div></section>
            <div className="side-stack"><section className="surface trend-card"><div className="surface-heading"><div><span className="section-number">03 / TRENDS</span><h2>Longitudinal perspective</h2></div><Icon name="activity" size={21}/></div><DemoTrend/><p className="trend-disclaimer">Illustrative chart only. No astronaut measurements are represented.</p></section><section className="surface next-step"><div className="next-step-top"><Icon name="layers" size={22}/><span>NEXT CAPABILITY</span></div><h3>From data to guidance.</h3><p>Record individual measurements and review exercise options suggested by the AI advisor, subject to professional approval.</p><button className="text-action" onClick={() => navigate('bodyprofile')}>Open body profile <Icon name="arrow" size={17}/></button></section></div></div>
          <div className="privacy-strip"><Icon name="shield" size={19}/><span><strong>Research environment.</strong> FastAPI stores crew profiles and exercise sessions; body measurements currently remain in browser memory. AI exercise suggestions require professional review.</span></div>
        </>}
        {page === 'bodyprofile' && <>
          <PageHeading number="02 / INDIVIDUAL MONITORING" title="Body profile. Personal baseline." subtitle="Manual anthropometry and optional externally measured body composition, linked to the active crew profile."/>
          <BodyProfile key={currentCrewId} athlete={backend.athlete} records={bodyRecords} onAdd={addBodyRecord} onRemove={removeBodyRecord} onSelectCrew={() => navigate('overview')}/>
        </>}
        {page === 'anatomy' && <>
          <PageHeading number="02 / ANATOMICAL ATLAS" title="Every region. In context." subtitle="Explore body regions and view linked manual measurements and functional monitoring information."/>
          <div className="anatomy-page-grid"><section className="surface anatomy-main"><div className="surface-heading"><div><span className="section-number">INTERACTIVE MAP</span><h2>Human body</h2></div><span className="muted-caption">Select an anatomical region directly</span></div><BodyMap selected={selected} onSelect={setSelected} view={view} onViewChange={changeView}/></section><section className="surface anatomy-detail-card"><RegionDetails regionId={selected} latestBody={latestBody} onNavigate={navigate}/></section></div>
        </>}
        {page === 'movement' && <>
          <PageHeading number="03 / FUNCTIONAL MONITORING" title="Movement, made visible." subtitle="A workspace for exercise sessions, joint metrics, and functional monitoring."/>
          <div className="movement-layout"><section className="surface movement-main"><div className="surface-heading"><div><span className="section-number">LIVE PREVIEW</span><h2>Camera capture</h2></div><span className="capsule-status capsule-status--neutral">LOCAL POSE · OPTIONAL</span></div><MovementStudio key={currentCrewId} reviewedPlans={plans.athleteId === currentCrewId ? plans.entries.filter(plan => plan.payload.review) : []} recordings={movementRecordings} athlete={backend.athlete} backendReady={backend.apiState === 'ready'} sessions={backend.sessions} onSessionChanged={() => void backend.reloadSessions()}/></section><aside className="surface movement-side"><span className="section-number">POSE TRACKING</span><h2>Camera analysis</h2><div className="pipeline-steps"><div><span>01</span><div><strong>Camera frame</strong><p>Capture and prepare frames for the selected engine.</p></div></div><div><span>02</span><div><strong>MediaPipe</strong><p>Landmark tracking and functional measurements.</p></div></div><div><span>03</span><div><strong>Orion YOLO-Pose</strong><p>Live pose estimation using the checkpoint trained on the Orion Dataset.</p></div></div><div><span>04</span><div><strong>API + history</strong><p>Receive, validate, and display processed results.</p></div></div></div><p className="clinical-note"><Icon name="info" size={16}/> Both pose models can display experimental 2D angles. Experimental local counting supports squats, biceps curls, lateral shoulder raises, and seated knee extensions. Choose the exercise manually and finish the session to save the results.</p></aside></div>
        </>}
        {page === 'wear' && <WearPanel key={currentCrewId} athleteId={currentCrewId}/>}
        {page === 'planner' && <section className="surface history-card">
          <h1>AI Workout Planner</h1>
          {backend.athlete ? <ExerciseAdvisor key={currentCrewId} measurement={latestBody} athleteId={backend.athlete.id}/> : <p>Select a crew profile in Overview.</p>}
        </section>}
        {(page === 'bodyprofile' || page === 'history') && bodyError.athleteId === currentCrewId && bodyError.message && <p role="alert">{bodyError.message}</p>}
        {page === 'history' && <>
          <WearPanel key={currentCrewId} athleteId={currentCrewId}/>
          <section className="surface history-card"><h2>Workout drafts</h2>
            {(!currentCrewId || (plans.athleteId === currentCrewId && plans.entries.length === 0)) &&
              <p>{currentCrewId ? 'No drafts saved for this crew member.' : 'Select a crew profile in Overview.'}</p>}
            {plans.athleteId === currentCrewId && plans.entries.map(({ id, created_at, payload }) => <article key={id}>
              <h3>{new Date(created_at).toLocaleString()}</h3><p>{payload.summary}</p>
              <p>{payload.sessions_per_week ? `${payload.sessions_per_week} sessions/week · ` : ''}{payload.limitations}</p>
              <ul>{payload.options.map(option => <li key={option.name}>{option.name} · {option.sets} sets × {option.repetitions_per_set} reps · {option.rest_seconds}s rest<p>{option.rationale} · {option.caution}</p></li>)}</ul>
              {payload.review ? <p>Professional review recorded for {payload.review.reviewer}.</p> : payload.options.length > 0 && <form onSubmit={event => {
                event.preventDefault();
                const reviewer = String(new FormData(event.currentTarget).get('reviewer') ?? '');
                void recordPlanReview(id, reviewer);
              }}>
                <label>Professional reviewer <input name="reviewer" required minLength={2} maxLength={80}/></label>
                <label><input type="checkbox" required/> A qualified professional approved this draft for use.</label>
                <button type="submit" className="button-dark">Record review</button>
              </form>}
            </article>)}
          </section>
          <PageHeading number="04 / RECORDS" title="A history worth exploring." subtitle="Exercise sessions stored in SQLite. Individual body measurements and workout drafts are stored in SQLite."/>
          <SessionHistory athleteName={backend.athlete?.pseudonym ?? null} sessions={backend.sessions} ready={backend.apiState === 'ready'} onRefresh={() => void backend.reloadSessions()}/>
          <section className="surface history-card"><div className="surface-heading"><div><span className="section-number">BODY PROFILE</span><h2>Individual measurement history</h2></div><span className="count-label">{bodyRecords.length} {bodyRecords.length === 1 ? 'record' : 'records'}</span></div>{bodyRecords.length ? <ul>{bodyRecords.map(record => <li key={record.id}>
            {new Date(record.recordedAt).toLocaleString()} · {formatUsWeight(record.weightKg)} · {formatUsHeight(record.heightCm)}
          </li>)}</ul> : <p className="muted-note">No measurements for the selected profile.</p>}<button type="button" className="button-dark" onClick={() => navigate('bodyprofile')}>Open measurement history <Icon name="arrow" size={16}/></button></section>
          <div className="privacy-strip"><Icon name="info" size={18}/><span>Records are linked to the selected crew profile.</span></div>
        </>}
        {page === 'integrations' && <>
          <PageHeading number="05 / SYSTEM ARCHITECTURE" title="Independent by design." subtitle="Planned integration points, keeping frontend, backend, and AI development independent."/>
          <div className="integrations-grid">{[
            { name: 'React + TypeScript', icon: 'grid', role: 'User interface and navigation', state: 'Frontend ready', ready: true },
            { name: 'FastAPI', icon: 'layers', role: 'Backend APIs and services', state: backend.apiState === 'ready' ? 'Live API connection' : 'API unavailable / migrations', ready: backend.apiState === 'ready' },
            { name: 'SQLite / SQLAlchemy', icon: 'database', role: 'Profiles and exercise sessions', state: backend.apiState === 'ready' ? 'Schema ready' : 'Not verified', ready: backend.apiState === 'ready' },
            { name: 'MediaPipe', icon: 'body', role: 'Optional local 2D pose tracking', state: vision?.mediapipe_asset ? 'Local task available · browser runtime required' : 'Browser runtime and Lite download required', ready: !!vision?.mediapipe_asset },
            { name: 'Orion YOLO-Pose', icon: 'body', role: 'Live tracking with the model trained on the Orion Dataset', state: vision?.yolo_configured ? 'Checkpoint and runtime configured' : 'Checkpoint or runtime unavailable', ready: !!vision?.yolo_configured },
            { name: 'OpenCV', icon: 'camera', role: 'Image processing', state: 'Integration pending', ready: false },
            { name: 'Body Profile', icon: 'user', role: 'Manual height, weight, circumferences and optional external BIA values', state: 'SQLite storage', ready: true },
            { name: 'Gemini AI Advisor', icon: 'cpu', role: 'Exercise candidates for professional review, when backend API is configured', state: 'API configuration required', ready: false },
            { name: 'Intelligence Engine', icon: 'cpu', role: 'Validated individual baselines and trends', state: 'Planned', ready: false }
          ].map(item => <article className="surface integration-card" key={item.name}><div className="integration-icon"><Icon name={item.icon} size={25}/></div><h2>{item.name}</h2><p>{item.role}</p><span className={item.ready ? 'integration-ready' : 'integration-pending'}><i/>{item.state}</span></article>)}</div><div className="privacy-strip"><Icon name="shield" size={18}/><span>This frontend uses the existing FastAPI endpoints for profiles, exercises, motion samples, and session history. YOLO-Pose processes camera frames in memory when selected in Movement.</span></div>
        </>}
      </main>
      <footer className="app-footer"><span>ORION — RESEARCH INTERFACE</span><span>RESEARCH PROTOTYPE · NOT FOR DIAGNOSIS</span></footer>
    </div>
  </div>;
}

function PageHeading({ number, title, subtitle }: { number: string; title: string; subtitle: string }) {
  return <div className="page-heading"><span className="overline">{number}</span><h1>{title}</h1><p>{subtitle}</p></div>;
}

export default App;
