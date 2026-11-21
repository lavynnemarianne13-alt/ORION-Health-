export type BodyMeasurement = {
  id: string;
  athleteId: string;
  recordedAt: string;
  ageYears: number | null;
  heightCm: number;
  weightKg: number;
  waistCm: number | null;
  hipCm: number | null;
  rightUpperArmCm: number | null;
  leftUpperArmCm: number | null;
  rightForearmCm: number | null;
  leftForearmCm: number | null;
  rightThighCm: number | null;
  leftThighCm: number | null;
  rightCalfCm: number | null;
  leftCalfCm: number | null;
  // The following fields MUST be transcribed from an actual external device.
  bodyFatPercent: number | null;
  skeletalMuscleMassKg: number | null;
  bodyWaterPercent: number | null;
  biaDevice: string | null;
};
