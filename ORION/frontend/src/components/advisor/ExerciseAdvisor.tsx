import { useState } from 'react';
import type { FormEvent } from 'react';
import type { BodyMeasurement } from '../../types/anthropometry';
import { formatUsHeight, formatUsWeight } from '../../utils/imperial';
import { apiRequest } from '../../services/apiClient';
import './ExerciseAdvisor.css';

type Equipment = 'none' | 'resistance_band' | 'resistance_device' | 'stationary_cycle' | 'treadmill_harness';
type TrainingLevel = 'beginner' | 'intermediate' | 'advanced';
type MissionContext = 'earth_training' | 'microgravity';
type Option = { exercise_id: string; name: string; rationale: string; caution: string; sets: number; repetitions_per_set: number; rest_seconds: number };
type AdvisorResult = {
  status: 'draft_for_review' | 'needs_clearance'; model_used: string | null;
  summary: string; limitations: string; options: Option[]; sessions_per_week: number | null; disclaimer: string;
};

const equipmentOptions: { id: Equipment; label: string }[] = [
  { id: 'none', label: 'No equipment' },
  { id: 'resistance_band', label: 'Resistance bands' },
  { id: 'resistance_device', label: 'Resistance machine / ARED-like' },
  { id: 'stationary_cycle', label: 'Stationary bike' },
  { id: 'treadmill_harness', label: 'Treadmill with harness' },
];

export default function ExerciseAdvisor({ measurement, athleteId, onDraftSaved }: { measurement: BodyMeasurement | null; athleteId: string; onDraftSaved: () => void }) {
  const [level, setLevel] = useState<TrainingLevel>('beginner');
  const [mission, setMission] = useState<MissionContext>('earth_training');
  const [availableDays, setAvailableDays] = useState(2);
  const [equipment, setEquipment] = useState<Equipment[]>(['none']);
  const [limitations, setLimitations] = useState('');
  const [hasPain, setHasPain] = useState(false);
  const [hasBoneRisk, setHasBoneRisk] = useState(false);
  const [cleared, setCleared] = useState(false);
  const [consented, setConsented] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<AdvisorResult | null>(null);

  const toggleEquipment = (id: Equipment) => {
    setEquipment(previous => {
      if (id === 'none') return ['none'];
      const next = previous.filter(value => value !== 'none');
      return next.includes(id) ? (next.filter(value => value !== id).length ? next.filter(value => value !== id) : ['none']) : [...next, id];
    });
    setResult(null);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!measurement) return;
    setError(''); setResult(null); setLoading(true);
    try {
      // Data minimization: no crew name, UUID, images, sessions or individual identifiers.
      const response = await apiRequest<AdvisorResult>('/api/v1/advisor/exercise-options', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          athlete_id: athleteId,
          height_cm: measurement.heightCm,
          weight_kg: measurement.weightKg,
          age_years: measurement.ageYears,
          measured_muscle_mass_kg: measurement.biaDevice ? measurement.skeletalMuscleMassKg : null,
          training_level: level, mission_context: mission, available_days_per_week: availableDays, equipment,
          limitations: limitations.trim(), pain_or_recent_injury: hasPain,
          known_bone_risk: hasBoneRisk, medical_clearance_confirmed: cleared,
          consent_to_external_processing: consented,
        }),
      });
      setResult(response);
      if (response.status === 'draft_for_review') onDraftSaved();
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Unable to contact the AI advisor.');
    } finally { setLoading(false); }
  };

  return <section className="surface ea-card" aria-labelledby="advisor-heading">
    <div className="ea-header">
      <div><span className="section-number">GOOGLE GEMINI</span>
        <h2 id="advisor-heading">Draft configuration</h2>
        <p>Uses the latest body profile, training experience, available days and equipment to generate a proposed exercise sheet. Sets, repetitions and rest are research examples, not a medical prescription.</p>
      </div><span className="ea-pill">AI ASSISTED · NOT CLINICAL</span>
    </div>
    {!measurement ? <p className="bp-placeholder">Save at least one height and weight measurement in Body Profile before requesting exercise options.</p> : <>
      <div className="ea-workspace"><form onSubmit={submit} className="ea-form">
      <p className="ea-source">Profile snapshot: {formatUsHeight(measurement.heightCm)} · {formatUsWeight(measurement.weightKg)}{measurement.ageYears !== null ? ` · ${measurement.ageYears} years` : ''}. No crew identifier will be sent to the provider.</p>
        <div className="ea-field-grid">
          <label className="ea-field"><span>Training experience</span>
            <select value={level} onChange={e => { setLevel(e.target.value as TrainingLevel); setResult(null); }}>
              <option value="beginner">Beginner</option><option value="intermediate">Intermediate</option><option value="advanced">Advanced</option>
            </select>
          </label>
          <label className="ea-field"><span>Exercise context</span>
            <select value={mission} onChange={e => { setMission(e.target.value as MissionContext); setResult(null); }}>
              <option value="earth_training">Earth-based training</option><option value="microgravity">Microgravity (research scenario)</option>
            </select>
          </label>
        </div>
        <label className="ea-field"><span>Training days available per week</span>
          <select value={availableDays} onChange={e => { setAvailableDays(Number(e.target.value)); setResult(null); }}>
            {[1, 2, 3, 4, 5].map(day => <option value={day} key={day}>{day} day{day > 1 ? 's' : ''}</option>)}
          </select>
        </label>
        <fieldset className="ea-fieldset"><legend>Equipment actually available</legend>
          <div className="ea-check-grid">{equipmentOptions.map(item => <label key={item.id} className="ea-check"><input type="checkbox" checked={equipment.includes(item.id)} onChange={() => toggleEquipment(item.id)}/><span>{item.label}</span></label>)}</div>
        </fieldset>
        <label className="ea-field"><span>Movement limitations (optional; omit names or identifying details)</span>
          <textarea value={limitations} maxLength={300} rows={2} placeholder="For example: avoid deep knee flexion" onChange={e => { setLimitations(e.target.value); setResult(null); }}/>
        </label>
        <fieldset className="ea-fieldset"><legend>Safety review</legend>
          <label className="ea-check"><input type="checkbox" checked={hasPain} onChange={e => { setHasPain(e.target.checked); setResult(null); }}/><span>Current pain or recent injury</span></label>
          <label className="ea-check"><input type="checkbox" checked={hasBoneRisk} onChange={e => { setHasBoneRisk(e.target.checked); setResult(null); }}/><span>Known bone fragility or fracture risk</span></label>
          <label className="ea-check"><input type="checkbox" checked={cleared} onChange={e => { setCleared(e.target.checked); setResult(null); }}/><span>A qualified professional has confirmed exercise clearance for this context</span></label>
        </fieldset>
        <label className="ea-check ea-consent"><input type="checkbox" checked={consented} onChange={e => setConsented(e.target.checked)} required/>
          <span>I consent to transmitting the indicated measurements and screening answers to an external AI service. This service does not receive my crew name or UUID, but health-related values still leave this device.</span>
        </label>
        <div className="ea-actions"><button type="submit" className="button-dark" disabled={loading || !consented}>
          {loading ? 'Consulting AI…' : 'Generate workout draft ↗'}
        </button><span>Saved drafts can be reviewed in History.</span></div>
      </form>
      <div className="ea-output" aria-label="Workout draft">
      {error && <p className="bp-error" role="alert">{error}</p>}
      {!result && !error && <p className="empty-state" role="status">{loading ? 'Generating workout draft…' : 'A generated workout sheet will appear here.'}</p>}
      {result && <div className="ea-result" role="status" aria-live="polite">
        <div className="ea-result-head"><strong>{result.status === 'needs_clearance' ? 'Review required before any options' : 'AI DRAFT — REVIEW REQUIRED'}</strong><span>{result.model_used ? `Model: ${result.model_used}` : 'No external AI call'}</span></div>
        <p>{result.summary}</p>
        {result.status === 'draft_for_review' && result.options.length > 0 && <>
          <div className="ea-plan-summary"><strong>Proposed weekly template</strong><span>{result.sessions_per_week} session{result.sessions_per_week === 1 ? '' : 's'} / week · Resistance exercise · Subject to professional adjustment</span></div>
          {result.sessions_per_week != null && <div className="ea-week" role="img" aria-label={`${result.sessions_per_week} sessions per week, days to be assigned during review`}>
            {Array.from({ length: 7 }, (_, index) => <span key={index} className={index < result.sessions_per_week! ? 'planned' : ''} aria-hidden="true">{index < result.sessions_per_week! ? 'Session' : '·'}</span>)}
          </div>}
          <div className="table-scroll ea-plan-scroll"><table className="ea-plan-table"><thead><tr><th>Exercise</th><th>Sets</th><th>Reps / set</th><th>Rest</th></tr></thead>
            <tbody>{result.options.map(option => <tr key={option.exercise_id}><th scope="row">{option.name}</th><td>{option.sets}</td><td>{option.repetitions_per_set}</td><td>{option.rest_seconds}s</td></tr>)}</tbody>
          </table></div>
          <div className="ea-options">{result.options.map(option => <article className="ea-option" key={option.exercise_id}>
            <strong>{option.name}</strong><p>{option.rationale}</p><small>Review note: {option.caution}</small>
          </article>)}</div>
          <p className="ea-plan-caveat">Research outline only. No loads or progression are selected automatically. Height, weight and BMI cannot determine an optimal individual dose or bone health.</p>
        </>}
        <p className="ea-limit"><strong>Limitations:</strong> {result.limitations}</p><p className="ea-disclaimer">{result.disclaimer}</p>
      </div>}
      </div></div>
    </>}
  </section>;
}
