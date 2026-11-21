from datetime import UTC, datetime
from uuid import UUID, uuid4

from fastapi import APIRouter, HTTPException
from pydantic import AwareDatetime, BaseModel, Field, FiniteFloat
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from database import engine
from models import Athlete, CrewRecord

router = APIRouter(prefix="/api/v1/athletes/{athlete_id}", tags=["crew records"])


class BodyMeasurement(BaseModel):
    id: UUID
    athleteId: UUID
    recordedAt: AwareDatetime
    ageYears: int | None = Field(None, ge=18, le=110)
    heightCm: FiniteFloat = Field(ge=100, le=250)
    weightKg: FiniteFloat = Field(ge=20, le=350)
    waistCm: FiniteFloat | None = Field(None, gt=0, le=300)
    hipCm: FiniteFloat | None = Field(None, gt=0, le=300)
    rightUpperArmCm: FiniteFloat | None = Field(None, gt=0, le=300)
    leftUpperArmCm: FiniteFloat | None = Field(None, gt=0, le=300)
    rightForearmCm: FiniteFloat | None = Field(None, gt=0, le=300)
    leftForearmCm: FiniteFloat | None = Field(None, gt=0, le=300)
    rightThighCm: FiniteFloat | None = Field(None, gt=0, le=300)
    leftThighCm: FiniteFloat | None = Field(None, gt=0, le=300)
    rightCalfCm: FiniteFloat | None = Field(None, gt=0, le=300)
    leftCalfCm: FiniteFloat | None = Field(None, gt=0, le=300)
    bodyFatPercent: FiniteFloat | None = Field(None, ge=0, le=100)
    skeletalMuscleMassKg: FiniteFloat | None = Field(None, gt=0, le=350)
    bodyWaterPercent: FiniteFloat | None = Field(None, ge=0, le=100)
    biaDevice: str | None = Field(None, max_length=120)


def require_athlete(db, athlete_id):
    if db.get(Athlete, str(athlete_id)) is None:
        raise HTTPException(404, "Crew profile not found.")


def save_record(athlete_id, kind, payload, record_id=None):
    with Session(engine) as db:
        require_athlete(db, athlete_id)
        record = CrewRecord(
            id=str(record_id or uuid4()), athlete_id=str(athlete_id),
            kind=kind, payload=payload, created_at=datetime.now(UTC).isoformat(),
        )
        db.add(record)
        try:
            db.commit()
        except IntegrityError as error:
            if getattr(error.orig, "sqlite_errorname", None) == "SQLITE_CONSTRAINT_PRIMARYKEY":
                raise HTTPException(409, "Record already exists.") from error
            raise


def list_records(athlete_id, kind):
    with Session(engine) as db:
        require_athlete(db, athlete_id)
        query = select(CrewRecord).where(
            CrewRecord.athlete_id == str(athlete_id), CrewRecord.kind == kind,
        ).order_by(CrewRecord.created_at.desc())
        return [{"id": row.id, "created_at": row.created_at, "payload": row.payload}
                for row in db.scalars(query).all()]


@router.get("/measurements")
def measurements(athlete_id: UUID):
    return [row["payload"] for row in list_records(athlete_id, "measurement")]


@router.post("/measurements", status_code=201)
def create_measurement(athlete_id: UUID, payload: BodyMeasurement):
    if athlete_id != payload.athleteId:
        raise HTTPException(422, "Measurement must belong to the selected crew member.")
    save_record(athlete_id, "measurement", payload.model_dump(mode="json"), payload.id)
    return payload


@router.delete("/measurements/{record_id}")
def delete_measurement(athlete_id: UUID, record_id: UUID):
    with Session(engine) as db:
        record = db.get(CrewRecord, str(record_id))
        if record is None or record.athlete_id != str(athlete_id) or record.kind != "measurement":
            raise HTTPException(404, "Measurement not found.")
        db.delete(record)
        db.commit()
    return {"ok": True}


@router.get("/plans")
def plans(athlete_id: UUID):
    return list_records(athlete_id, "workout_plan")


class PlanReview(BaseModel):
    reviewer: str = Field(min_length=2, max_length=80)
    professionally_reviewed: bool


@router.post("/plans/{plan_id}/review")
def review_plan(athlete_id: UUID, plan_id: UUID, review: PlanReview):
    reviewer = review.reviewer.strip()
    if not review.professionally_reviewed or len(reviewer) < 2:
        raise HTTPException(422, "Record the professional's review explicitly.")
    with Session(engine) as db:
        record = db.get(CrewRecord, str(plan_id))
        if record is None or record.athlete_id != str(athlete_id) or record.kind != "workout_plan":
            raise HTTPException(404, "Workout draft not found.")
        if not record.payload.get("options"):
            raise HTTPException(422, "This draft does not contain an exercise.")
        if not record.payload.get("review"):
            saved = {**record.payload, "review": {"reviewer": reviewer, "at": datetime.now(UTC).isoformat()}}
            db.execute(update(CrewRecord).where(
                CrewRecord.id == record.id, CrewRecord.payload["review"].as_string().is_(None),
            ).values(payload=saved))
            db.commit()
        return record.payload["review"]
