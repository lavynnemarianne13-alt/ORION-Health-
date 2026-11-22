import { useCallback, useEffect, useState } from 'react';
import { backendApi } from '../services/backendApi';
import type { Athlete, ExerciseSession } from '../types/backend';

type ApiState = 'checking' | 'ready' | 'schema-not-ready' | 'offline';
const KEY = 'orion_active_athlete_id';
const messageOf = (error: unknown) => error instanceof Error ? error.message : 'Unexpected API error.';

export function useBackend() {
  const [apiState, setApiState] = useState<ApiState>('checking');
  const [athlete, setAthlete] = useState<Athlete | null>(null);
  const [knownCrew, setKnownCrew] = useState<Athlete[]>([]);
  const rememberCrew = (profile: Athlete) => setKnownCrew(crew => [...crew.filter(member => member.id !== profile.id), profile]);
  const [sessionsByCrew, setSessionsByCrew] = useState<Record<string, ExerciseSession[]>>({});
  const sessions = athlete ? sessionsByCrew[athlete.id] ?? [] : [];
  const storeSessions = useCallback((id: string, records: ExerciseSession[]) => {
    setSessionsByCrew(previous => ({ ...previous, [id]: records }));
  }, []);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');

  const checkConnection = useCallback(async () => {
    // Keep the initial effect free of synchronous state updates.
    await Promise.resolve();
    setApiState('checking');
    try {
      await backendApi.health();
    } catch (e) {
      setApiState('offline'); setError(messageOf(e)); return;
    }
    try { await backendApi.ready(); setApiState('ready'); setError(''); }
    catch { setApiState('schema-not-ready'); setError('Backend is online, but SQLite migrations are not ready. Run alembic upgrade head.'); }
  }, []);

  const reloadSessions = useCallback(async (id?: string) => {
    const key = id || athlete?.id;
    if (!key) return;
    try { storeSessions(key, await backendApi.getSessions(key)); setError(''); }
    catch (e) { setError(messageOf(e)); }
  }, [athlete?.id, storeSessions]);

  useEffect(() => {
    let active = true;
    void backendApi.health().then(() => backendApi.ready()).then(() => {
      if (active) { setApiState('ready'); setError(''); }
    }).catch(async () => {
      try {
        await backendApi.health();
        if (active) { setApiState('schema-not-ready'); setError('Backend online, but SQLite migrations are not ready. Run alembic upgrade head.'); }
      } catch (error) {
        if (active) { setApiState('offline'); setError(messageOf(error)); }
      }
    });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (apiState !== 'ready') return;
    const saved = window.sessionStorage.getItem(KEY);
    if (!saved || athlete) return;
    let alive = true;
    backendApi.getAthlete(saved).then(async profile => {
      const records = await backendApi.getSessions(profile.id);
      if (!alive) return;
      storeSessions(profile.id, records);
      rememberCrew(profile);
      setAthlete(profile);
    }).catch(() => { if (alive) window.sessionStorage.removeItem(KEY); });
    return () => { alive = false; };
  }, [apiState, athlete, storeSessions]);

  const openProfile = async (id: string) => {
    setWorking(true); setError('');
    try {
      const profile = await backendApi.getAthlete(id.trim());
      const records = await backendApi.getSessions(profile.id);
      rememberCrew(profile);
      setAthlete(profile); storeSessions(profile.id, records);
      window.sessionStorage.setItem(KEY, profile.id);
    } catch (e) { setError(messageOf(e)); } finally { setWorking(false); }
  };
  const createProfile = async (pseudonym: string) => {
    setWorking(true); setError('');
    try {
      const profile = await backendApi.createAthlete(pseudonym.trim());
      rememberCrew(profile);
      setAthlete(profile);
      window.sessionStorage.setItem(KEY, profile.id);
    } catch (e) { setError(messageOf(e)); } finally { setWorking(false); }
  };
  const clearProfile = () => {
    window.sessionStorage.removeItem(KEY);
    setAthlete(null); setError('');
  };
  return { apiState, athlete, knownCrew, sessions, working, error, checkConnection, reloadSessions, openProfile, createProfile, clearProfile };
}
