"""ORION research prototype: AI-assisted exercise candidates for qualified human review.

This module stores validated drafts locally. It does not
prescribe exercise, assess bone density, or diagnose atrophy.
"""
from __future__ import annotations

import asyncio
from uuid import UUID
from crew_records import require_athlete, save_record
from database import engine
from sqlalchemy.orm import Session
import json
import os
from typing import Literal
from urllib.parse import quote
from urllib import error, request

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, FiniteFloat, field_validator

router = APIRouter(prefix="/api/v1", tags=["Research exercise advisor"])

ExerciseId = Literal[
    "resistance_squat", "band_row", "calf_raise", "knee_extension",
    "stationary_cycle", "treadmill_harness",
]
Equipment = Literal["none", "resistance_band", "resistance_device", "stationary_cycle", "treadmill_harness"]
TrainingLevel = Literal["beginner", "intermediate", "advanced"]
MissionContext = Literal["earth_training", "microgravity"]

# Catalog fixed by ORION: the AI can SELECT examples, not invent unsafe movements.
CATALOG = {
    "resistance_squat": ("Resisted squat", "resistance_device"),
    "band_row": ("Resistance-band row", "resistance_band"),
    "calf_raise": ("Calf raise", "none"),
    "knee_extension": ("Knee extension", "resistance_device"),
    "stationary_cycle": ("Stationary cycling", "stationary_cycle"),
    "treadmill_harness": ("Treadmill with harness", "treadmill_harness"),
}

# Dosage templates are generated only for resistance exercise.
# Cardio uses time/intensity and needs a separate reviewed protocol.
RESISTANCE_EXERCISES = frozenset({"resistance_squat", "band_row", "calf_raise", "knee_extension"})

class ExerciseAdvisorRequest(BaseModel):
    athlete_id: UUID | None = None
    height_cm: FiniteFloat = Field(ge=100, le=250)
    weight_kg: FiniteFloat = Field(ge=20, le=350)
    age_years: int | None = Field(default=None, ge=18, le=110)
    # These are optional measurements explicitly taken from an EXTERNAL BIA report.
    measured_muscle_mass_kg: FiniteFloat | None = Field(default=None, ge=1, le=150)
    training_level: TrainingLevel
    mission_context: MissionContext
    available_days_per_week: int = Field(default=2, ge=1, le=5)
    equipment: list[Equipment] = Field(min_length=1, max_length=5)
    limitations: str = Field(default="", max_length=300)
    pain_or_recent_injury: bool
    known_bone_risk: bool
    medical_clearance_confirmed: bool
    consent_to_external_processing: bool

    @field_validator("equipment")
    @classmethod
    def unique_equipment(cls, value: list[Equipment]) -> list[Equipment]:
        if len(set(value)) != len(value):
            raise ValueError("Equipment entries must be unique")
        return value

class ExerciseOption(BaseModel):
    exercise_id: ExerciseId
    name: str
    rationale: str
    caution: str
    # Proposal for professional review, not an exercise prescription.
    sets: int = Field(ge=1, le=3)
    repetitions_per_set: int = Field(ge=6, le=15)
    rest_seconds: int = Field(ge=60, le=180)

class ExerciseAdvisorResponse(BaseModel):
    status: Literal["draft_for_review", "needs_clearance"]
    model_used: str | None
    summary: str
    options: list[ExerciseOption]
    sessions_per_week: int | None = Field(default=None, ge=1, le=3)
    limitations: str
    disclaimer: str = "Research prototype only. A qualified mission medical/exercise specialist must approve any plan before use. No diagnosis or prescription."

# Structured output schema: conservative resistance-training draft, not prescribed dosage.
RESPONSE_SCHEMA = {
    "type": "object", "additionalProperties": False,
    "properties": {
        "summary": {"type": "string"},
        "limitations": {"type": "string"},
        "sessions_per_week": {"type": "integer"},
        "options": {"type": "array", "items": {
            "type": "object", "additionalProperties": False,
            "properties": {
                "exercise_id": {"type": "string", "enum": sorted(RESISTANCE_EXERCISES)},
                "rationale": {"type": "string"},
                "caution": {"type": "string"},
                "sets": {"type": "integer"},
                "repetitions_per_set": {"type": "integer"},
                "rest_seconds": {"type": "integer"},
            },
            "required": ["exercise_id", "rationale", "caution", "sets", "repetitions_per_set", "rest_seconds"],
        }},
    },
    "required": ["summary", "limitations", "sessions_per_week", "options"],
}

INSTRUCTIONS = """You are ORION's research-only workout-outline assistant for astronaut monitoring.
Return a hypothetical, conservative weekly resistance-training DRAFT for REVIEW BY QUALIFIED MISSION MEDICAL/EXERCISE STAFF, not an autonomous prescription.
Use the reported anthropometry as context, NOT to calculate bone density, diagnose muscle atrophy, infer strength, select mechanical loads, or assert a clinically optimal dosage.
Also consider training experience, number of days available, actual equipment, injury screening, movement limitations, and Earth versus microgravity context.
Choose at most THREE unique resistance exercises only: resistance_squat, band_row, calf_raise, knee_extension. Do not add unlisted movements.
For each selected exercise, propose sets, repetitions_per_set, and rest_seconds as provisional parameters, strictly within these conservative research-template bounds:
  Beginner: 1-2 sets, 8-12 reps/set, 60-150 seconds rest.
  Intermediate or advanced: 1-3 sets, 6-15 reps/set, 60-180 seconds rest.
Choose sessions_per_week from 1 to min(3, available_days_per_week); never exceed available days. These are NOT individually validated doses.
If no exercise is suitable, choose an EMPTY options list with sessions_per_week=1 as a placeholder that must not be shown as a training schedule.
Never output load (kg), percent of 1RM, RPE, speed, progression, or treatment instructions.
In microgravity, body-weight calf raises cannot be assumed to provide meaningful mechanical bone loading. Do not choose calf_raise in microgravity. Other resistance movements are NOT proven to prevent bone loss in this user.
Never invent available equipment or clinical clearance. Respect reported movement limitations and context. Do not imply that cycling alone prevents bone loss.
State missing information and the need for professional review. A medically qualified team must adapt frequency, loads, recovery, and contraindications.
Use concise English text, written for the ORION dashboard. Never output personally identifying information.
"""


def _extract_text(body: dict) -> str:
    """Read an ordinary Gemini generateContent structured-output response."""
    candidates = body.get("candidates") or []
    if not candidates:
        raise ValueError("Gemini returned no candidates")
    candidate = candidates[0]
    # STOP indicates a completed response; reject incomplete outputs.
    if candidate.get("finishReason") not in ("STOP", None):
        raise ValueError("Gemini response incomplete")
    parts = (candidate.get("content") or {}).get("parts") or []
    content = "".join(p.get("text", "") for p in parts if isinstance(p, dict))
    if not content.strip():
        raise ValueError("Gemini response did not contain text")
    return content


def _gemini_schema(value):
    """Convert ORION's strict schema to the Gemini-compatible JSON Schema subset."""
    if isinstance(value, list):
        return [_gemini_schema(item) for item in value]
    if not isinstance(value, dict):
        return value
    cleaned = {k: _gemini_schema(v) for k, v in value.items() if k != "additionalProperties"}
    if "type" in cleaned and isinstance(cleaned["type"], str):
        cleaned["type"] = cleaned["type"].upper()
    return cleaned


def _call_model(payload: ExerciseAdvisorRequest, api_key: str, model: str) -> dict:
    body = {
        "systemInstruction": {"parts": [{"text": INSTRUCTIONS}]},
        "contents": [{"role": "user", "parts": [{"text": json.dumps(
            payload.model_dump(exclude={"consent_to_external_processing", "medical_clearance_confirmed", "athlete_id"}),
            ensure_ascii=True,
        )}]}],
        "generationConfig": {
            "responseMimeType": "application/json",
            "responseSchema": _gemini_schema(RESPONSE_SCHEMA),
            "maxOutputTokens": 2400,
        },
    }
    endpoint = f"https://generativelanguage.googleapis.com/v1beta/models/{quote(model, safe='')}:generateContent"
    req = request.Request(
        endpoint,
        data=json.dumps(body).encode("utf-8"),
        headers={"x-goog-api-key": api_key, "Content-Type": "application/json"},
        method="POST",
    )
    with request.urlopen(req, timeout=45) as response:
        result = json.loads(response.read(750_000).decode("utf-8"))
    return json.loads(_extract_text(result))


@router.post("/advisor/exercise-options", response_model=ExerciseAdvisorResponse)
async def suggest_exercise_options(payload: ExerciseAdvisorRequest):
    if not payload.consent_to_external_processing:
        raise HTTPException(422, "Explicit consent is required before sending anonymized measurements to an external AI API.")

    if not payload.medical_clearance_confirmed or payload.pain_or_recent_injury or payload.known_bone_risk:
        return ExerciseAdvisorResponse(
            status="needs_clearance", model_used=None, options=[], sessions_per_week=None,
            summary="Specialist review is required before considering exercise options.",
            limitations="The supplied history includes an unknown or elevated safety concern. No information was sent to the AI provider.",
        )

    if os.getenv("ORION_AI_ENABLED") != "1":
        raise HTTPException(503, "AI advisor is disabled. Set ORION_AI_ENABLED=1 for local development only.")
    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    if not api_key:
        raise HTTPException(503, "AI advisor is not configured: GEMINI_API_KEY is missing on the backend.")
    if payload.athlete_id:
        with Session(engine) as db:
            require_athlete(db, payload.athlete_id)
    model = os.getenv("ORION_AI_MODEL", "gemini-3.5-flash-lite")
    try:
        generated = await asyncio.to_thread(_call_model, payload, api_key, model)
        output = generated.get("options", [])
        if not isinstance(output, list) or len(output) > 3:
            raise ValueError("Invalid option count")
        frequency = generated["sessions_per_week"]
        if type(frequency) is not int or not 1 <= frequency <= min(3, payload.available_days_per_week):
            raise ValueError("Invalid frequency")
        options = []
        seen = set()
        available = set(payload.equipment)
        for item in output:
            exercise_id = item["exercise_id"]
            if exercise_id not in RESISTANCE_EXERCISES or exercise_id in seen:
                raise ValueError("Duplicate or unrecognized resistance exercise")
            name, required = CATALOG[exercise_id]
            if required not in available and required != "none":
                raise ValueError("Suggested exercise requires unavailable equipment")
            # Bodyweight calf raises are NOT asserted to preserve bone in microgravity.
            if exercise_id == "calf_raise" and payload.mission_context == "microgravity":
                raise ValueError("Unsupported unresisted exercise under microgravity")
            seen.add(exercise_id)
            rationale = item["rationale"].strip()
            caution = item["caution"].strip()
            if not rationale or not caution or len(rationale) > 900 or len(caution) > 900:
                raise ValueError("Invalid explanation length")
            sets = item["sets"]
            reps = item["repetitions_per_set"]
            rest = item["rest_seconds"]
            if any(type(value) is not int for value in (sets, reps, rest)):
                raise ValueError("Exercise dosage must use integers")
            sets_limit = 2 if payload.training_level == "beginner" else 3
            min_reps = 8 if payload.training_level == "beginner" else 6
            max_reps = 12 if payload.training_level == "beginner" else 15
            max_rest = 150 if payload.training_level == "beginner" else 180
            if not (1 <= sets <= sets_limit and min_reps <= reps <= max_reps and 60 <= rest <= max_rest):
                raise ValueError("Outside reviewed proposal bounds")
            options.append(ExerciseOption(exercise_id=exercise_id, name=name, rationale=rationale,
                                          caution=caution, sets=sets, repetitions_per_set=reps, rest_seconds=rest))
        summary = generated["summary"].strip()
        limitations = generated["limitations"].strip()
        if not summary or not limitations or len(summary) > 1200 or len(limitations) > 1200:
            raise ValueError("Invalid summary")
        result = ExerciseAdvisorResponse(status="draft_for_review", model_used=model, options=options,
                                       sessions_per_week=frequency if options else None,
                                       summary=summary, limitations=limitations)

    except (error.URLError, TimeoutError, ValueError, KeyError, TypeError, AttributeError) as exc:
        raise HTTPException(502, "AI advisor unavailable or returned invalid guidance.") from exc

    if payload.athlete_id:
        await asyncio.to_thread(save_record, payload.athlete_id, "workout_plan", result.model_dump(mode="json"))
    return result
