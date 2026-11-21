"""Run against a fresh SQLite database and a real local ORION server."""

import argparse
import io
import json
import os
import sqlite3
import subprocess
import sys
import time
from threading import Thread
from pathlib import Path
from tempfile import TemporaryDirectory
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from PIL import Image
import uvicorn

BACKEND = Path(__file__).resolve().parents[1]


def check(base, dataset, image_path):
    def request(path, *, payload=None, raw=None, content_type=None, status=200):
        body = raw
        if payload is not None:
            body = json.dumps(payload).encode()
            content_type = "application/json"
        headers = {"Content-Type": content_type} if content_type else {}
        try:
            response = urlopen(Request(base + path, data=body, headers=headers), timeout=30)
        except HTTPError as error:
            response = error
        with response:
            content = response.read()
            assert response.code == status, (path, response.code, content[:500])
            return json.loads(content) if "json" in response.headers.get("content-type", "") else content

    for _ in range(60):
        try:
            assert request("/health") == {"status": "ok"}
            break
        except URLError:
            time.sleep(0.25)
    else:
        raise RuntimeError("The backend failed to start.")
    assert request("/ready")["database"] == "ok"
    migrated = request("/api/v1/sessions?athlete_id=00000000-0000-0000-0000-000000000001")
    assert migrated[0]["rep_count"] == 3 and migrated[0]["assessment_result"] is None

    pose = request("/api/v1/pose/model")
    assert pose["keypoints"] == 15
    assert pose["landmarks_version"].startswith("orion-yolo-pose-15-")
    mp = request("/api/v1/pose/mediapipe")
    assert mp["keypoints"] == 33 and len(request(mp["asset"])) > 1_000_000

    def jpeg(image):
        output = io.BytesIO()
        image.thumbnail((640, 640))
        image.convert("RGB").save(output, format="JPEG")
        return output.getvalue()

    route = "/api/v1/pose/frame"
    request(route, raw=b"bad", content_type="image/jpeg", status=422)
    request(route, raw=b"x" * (512 * 1024 + 1), content_type="image/jpeg", status=413)
    request(route, raw=b"bad", status=415)
    assert not request(route, raw=jpeg(Image.new("RGB", (640, 480))), content_type="image/jpeg")["keypoints"]
    if image_path is None:
        image_path = next(iter(sorted((dataset / "valid" / "images").glob("*.jpg"))), None)
        if image_path is None:
            raise RuntimeError("Set --image to a valid ORION validation image.")
    with Image.open(image_path) as image:
        points = request(route, raw=jpeg(image), content_type="image/jpeg")["keypoints"]
    assert len(points) == 15 and all(0 <= point["visibility"] <= 1 for point in points)
    print(f"Real YOLO inference on {pose['device']}: 15 keypoints; MediaPipe Full asset served.")

    athlete = request("/api/v1/athletes", payload={"pseudonym": "Integration Test"}, status=201)
    creation = {"athlete_id": athlete["id"], "exercise_code": "curl", "protocol_id": "CURL-01",
                "pose_engine": "orion", "tracked_side": "left"}
    session = request("/api/v1/sessions", payload=creation, status=201)
    path = "/api/v1/sessions/" + session["session_id"]
    sample = {
        "frame_id": 1, "captured_at_utc": "2026-11-15T12:00:00Z", "pose_quality": 0.8,
        "angles_deg": {"leftElbow": 70}, "image_width": 640, "image_height": 480,
        "landmarks_version": pose["landmarks_version"],
    }
    report = {
        "assessment_source": "biomechanical_rules", "rules_version": "orion-2d-v1",
        "repetitions": 2, "valid_repetitions": 1, "tracking_quality": 0.9, "feedback": ["range_or_tempo"],
    }
    payload = {"result": report, "samples": [sample, sample]}
    mixed_engine = {"result": report, "samples": [{**sample, "landmarks_version": "mediapipe-full"}]}
    request(path + "/finish", payload=mixed_engine, status=422)
    assert request(path + "/samples") == []
    assert request(path + "/samples", payload={"samples": [sample]})["inserted"] == 1
    finished = request(path + "/finish", payload=payload)
    assert finished["rep_count"] == 1 and finished["assessment_result"]["assessment"] == "needs_correction"
    assert request(path + "/finish", raw=b"") == finished
    assert len(request(path + "/samples")) == 1
    history = request("/api/v1/sessions?athlete_id=" + athlete["id"])
    assert history[0]["exercise_code"] == "curl" and history[0]["pose_engine"] == "orion"
    assert history[0]["assessment_result"] == finished["assessment_result"]
    assert history[0]["duration_seconds"] >= 0
    legacy = request("/api/v1/sessions", payload={
        "athlete_id": athlete["id"], "exercise_code": "squat", "protocol_id": "SQUAT-01",
    }, status=201)
    assert request("/api/v1/sessions/" + legacy["session_id"] + "/finish", raw=b"")["assessment_result"] is None
    print("Real API and SQLite passed: migration, profiles, session lifecycle, rollback, deduplication, history.")
    print("Movement assessment values in the SQLite check were fixtures.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image", type=Path, help="Optional validation image for a relocated dataset.")
    parser.add_argument("--port", default=18000, type=int)
    args = parser.parse_args()
    dataset = Path(os.environ["ORION_DATASET_DIR"]).resolve()
    with TemporaryDirectory(prefix="orion-test-") as temp:
        os.environ.update(ORION_DB_PATH=str(Path(temp) / "test.db"),
                          YOLO_CONFIG_DIR=str(Path(temp) / "ultralytics"))
        subprocess.run([sys.executable, "-m", "alembic", "upgrade", "63742b726502"], cwd=BACKEND, check=True)
        connection = sqlite3.connect(os.environ["ORION_DB_PATH"])
        with connection:
            connection.execute(
                "INSERT INTO athletes (id, pseudonym, created_at) VALUES (?, ?, ?)",
                ("00000000-0000-0000-0000-000000000001", "Existing Profile", "2026-11-15T12:00:00+00:00"),
            )
            connection.execute("""
                INSERT INTO exercise_sessions
                (id, athlete_id, exercise_code, protocol_id, protocol_version, started_at, ended_at, status, rep_count)
                VALUES ('legacy-squat', '00000000-0000-0000-0000-000000000001', 'squat', 'SQUAT-01', '1',
                        '2026-11-15T12:00:00+00:00', '2026-11-15T12:00:10+00:00', 'finished', 3)
            """)
        connection.close()
        subprocess.run([sys.executable, "-m", "alembic", "upgrade", "head"], cwd=BACKEND, check=True)
        sys.path.insert(0, str(BACKEND))
        from database import engine

        server = uvicorn.Server(uvicorn.Config("main:app", host="127.0.0.1", port=args.port, access_log=False))
        thread = Thread(target=server.run, daemon=True)
        thread.start()
        try:
            check(f"http://127.0.0.1:{args.port}", dataset, args.image)
        finally:
            server.should_exit = True
            thread.join(timeout=10)
            engine.dispose()


if __name__ == "__main__":
    main()
