"""Exercise the real FastAPI ASGI app against a migrated temporary SQLite database."""
import asyncio
from datetime import UTC, datetime
import importlib
import json
import os
from pathlib import Path
import selectors
import sqlite3
import subprocess
import sys
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch
from uuid import uuid4

import httpx

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
LEGACY_ID = "00000000-0000-0000-0000-000000000001"


class PollingSelector(selectors.DefaultSelector):
    # Also poll callbacks when a restricted environment suppresses self-pipe wakeups.
    def select(self, timeout=None):
        return super().select(0.02 if timeout is None else min(timeout, 0.02))


def run(coroutine):
    return asyncio.run(coroutine, loop_factory=lambda: asyncio.SelectorEventLoop(PollingSelector()))


async def check(app):
    from test_exercise_advisor import payload
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://orion") as client:
        async def request(method, route, status=200, body=None):
            response = await client.request(method, route, json=body)
            assert response.status_code == status, (route, response.status_code, response.text)
            return response.json()

        await request("GET", "/ready")
        astronauts = "/api/v1/athletes"
        athlete = (await request("POST", astronauts, 201, {"pseudonym": "Synthetic astronaut"}))["id"]
        other = f"{astronauts}/{LEGACY_ID}"
        profile = f"{astronauts}/{athlete}"
        sessions = "/api/v1/sessions"
        assert (await request("GET", f"{sessions}?athlete_id={LEGACY_ID}"))[0]["rep_count"] == 3
        assert (await request("GET", f"{sessions}/00000000-0000-0000-0000-000000000002/samples"))[0]["frame_id"] == 1
        record_id = str(uuid4())
        record = {"id": record_id, "athleteId": athlete, "recordedAt": datetime.now(UTC).isoformat(),
                  "heightCm": 180, "weightKg": 75, "rightThighCm": 45}
        await request("POST", f"{profile}/measurements", 201, record)
        await request("POST", f"{other}/measurements", 422, record)
        assert await request("GET", f"{other}/measurements") == []
        await request("DELETE", f"{other}/measurements/{record_id}", 404)
        assert (await request("GET", f"{profile}/measurements"))[0]["weightKg"] == 75
        await request("DELETE", f"{profile}/measurements/{record_id}")
        assert await request("GET", f"{profile}/measurements") == []

        planner = "/api/v1/advisor/exercise-options"
        generated = {
            "summary": "Synthetic draft", "limitations": "Review required", "sessions_per_week": 2,
            "options": [{"exercise_id": "knee_extension", "rationale": "Fixture", "caution": "Fixture",
                         "sets": 2, "repetitions_per_set": 10, "rest_seconds": 90}],
        }
        with patch.dict(os.environ, {"ORION_AI_ENABLED": "1", "GEMINI_API_KEY": "fixture"}):
            with patch("exercise_advisor._call_model", return_value=generated):
                await request("POST", planner, body=payload(athlete_id=athlete, equipment=["resistance_device"]))
            with patch("exercise_advisor._call_model", side_effect=TimeoutError):
                await request("POST", planner, 502, payload(athlete_id=athlete))
        assert await request("GET", f"{other}/plans") == []
        plan = (await request("GET", f"{profile}/plans"))[0]["id"]
        session = {"athlete_id": athlete, "exercise_code": "knee", "protocol_id": "KNEE-01",
                   "pose_engine": "mediapipe", "tracked_side": "left", "plan_id": plan}
        await request("POST", sessions, 422, session)
        review = {"reviewer": "Synthetic professional", "professionally_reviewed": True}
        await request("POST", f"{other}/plans/{plan}/review", 404, review)
        await request("POST", f"{profile}/plans/{plan}/review", body=review)
        created = await request("POST", sessions, 201, session)
        route = f"{sessions}/{created['session_id']}/finish"
        assessment = {"assessment_source": "biomechanical_rules", "rules_version": "orion-2d-v1",
                      "repetitions": 2, "valid_repetitions": 2, "tracking_quality": 0.9, "feedback": []}
        finish = {"result": assessment, "samples": [], "sets": [1, 1]}
        await request("POST", route, 422, {**finish, "sets": [3]})
        assert (await request("POST", route, body=finish))["sets"] == [1, 1]
        assert (await request("POST", route))["rep_count"] == 2
        saved = (await request("GET", f"{sessions}?athlete_id={athlete}"))[0]
        assert saved["plan_id"] == plan and saved["sets"] == [1, 1]
        assert await request("GET", f"{profile}/wear") == {"configured": False}
        with patch.dict(os.environ, {"ORION_WATCH_ATHLETE_ID": athlete, "ORION_WATCH_TOKEN": "x" * 32}):
            from io import BytesIO
            received = int(datetime.fromisoformat(created["started_at_utc"]).timestamp() * 1000)
            responses = [{"athleteId": athlete, "deviceId": "galaxy-watch4"},
                         {"readings": [{"measured_at": received}, {"measured_at": None}]}]
            with patch("wear_api.urlopen", side_effect=[BytesIO(json.dumps(row).encode()) for row in responses]):
                wear = await request("GET", f"{profile}/wear")
                assert wear["history"]["readings"][0]["exercise_session_id"] == created["session_id"]
                assert wear["history"]["readings"][1]["exercise_session_id"] is None
            assert await request("GET", f"{other}/wear") == {"configured": False}
        if os.getenv("ORION_DATASET_DIR"):
            mediapipe = await request("GET", "/api/v1/pose/mediapipe")
            model = await client.get(mediapipe["asset"])
            assert model.status_code == 200 and len(model.content) > 1_000_000



def run_advisor_suite():
    tests = importlib.import_module("test_exercise_advisor")

    class Client:
        def post(self, url, json):
            async def send():
                async with httpx.AsyncClient(transport=httpx.ASGITransport(app=tests.app), base_url="http://orion") as client:
                    return await client.post(url, json=json)
            return run(send())

    with patch.object(tests, "client", Client()):
        result = unittest.TextTestRunner(verbosity=1).run(unittest.defaultTestLoader.loadTestsFromModule(tests))
        assert result.wasSuccessful()


def main():
    with TemporaryDirectory(prefix="orion-core-") as temp:
        database = Path(temp) / "test.sqlite"
        os.environ["ORION_DB_PATH"] = str(database)
        subprocess.run([sys.executable, "-m", "alembic", "upgrade", "63742b726502"], cwd=BACKEND, check=True)
        with sqlite3.connect(database) as connection:
            stamp = "2026-01-01T00:00:00+00:00"
            connection.execute("INSERT INTO athletes VALUES (?, 'Legacy fixture', ?)", (LEGACY_ID, stamp))
            connection.execute("""INSERT INTO exercise_sessions
                (id, athlete_id, exercise_code, protocol_id, protocol_version, started_at, ended_at, status, rep_count)
                VALUES ('00000000-0000-0000-0000-000000000002', ?, 'squat', 'SQUAT-01', '1', ?, ?, 'finished', 3)""", (LEGACY_ID, stamp, stamp))
            connection.execute("""INSERT INTO motion_samples
                (id,session_id,frame_id,captured_at,quality,angles_json,image_width,image_height,landmarks_version)
                VALUES ('legacy-frame','00000000-0000-0000-0000-000000000002',1,?,0.9,'{"leftKnee": 90}',640,480,'legacy')""", (stamp,))
        subprocess.run([sys.executable, "-m", "alembic", "upgrade", "head"], cwd=BACKEND, check=True)
        from main import app
        run(check(app))
        run_advisor_suite()
        print("Core ASGI/SQLite integration passed, including legacy rows, reviewed plans, sets, and simulated Wear association.")


if __name__ == "__main__":
    main()
