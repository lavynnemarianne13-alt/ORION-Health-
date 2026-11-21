import type { MotionSample } from '../../types/backend';
import type { ExerciseCode, ExerciseSide } from './exerciseCounter';
import { ExerciseRepCounter } from './exerciseCounter';
import { MovementAssessment } from './movementAssessment';
import type { poseMetrics } from './poseClient';

export const exerciseProtocols = { squat: 'SQUAT-01', curl: 'CURL-01', shoulder: 'SHOULDER-01', knee: 'KNEE-01' };
export function isRecordable(code: string): code is keyof typeof exerciseProtocols {
  return Object.hasOwn(exerciseProtocols, code);
}

export class MovementRecording {
  readonly counter: ExerciseRepCounter;
  readonly assessment = new MovementAssessment();
  samples: MotionSample[] = [];
  readonly sets: number[] = [];
  private lastSampleAt = -Infinity;
  private interval = 500;

  constructor(exercise: ExerciseCode, side: ExerciseSide) {
    this.counter = new ExerciseRepCounter(exercise, side);
  }

  capture(metrics: ReturnType<typeof poseMetrics>, timestamp: number, capturedAt: number,
          width: number, height: number, model: string) {
    if (timestamp - this.lastSampleAt < this.interval || metrics.averageVisibility === null) return;
    const angles = ['leftKnee', 'rightKnee', 'leftElbow', 'rightElbow', 'leftShoulder', 'rightShoulder'] as const;
    const measured = angles.flatMap(key => metrics[key] === null ? [] : [[key, metrics[key]] as const]);
    if (!measured.length) return;
    if (this.samples.length >= 900) {
      this.samples = this.samples.filter((_, index) => index % 2 === 0);
      this.interval *= 2;
    }
    this.samples.push({
      frame_id: Math.round(capturedAt * 1000),
      captured_at_utc: new Date(capturedAt).toISOString(),
      pose_quality: metrics.averageVisibility,
      angles_deg: Object.fromEntries(measured),
      image_width: width,
      image_height: height,
      landmarks_version: model,
    });
    this.lastSampleAt = timestamp;
  }
}
