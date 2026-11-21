// Presentation-only units. Keep the existing metric domain/API fields unchanged.
export const CM_PER_INCH = 2.54;
export const LB_PER_KG = 2.20462262185;

export function cmToIn(value: number): number { return value / CM_PER_INCH; }
export function inToCm(value: number): number { return value * CM_PER_INCH; }
export function kgToLb(value: number): number { return value * LB_PER_KG; }
export function lbToKg(value: number): number { return value / LB_PER_KG; }

export function formatUsHeight(cm: number | null | undefined): string {
  if (cm == null || !Number.isFinite(cm) || cm <= 0) return '—';
  // Round to the nearest tenth of an inch; avoids displaying 12.0 in.
  const tenths = Math.round(cmToIn(cm) * 10);
  const feet = Math.floor(tenths / 120);
  const inches = (tenths - feet * 120) / 10;
  return `${feet} ft ${inches.toFixed(1)} in`;
}

export function formatUsWeight(kg: number | null | undefined): string {
  return kg == null || !Number.isFinite(kg) ? '—' : `${kgToLb(kg).toFixed(1)} lb`;
}
