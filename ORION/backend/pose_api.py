from hashlib import file_digest
from importlib.util import find_spec
import io
import logging
import os
from functools import lru_cache
from pathlib import Path
from threading import Lock

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse
from starlette.concurrency import run_in_threadpool

router = APIRouter(prefix="/api/v1/pose", tags=["pose"])
log = logging.getLogger(__name__)
model_lock = Lock()
MAX_FRAME_BYTES = 512 * 1024
DEFAULT_WEIGHTS = Path("fitness_pose/runs/pose/squat_finetune/weights/best.pt")


def configured_weights():
    dataset = os.environ.get("ORION_DATASET_DIR")
    if not dataset:
        raise HTTPException(503, "Set ORION_DATASET_DIR to the Orion Dataset folder.")
    weights = Path(dataset) / os.environ.get("ORION_POSE_WEIGHTS", DEFAULT_WEIGHTS)
    if not weights.is_file() or weights.suffix.lower() != ".pt":
        raise HTTPException(503, "The configured Orion YOLO-Pose checkpoint was not found.")
    return weights


@lru_cache(maxsize=1)
def load_model():
    weights = configured_weights()
    try:
        os.environ.setdefault("YOLO_CONFIG_DIR", str(Path(__file__).resolve().parent / ".ultralytics"))
        os.environ.setdefault("YOLO_AUTOINSTALL", "false")
        from ultralytics import YOLO
        import torch

        model = YOLO(str(weights.resolve()))
        if model.task != "pose" or list(model.model.yaml.get("kpt_shape", [])) != [15, 3] or dict(model.names) != {0: "lifter"}:
            raise ValueError("Expected the Orion 15-point pose model.")
    except Exception as error:
        log.exception("Could not load the Orion pose checkpoint")
        raise HTTPException(503, "Could not load the Orion 15-point YOLO-Pose model.") from error
    device = "cpu"
    configured = os.environ.get("ORION_POSE_DEVICE", "cpu")
    if configured in ("auto", "cuda:0") and torch.cuda.is_available():
        device = "cuda:0"
    elif configured not in ("cpu", "auto"):
        raise HTTPException(503, "Requested YOLO device is unavailable. Use cpu or auto.")
    with weights.open("rb") as checkpoint:
        version = "orion-yolo-pose-15-" + file_digest(checkpoint, "sha256").hexdigest()[:12]
    return model, device, version


@router.get("/model")
def pose_model():
    with model_lock:
        _, device, version = load_model()
    return {"model": "orion-yolo-pose", "keypoints": 15, "device": device, "landmarks_version": version}


def mediapipe_path():
    dataset = os.environ.get("ORION_DATASET_DIR")
    if dataset:
        path = Path(dataset) / os.environ.get("ORION_MEDIAPIPE_MODEL", "fitness_pose/models/mediapipe/pose_landmarker_full.task")
        if path.is_file() and path.suffix.lower() == ".task":
            return path
    raise HTTPException(503, "The Orion Dataset MediaPipe Full model was not found.")


@router.get("/availability")
def pose_availability():
    try:
        configured_weights()
        yolo = all(find_spec(package) is not None for package in ("ultralytics", "torch", "PIL"))
    except HTTPException:
        yolo = False
    try:
        mediapipe_path()
        mediapipe = True
    except HTTPException:
        mediapipe = False
    return {"yolo_configured": yolo, "mediapipe_asset": mediapipe}


@router.get("/mediapipe")
def mediapipe_status():
    path = mediapipe_path()
    variant = "heavy" if path.name == "pose_landmarker_heavy.task" else "full"
    return {"model": f"pose-landmarker-{variant}", "keypoints": 33, "asset": "/api/v1/pose/mediapipe/asset"}


@router.get("/mediapipe/asset")
def mediapipe_asset():
    return FileResponse(mediapipe_path(), media_type="application/octet-stream")


def predict_frame(frame: bytes):
    try:
        from PIL import JpegImagePlugin
    except ImportError as error:
        raise HTTPException(503, "Install the ORION pose dependencies first.") from error

    try:
        with JpegImagePlugin.JpegImageFile(io.BytesIO(frame)) as image:
            if max(image.size) > 1280:
                raise HTTPException(422, "Frame dimensions must be at most 1280 pixels.")
            rgb = image.convert("RGB")
    except (SyntaxError, OSError, ValueError) as error:
        raise HTTPException(422, "Send a valid JPEG frame.") from error

    if all(low == high for low, high in rgb.getextrema()):
        return {"detection": None, "keypoints": []}

    with model_lock:
        model, device, _ = load_model()
        try:
            result = model.predict(rgb, imgsz=640, conf=0.4, max_det=1, device=device, verbose=False)[0]
        except Exception as error:
            log.exception("Orion pose inference failed")
            raise HTTPException(503, "YOLO-Pose could not process the frame.") from error

    if result.keypoints is None or len(result.keypoints) == 0:
        return {"detection": None, "keypoints": []}

    coordinates = result.keypoints.xyn[0].cpu().tolist()
    confidence = result.keypoints.conf[0].cpu().tolist()
    detection = {
        "class": "lifter", "confidence": float(result.boxes.conf[0]),
        "box": result.boxes.xyxyn[0].cpu().tolist(),
    }
    return {"detection": detection, "keypoints": [
        {"x": x, "y": y, "visibility": score}
        for (x, y), score in zip(coordinates, confidence)
    ]}


@router.post("/frame")
async def pose_frame(request: Request):
    if request.headers.get("content-type") != "image/jpeg":
        raise HTTPException(415, "Send a JPEG frame with Content-Type: image/jpeg.")
    body = bytearray()
    async for chunk in request.stream():
        if len(body) + len(chunk) > MAX_FRAME_BYTES:
            raise HTTPException(413, "Frame exceeds 512 KiB.")
        body.extend(chunk)
    return await run_in_threadpool(predict_frame, bytes(body))
