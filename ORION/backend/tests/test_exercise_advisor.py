"""Run: python -m unittest discover -s tests -p 'test_exercise_advisor.py' -v"""
import os
import unittest
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from exercise_advisor import router

app = FastAPI()
app.include_router(router)
client = TestClient(app)
URL = "/api/v1/advisor/exercise-options"


def payload(**changes):
    data = {
        "height_cm": 176, "weight_kg": 77, "age_years": 34,
        "measured_muscle_mass_kg": None,
        "training_level": "intermediate", "mission_context": "earth_training",
        "available_days_per_week": 3,
        "equipment": ["none", "resistance_band"], "limitations": "",
        "pain_or_recent_injury": False, "known_bone_risk": False,
        "medical_clearance_confirmed": True,
        "consent_to_external_processing": True,
    }
    data.update(changes)
    return data


class AdvisorTests(unittest.TestCase):
    def test_requires_consent(self):
        r = client.post(URL, json=payload(consent_to_external_processing=False))
        self.assertEqual(422, r.status_code)

    def test_without_clearance_does_not_call_ai(self):
        with patch("exercise_advisor._call_model") as call:
            r = client.post(URL, json=payload(medical_clearance_confirmed=False))
            self.assertEqual(200, r.status_code)
            self.assertEqual("needs_clearance", r.json()["status"])
            self.assertEqual([], r.json()["options"])
            call.assert_not_called()

    def test_bone_risk_does_not_call_ai(self):
        with patch("exercise_advisor._call_model") as call:
            r = client.post(URL, json=payload(known_bone_risk=True))
            self.assertEqual(200, r.status_code)
            call.assert_not_called()

    def test_pain_does_not_call_ai(self):
        with patch("exercise_advisor._call_model") as call:
            r = client.post(URL, json=payload(pain_or_recent_injury=True))
            self.assertEqual(200, r.status_code)
            call.assert_not_called()

    def test_disabled_without_config(self):
        with patch.dict(os.environ, {"ORION_AI_ENABLED": "0"}):
            self.assertEqual(503, client.post(URL, json=payload()).status_code)

    def test_rejects_unavailable_equipment(self):
        generated = {"summary":"Draft", "limitations":"Professional review required", "sessions_per_week": 2, "options":[
            {"exercise_id":"resistance_squat", "rationale":"Strength", "caution":"Review", "sets": 2, "repetitions_per_set": 10, "rest_seconds": 90}]}
        with patch.dict(os.environ, {"ORION_AI_ENABLED":"1", "GEMINI_API_KEY":"unit-test", "ORION_AI_MODEL":"demo"}), patch("exercise_advisor._call_model", return_value=generated):
            r = client.post(URL, json=payload())
            self.assertEqual(502, r.status_code)

    def test_accepts_catalog_suggestion(self):
        generated = {"summary":"Candidate only", "limitations":"Needs approval", "sessions_per_week": 2, "options":[
            {"exercise_id":"band_row", "rationale":"Resistance example", "caution":"Review technique", "sets": 2, "repetitions_per_set": 10, "rest_seconds": 90}]}
        with patch.dict(os.environ, {"ORION_AI_ENABLED":"1", "GEMINI_API_KEY":"unit-test", "ORION_AI_MODEL":"demo"}), patch("exercise_advisor._call_model", return_value=generated):
            r = client.post(URL, json=payload())
            self.assertEqual(200, r.status_code, r.text)
            self.assertEqual("draft_for_review", r.json()["status"])
            self.assertEqual("Resistance-band row", r.json()["options"][0]["name"])
            self.assertEqual(2, r.json()["sessions_per_week"])
            self.assertEqual(2, r.json()["options"][0]["sets"])
            self.assertEqual(10, r.json()["options"][0]["repetitions_per_set"])

    def test_rejects_unresisted_calf_raise_for_microgravity(self):
        generated = {"summary":"Draft", "limitations":"Review", "sessions_per_week": 2, "options":[
            {"exercise_id":"calf_raise", "rationale":"Example", "caution":"Review", "sets": 2, "repetitions_per_set": 10, "rest_seconds": 90}]}
        with patch.dict(os.environ, {"ORION_AI_ENABLED":"1", "GEMINI_API_KEY":"unit-test"}), patch("exercise_advisor._call_model", return_value=generated):
            self.assertEqual(502, client.post(URL, json=payload(mission_context="microgravity")).status_code)

    def test_invalid_payload_rejected(self):
        self.assertEqual(422, client.post(URL, json=payload(height_cm=800)).status_code)


    def test_rejects_excessive_dosage(self):
        generated = {"summary": "Draft", "limitations": "Review", "sessions_per_week": 2, "options": [
            {"exercise_id": "band_row", "rationale": "Upper body", "caution": "Review", "sets": 12, "repetitions_per_set": 50, "rest_seconds": 20}]}
        with patch.dict(os.environ, {"ORION_AI_ENABLED": "1", "GEMINI_API_KEY": "test"}), patch("exercise_advisor._call_model", return_value=generated):
            self.assertEqual(502, client.post(URL, json=payload()).status_code)

    def test_rejects_frequency_above_available_days(self):
        generated = {"summary": "Draft", "limitations": "Review", "sessions_per_week": 3, "options": [
            {"exercise_id": "band_row", "rationale": "Upper body", "caution": "Review", "sets": 2, "repetitions_per_set": 10, "rest_seconds": 90}]}
        with patch.dict(os.environ, {"ORION_AI_ENABLED": "1", "GEMINI_API_KEY": "test"}), patch("exercise_advisor._call_model", return_value=generated):
            self.assertEqual(502, client.post(URL, json=payload(available_days_per_week=2)).status_code)

    def test_beginner_limited_sets(self):
        generated = {"summary": "Draft", "limitations": "Review", "sessions_per_week": 2, "options": [
            {"exercise_id": "band_row", "rationale": "Upper body", "caution": "Review", "sets": 3, "repetitions_per_set": 10, "rest_seconds": 90}]}
        with patch.dict(os.environ, {"ORION_AI_ENABLED": "1", "GEMINI_API_KEY": "test"}), patch("exercise_advisor._call_model", return_value=generated):
            self.assertEqual(502, client.post(URL, json=payload(training_level="beginner")).status_code)

    def test_rejects_aerobic_repetitions_template(self):
        generated = {"summary": "Draft", "limitations": "Review", "sessions_per_week": 2, "options": [
            {"exercise_id": "stationary_cycle", "rationale": "Cardio", "caution": "Review", "sets": 2, "repetitions_per_set": 10, "rest_seconds": 90}]}
        with patch.dict(os.environ, {"ORION_AI_ENABLED": "1", "GEMINI_API_KEY": "test"}), patch("exercise_advisor._call_model", return_value=generated):
            self.assertEqual(502, client.post(URL, json=payload(equipment=["stationary_cycle"])).status_code)

    def test_no_equipment_in_microgravity_returns_no_plan(self):
        generated = {"summary": "No suitable resistance equipment", "limitations": "Crew medical review", "sessions_per_week": 1, "options": []}
        with patch.dict(os.environ, {"ORION_AI_ENABLED": "1", "GEMINI_API_KEY": "test"}), patch("exercise_advisor._call_model", return_value=generated):
            r = client.post(URL, json=payload(mission_context="microgravity", equipment=["none"]))
            self.assertEqual(200, r.status_code, r.text)
            self.assertEqual([], r.json()["options"])
            self.assertIsNone(r.json()["sessions_per_week"])

    def test_no_clearance_never_returns_dosage(self):
        with patch("exercise_advisor._call_model") as call:
            r = client.post(URL, json=payload(medical_clearance_confirmed=False))
            self.assertEqual(200, r.status_code)
            self.assertIsNone(r.json()["sessions_per_week"])
            call.assert_not_called()


if __name__ == "__main__":
    unittest.main()
