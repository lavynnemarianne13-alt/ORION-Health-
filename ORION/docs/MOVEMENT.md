# Pose models and movement rules

## Dataset audit

The default candidate is `fitness_pose/runs/pose/squat_finetune/weights/best.pt`, trained with YOLOv8n-Pose and Ultralytics 8.4.213. The class is `lifter` with a `[15, 3]` pose layout. The six trained checkpoints passed archive CRC checks. The validation report records the split audit, evaluation scope, and limitations.

### Joint mapping

The project's `prepare_custom_dataset.py` defines the anatomical order. The shared overlay and angle code uses these corresponding array indices:

| Joints | Orion (left / right) | MediaPipe (left / right) |
|---|---|---|
| Shoulders | 1 / 2 | 11 / 12 |
| Elbows | 3 / 4 | 13 / 14 |
| Wrists | 5 / 6 | 15 / 16 |
| Hips | 7 / 8 | 23 / 24 |
| Knees | 9 / 10 | 25 / 26 |
| Ankles | 11 / 12 | 27 / 28 |

The Orion head and proxy hand annotations have no mapped slot. Unmapped landmarks and scores below 0.55 are unavailable. Angles use aspect-corrected image coordinates. YOLO provides keypoint confidence and MediaPipe supplies landmark visibility. These are model-specific scores.

MediaPipe uses the supplied `fitness_pose/models/mediapipe/pose_landmarker_full.task` by default. The browser loads the pinned MediaPipe Web runtime and its WASM on demand, from a configurable URL. If the local task is unavailable, standalone browser tracking can load Google's Lite model over the internet. A worker processes frames where supported, with a throttled browser-thread fallback. YOLO uses bounded JPEG requests and a single in-flight prediction per browser tracker. Boxes below a confidence of 0.40 are omitted. In comparison mode, both predictions share one camera and a capture callback. The secondary YOLO skeleton and box render in amber. The primary engine controls counts, angles, and session records.

## Rule evaluation

The browser tracks each supported exercise as a sequence from a stable start through a target position and back. These are experimental movement rules for projected joint angles.

| Exercise | Joint and starting angle | Target angle | Additional feedback |
|---|---|---|---|
| Bodyweight squat | Mean of both knee angles, at least 160° | At most 110° | At the bottom, a projected left/right knee difference above 15° flags the attempt |
| Biceps curl | Elbow on the selected side, at least 155° | At most 75° | Range and cycle timing |
| Lateral shoulder raise | Hip–shoulder–elbow angle on the selected side, at most 30° | At least 70° | Range and cycle timing |
| Seated knee extension | Knee on the selected side, at most 110° | At least 155° | Range and cycle timing |

A completed attempt crosses the movement trigger, then returns to the starting position. A valid attempt also reaches the target and satisfies the configured stability and timing. The counters use short stability holds, a minimum 650 ms cycle, and a 12 s cycle timeout. Tracking gaps longer than 650 ms interrupt unfinished cycles. Deadlifts and calf raises provide pose preview.

The assessment reports `insufficient_data` until at least one completed attempt, `needs_correction` when any completed attempt misses a rule, and `meets_configured_rules` when all completed attempts pass. `tracking_quality` is the fraction of processed frames usable by the selected exercise rules. The stored angular trajectory is a timestamped sequence of available angles, initially sampled at most twice per second, with adaptive downsampling above 900 samples. The rules do not evaluate out-of-plane motion, loading, or injury risk.

Started sessions are saved immediately. Derived measurements, explicitly marked sets, and the assessment are committed together at finish. An unfinished capture remains in app memory during navigation. Reloading or closing the app discards unsaved measurements. The existing session record can still be resumed.

[MediaPipe Pose Landmarker web guide](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker?tab=Web)
