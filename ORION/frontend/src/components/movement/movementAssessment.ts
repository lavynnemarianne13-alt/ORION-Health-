import type { AssessmentReport, FeedbackCode } from '../../types/backend';
import type { CounterMetrics, CounterSnapshot, ExerciseCode } from './exerciseCounter';

export const feedbackText: Record<FeedbackCode, string> = {
  range_or_tempo: 'One or more attempts missed the configured range or timing. Reach the target position, then return steadily.',
  squat_asymmetry: 'The projected knee angles differed by more than 15° near the bottom. Check your stance and camera alignment.',
};

export class MovementAssessment {
  private frames = 0;
  private trackedFrames = 0;
  private attempts = 0;
  private rangeReps = 0;
  private validReps = 0;
  private asymmetricBottom = false;
  private previousPhase: string | null = null;
  private feedback = new Set<FeedbackCode>();

  interrupt() {
    this.asymmetricBottom = false;
  }

  update(exercise: ExerciseCode, metrics: CounterMetrics | null, snapshot: CounterSnapshot | null) {
    this.frames += 1;
    if (snapshot?.trackingValid) this.trackedFrames += 1;
    if (!snapshot) return;

    if (snapshot.phase === 'waiting' || snapshot.phase === 'descending' && this.previousPhase === 'ready') {
      this.asymmetricBottom = false;
    }
    this.previousPhase = snapshot.phase;
    if (exercise === 'squat' && snapshot.trackingValid && metrics
        && metrics.leftKnee !== null && metrics.rightKnee !== null
        && (metrics.leftKnee + metrics.rightKnee) / 2 <= 115
        && ['descending', 'bottom', 'ascending'].includes(snapshot.phase)) {
      this.asymmetricBottom ||= Math.abs(metrics.leftKnee - metrics.rightKnee) > 15;
    }
    if (snapshot.attempts === this.attempts) return;

    const passesRange = snapshot.reps > this.rangeReps;
    if (!passesRange) this.feedback.add('range_or_tempo');
    if (this.asymmetricBottom) this.feedback.add('squat_asymmetry');
    if (passesRange && !this.asymmetricBottom) this.validReps += 1;
    this.attempts = snapshot.attempts;
    this.rangeReps = snapshot.reps;
    this.asymmetricBottom = false;
  }

  report(): AssessmentReport {
    return {
      assessment_source: 'biomechanical_rules',
      rules_version: 'orion-2d-v1',
      repetitions: this.attempts,
      valid_repetitions: this.validReps,
      tracking_quality: this.frames ? this.trackedFrames / this.frames : null,
      feedback: [...this.feedback],
    };
  }
}
