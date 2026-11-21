# API contracts

| Method | Route | Purpose |
|---|---|---|
| GET | `/health` | Check that the API is running |
| GET | `/ready` | Check that the three required SQLite tables exist |
| POST | `/api/v1/athletes` | Register a pseudonym with `{"pseudonym":"Crew One"}` |
| GET | `/api/v1/athletes/{uuid}` | Look up an athlete by UUID |
| POST | `/api/v1/sessions` | Create an exercise session with `{"athlete_id":"<uuid>","exercise_code":"squat","protocol_id":"SQUAT-01"}` |
| GET | `/api/v1/sessions?athlete_id=<uuid>&limit=20&offset=0` | List sessions for an athlete |
| POST | `/api/v1/sessions/{uuid}/samples` | Submit 1–50 recorded motion samples |
| GET | `/api/v1/sessions/{uuid}/samples?limit=25&offset=0` | Retrieve saved joint measurements |
| POST | `/api/v1/sessions/{uuid}/finish` | Finish a session and optionally save its assessment and measurements |
| GET | `/api/v1/pose/model` | Load the configured YOLO-Pose checkpoint and return model information |
| GET | `/api/v1/pose/mediapipe` | Check availability of the local MediaPipe Full model |
| GET | `/api/v1/pose/mediapipe/asset` | Serve the local MediaPipe task file |
| POST | `/api/v1/pose/frame` | Process a JPEG frame and return normalized pose keypoints |

## Motion sample format

```json
{
  "frame_id": 1,
  "captured_at_utc": "2026-11-15T12:00:00Z",
  "pose_quality": 0.9,
  "angles_deg": {"left_knee": 92.5},
  "image_width": 1280,
  "image_height": 720,
  "landmarks_version": "mediapipe-pose-<actual-version>"
}
```

These values illustrate the format. Import recordings as a JSON array or an object with a `samples` array. The API stores at most one record per `frame_id` within a session.

## Pose frame format

Send raw JPEG bytes with `Content-Type: image/jpeg`. The limit is 512 KiB and 1,280 pixels on either side. The response contains a `keypoints` array with 15 points in Orion Dataset order when a person is detected. Each point includes normalized `x` and `y` coordinates and a `visibility` score. The API returns an empty array when it detects no pose.

## Frontend and storage

- Vite forwards requests under `/backend-api` to the configured API, which runs on port 8000 by default.
- The frontend stores the active athlete UUID for the current tab in `sessionStorage`.
- The motion sample interface reports the number of inserted records. The pose endpoint processes frames in memory.
- Apply the SQLite migrations with `alembic upgrade head` in `backend`. Until then, `/ready` returns HTTP 503.

## Live session recording

Send the exercise and its protocol when creating the session: `squat / SQUAT-01`, `curl / CURL-01`, `shoulder / SHOULDER-01`, or `knee / KNEE-01`. Set `pose_engine` to `orion` or `mediapipe` and include `tracked_side` (left or right) for a recorded unilateral exercise.

The finish endpoint accepts `{"result": {...}, "samples": [...]}`, with up to 900 derived measurements. The result includes `assessment_source` (`biomechanical_rules`), `rules_version` (`orion-2d-v1`), `repetitions` (completed attempts), `valid_repetitions`, `tracking_quality` (number from zero to one or null), and a `feedback` array of rule codes. The API assigns the assessment status and writes the report, measurements, and finish time in the same transaction. A retry returns the original finished result. Legacy clients may finish a session with an empty body.

History returns the engine, tracked side, elapsed duration, valid repetition count, and assessment result. Older sessions can have null engine or result values.

## Crew workspace additions

| Method | Route | Behavior |
|---|---|---|
| GET, POST | `/api/v1/athletes/{athlete_id}/measurements` | Read and create metric anthropometry records for the selected crew member. |
| DELETE | `/api/v1/athletes/{athlete_id}/measurements/{record_id}` | Delete the indicated measurement if it belongs to the crew member. |
| GET | `/api/v1/athletes/{athlete_id}/plans` | List validated local workout drafts and recorded reviews. |
| POST | `/api/v1/athletes/{athlete_id}/plans/{plan_id}/review` | Record a professional review declaration with `reviewer` and `professionally_reviewed`. |
| GET | `/api/v1/athletes/{athlete_id}/wear` | Return bound receiver history and recent metrics, or `configured: false`. |

Workout drafts are associated via the optional `athlete_id` on the advisor request. Session creation accepts `plan_id` for reviewed plans with a corresponding exercise. Session completion accepts `sets`, an ordered list of positive counts of valid repetitions. YOLO's frame response includes optional `detection` with class, confidence, and normalized `[left, top, right, bottom]` coordinates.
