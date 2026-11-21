export type PoseEngine = 'orion' | 'mediapipe';
export type FeedbackCode = 'range_or_tempo' | 'squat_asymmetry';
export type AssessmentReport = {
  assessment_source: 'biomechanical_rules';
  rules_version: 'orion-2d-v1';
  repetitions: number;
  valid_repetitions: number;
  tracking_quality: number | null;
  feedback: FeedbackCode[];
};
export type SavedAssessment = AssessmentReport & {
  assessment: 'insufficient_data' | 'needs_correction' | 'meets_configured_rules';
};
export type Athlete = { id: string; pseudonym: string; created_at: string };
export type SessionStatus = 'in_progress' | 'finished' | 'cancelled';
export type ExerciseSession = {
  session_id: string;
  exercise_code: string;
  protocol_id: string;
  status: SessionStatus;
  started_at_utc: string;
  ended_at_utc: string | null;
  rep_count: number;
  pose_engine: PoseEngine | null;
  tracked_side: 'left' | 'right' | null;
  assessment_result: SavedAssessment | null;
  duration_seconds: number | null;
  sets?: number[] | null;
  plan_id?: string | null;
};
export type SessionCreated = {
  session_id: string;
  status: SessionStatus;
  started_at_utc: string;
  protocol_version: string;
  pose_engine?: PoseEngine | null;
};
export type SessionFinished = {
  session_id: string;
  status: SessionStatus;
  ended_at_utc: string | null;
  rep_count: number;
  assessment_result: SavedAssessment | null;
};
export type MotionSample = {
  frame_id: number;
  captured_at_utc: string;
  pose_quality: number;
  angles_deg: Record<string, number>;
  image_width: number;
  image_height: number;
  landmarks_version: string;
};
export type MotionSampleResult = { received: number; inserted: number; duplicates: number };

export type SavedPlan = {
  id: string;
  created_at: string;
  payload: {
    summary: string;
    sessions_per_week: number | null;
    limitations: string;
    review?: { reviewer: string; at: string };
    options: { exercise_id: string; name: string; sets: number; repetitions_per_set: number; rest_seconds: number; rationale: string; caution: string }[];
  };
};
