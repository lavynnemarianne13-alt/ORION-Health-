from typing import Annotated, Literal

from pydantic import AwareDatetime, BaseModel, Field, FiniteFloat, model_validator

PoseEngine = Literal["orion", "mediapipe"]
TrackedSide = Literal["left", "right"]

PROTOCOLS = {"squat": "SQUAT-01", "curl": "CURL-01", "shoulder": "SHOULDER-01", "knee": "KNEE-01"}


class MotionSampleCreate(BaseModel):
    frame_id: int = Field(ge=0, le=2**63 - 1)
    captured_at_utc: AwareDatetime
    pose_quality: FiniteFloat = Field(ge=0, le=1)
    angles_deg: dict[str, FiniteFloat]
    image_width: int = Field(gt=0)
    image_height: int = Field(gt=0)
    landmarks_version: str = Field(min_length=1, max_length=80)


class MotionSampleBatch(BaseModel):
    samples: list[MotionSampleCreate] = Field(min_length=1, max_length=50)


class PoseAssessment(BaseModel):
    assessment_source: Literal["biomechanical_rules"]
    rules_version: Literal["orion-2d-v1"]
    repetitions: int = Field(ge=0, le=1_000_000)
    valid_repetitions: int = Field(ge=0, le=1_000_000)
    tracking_quality: FiniteFloat | None = Field(ge=0, le=1)
    feedback: list[Literal["range_or_tempo", "squat_asymmetry"]] = Field(max_length=2)

    @model_validator(mode="after")
    def validate_counts(self):
        if self.valid_repetitions > self.repetitions:
            raise ValueError("Valid repetitions cannot exceed completed attempts.")
        if self.repetitions and self.tracking_quality is None:
            raise ValueError("Completed attempts require tracked measurements.")
        if (self.valid_repetitions < self.repetitions) != bool(self.feedback):
            raise ValueError("Feedback is required for completed attempts that miss a rule.")
        return self

    def result(self):
        status = "insufficient_data"
        if self.repetitions:
            status = "meets_configured_rules" if self.valid_repetitions == self.repetitions else "needs_correction"
        return {"assessment": status, **self.model_dump()}


class SessionFinish(BaseModel):
    result: PoseAssessment
    samples: list[MotionSampleCreate] = Field(max_length=900)
    sets: list[Annotated[int, Field(ge=1, le=5000)]] = Field(default_factory=list, max_length=100)
