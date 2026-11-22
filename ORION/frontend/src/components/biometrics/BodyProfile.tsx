import { useState } from 'react';
import type { FormEvent } from 'react';
import type { Athlete } from '../../types/backend';
import type { BodyMeasurement } from '../../types/anthropometry';
import { calculateBmi, calculateWaistToHeight, formatNumber } from '../../utils/anthropometry';
import { cmToIn, inToCm, kgToLb, lbToKg, formatUsHeight, formatUsWeight } from '../../utils/imperial';
import { initials } from '../../utils/initials';
import TrendChart from '../ui/TrendChart';
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
function formFromMeasurement(record: BodyMeasurement): FormValues {
  const inches = Number(cmToIn(record.heightCm).toFixed(9));
  const feet = Math.floor(inches / 12);
  const optional = (value: number | null) => value == null ? '' : String(value);
  const form = {
    ...emptyForm,
    ageYears: optional(record.ageYears),
    heightFeet: String(feet),
    heightInches: optional(inches - feet * 12),
    weightLb: optional(kgToLb(record.weightKg)),
    bodyFatPercent: optional(record.bodyFatPercent),
    skeletalMuscleMassLb: optional(record.skeletalMuscleMassKg == null ? null : kgToLb(record.skeletalMuscleMassKg)),
    bodyWaterPercent: optional(record.bodyWaterPercent),
    biaDevice: record.biaDevice ?? '',
  };
  for (const { key } of optionalCircumferences) {
    const value = record[`${key}Cm`];
    form[key] = optional(value == null ? null : cmToIn(value));
  }
  return form;
}
function NumericInput({ field, label, value, onChange, required = false, unit = 'in' }: {
  field: NumberKey; label: string; value: string; required?: boolean; unit?: string;
  onChange: (field: NumberKey, value: string) => void;
}) {
  const [min, max] = limits[field];
  return <label className="bp-field"><span>{label} {required && <b aria-label="required">*</b>}</span>
    <div className="bp-input-wrap"><input type="number" inputMode="decimal" min={min} max={max}
      step={field === 'ageYears' || field === 'heightFeet' ? 1 : 'any'} value={value}
      required={required} placeholder="—" onChange={e => onChange(field, e.target.value)}/><em>{unit}</em></div></label>;
}
export default function BodyProfile({ athlete, records, onAdd, onRemove, onSelectCrew }: {
  athlete: Athlete | null; records: BodyMeasurement[];
  onAdd: (measurement: BodyMeasurement) => Promise<boolean>;
  onRemove: (id: string) => void; onSelectCrew: () => void;
}) {
  const [form, setForm] = useState<FormValues>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
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
    setSaving(true);
    try {
      if (await onAdd(createMeasurement(form, athlete.id))) {
        setForm(emptyForm);
        setCopied(false);
        setSuccess('Measurement saved for the selected crew member.');
      }
    } finally { setSaving(false); }
  };
  return <div className="body-profile">
    {!athlete ? <section className="surface bp-empty"><h2>No crew profile selected</h2><p>Register or open a crew member before recording measurements.</p><button className="button-dark" type="button" onClick={onSelectCrew}>Manage crew →</button></section> : <>
      <div className="bp-columns">
        <aside className="bp-side-stack">
          <section className="surface bp-profile">
            <span className="avatar bp-avatar" aria-hidden="true">{initials(athlete.pseudonym)}</span>
            <h2>{athlete.pseudonym}</h2>
            <dl className="bp-meta">
              <div><dt>Crew ID</dt><dd><code>{athlete.id}</code></dd></div>
              <div><dt>Age</dt><dd>{latest?.ageYears == null ? '—' : `${latest.ageYears} years`}</dd></div>
              <div><dt>Height</dt><dd>{formatUsHeight(latest?.heightCm)}</dd></div>
              <div><dt>Body weight</dt><dd>{formatUsWeight(latest?.weightKg)}</dd></div>
              <div><dt>Body mass index</dt><dd>{bmi == null ? '—' : `${formatNumber(bmi)} kg/m²`}</dd></div>
              <div><dt>Waist / height</dt><dd>{formatNumber(waistRatio, 2)}</dd></div>
            </dl>
          </section>
          <section className="surface bp-history-card"><div className="surface-heading"><h2>Measurement history</h2><span className="pill">{records.length} records</span></div>
            <TrendChart label="Body weight in pounds" empty="Add another measurement to see a weight trend."
              points={records.map(record => ({ time: Date.parse(record.recordedAt), value: kgToLb(record.weightKg) }))}/>
            <div className="bp-history-list">{records.length === 0 ? <p className="bp-placeholder">No measurements for this crew member.</p> : records.map(item => <article key={item.id} className="bp-record">
              <div><strong>{formatUsWeight(item.weightKg)} · {formatUsHeight(item.heightCm)}</strong>
              <small>{new Date(item.recordedAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })} · BMI {formatNumber(calculateBmi(item.heightCm, item.weightKg))}</small>
              {item.biaDevice && <small>External BIA report: {item.biaDevice}</small>}</div>
              <button type="button" onClick={() => { if (window.confirm('Remove this measurement?')) onRemove(item.id); }}
                aria-label={`Remove record from ${new Date(item.recordedAt).toLocaleDateString('en-US')}`}>Remove</button>
            </article>)}</div>
          </section>
        </aside>
        <section className="surface bp-form-card"><div className="surface-heading"><h2>Body measurements</h2><span className="bp-subtle-tag">MANUAL ENTRY · US UNITS</span></div>
        {latest && <button type="button" className="bp-copy" disabled={saving} onClick={() => {
          setForm(formFromMeasurement(latest));
          setShowCircs(true);
          setShowBia(!!latest.biaDevice);
          setCopied(true); setError(''); setSuccess('');
        }}>Use latest measurement as starting point</button>}
        {copied && <p className="muted-note">Saving adds a new observation to the measurement history.</p>}
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
        <div className="bp-form-actions"><button type="submit" className="button-dark" disabled={saving}>{saving ? 'Saving…' : 'Save measurement'}</button></div>
        {error && <p className="bp-error" role="alert">{error}</p>}{success && <p className="bp-success" role="status">{success}</p>}
        </form>
        <p className="clinical-note">BMI and waist-to-height ratio describe the recorded measurements. Body composition values come from external bioimpedance reports.</p>
      </section></div>
    </>}
  </div>;
}
