import { useState } from 'react';
import type { FormEvent } from 'react';
import type { Athlete } from '../../types/backend';

type Props = {
  apiState: 'checking' | 'ready' | 'schema-not-ready' | 'offline';
  athlete: Athlete | null;
  working: boolean;
  crewLocked: boolean;
  error: string;
  onCreate: (pseudonym: string) => Promise<void>;
  onOpen: (id: string) => Promise<void>;
  onClear: () => void;
  onRetry: () => void;
};
export default function ProfilePanel({apiState, athlete, working, crewLocked, error, onCreate, onOpen, onClear, onRetry}: Props) {
  const [pseudonym, setPseudonym] = useState('');
  const [lookupId, setLookupId] = useState('');
  const create = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); if (pseudonym.trim()) void onCreate(pseudonym); };
  const lookup = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); if (lookupId.trim()) void onOpen(lookupId); };
  return <section className="surface backend-panel" aria-label="Backend profile connection">
    <div className="backend-panel-heading"><div><span className="section-number">CONNECTED RECORDS / API</span><h2>Active crew profile</h2></div>
      <span className={`backend-status backend-status--${apiState}`}>{apiState === 'ready' ? 'API & DATABASE READY' : apiState === 'checking' ? 'CHECKING API' : apiState === 'schema-not-ready' ? 'MIGRATIONS NEEDED' : 'API OFFLINE'}</span>
    </div>
    {athlete ? <div className="backend-active"><div><strong>{athlete.pseudonym}</strong><p>Profile ID: <code>{athlete.id}</code></p><small>Data is retrieved from FastAPI / SQLite. Keep the ID to reopen this profile.</small></div><button type="button" className="ms-button ms-button--outline" onClick={onClear} disabled={crewLocked || working}>Change profile</button></div>
    : <div className="backend-forms"><form onSubmit={create}><label htmlFor="crew-name">Register a pseudonymous crew member</label><div className="backend-input-row"><input id="crew-name" maxLength={80} value={pseudonym} onChange={e => setPseudonym(e.target.value)} placeholder="Crew pseudonym" required disabled={apiState !== 'ready' || working || crewLocked}/><button type="submit" className="ms-button ms-button--primary" disabled={apiState !== 'ready' || working || crewLocked}>Create profile</button></div></form>
      <form onSubmit={lookup}><label htmlFor="crew-id">Open an existing profile by UUID</label><div className="backend-input-row"><input id="crew-id" value={lookupId} onChange={e => setLookupId(e.target.value)} placeholder="UUID from previous registration" required disabled={apiState !== 'ready' || working || crewLocked}/><button type="submit" className="ms-button ms-button--outline" disabled={apiState !== 'ready' || working || crewLocked}>Find profile</button></div></form></div>}
    {crewLocked && <p className="muted-note">Stop the camera and timer or finish the active Movement session before switching crew.</p>}
    {error && <p role="alert" className="ms-error">{error}</p>}
    {apiState !== 'ready' && <button type="button" className="text-action" onClick={onRetry}>Check backend connection again ↗</button>}
    <p className="backend-disclaimer">This dashboard is designed for a trusted local workstation.</p>
  </section>;
}
