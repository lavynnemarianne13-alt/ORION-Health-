import type { RegionId } from '../components/anatomy/BodyMap';
import type { BodyMeasurement } from '../types/anthropometry';

export function calculateBmi(heightCm: number, weightKg: number): number | null {
  if (!Number.isFinite(heightCm) || !Number.isFinite(weightKg) || heightCm <= 0 || weightKg <= 0) return null;
  return weightKg / (heightCm / 100) ** 2;
}

export function calculateWaistToHeight(waistCm: number | null, heightCm: number): number | null {
  if (waistCm === null || !Number.isFinite(waistCm) || waistCm <= 0 || !Number.isFinite(heightCm) || heightCm <= 0) return null;
  return waistCm / heightCm;
}

const regionCircumference: Partial<Record<RegionId, { key: keyof BodyMeasurement; label: string }>> = {
  right_upper_arm: { key: 'rightUpperArmCm', label: 'Right upper-arm circumference' },
  left_upper_arm: { key: 'leftUpperArmCm', label: 'Left upper-arm circumference' },
  right_forearm: { key: 'rightForearmCm', label: 'Right forearm circumference' },
  left_forearm: { key: 'leftForearmCm', label: 'Left forearm circumference' },
  abdomen: { key: 'waistCm', label: 'Waist circumference' },
  pelvis: { key: 'hipCm', label: 'Hip circumference' },
  right_thigh: { key: 'rightThighCm', label: 'Right thigh circumference' },
  left_thigh: { key: 'leftThighCm', label: 'Left thigh circumference' },
  right_calf: { key: 'rightCalfCm', label: 'Right calf circumference' },
  left_calf: { key: 'leftCalfCm', label: 'Left calf circumference' }
};
export function getRegionCircumference(record: BodyMeasurement | null | undefined, region: RegionId): { label: string; value: number } | null {
  const mapping = regionCircumference[region];
  if (!record || !mapping) return null;
  const value = record[mapping.key];
  return typeof value === 'number' && Number.isFinite(value) ? { label: mapping.label, value } : null;
}

export function formatNumber(value: number | null | undefined, digits = 1): string {
  return value === null || value === undefined || !Number.isFinite(value) ? '—' : value.toFixed(digits);
}
