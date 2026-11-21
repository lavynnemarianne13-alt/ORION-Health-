import { apiRequest } from './apiClient';
import type { Athlete, ExerciseSession, SessionCreated, SessionFinished, MotionSample, MotionSampleResult, AssessmentReport, PoseEngine } from '../types/backend';

const json = () => ({ 'Content-Type': 'application/json' } as const);
export const backendApi = {
  health: () => apiRequest<{status: 'ok'}>('/health'),
  ready: () => apiRequest<{status: 'ready';database:'ok'}>('/ready'),
  createAthlete: (pseudonym: string) => apiRequest<Athlete>('/api/v1/athletes', {
    method: 'POST', headers: json(), body: JSON.stringify({ pseudonym })
  }),
  getAthlete: (id: string) => apiRequest<Athlete>(`/api/v1/athletes/${encodeURIComponent(id)}`),
  getSessions: (athleteId: string, limit = 100) => apiRequest<ExerciseSession[]>(`/api/v1/sessions?athlete_id=${encodeURIComponent(athleteId)}&limit=${limit}`),
  createSession: (payload: {
    athlete_id: string; exercise_code: string; protocol_id: string;
    pose_engine: PoseEngine; tracked_side?: 'left' | 'right';
    load_kg?: number; target_repetitions?: number; plan_id?: string;
  }) => apiRequest<SessionCreated>('/api/v1/sessions', {
    method: 'POST', headers: json(), body: JSON.stringify(payload)
  }),
  getSamples: (sessionId: string, offset: number) => apiRequest<MotionSample[]>(
    `/api/v1/sessions/${encodeURIComponent(sessionId)}/samples?limit=25&offset=${offset}`
  ),
  uploadSamples: (sessionId: string, samples: MotionSample[]) => apiRequest<MotionSampleResult>(`/api/v1/sessions/${encodeURIComponent(sessionId)}/samples`, {
    method: 'POST', headers: json(), body: JSON.stringify({ samples })
  }),
  finishSession: (sessionId: string, assessment?: { result: AssessmentReport; samples: MotionSample[]; sets?: number[] }) => apiRequest<SessionFinished>(`/api/v1/sessions/${encodeURIComponent(sessionId)}/finish`, {
    method: 'POST', ...(assessment && { headers: json(), body: JSON.stringify(assessment) })
  })
};
