import { useState } from 'react';
import type { FormEvent } from 'react';
import type { Athlete } from '../../types/backend';
import type { BodyMeasurement } from '../../types/anthropometry';
import { calculateBmi, calculateWaistToHeight, formatNumber } from '../../utils/anthropometry';
import { cmToIn, inToCm, kgToLb, lbToKg, formatUsHeight, formatUsWeight } from '../../utils/imperial';
import './BodyProfile.css';

type CircumferenceKey = 'waist' | 'hip' | 'rightUpperArm' | 'leftUpperArm' | 'rightForearm' | 'leftForearm' | 'rightThigh' | 'leftThigh' | 'rightCalf' | 'leftCalf';
type NumberKey = 'ageYears' | 'heightFeet' | 'heightInches' | 'weightLb' | CircumferenceKey | 'bodyFatPercent' | 'skeletalMuscleMassLb' | 'bodyWaterPercent';
type FormValues = Record<NumberKey, string> & { biaDevice: string };
const emptyForm: FormValues = {
  ageYears: '', heightFeet: '', heightInches: '', weightLb: '',
  waist: '', hip: '', rightUpperArm: '', leftUpperArm: '',
  rightForearm: '', leftForearm: '', rightThigh: '', leftThigh: '',
  rightCalf: '', leftCalf: '', bodyFatPercent: '',
  skeletalMuscleMassLb: '', bodyWaterPercent: '', biaDevice: ''
};
const optionalCircumferences: { key: CircumferenceKey; label: string }[] = [
  { key: 'waist', label: 'Waist' },
  { key: 'hip', label: 'Hip' },
  { key: 'rightUpperArm', label: 'Right upper arm' },
  { key: 'leftUpperArm', label: 'Left upper arm' },
  { key: 'rightForearm', label: 'Right forearm' },
  { key: 'leftForearm', label: 'Left forearm' },
  { key: 'rightThigh', label: 'Right thigh' },
  { key: 'leftThigh', label: 'Left thigh' },
  { key: 'rightCalf', label: 'Right calf' },
  { key: 'leftCalf', label: 'Left calf' }
];
const limits: Record<NumberKey, [number, number]> = {
  ageYears: [18, 110], heightFeet: [3, 8], heightInches: [0, 11.999],
  weightLb: [kgToLb(20), kgToLb(350)],
  waist: [cmToIn(25), cmToIn(250)], hip: [cmToIn(25), cmToIn(250)],
  rightUpperArm: [cmToIn(10), cmToIn(100)], leftUpperArm: [cmToIn(10), cmToIn(100)],
  rightForearm: [cmToIn(10), cmToIn(90)], leftForearm: [cmToIn(10), cmToIn(90)],
  rightThigh: [cmToIn(15), cmToIn(140)], leftThigh: [cmToIn(15), cmToIn(140)],
  rightCalf: [cmToIn(10), cmToIn(110)], leftCalf: [cmToIn(10), cmToIn(110)],
  bodyFatPercent: [1, 80], skeletalMuscleMassLb: [kgToLb(1), kgToLb(150)],
  bodyWaterPercent: [10, 90]
};
function numericValue(form: FormValues, key: NumberKey): number | null {
  const raw = form[key].trim();
  return raw === '' ? null : Number(raw);
}
function createMeasurement(form: FormValues, athleteId: string): BodyMeasurement {
  const numeric = (key: NumberKey) => numericValue(form, key);
  const circumference = (key: CircumferenceKey) => {
    const inches = numeric(key);
    return inches === null ? null : inToCm(inches);
  };
  return {
    id: crypto.randomUUID(), athleteId, recordedAt: new Date().toISOString(),
    ageYears: numeric('ageYears'),
    heightCm: inToCm(numeric('heightFeet')! * 12 + (numeric('heightInches') ?? 0)),
    weightKg: lbToKg(numeric('weightLb')!),
    waistCm: circumference('waist'), hipCm: circumference('hip'),
    rightUpperArmCm: circumference('rightUpperArm'), leftUpperArmCm: circumference('leftUpperArm'),
    rightForearmCm: circumference('rightForearm'), leftForearmCm: circumference('leftForearm'),
    rightThighCm: circumference('rightThigh'), leftThighCm: circumference('leftThigh'),
    rightCalfCm: circumference('rightCalf'), leftCalfCm: circumference('leftCalf'),
    bodyFatPercent: numeric('bodyFatPercent'),
    skeletalMuscleMassKg: numeric('skeletalMuscleMassLb') === null ? null : lbToKg(numeric('skeletalMuscleMassLb')!),
    bodyWaterPercent: numeric('bodyWaterPercent'), biaDevice: form.biaDevice.trim() || null
  };
}
function NumericInput({ field, label, value, onChange, required = false, unit = 'in' }: {
  field: NumberKey; label: string; value: string; required?: boolean; unit?: string;
  onChange: (field: NumberKey, value: string) => void;
}) {
  const [min, max] = limits[field];
  return <label className="bp-field"><span>{label} {required && <b aria-label="required">*</b>}</span>
    <div className="bp-input-wrap"><input type="number" inputMode="decimal" min={min} max={max}
      step={field === 'ageYears' || field === 'heightFeet' ? 1 : 0.1} value={value}
      required={required} placeholder="—" onChange={e => onChange(field, e.target.value)}/><em>{unit}</em></div></label>;
}
function WeightTrend({ records }: { records: BodyMeasurement[] }) {
  const chronology = records.slice(0, 8).reverse();
  if (chronology.length < 2) return <p className="bp-placeholder">Add another measurement to view an individual weight trend.</p>;
  const weights = chronology.map(record => kgToLb(record.weightKg));
  const low = Math.min(...weights) - 2;
  const high = Math.max(...weights) + 2;
  const spread = Math.max(1, high - low);
  const points = weights.map((value, i) => `${20 + i * 52},${110 - ((value - low) / spread) * 85}`).join(' ');
  return <div className="bp-trend"><svg viewBox="0 0 410 125" role="img" aria-label={`Weight trend from ${weights[0].toFixed(1)} to ${weights.at(-1)!.toFixed(1)} pounds`} preserveAspectRatio="xMidYMid meet">
    {[25, 65, 105].map(y => <line key={y} x1="15" x2="390" y1={y} y2={y} stroke="#dae1e9" strokeDasharray="4 5"/>)}
    <polyline points={points} fill="none" stroke="#375978" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
    {weights.map((weight, i) => <circle key={i} cx={20 + i * 52} cy={110 - ((weight - low) / spread) * 85} r="4" fill="#375978"><title>{weight.toFixed(1)} lb</title></circle>)}
  </svg><div className="bp-trend-caption"><span>Oldest of last {chronology.length}</span><span>Most recent</span></div></div>;
}
export default function BodyProfile({ athlete, records, onAdd, onRemove, onSelectCrew }: {
  athlete: Athlete | null; records: BodyMeasurement[];
  onAdd: (measurement: BodyMeasurement) => Promise<boolean>;
  onRemove: (id: string) => void; onSelectCrew: () => void;
}) {
  const [form, setForm] = useState<FormValues>(emptyForm);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showCircs, setShowCircs] = useState(true);
  const [showBia, setShowBia] = useState(false);
  const latest = records[0] ?? null;
  const bmi = latest ? calculateBmi(latest.heightCm, latest.weightKg) : null;
  const waistRatio = latest ? calculateWaistToHeight(latest.waistCm, latest.heightCm) : null;
  const setField = (key: NumberKey, value: string) => {
    setForm(prev => ({ ...prev, [key]: value })); setError(''); setSuccess('');
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setError(''); setSuccess('');
    if (!athlete) { setError('Select a crew profile before saving measurements.'); return; }
    const ft = numericValue(form, 'heightFeet');
    const inches = numericValue(form, 'heightInches') ?? 0;
    const pounds = numericValue(form, 'weightLb');
    if (ft === null || pounds === null) { setError('Height (ft) and weight (lb) are required.'); return; }
    for (const key of Object.keys(limits) as NumberKey[]) {
      const value = numericValue(form, key); const [min, max] = limits[key];
      if (value !== null && (!Number.isFinite(value) || value < min - 0.00001 || value > max + 0.00001 || ((key === 'ageYears' || key === 'heightFeet') && !Number.isInteger(value)))) {
        setError(`Check ${key}: value is out of the supported range.`); return;
      }
    }
    const heightCm = inToCm(ft * 12 + inches);
    if (heightCm < 100 || heightCm > 250) { setError('Check height: expected 3 ft 3.4 in to 8 ft 2.4 in.'); return; }
    const hasBia = ['bodyFatPercent', 'skeletalMuscleMassLb', 'bodyWaterPercent'].some(key => form[key as NumberKey].trim() !== '');
    if (hasBia && !form.biaDevice.trim()) { setError('Name the actual device or report used for any external BIA values.'); return; }
    if (form.biaDevice.length > 120) { setError('Device/source name must be 120 characters or fewer.'); return; }
    if (!await onAdd(createMeasurement(form, athlete.id))) return;
    setForm(emptyForm); setSuccess('Measurement saved for the selected crew member.');
  };
  return <div className="body-profile">
    <section className="surface bp-intro"><div><span className="section-number">PERSONAL ANTHROPOMETRY</span><h2>One person. One baseline.</h2><p>Enter measurements using U.S. customary units (ft, in, lb). ORION keeps metric values internally for accurate BMI calculations and the existing API.</p></div><div className="bp-intro-seal"><strong>ORION</strong><span>BODY PROFILE</span></div></section>
    {!athlete ? <section className="surface bp-empty"><h2>No crew profile selected</h2><p>Register or open a crew member in Overview before recording personal measurements. This prevents mixing measurements between people.</p><button className="button-dark" type="button" onClick={onSelectCrew}>Open crew profiles ↗</button></section> : <>
      <div className="bp-crew-strip"><span className="bp-crew-dot"/><span>ACTIVE CREW MEMBER</span><strong>{athlete.pseudonym}</strong><code title={athlete.id}>{athlete.id}</code><span className="bp-memory-tag">LOCAL SQLITE</span></div>
      <div className="bp-metric-grid">
        <article className="surface bp-stat"><span>HEIGHT</span><strong>{formatUsHeight(latest?.heightCm)}</strong><p>Entered manually</p></article>
        <article className="surface bp-stat"><span>BODY WEIGHT</span><strong>{formatUsWeight(latest?.weightKg)}</strong><p>Entered manually</p></article>
        <article className="surface bp-stat"><span>BODY MASS INDEX</span><strong>{formatNumber(bmi)} <small>kg/m²</small></strong><p>Calculated from height and weight</p></article>
        <article className="surface bp-stat"><span>WAIST / HEIGHT</span><strong>{formatNumber(waistRatio, 2)}</strong><p>Shown only if waist is entered</p></article>
      </div>
      <div className="bp-columns"><section className="surface bp-form-card"><div className="surface-heading"><div><span className="section-number">NEW OBSERVATION</span><h2>Body measurements</h2></div><span className="bp-subtle-tag">MANUAL ENTRY · US UNITS</span></div>
        <form onSubmit={submit}><h3>Essential measurements</h3><div className="bp-form-grid">
          <div className="bp-height-group" role="group" aria-label="Height"><span className="bp-height-label">Height <b aria-label="required">*</b></span><div className="bp-height-pair">
            <NumericInput field="heightFeet" label="Feet" unit="ft" value={form.heightFeet} onChange={setField} required/>
            <NumericInput field="heightInches" label="Inches" unit="in" value={form.heightInches} onChange={setField}/>
          </div></div>
          <NumericInput field="weightLb" label="Body weight" unit="lb" value={form.weightLb} onChange={setField} required/>
          <NumericInput field="ageYears" label="Age (optional)" unit="years" value={form.ageYears} onChange={setField}/>
        </div>
        <button className="bp-section-toggle" type="button" aria-expanded={showCircs} onClick={() => setShowCircs(v => !v)}>Body circumferences <span>{showCircs ? '−' : '+'}</span></button>
        {showCircs && <><p className="bp-help">Optional tape measurements in inches. Use the same landmarks, posture, and technique at each assessment.</p><div className="bp-form-grid">{optionalCircumferences.map(item => <NumericInput key={item.key} field={item.key} label={item.label} unit="in" value={form[item.key]} onChange={setField}/>)}</div></>}
        <button className="bp-section-toggle" type="button" aria-expanded={showBia} onClick={() => setShowBia(v => !v)}>External bioimpedance results <span>{showBia ? '−' : '+'}</span></button>
        {showBia && <div className="bp-bia-section"><p className="bp-help"><strong>Only transcribe values measured by an actual BIA device.</strong> The webcam, pose tracking, height and weight cannot produce these measurements.</p><div className="bp-form-grid">
          <NumericInput field="bodyFatPercent" label="Body fat" unit="%" value={form.bodyFatPercent} onChange={setField}/>
          <NumericInput field="skeletalMuscleMassLb" label="Muscle mass (as reported)" unit="lb" value={form.skeletalMuscleMassLb} onChange={setField}/>
          <NumericInput field="bodyWaterPercent" label="Total body water" unit="%" value={form.bodyWaterPercent} onChange={setField}/>
          <label className="bp-field"><span>Measurement device / report</span><div className="bp-input-wrap"><input type="text" value={form.biaDevice} maxLength={120} placeholder="Device or report name" onChange={e => setForm(prev => ({ ...prev, biaDevice: e.target.value }))}/></div></label>
        </div></div>}
        <div className="bp-form-actions"><button type="submit" className="button-dark">Save local measurement</button><span>Nothing sent to FastAPI</span></div>
        {error && <p className="bp-error" role="alert">{error}</p>}{success && <p className="bp-success" role="status">{success}</p>}
        </form>
      </section><aside className="bp-side-stack"><section className="surface bp-history-card"><div className="surface-heading"><div><span className="section-number">INDIVIDUAL BASELINE</span><h2>Measurement history</h2></div><span className="bp-subtle-tag">{records.length} RECORD(S)</span></div><WeightTrend records={records}/>
        <div className="bp-history-list">{records.length === 0 ? <p className="bp-placeholder">No personal measurements have been entered for this crew member.</p> : records.map(item => <article key={item.id} className="bp-record"><div><strong>{formatUsWeight(item.weightKg)} <span>·</span> {formatUsHeight(item.heightCm)}</strong><small>{new Date(item.recordedAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })} · BMI {formatNumber(calculateBmi(item.heightCm, item.weightKg))}</small>{item.biaDevice && <small>External BIA report: {item.biaDevice}</small>}</div><button type="button" onClick={() => { if (window.confirm('Remove this local measurement?')) onRemove(item.id); }} aria-label={`Remove record from ${new Date(item.recordedAt).toLocaleDateString('en-US')}`}>Remove</button></article>)}</div>
      </section><section className="surface bp-science-card"><span className="section-number">MEASUREMENT BOUNDARIES</span><h2>Not a bioimpedance examination.</h2><p>BMI and waist-to-height ratio are mathematical indicators, not diagnoses. Body fat, muscle mass, water compartments and individual identity cannot be determined reliably from a webcam or MediaPipe. ORION does not provide a medical classification.</p><p>Baseline comparisons are meaningful only with comparable repeated measurements from the same person.</p><p className="bp-privacy"><strong>Privacy:</strong> Anthropometry is saved locally in SQLite under the selected crew profile.</p></section></aside></div>
    </>}
  </div>;
}
