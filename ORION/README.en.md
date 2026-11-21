# ORION

[Português (Brasil)](README.md) · **English**

ORION is a research prototype for recording astronaut body measurements, tracking exercise movement, and viewing smartwatch observations. It was developed for the NASA Space Apps Challenge 2026 challenge **Create Health Monitoring Software for Astronauts on Space Missions**. Its movement metrics are experimental, and workout drafts require professional review. [NASA Space Apps challenge](https://www.spaceappschallenge.org/2026/challenges/health-monitoring-software/)

## Install and run

On Ubuntu, use Python 3.12 with `venv`, Node.js 24 or later, npm, curl, and flock. Open a terminal in the directory containing this README:

```bash
bash setup.sh
bash start.sh
```

Open [the ORION dashboard](http://127.0.0.1:5173/). The API listens on port 8000. The core application starts without a Gemini key, a watch, or the YOLO runtime. Logs are in `.runtime/`. Press Ctrl+C in the startup terminal or run `bash stop.sh` from another terminal.

| Directory | Contents |
| --- | --- |
| `frontend/` | React, TypeScript, Vite, and the dashboard |
| `backend/` | FastAPI, SQLAlchemy, SQLite migrations, Gemini, and optional YOLO inference |
| `wearable/receiver/` | Node.js watch receiver and its SQLite storage |
| `scripts/` | Environment, dataset audit, and training-copy tools |
| `data/` | Local datasets, models, and private SQLite databases |
| `docs/` | [API contracts](docs/API_CONTRACTS.md), [movement rules](docs/MOVEMENT.md), and [validation results](docs/VALIDATION.md) |

## Use the dashboard

1. In **Overview**, enter a pseudonym and click **Create profile**. Copy the **Profile ID** to reopen the profile using **Find profile**.
2. In **Body Profile**, enter height and weight. For a fictional test, enter 5 ft, 10 in, and 165 lb. Circumferences in inches are optional. Click **Save local measurement**. SQLite stores values in centimeters and kilograms.
3. In **Body Atlas**, switch between **Front** and **Back** and select a region. A saved circumference appears for the corresponding region.
4. In **History**, check measurements, workout drafts, exercise sessions, and wearable readings for the active profile. Use **Change profile** in **Overview** to switch crew members.

### Generate and review a workout

In the private `.env` file, set `ORION_AI_ENABLED=1` and configure `GEMINI_API_KEY`. The default model is `gemini-3.5-flash-lite`; set `ORION_AI_MODEL` to change it. Restart ORION. [Gemini model documentation](https://ai.google.dev/gemini-api/docs/models)

1. Select a profile with height and weight recorded. In **AI Workout Planner**, enter availability, equipment, and safety answers.
2. Consent to external processing and click **Generate workout draft**. ORION excludes the crew UUID from the provider request.
3. After a qualified professional approves the draft, record the reviewer's name and confirmation in **History** using **Record review**.
4. In **Movement**, choose a corresponding exercise. A reviewed squat or knee-extension draft can be selected in **Reviewed workout**.

### Record movement

1. Select a crew profile and open **Movement**. Choose an exercise, tracking side when applicable, and **Pose model**.
2. Click **Enable camera**, grant browser permission, and position the relevant body region in view.
3. Click **Start server session** and **Start pose tracking**. Use **Record set** after each set of valid repetitions.
4. Click **Finish server session**. Open **History** to inspect the session, sets, and recorded movement measurements.

### Connect a Galaxy Watch4

1. In `.env`, set the profile UUID in `ORION_WATCH_ATHLETE_ID` and configure `ORION_WATCH_DEVICE_ID`.
2. Configure a shared token of at least 32 characters in the watch app and in the receiver via `ORION_WATCH_TOKEN_FILE` or `ORION_WATCH_TOKEN`. Keep token files private with permissions `0600`.
3. Connect both devices to the same trusted private network. For local network reception, use `ORION_WATCH_HOST=0.0.0.0` and `ORION_WATCH_PORT=8001`. Configure the installed watch app with `http://COMPUTER_LOCAL_IP:8001` and the same token. Grant the sensor permissions requested by the watch app.
4. Restart ORION and open **ORION Wear**. The panel shows BPM, the latest available SpO₂, observation duration, and receipt time. The receiver uses authenticated `POST /api/saude` and `GET /api/saude`. The Wear OS source and APK were unavailable in the audited project export.

## Download and configure the dataset

1. Use the included `data/datasets/Orion_dataset` directory when present. For the original distribution, download the team's data from [the ORION dataset folder on Google Drive](https://drive.google.com/drive/u/0/folders/1wpiZ1MkQ2vvVa4rKYaR_v4T7N0s6r_JS). If Drive asks for permission, request access from the folder owner.
2. Extract the download if needed. Locate the `Orion_dataset` directory containing `data.yaml` and `fitness_pose/`, then preserve its structure.
3. Place that directory at `data/datasets/Orion_dataset` or set `ORION_DATASET_DIR` in the private `.env` file to its location. Use the checked-in training files and checkpoints or point the app to a separate local copy.

For YOLO, set `ORION_ENABLE_YOLO=1` and run `bash setup.sh` again. The default checkpoint is `fitness_pose/runs/pose/squat_finetune/weights/best.pt`. `ORION_POSE_WEIGHTS` overrides the checkpoint. Use `ORION_POSE_DEVICE=cpu` or set `auto` to try CUDA with CPU fallback. CUDA requires a suitable PyTorch wheel index and a working NVIDIA driver.

MediaPipe uses the team's Full task file by default and falls back to the official Lite model if the backend is unavailable or has no local model. To test Heavy, set `ORION_MEDIAPIPE_MODEL=fitness_pose/models/mediapipe/pose_landmarker_heavy.task` in `.env` and restart ORION. The panel identifies the active model as **MEDIAPIPE FULL**, **MEDIAPIPE HEAVY**, or **MEDIAPIPE LITE**. The browser loads the pinned Tasks Vision 0.10.21 runtime on demand. For offline runtime files, place `vision_bundle.mjs` and `wasm/` in `frontend/public/mediapipe-runtime/` and set `VITE_MEDIAPIPE_RUNTIME=/mediapipe-runtime`. Select **MediaPipe** and enable **Compare YOLO overlay** to display both engines from the same camera. The selected primary engine supplies the session measurements. [MediaPipe Pose Landmarker for web](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker/web_js)

### Audit or prepare a training copy

```bash
(
  source scripts/environment.sh
  python3 scripts/audit_dataset.py "$ORION_DATASET_DIR"
)
```

To stage a portable copy for evaluation or fine-tuning, use the command below after reviewing the audit. Choose a new output directory on each run.

```bash
(
  source scripts/environment.sh
  python3 scripts/prepare_squat_dataset.py "$ORION_DATASET_DIR" data/squat-training
)
```

The [Portuguese README](README.md#visão-computacional-e-treinamento) includes the exact Ultralytics validation and fine-tuning commands and the checkpoint resume conditions. See [dataset findings and recorded metrics](docs/VALIDATION.md).

## Test ORION

### Manual checks

Start the application and check API health in another terminal:

```bash
curl --fail --silent --show-error http://127.0.0.1:8000/health
curl --fail --silent --show-error http://127.0.0.1:8000/ready
```

Expect `"status":"ok"` from health and `"status":"ready"` with `"database":"ok"` from readiness.

| Test | Expected result |
| --- | --- |
| Create two fictional profiles and persist a body measurement for the first | The entry survives a reload and appears only under the first profile. |
| Generate a workout draft with consent and a configured Gemini key | The draft appears for review. With consent unchecked, the submit button stays disabled. |
| Record and finish a Movement session with a configured camera and pose engine | Tracking loss is indicated when the subject leaves view. The finished session and marked sets appear in History. |
| Open ORION Wear without an associated receiver, then test with a configured watch | The panel reports availability. With the watch connected, incoming readings update the receipt time and become stale after updates stop. |

### Automated tests

Run from the directory containing this README after setup:

```bash
(cd frontend && npm run build && npm run lint && npm test)
.venv/bin/pip install -r backend/requirements-test.txt
.venv/bin/python backend/tests/check_core.py
(cd wearable/receiver && npm test)
```

The core check uses a temporary SQLite database and a simulated Gemini provider. Look for `Core ASGI/SQLite integration passed`. If local sockets are blocked, use the in-process receiver tests:

```bash
(cd wearable/receiver && node --test server/watch-handler.test.mjs server/exercise-store.test.mjs server/wellness-store.test.mjs)
```

With the dataset and YOLO runtime installed, and local sockets available, run inference and API integration checks:

```bash
(
  source scripts/environment.sh
  .venv-yolo/bin/python backend/tests/integration_check.py
)
```

The test uses an image from the local validation split. It checks the YOLO `lifter` class, the normalized bounding box, all 15 keypoints, the empty response for frames without a pose, delivery of the configured MediaPipe model, and session persistence in a temporary SQLite database. Add `--image "/path/to/validation-image.jpg"` to select another image.

YOLO was validated on dataset images in CPU mode and on an RTX 3050 Laptop GPU. MediaPipe Full and Heavy detected body landmarks from the physical webcam in short trials. YOLO detection from the webcam, repetition counting, and saving a set during a real exercise still need validation. Use the manual **Movement** scenario to run the pending checks. [Observed test results and remaining checks](docs/VALIDATION.md)

## Storage and troubleshooting

The default database is `data/orion.sqlite`; set `ORION_DB_PATH` to reuse a prior database. Setup backs up an existing database before migration. Wear uses a separate database for the configured crew member. Keep `.env`, tokens, and databases private.

- **Port or startup error:** check `.runtime/backend.log` and `.runtime/frontend.log`. Verify ports 8000 and 5173 are available.
- **Database unavailable:** check `ORION_DB_PATH` and rerun setup to apply migrations.
- **Camera unavailable:** check browser permission, then verify the configured pose runtime and model file.
- **Wear unavailable:** check the receiver log, profile UUID, host and port, and the shared token on both devices.
