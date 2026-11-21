/**
 * ORION experimental local repetition counting.
 * Each supported exercise has a dedicated motion profile; there is no universal
 * threshold or automatic exercise recognition.
 */
import { SquatCounter } from './squatCounter.ts';
import type { SquatSnapshot } from './squatCounter.ts';

export type ExerciseCode = 'squat' | 'curl' | 'shoulder' | 'knee' | 'deadlift' | 'calf';
export type ExerciseSide = 'left' | 'right';
export type CounterSnapshot = {
  reps: number;
  attempts: number;
  phase: string;
  guidance: string;
  angle: number | null;
  trackingValid: boolean;
};
export type CounterMetrics = {
  leftKnee: number | null;
  rightKnee: number | null;
  leftElbow: number | null;
  rightElbow: number | null;
  leftShoulder: number | null;
  rightShoulder: number | null;
  visiblePoints: number;
};

export const exerciseOptions: {value: ExerciseCode; label: string; counting: boolean}[] = [
  { value: 'squat', label: 'Bodyweight squat', counting: true },
  { value: 'curl', label: 'Biceps curl', counting: true },
  { value: 'shoulder', label: 'Lateral shoulder raise', counting: true },
  { value: 'knee', label: 'Seated knee extension', counting: true },
  { value: 'deadlift', label: 'Deadlift · camera preview only', counting: false },
  { value: 'calf', label: 'Calf raise · camera preview only', counting: false }
];

export const supportsExerciseCounting = (code: ExerciseCode): boolean =>
  exerciseOptions.some(option => option.value === code && option.counting);

export const setupGuidance: Record<ExerciseCode, string> = {
  squat: 'Show both legs. Stand upright, bend both knees, then stand up.',
  curl: 'Choose a side. Face the camera; keep the selected shoulder, elbow, and wrist visible.',
  shoulder: 'Choose a side. Face the camera; raise the straight arm from your side to shoulder height.',
  knee: 'Choose a side. Sit side-on so the selected hip, knee, and ankle are visible.',
  deadlift: 'Experimental exercise counter not available for deadlifts. Camera preview only.',
  calf: 'Experimental exercise counter not available for calf raises. Camera preview only.'
};

type JointPhase = 'waiting' | 'ready' | 'moving' | 'peak' | 'returning';
type JointProfile = { start: number; peak: number; direction: 'up' | 'down'; label: string };
const profiles: Record<'curl' | 'shoulder' | 'knee', JointProfile> = {
  curl: { start: 155, peak: 75, direction: 'down', label: 'elbow' },
  shoulder: { start: 30, peak: 70, direction: 'up', label: 'shoulder' },
  knee: { start: 110, peak: 155, direction: 'up', label: 'knee' }
};
const START_STABLE_MS = 220;
const PEAK_STABLE_MS = 180;
const MIN_CYCLE_MS = 650;
const MIN_BETWEEN_MS = 700;
const MAX_CYCLE_MS = 12000;
const MAX_LOSS_MS = 650;

class JointCycleCounter {
  private reps = 0;
  private attempts = 0;
  private phase: JointPhase = 'waiting';
  private stableSince: number | null = null;
  private stableZone: 'start' | 'peak' | null = null;
  private cycleStart: number | null = null;
  private lastRep: number | null = null;
  private invalidSince: number | null = null;
  private filtered: number | null = null;
  private lastTimestamp: number | null = null;

  private readonly profile: JointProfile;
  constructor(profile: JointProfile) { this.profile = profile; }
  reset() { this.reps = 0; this.attempts = 0; this.lastRep = null; this.interrupt(); }
  interrupt() {
    this.phase = 'waiting'; this.stableSince = null; this.cycleStart = null;
    this.invalidSince = null; this.filtered = null; this.lastTimestamp = null;
  }
  private snapshot(phase: string, valid: boolean, guidance: string): CounterSnapshot {
    return { reps: this.reps, attempts: this.attempts, phase, guidance, angle: valid ? this.filtered : null, trackingValid: valid };
  }
  private transition(next: JointPhase) { this.phase = next; this.stableSince = null; }
  update(angle: number | null, visiblePoints: number, now: number): CounterSnapshot {
    if (!Number.isFinite(now)) return this.snapshot('tracking_lost', false, 'Invalid timestamp.');
    if (this.lastTimestamp !== null && (now < this.lastTimestamp || now - this.lastTimestamp > MAX_LOSS_MS)) this.interrupt();
    this.lastTimestamp = now;
    const valid = angle !== null && Number.isFinite(angle) && angle >= 0 && angle <= 180 && visiblePoints >= 6;
    if (!valid) {
      if (this.invalidSince === null) this.invalidSince = now;
      this.stableSince = null;
      if (now - this.invalidSince >= MAX_LOSS_MS) {
        this.interrupt(); this.invalidSince = now; this.lastTimestamp = now;
      }
      return this.snapshot('tracking_lost', false, `Show your selected ${this.profile.label} clearly; tracking is insufficient.`);
    }
    if (this.invalidSince !== null) {
      const gap = now - this.invalidSince;
      this.invalidSince = null;
      if (gap >= MAX_LOSS_MS) { this.interrupt(); this.lastTimestamp = now; }
    }
    this.filtered = this.filtered === null ? angle : this.filtered * .55 + angle! * .45;
    const a = this.filtered;
    const { start, peak, direction } = this.profile;
    const atStart = direction === 'down' ? a >= start : a <= start;
    const atPeak = direction === 'down' ? a <= peak : a >= peak;
    const crossedHalf = direction === 'down' ? a <= (start + peak) / 2 : a >= (start + peak) / 2;
    const stable = (condition: boolean, duration: number, zone: 'start' | 'peak') => {
      if (!condition) { this.stableSince = null; return false; }
      if (this.stableSince === null || this.stableZone !== zone) this.stableSince = now;
      this.stableZone = zone;
      return now - this.stableSince >= duration;
    };
    if (this.cycleStart !== null && now - this.cycleStart > MAX_CYCLE_MS) {
      this.transition('waiting'); this.cycleStart = null;
    }
    switch (this.phase) {
      case 'waiting':
        if (stable(atStart, START_STABLE_MS, 'start')) this.transition('ready');
        break;
      case 'ready':
        if (crossedHalf) { this.transition('moving'); this.cycleStart = now; }
        break;
      case 'moving':
        if (!atStart) {
          if (stable(atPeak, PEAK_STABLE_MS, 'peak')) this.transition('peak');
        } else if (stable(atStart, START_STABLE_MS, 'start')) {
          this.attempts += 1;
          this.transition('ready'); this.cycleStart = null;
        }
        break;
      case 'peak':
        if (!crossedHalf) this.transition('returning');
        break;
      case 'returning':
        if (atPeak) this.transition('peak');
        else if (stable(atStart, START_STABLE_MS, 'start')) {
          this.attempts += 1;
          const durationOk = this.cycleStart !== null && now - this.cycleStart >= MIN_CYCLE_MS;
          const gapOk = this.lastRep === null || now - this.lastRep >= MIN_BETWEEN_MS;
          if (durationOk && gapOk) { this.reps += 1; this.lastRep = now; }
          this.cycleStart = null; this.transition('ready');
        }
        break;
    }
    const guidance: Record<JointPhase, string> = {
      waiting: 'Hold the starting position until the counter is ready.',
      ready: 'Ready · begin your selected exercise.',
      moving: 'Movement detected · continue to the target position.',
      peak: 'End position reached · return to the starting position.',
      returning: 'Returning · finish the movement steadily.'
    };
    return this.snapshot(this.phase, true, guidance[this.phase]);
  }
}

/** One counter instance per exercise/side selection. */
export class ExerciseRepCounter {
  private squat = new SquatCounter();
  private joint: JointCycleCounter | null;
  readonly code: ExerciseCode;
  readonly side: ExerciseSide;
  constructor(code: ExerciseCode, side: ExerciseSide) {
    this.code = code; this.side = side;
    this.joint = code === 'curl' || code === 'shoulder' || code === 'knee' ? new JointCycleCounter(profiles[code]) : null;
  }
  reset() { this.squat.reset(); this.joint?.reset(); }
  interrupt() { this.squat.interrupt(); this.joint?.interrupt(); }
  update(metrics: CounterMetrics | null, now: number): CounterSnapshot | null {
    if (!supportsExerciseCounting(this.code)) return null;
    if (this.code === 'squat') {
      const value: SquatSnapshot = this.squat.update({
        leftKnee: metrics?.leftKnee ?? null,
        rightKnee: metrics?.rightKnee ?? null,
        visiblePoints: metrics?.visiblePoints ?? 0
      }, now);
      return { reps: value.reps, attempts: value.attempts, phase: value.phase, guidance: value.guidance, angle: value.kneeAngle, trackingValid: value.trackingValid };
    }
    const key = this.code === 'curl' ? (this.side === 'left' ? 'leftElbow' : 'rightElbow') :
      this.code === 'shoulder' ? (this.side === 'left' ? 'leftShoulder' : 'rightShoulder') :
      this.side === 'left' ? 'leftKnee' : 'rightKnee';
    return this.joint!.update(metrics?.[key] ?? null, metrics?.visiblePoints ?? 0, now);
  }
}
