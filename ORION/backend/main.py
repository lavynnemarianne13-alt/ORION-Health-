
from datetime import datetime, timezone
from typing import Any, cast
from uuid import UUID, uuid4

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, FiniteFloat
from sqlalchemy import select, update
from sqlalchemy.dialects.sqlite import insert
from sqlalchemy.engine import CursorResult
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from database import engine
from crew_records import router as crew_router
from exercise_advisor import router as exercise_advisor_router
from models import Athlete, CrewRecord, ExerciseSession, MotionSample
from movement_schemas import PROTOCOLS, MotionSampleBatch, MotionSampleCreate, PoseEngine, SessionFinish, TrackedSide
from pose_api import router as pose_router
from wear_api import router as wear_router


app = FastAPI(title="ORION")
app.include_router(exercise_advisor_router)
app.include_router(pose_router)
app.include_router(crew_router)
app.include_router(wear_router)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["Content-Type"],
)


@app.exception_handler(SQLAlchemyError)
async def database_error(_request: Request, _error: SQLAlchemyError):
    return JSONResponse(status_code=503, content={"detail": "Database operation failed. Check SQLite availability and migrations."})


@app.get("/health")
def health():
    return {"status": "ok"}

@app.get("/ready")
def ready():
    try:
        with Session(engine) as db:
            db.execute(select(Athlete.id).limit(1))
            db.execute(select(ExerciseSession.pose_engine, ExerciseSession.assessment_json).limit(1))
            db.execute(select(MotionSample.id).limit(1))
            db.execute(select(CrewRecord.id).limit(1))
    except SQLAlchemyError as error:
        raise HTTPException(
            status_code=503,
            detail="Database unavailable or schema incomplete.",
        ) from error

    return {"status": "ready", "database": "ok"}
class AthleteCreate(BaseModel):
    pseudonym: str


@app.post("/api/v1/athletes", status_code=201)
def create_athlete(payload: AthleteCreate):
    pseudonym = payload.pseudonym.strip()
    if not 1 <= len(pseudonym) <= 80:
        raise HTTPException(422, "The pseudonym must be between 1 and 80 characters.")

    athlete = Athlete(
        id=str(uuid4()),
        pseudonym=pseudonym,
        created_at=datetime.now(timezone.utc).isoformat(timespec="milliseconds"),
    )

    with Session(engine) as db:
        db.add(athlete)
        try:
            db.commit()
        except IntegrityError as error:
            db.rollback()
            if getattr(error.orig, "sqlite_errorname", None) == "SQLITE_CONSTRAINT_UNIQUE":
                raise HTTPException(409, "This pseudonym is already registered.") from error
            raise

        return {
            "id": athlete.id,
            "pseudonym": athlete.pseudonym,
            "created_at": athlete.created_at,
        }
@app.get("/api/v1/athletes/{athlete_id}")
def get_athlete(athlete_id: UUID):
    with Session(engine) as db:
        athlete = db.get(Athlete, str(athlete_id))

        if athlete is None:
            raise HTTPException(404, "Profile not found.")

        return {
            "id": athlete.id,
            "pseudonym": athlete.pseudonym,
            "created_at": athlete.created_at,
        }
class ExerciseSessionCreate(BaseModel):
    athlete_id: UUID
    exercise_code: str
    protocol_id: str
    pose_engine: PoseEngine | None = None
    tracked_side: TrackedSide | None = None
    load_kg: FiniteFloat | None = Field(default=None, ge=0)
    target_repetitions: int | None = Field(default=None, gt=0)
    plan_id: UUID | None = None


@app.post("/api/v1/sessions", status_code=201)
def create_exercise_session(payload: ExerciseSessionCreate):
    with Session(engine) as db:
        athlete_id = str(payload.athlete_id)

        if db.get(Athlete, athlete_id) is None:
            raise HTTPException(404, "Profile not found.")

        if PROTOCOLS.get(payload.exercise_code) != payload.protocol_id:
            raise HTTPException(422, "The protocol is unavailable for this exercise.")

        if payload.pose_engine and payload.exercise_code != "squat" and payload.tracked_side is None:
            raise HTTPException(422, "Select a side for this exercise.")

        if payload.plan_id:
            plan = db.get(CrewRecord, str(payload.plan_id))
            if not plan or plan.kind != "workout_plan" or plan.athlete_id != athlete_id or not plan.payload.get("review"):
                raise HTTPException(422, "Select a reviewed workout plan for this crew member.")
            supported = {"squat": "resistance_squat", "knee": "knee_extension"}
            if not any(option["exercise_id"] == supported.get(payload.exercise_code) for option in plan.payload["options"]):
                raise HTTPException(422, "This exercise is not in the reviewed workout plan.")

        session = ExerciseSession(
            id=str(uuid4()),
            athlete_id=athlete_id,
            exercise_code=payload.exercise_code,
            protocol_id=payload.protocol_id,
            protocol_version="1",
            started_at=datetime.now(timezone.utc).isoformat(timespec="milliseconds"),
            status="in_progress",
            pose_engine=payload.pose_engine,
            tracked_side=payload.tracked_side,
            load_kg=payload.load_kg,
            target_repetitions=payload.target_repetitions,
            plan_id=str(payload.plan_id) if payload.plan_id else None,
        )

        db.add(session)
        db.commit()

        return {
            "session_id": session.id,
            "status": session.status,
            "started_at_utc": session.started_at,
            "protocol_version": session.protocol_version,
            "pose_engine": session.pose_engine,
        }


def insert_motion_samples(db: Session, session_id: UUID, samples: list[MotionSampleCreate]) -> int:
    rows = [
        {
            "id": str(uuid4()),
            "session_id": str(session_id),
            "frame_id": sample.frame_id,
            "captured_at": sample.captured_at_utc.astimezone(timezone.utc).isoformat(),
            "angles_json": sample.angles_deg,
            "quality": sample.pose_quality,
            "image_width": sample.image_width,
            "image_height": sample.image_height,
            "landmarks_version": sample.landmarks_version,
        }
        for sample in samples
    ]

    statement = (
        insert(MotionSample)
        .values(rows)
        .on_conflict_do_nothing(index_elements=["session_id", "frame_id"])
    )
   
    result = cast(CursorResult[Any], db.execute(statement))
    inserted = result.rowcount
    return inserted


@app.post("/api/v1/sessions/{session_id}/samples")
def add_motion_samples(session_id: UUID, payload: MotionSampleBatch):
    with Session(engine) as db:
        db.connection().exec_driver_sql("BEGIN IMMEDIATE")
        exercise_session = db.get(ExerciseSession, str(session_id))

        if exercise_session is None:
            raise HTTPException(404, "Session not found.")

        if exercise_session.status != "in_progress":
            raise HTTPException(409, "The session must be in progress.")

        inserted = insert_motion_samples(db, session_id, payload.samples)
        db.commit()

        return {
            "received": len(payload.samples),
            "inserted": inserted,
            "duplicates": len(payload.samples) - inserted,
        }
@app.post("/api/v1/sessions/{session_id}/finish")
def finish_exercise_session(session_id: UUID, payload: SessionFinish | None = None):
    with Session(engine) as db:
        values: dict[str, Any] = {
            "status": "finished",
            "ended_at": datetime.now(timezone.utc).isoformat(timespec="milliseconds"),
        }
        if payload is not None:
            values["rep_count"] = payload.result.valid_repetitions
            values["assessment_json"] = payload.result.result()
            values["sets_json"] = payload.sets or None
        statement = (
            update(ExerciseSession)
            .where(
                ExerciseSession.id == str(session_id),
                ExerciseSession.status == "in_progress",
            )
            .values(**values)
        )

        updated = cast(CursorResult[Any], db.execute(statement)).rowcount
        exercise_session = db.get(ExerciseSession, str(session_id))

        if exercise_session is None:
            raise HTTPException(404, "Session not found.")

        if exercise_session.status != "finished":
            raise HTTPException(409, "The session has been canceled.")

        if updated and payload is not None:
            if sum(payload.sets) > payload.result.valid_repetitions:
                raise HTTPException(422, "Sets exceed the recorded repetition count.")
            if exercise_session.pose_engine is None:
                raise HTTPException(409, "This session has no configured pose engine.")
            if "squat_asymmetry" in payload.result.feedback and exercise_session.exercise_code != "squat":
                raise HTTPException(422, "Knee symmetry feedback applies to squats only.")
            if any(not sample.landmarks_version.startswith(exercise_session.pose_engine + "-")
                   for sample in payload.samples):
                raise HTTPException(422, "Motion samples must match the session's pose engine.")
            for start in range(0, len(payload.samples), 50):
                insert_motion_samples(db, session_id, payload.samples[start:start + 50])

        result = {
            "session_id": exercise_session.id,
            "status": exercise_session.status,
            "ended_at_utc": exercise_session.ended_at,
            "rep_count": exercise_session.rep_count,
            "assessment_result": exercise_session.assessment_json,
            "sets": exercise_session.sets_json,
        }
        db.commit()
        return result
    
@app.get("/api/v1/sessions")
def list_exercise_sessions(
    athlete_id: UUID,
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
):
    with Session(engine) as db:
        athlete_key = str(athlete_id)

        if db.get(Athlete, athlete_key) is None:
            raise HTTPException(404, "Profile not found.")

        statement = (
            select(ExerciseSession)
            .where(ExerciseSession.athlete_id == athlete_key)
            .order_by(ExerciseSession.started_at.desc(), ExerciseSession.id.desc())
            .limit(limit)
            .offset(offset)
        )

        return [
            {
                "session_id": session.id,
                "exercise_code": session.exercise_code,
                "protocol_id": session.protocol_id,
                "status": session.status,
                "started_at_utc": session.started_at,
                "ended_at_utc": session.ended_at,
                "rep_count": session.rep_count,
                "pose_engine": session.pose_engine,
                "tracked_side": session.tracked_side,
                "assessment_result": session.assessment_json,
                "sets": session.sets_json,
                "plan_id": session.plan_id,
                "duration_seconds": (datetime.fromisoformat(session.ended_at) -
                                     datetime.fromisoformat(session.started_at)).total_seconds()
                if session.ended_at else None,
            }
            for session in db.scalars(statement)
        ]

@app.get("/api/v1/sessions/{session_id}/samples", response_model=list[MotionSampleCreate])
def list_motion_samples(
    session_id: UUID,
    limit: int = Query(default=25, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
):
    with Session(engine) as db:
        session_key = str(session_id)
        if db.get(ExerciseSession, session_key) is None:
            raise HTTPException(404, "Session not found.")
        samples = db.scalars(
            select(MotionSample).where(MotionSample.session_id == session_key)
            .order_by(MotionSample.captured_at, MotionSample.frame_id).limit(limit).offset(offset)
        )
        return [
            {
                "frame_id": sample.frame_id,
                "captured_at_utc": sample.captured_at,
                "pose_quality": sample.quality,
                "angles_deg": sample.angles_json,
                "image_width": sample.image_width,
                "image_height": sample.image_height,
                "landmarks_version": sample.landmarks_version,
            }
            for sample in samples
        ]
