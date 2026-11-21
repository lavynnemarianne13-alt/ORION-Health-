/**
 * Experimental, browser-only squat counter based on the frontal 2D knee angles.
 * A rep requires: stable upright -> deep flexion -> stable upright.
 * Both knees must be visible and broadly consistent; tracking gaps cancel an unfinished rep.
 */
export type SquatPhase = 'waiting' | 'ready' | 'descending' | 'bottom' | 'ascending' | 'tracking_lost';
export type SquatInput = { leftKnee: number | null; rightKnee: number | null; visiblePoints: number };
export type SquatSnapshot = { reps: number; attempts: number; phase: SquatPhase; guidance: string; kneeAngle: number | null; trackingValid: boolean };

const UPRIGHT = 160;
const DOWN = 110;
const MOVE_DOWN = 145;
const MOVE_UP = 130;
const MIN_STABLE_MS = 220;
const MIN_BOTTOM_MS = 180;
const MIN_CYCLE_MS = 650;
const MIN_BETWEEN_REPS_MS = 750;
const MAX_CYCLE_MS = 12000;
const MAX_TRACKING_GAP_MS = 650;

export class SquatCounter {
  private reps = 0;
  private attempts = 0;
  private phase: Exclude<SquatPhase, 'tracking_lost'> = 'waiting';
  private stableSince: number | null = null;
  private stableZone: 'above' | 'below' | null = null;
  private cycleStartedAt: number | null = null;
  private lastRepAt: number | null = null;
  private invalidSince: number | null = null;
  private filteredAngle: number | null = null;
  private lastTimestamp: number | null = null;

  reset() {
    this.reps = 0;
    this.attempts = 0;
    this.interrupt();
    this.lastRepAt = null;
  }

  /** Preserve completed reps, but invalidate unfinished cycles (stop camera / change mode). */
  interrupt() {
    this.phase = 'waiting';
    this.stableSince = null;
    this.cycleStartedAt = null;
    this.invalidSince = null;
    this.filteredAngle = null;
    this.lastTimestamp = null;
  }

  private transition(phase: Exclude<SquatPhase, 'tracking_lost'>) {
    this.phase = phase;
    this.stableSince = null;
  }

  private snapshot(phase: SquatPhase, trackingValid: boolean, guidance: string): SquatSnapshot {
    return { reps: this.reps, attempts: this.attempts, phase, guidance, kneeAngle: trackingValid ? this.filteredAngle : null, trackingValid };
  }

  update(input: SquatInput, now: number): SquatSnapshot {
    if (!Number.isFinite(now)) return this.snapshot('tracking_lost', false, 'Invalid camera timestamp.');
    // A new camera stream may start with a smaller requestAnimationFrame timestamp.
    if (this.lastTimestamp !== null && (now < this.lastTimestamp || now - this.lastTimestamp > MAX_TRACKING_GAP_MS)) this.interrupt();
    this.lastTimestamp = now;

    const valid = input.leftKnee !== null && input.rightKnee !== null &&
      Number.isFinite(input.leftKnee) && Number.isFinite(input.rightKnee) &&
      input.leftKnee >= 0 && input.leftKnee <= 180 &&
      input.rightKnee >= 0 && input.rightKnee <= 180 &&
      input.visiblePoints >= 6;

    if (!valid) {
      if (this.invalidSince === null) this.invalidSince = now;
      this.stableSince = null;
      if (now - this.invalidSince >= MAX_TRACKING_GAP_MS) {
        const preserveNow = this.lastTimestamp;
        this.interrupt();
        this.invalidSince = now;
        this.lastTimestamp = preserveNow;
      }
      return this.snapshot('tracking_lost', false, 'Show both legs clearly; tracking is insufficient to count.');
    }

    if (this.invalidSince !== null) {
      const gap = now - this.invalidSince;
      this.invalidSince = null;
      if (gap >= MAX_TRACKING_GAP_MS) this.interrupt();
    }

    const kneeAngle = (input.leftKnee! + input.rightKnee!) / 2;
    // Light smoothing reduces threshold jitter without introducing excessive latency.
    this.filteredAngle = this.filteredAngle === null ? kneeAngle : this.filteredAngle * 0.5 + kneeAngle * 0.5;
    const angle = this.filteredAngle;
    const stayAbove = (threshold: number) => {
      if (angle < threshold) { this.stableSince = null; return false; }
      if (this.stableSince === null || this.stableZone !== 'above') this.stableSince = now;
      this.stableZone = 'above';
      return now - this.stableSince >= MIN_STABLE_MS;
    };
    const stayBelow = (threshold: number) => {
      if (angle > threshold) { this.stableSince = null; return false; }
      if (this.stableSince === null || this.stableZone !== 'below') this.stableSince = now;
      this.stableZone = 'below';
      return now - this.stableSince >= MIN_BOTTOM_MS;
    };

    if (this.cycleStartedAt !== null && now - this.cycleStartedAt > MAX_CYCLE_MS) {
      this.transition('waiting');
      this.cycleStartedAt = null;
    }

    switch (this.phase) {
      case 'waiting':
        if (stayAbove(UPRIGHT)) this.transition('ready');
        break;
      case 'ready':
        if (angle <= MOVE_DOWN) {
          this.transition('descending');
          this.cycleStartedAt = now;
        }
        break;
      case 'descending':
        if (angle < UPRIGHT) {
          if (stayBelow(DOWN)) this.transition('bottom');
        } else if (stayAbove(UPRIGHT)) {
          this.attempts += 1;
          this.transition('waiting');
          this.cycleStartedAt = null;
        }
        break;
      case 'bottom':
        if (angle >= MOVE_UP) this.transition('ascending');
        break;
      case 'ascending':
        if (angle <= DOWN) this.transition('bottom');
        else if (stayAbove(UPRIGHT)) {
          this.attempts += 1;
          const enoughTime = this.cycleStartedAt !== null && now - this.cycleStartedAt >= MIN_CYCLE_MS;
          const spaced = this.lastRepAt === null || now - this.lastRepAt >= MIN_BETWEEN_REPS_MS;
          if (enoughTime && spaced) {
            this.reps += 1;
            this.lastRepAt = now;
          }
          this.cycleStartedAt = null;
          this.transition('ready');
        }
        break;
    }

    const guidance: Record<Exclude<SquatPhase, 'tracking_lost'>, string> = {
      waiting: 'Stand upright and keep both legs visible to arm the counter.',
      ready: 'Ready · bend your knees to begin a squat.',
      descending: 'Descending · continue until both knees bend sufficiently.',
      bottom: 'Bottom reached · return to standing to complete the repetition.',
      ascending: 'Ascending · return to a stable upright position.'
    };
    return this.snapshot(this.phase, true, guidance[this.phase]);
  }
}
