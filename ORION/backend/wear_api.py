from datetime import datetime
import json
import os
from pathlib import Path
from urllib.error import URLError
from urllib.request import Request, urlopen
from uuid import UUID

from fastapi import APIRouter, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from crew_records import require_athlete
from database import engine
from models import ExerciseSession

router = APIRouter(prefix="/api/v1/athletes/{athlete_id}/wear", tags=["wear"])


def watch_token():
    value = os.getenv("ORION_WATCH_TOKEN", "").strip()
    if value:
        return value
    path = os.getenv("ORION_WATCH_TOKEN_FILE")
    if path:
        try:
            return Path(path).read_text().strip()
        except OSError:
            pass
    return ""


@router.get("")
def wear_history(athlete_id: UUID):
    with Session(engine) as db:
        require_athlete(db, athlete_id)
        sessions = db.execute(select(ExerciseSession.id, ExerciseSession.started_at, ExerciseSession.ended_at)
                              .where(ExerciseSession.athlete_id == str(athlete_id), ExerciseSession.status == "finished")).all()
    token = watch_token()
    if str(athlete_id) != os.getenv("ORION_WATCH_ATHLETE_ID") or len(token) < 32:
        return {"configured": False}
    receiver = os.getenv("ORION_WATCH_RECEIVER", "http://127.0.0.1:8001").rstrip("/")
    headers = {"Authorization": f"Bearer {token}"}
    try:
        with urlopen(Request(f"{receiver}/api/saude", headers=headers), timeout=2) as response:
            latest = json.loads(response.read(64 * 1024))
        if latest.get("athleteId") != str(athlete_id) or latest.get("deviceId") != os.getenv("ORION_WATCH_DEVICE_ID", "galaxy-watch4"):
            raise HTTPException(503, "Watch receiver association does not match the selected crew profile.")
        with urlopen(Request(f"{receiver}/api/watch/history?limit=50", headers=headers), timeout=2) as response:
            history = json.loads(response.read(128 * 1024))
    except (URLError, OSError, ValueError) as error:
        raise HTTPException(503, "Watch receiver unavailable.") from error
    intervals = [(key, datetime.fromisoformat(start).timestamp() * 1000,
                  datetime.fromisoformat(end).timestamp() * 1000) for key, start, end in sessions if end]
    for reading in history["readings"]:
        measured = reading.get("measured_at")
        matches = [key for key, start, end in intervals if measured is not None and start <= measured <= end]
        reading["exercise_session_id"] = matches[0] if len(matches) == 1 else None
    return {"configured": True, "latest": latest, "history": history}
