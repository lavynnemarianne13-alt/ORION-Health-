import { useEffect, useRef } from 'react';
import type { Athlete } from '../../types/backend';
import type { useBackend } from '../../hooks/useBackend';
import Icon from './Icon';
import { initials } from '../../utils/initials';
import './OrbitDock.css';

const modules = [
  ['overview', 'Overview', 'Overview', 'overview'],
  ['bodyprofile', 'Profile', 'Body Profile', 'user'],
  ['anatomy', 'Atlas', 'Body Atlas', 'atlas'],
  ['planner', 'AI Planner', 'AI Workout Planner', 'brain'],
  ['movement', 'Movement', 'Movement', 'activity'],
  ['wear', 'Wear', 'ORION Wear', 'watch'],
  ['history', 'History', 'History', 'history'],
] as const;

export type Page = typeof modules[number][0];

const status = {
  ready: 'API connected',
  checking: 'Checking API',
  offline: 'API offline',
  'schema-not-ready': 'Database pending',
};

function Logo({ onClick }: { onClick: () => void }) {
  return <button type="button" className="orbit-brand" onClick={onClick} aria-label="ORION home">
    <svg viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <circle cx="24" cy="24" r="19" stroke="#444a34"/>
      <ellipse cx="24" cy="24" rx="22" ry="10" transform="rotate(-42 24 24)" stroke="#b4cd72" strokeWidth="1.2"/>
      <path d="M24 6L27 21L42 24L27 27L24 42L21 27L6 24L21 21Z" fill="var(--accent)"/>
      <circle cx="24" cy="24" r="3" fill="var(--bg)"/>
    </svg>
    <span><strong>ORION</strong><small>CREW HEALTH SYSTEM</small></span>
  </button>;
}

type Props = {
  active: Page;
  navigate: (page: Page) => void;
  backend: ReturnType<typeof useBackend>;
  onManageCrew: () => void;
  crewLocked: boolean;
};

export default function OrbitDock({ active, navigate, backend, onManageCrew, crewLocked }: Props) {
  const dock = useRef<HTMLElement>(null);
  const activeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const nav = dock.current;
    const button = activeButton.current;
    if (!nav || !button || nav.scrollWidth <= nav.clientWidth) return;
    nav.scrollLeft += button.getBoundingClientRect().left - nav.getBoundingClientRect().left - (nav.clientWidth - button.offsetWidth) / 2;
  }, [active]);

  return <header className="orbit-header"><div className="orbit-inner">
    <Logo onClick={() => navigate('overview')}/>
    <nav ref={dock} className="orbit-dock" aria-label="Primary navigation">
      {modules.map(([id, label, title, icon]) => <button type="button" key={id} ref={active === id ? activeButton : undefined}
        className={active === id ? 'active' : ''} title={id === 'movement' && crewLocked ? 'Movement workspace active' : title} aria-label={title} aria-current={active === id ? 'page' : undefined}
        data-live={id === 'movement' && crewLocked ? 'true' : undefined}
        onClick={() => navigate(id)}><Icon name={icon}/><span>{label}</span></button>)}
    </nav>
    <div className="orbit-end">
      <span className="system-status" data-state={backend.apiState} role="status"><i className="dot"/>{status[backend.apiState]}</span>
      <CrewSelector athlete={backend.athlete} knownCrew={backend.knownCrew} working={backend.working || crewLocked}
        onOpen={backend.openProfile} onManage={onManageCrew} ready={backend.apiState === 'ready'}/>
    </div>
  </div></header>;
}

function CrewSelector({ athlete, knownCrew, ready, working, onOpen, onManage }: {
  athlete: Athlete | null;
  knownCrew: Athlete[];
  ready: boolean;
  working: boolean;
  onOpen: (id: string) => Promise<void>;
  onManage: () => void;
}) {
  return <div className="crew-select">
    <span className="avatar" aria-hidden="true">{athlete ? initials(athlete.pseudonym) : <Icon name="user" size={15}/>}</span>
    <select aria-label="Crew member" value={athlete?.id ?? ''} disabled={working} onChange={event => {
      const id = event.target.value;
      if (!id || id === 'manage') onManage();
      else void onOpen(id);
    }}>
      <option value="" disabled>Select crew</option>
      {knownCrew.map(member => <option key={member.id} value={member.id} disabled={!ready}>{member.pseudonym}</option>)}
      <option value="manage">Manage crew…</option>
    </select>
  </div>;
}
