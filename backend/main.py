"""
Face Recognition Backend - FastAPI Application
Optimized for Capstone/Thesis Projects

System Flow:
1. Receive image from mobile app
2. Detect face using OpenCV
3. Extract face region
4. Convert to embedding using DeepFace
5. Compare with registered faces (1:N matching)
6. Return "Verified" or "Not Recognized"

NEW: MongoDB Integration for Resident Registration
- Collection: residents - stores registered residents with face embeddings
- Collection: face_registration_logs - logs all registration attempts (ALLOW/BLOCK/ERROR)
"""

from fastapi import FastAPI, HTTPException, Request, Header, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, Any, Dict, List, Union
import base64
import cv2
import cv2.data
import numpy as np
from deepface import DeepFace
import os
import json
from datetime import datetime
import logging
import time
import sys
import os

# Ensure UTF-8 output on Windows console
if sys.platform == "win32":
    try:
        reconf_stdout = getattr(sys.stdout, "reconfigure", None)
        if callable(reconf_stdout):
            reconf_stdout(encoding="utf-8")
        reconf_stderr = getattr(sys.stderr, "reconfigure", None)
        if callable(reconf_stderr):
            reconf_stderr(encoding="utf-8")
    except Exception:
        pass

from services.liveness_service import liveness_detector
from services.id_verification_service import id_verifier
from services.active_liveness_service import active_liveness_verifier

os.environ.setdefault("TF_ENABLE_ONEDNN_OPTS", "0")

from pymongo import MongoClient
from bson import ObjectId

# Load environment variables
from dotenv import load_dotenv
load_dotenv()

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="Face Recognition API",
    description="Backend API for mobile face recognition feature",
    version="1.0.0"
)

# CORS allowlist configuration
raw_allowed_origins = os.getenv("FACE_API_ALLOWED_ORIGINS", "*").split(",")
FACE_API_ALLOWED_ORIGINS = [origin.strip() for origin in raw_allowed_origins if origin.strip()]

if "*" in FACE_API_ALLOWED_ORIGINS or not FACE_API_ALLOWED_ORIGINS:
    cors_origins = ["*"]
    cors_credentials = False
else:
    cors_origins = FACE_API_ALLOWED_ORIGINS
    cors_credentials = True

# Enable CORS for mobile app communication
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=cors_credentials,
    allow_methods=["*"],
    allow_headers=["*"],
)

FACE_API_ADMIN_TOKEN = os.getenv("FACE_API_ADMIN_TOKEN", "").strip()

def require_admin_auth(
    authorization: Optional[str] = Header(default=None),
    x_api_key: Optional[str] = Header(default=None),
) -> None:
    if not FACE_API_ADMIN_TOKEN:
        raise HTTPException(status_code=503, detail="Admin token is not configured")

    bearer_token = ""
    if authorization and authorization.lower().startswith("bearer "):
        bearer_token = authorization[7:].strip()

    supplied = (x_api_key or "").strip() or bearer_token
    if supplied != FACE_API_ADMIN_TOKEN:
        raise HTTPException(status_code=401, detail="Unauthorized")

# ============================================
# CONFIGURATION
# ============================================

FACE_MATCH_THRESHOLD = float(os.getenv("FACE_MATCH_THRESHOLD", "0.65"))  # Similarity threshold for verification
DUPLICATE_THRESHOLD = float(os.getenv("DUPLICATE_THRESHOLD", "0.70"))    # Threshold for duplicate detection during registration
MIN_FACE_SIZE = int(os.getenv("MIN_FACE_SIZE", "80"))                    # Minimum face size in pixels
MODEL_NAME = os.getenv("MODEL_NAME", "Facenet")                          # DeepFace model: Facenet, VGG-Face, OpenFace, etc.
DETECTOR_BACKEND = os.getenv("DETECTOR_BACKEND", "opencv")               # Faster on CPU; override to retinaface for accuracy
DETECTOR_FOR_DETECT = os.getenv("DETECTOR_FOR_DETECT", "opencv")         # deepface or opencv
BLUR_THRESHOLD = float(os.getenv("BLUR_THRESHOLD", "18"))                # Laplacian variance; lower = more tolerant
LIVENESS_MIN_PASSES = int(os.getenv("LIVENESS_MIN_PASSES", "1"))         # Minimum checks that must pass
LOW_RES_THRESHOLD = int(os.getenv("LOW_RES_THRESHOLD", "360"))           # px; below this treat liveness as uncertain
MAX_IMAGE_DIM = int(os.getenv("MAX_IMAGE_DIM", "800"))                   # px; downscale large images for speed
ENABLE_LOW_LIGHT_ENHANCEMENT = os.getenv("ENABLE_LOW_LIGHT_ENHANCEMENT", "true").lower() == "true"
LOW_LIGHT_MEAN_THRESHOLD = float(os.getenv("LOW_LIGHT_MEAN_THRESHOLD", "75"))  # grayscale mean (0-255)
LOW_LIGHT_GAMMA = float(os.getenv("LOW_LIGHT_GAMMA", "1.4"))

# Face capture abuse protection
# TEMPORARY TESTING BYPASS: Disabled during verification testing to prevent 300s lockouts.
# Set ENABLE_FACE_ATTEMPT_LIMIT="true" or restore default "10" limit when testing is finished.
ENABLE_FACE_ATTEMPT_LIMIT = os.getenv("ENABLE_FACE_ATTEMPT_LIMIT", "false").lower() == "true"
FACE_ATTEMPT_LIMIT = int(os.getenv("FACE_ATTEMPT_LIMIT", "1000"))
FACE_ATTEMPT_WINDOW_SECONDS = int(os.getenv("FACE_ATTEMPT_WINDOW_SECONDS", "900"))  # 15 minutes
FACE_ATTEMPT_LOCK_SECONDS = int(os.getenv("FACE_ATTEMPT_LOCK_SECONDS", "300"))      # 5 minutes
_face_attempt_tracker = {}


def _get_client_ip(request: Request) -> str:
    forwarded_for = request.headers.get("x-forwarded-for")
    if forwarded_for:
        return forwarded_for.split(",")[0].strip()
    client = request.client
    return client.host if client else "unknown"


def _cleanup_face_attempt_tracker(now_ts: float) -> None:
    stale_keys = []
    stale_after = FACE_ATTEMPT_WINDOW_SECONDS + FACE_ATTEMPT_LOCK_SECONDS + 60
    for key, state in _face_attempt_tracker.items():
        if now_ts - state.get("updated_at", now_ts) > stale_after:
            stale_keys.append(key)
    for key in stale_keys:
        _face_attempt_tracker.pop(key, None)


def enforce_face_attempt_limit(http_request: Optional[Request], endpoint_name: str, session_key: Optional[str] = None) -> None:
    if not ENABLE_FACE_ATTEMPT_LIMIT:
        return
    if http_request is None:
        return
    now_ts = time.time()
    _cleanup_face_attempt_tracker(now_ts)

    client_ip = _get_client_ip(http_request)
    scoped_key = (session_key or "").strip().upper()
    actor_key = scoped_key if scoped_key else f"IP:{client_ip}"
    tracker_key = f"{endpoint_name}:{actor_key}"

    state = _face_attempt_tracker.get(tracker_key)
    if not state:
        state = {
            "count": 0,
            "window_started_at": now_ts,
            "locked_until": 0.0,
            "updated_at": now_ts,
        }
        _face_attempt_tracker[tracker_key] = state

    if state["locked_until"] > now_ts:
        retry_after = int(max(1, state["locked_until"] - now_ts))
        raise HTTPException(
            status_code=429,
            detail=f"Too many photo attempts. Please wait {retry_after} seconds before trying again.",
        )

    if now_ts - state["window_started_at"] > FACE_ATTEMPT_WINDOW_SECONDS:
        state["count"] = 0
        state["window_started_at"] = now_ts
        state["locked_until"] = 0.0

    if state["count"] >= FACE_ATTEMPT_LIMIT:
        state["locked_until"] = now_ts + FACE_ATTEMPT_LOCK_SECONDS
        state["updated_at"] = now_ts
        raise HTTPException(
            status_code=429,
            detail=f"Too many photo attempts. Please wait {FACE_ATTEMPT_LOCK_SECONDS} seconds before trying again.",
        )

    state["count"] += 1
    state["updated_at"] = now_ts

# ============================================
# MONGODB CONFIGURATION
# ============================================

MONGODB_URI = os.getenv("MONGODB_URI", "mongodb://localhost:27017")
MONGODB_DB_NAME = os.getenv("MONGODB_DB_NAME", "kapit_bisig")

# MongoDB connection (lazy initialization)
mongo_client = None
mongo_db = None

def get_mongo_db():
    """Get MongoDB database connection (lazy initialization)"""
    global mongo_client, mongo_db
    if mongo_db is None:
        try:
            mongo_client = MongoClient(MONGODB_URI, serverSelectionTimeoutMS=5000)
            mongo_db = mongo_client[MONGODB_DB_NAME]
            # Test connection
            mongo_client.admin.command('ping')
            logger.info(f"✓ Connected to MongoDB: {MONGODB_DB_NAME}")
        except Exception as e:
            logger.error(f"✗ MongoDB connection failed: {e}")
            logger.warning("Using in-memory storage as fallback")
            return None
    return mongo_db

# ============================================
# DATA MODELS
# ============================================

class FaceRegisterRequest(BaseModel):
    image: str  # Base64 encoded image
    user_id: str
    name: str

class FaceVerifyRequest(BaseModel):
    image: str  # Base64 encoded image

class FaceDetectRequest(BaseModel):
    image: str  # Base64 encoded image
    session_key: Optional[str] = None  # Optional registration/session key

# NEW: Duplicate Check Request/Response for Registration Flow
class DuplicateCheckRequest(BaseModel):
    image: str  # Base64 encoded image
    resident_data: Optional[dict] = None  # Optional resident registration data

class DuplicateCheckResponse(BaseModel):
    success: bool
    face_detected: bool
    decision: str  # "ALLOW" or "BLOCK"
    best_match_id: Optional[str] = None
    best_match_name: Optional[str] = None
    similarity: float
    threshold: float
    processing_time_ms: int
    message: str
    # For storing resident on ALLOW
    resident_id: Optional[str] = None

class FaceRegisterResponse(BaseModel):
    success: bool
    message: str
    user_id: Optional[str] = None

class FaceVerifyResponse(BaseModel):
    verified: bool
    user_id: Optional[str] = None
    name: Optional[str] = None
    confidence: float
    message: str

class FaceDetectionResult(BaseModel):
    has_face: bool
    face_count: int
    is_centered: bool
    face_size_ok: bool
    is_real_image: bool = True  # Liveness/anti-spoofing check
    image_quality: str = "good"  # good, blurry, too_dark, too_bright
    is_valid: bool = False  # Overall validation result
    message: str
    bounding_box: Optional[Dict[str, Any]] = None
    validation_details: Optional[Dict[str, Any]] = None  # Detailed validation info

class ActiveLivenessRequest(BaseModel):
    frontal_image: str  # Base64 encoded frontal photo
    challenge_image: str  # Base64 encoded challenge photo (e.g. head turned)
    challenge_type: Optional[str] = "turn_any"
    session_key: Optional[str] = None

class ActiveLivenessResponse(BaseModel):
    success: bool
    is_live: bool
    status: str  # "PASSED" or "REJECTED"
    message: str
    details: Optional[Dict[str, Any]] = None

class LiveStreamFrameRequest(BaseModel):
    session_id: str
    stage: Optional[str] = "frontal"  # "frontal" | "turn"
    image: str  # Base64 encoded frame
    reset_session: Optional[bool] = False

class LiveStreamFrameResponse(BaseModel):
    success: bool
    status: str  # "ALIGNING" | "FRONTAL_LOCKED" | "TURNING" | "NOD_DETECTED" | "PASSED" | "REJECTED"
    stage: str   # "frontal" | "turn" | "complete"
    progress: float  # 0.0 to 1.0
    feedback: str
    is_live: bool = False
    direction: Optional[str] = None
    details: Optional[Dict[str, Any]] = None

# ============================================
# IN-MEMORY FACE DATABASE
# For production, use MongoDB, PostgreSQL, etc.
# ============================================

face_database = {}  # {user_id: {"name": str, "embedding": list, "registered_at": str}}
EMBEDDINGS_FILE = "face_embeddings.json"
face_index: Dict[str, Any] = {
    "user_ids": [],
    "names": [],
    "matrix": None,   # 2D numpy array [n_users, embedding_dim]
    "norms": None,    # 1D numpy array [n_users]
}

# ============================================
# PERFORMANCE: Embedding Cache (reduces repeat computation)
# ============================================
from functools import lru_cache
import hashlib

# Cache for model loading (prevents reloading on every request)
_model_cache = {}

def get_image_hash(image: np.ndarray) -> str:
    """Generate hash for image caching"""
    return hashlib.md5(image.tobytes()).hexdigest()

# Pre-warm the DeepFace model on startup
def warmup_model():
    """Pre-load DeepFace model to avoid first-request delay"""
    try:
        logger.info(f"Pre-loading {MODEL_NAME} model...")
        # Create a dummy image to trigger model loading
        dummy = np.zeros((224, 224, 3), dtype=np.uint8)
        DeepFace.represent(dummy, model_name=MODEL_NAME, detector_backend="skip", enforce_detection=False)
        logger.info("Model pre-loaded successfully!")
    except Exception as e:
        logger.warning(f"Model warmup failed (will load on first request): {e}")

def save_database() -> bool:
    """Save face database to file. Returns True on success, False on failure."""
    try:
        # Ensure any numpy types are JSON-serializable
        serializable_data = to_native(face_database)

        # Write atomically to avoid partial files if the process crashes
        tmp_path = f"{EMBEDDINGS_FILE}.tmp"
        with open(tmp_path, 'w') as f:
            json.dump(serializable_data, f, indent=2)
        os.replace(tmp_path, EMBEDDINGS_FILE)

        logger.info(f"Database saved with {len(face_database)} users")
        return True
    except Exception as e:
        logger.error(f"Failed to save database: {e}")
        return False

def load_database():
    """Load face database from file"""
    global face_database
    if os.path.exists(EMBEDDINGS_FILE):
        try:
            with open(EMBEDDINGS_FILE, 'r') as f:
                face_database = json.load(f)
            logger.info(f"Database loaded with {len(face_database)} users")
        except Exception as e:
            logger.error(f"Failed to load database: {e}")
            face_database = {}

def rebuild_face_index():
    """
    Build a vectorized in-memory index for fast 1:N similarity search.
    This avoids Python-loop cosine computations for every verification.
    """
    user_ids = []
    names = []
    vectors = []

    for user_id, data in face_database.items():
        embedding = data.get("embedding")
        if not isinstance(embedding, list) or len(embedding) == 0:
            continue
        vectors.append(np.array(embedding, dtype=np.float32))
        user_ids.append(user_id)
        names.append(data.get("name", user_id))

    if vectors:
        matrix = np.vstack(vectors)
        norms = np.linalg.norm(matrix, axis=1)
    else:
        matrix = np.empty((0, 0), dtype=np.float32)
        norms = np.empty((0,), dtype=np.float32)

    face_index["user_ids"] = user_ids
    face_index["names"] = names
    face_index["matrix"] = matrix
    face_index["norms"] = norms
    logger.info(f"Face index rebuilt with {len(user_ids)} users")

# Load database on startup
load_database()
rebuild_face_index()

# Warm up model on startup (prevents first-request delay)
warmup_model()

# ============================================
# UTILITY FUNCTIONS
# ============================================

def decode_base64_image(base64_string: str) -> np.ndarray:
    """
    Convert Base64 string to OpenCV image (numpy array)
    
    Args:
        base64_string: Base64 encoded image string
        
    Returns:
        OpenCV image as numpy array (BGR format)
    """
    # Remove data URL prefix if present (e.g., "data:image/jpeg;base64,")
    if 'base64,' in base64_string:
        base64_string = base64_string.split('base64,')[1]
    
    # Decode base64 to bytes
    image_bytes = base64.b64decode(base64_string)
    
    # Convert to numpy array
    nparr = np.frombuffer(image_bytes, np.uint8)
    
    # Decode image (OpenCV BGR format)
    image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    
    if image is None:
        raise ValueError("Failed to decode image. Please ensure the image is valid.")

    return resize_image_if_needed(image)

def resize_image_if_needed(image: np.ndarray) -> np.ndarray:
    """
    Downscale large images to improve CPU performance.
    """
    if MAX_IMAGE_DIM <= 0:
        return image
    
    height, width = image.shape[:2]
    max_side = max(height, width)
    
    if max_side <= MAX_IMAGE_DIM:
        return image
    
    scale = MAX_IMAGE_DIM / max_side
    new_width = int(width * scale)
    new_height = int(height * scale)
    
    resized = cv2.resize(image, (new_width, new_height), interpolation=cv2.INTER_AREA)
    logger.info(f"Image resized: {width}x{height} -> {new_width}x{new_height}")
    return resized

def estimate_brightness(image: np.ndarray) -> float:
    """Estimate scene brightness using grayscale mean intensity."""
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    return float(np.mean(gray))

def enhance_low_light_image(image: np.ndarray) -> tuple[np.ndarray, bool, float]:
    """
    Apply lightweight low-light enhancement.
    Returns (possibly enhanced image, was_enhanced, input_brightness).
    """
    brightness = estimate_brightness(image)
    if (not ENABLE_LOW_LIGHT_ENHANCEMENT) or (brightness >= LOW_LIGHT_MEAN_THRESHOLD):
        return image, False, brightness

    # 1) Local contrast boost in luminance channel (CLAHE)
    ycrcb = cv2.cvtColor(image, cv2.COLOR_BGR2YCrCb)
    y, cr, cb = cv2.split(ycrcb)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    y = clahe.apply(y)
    enhanced = cv2.merge((y, cr, cb))
    enhanced = cv2.cvtColor(enhanced, cv2.COLOR_YCrCb2BGR)

    # 2) Gentle gamma lift
    gamma = max(1.0, LOW_LIGHT_GAMMA)
    inv_gamma = 1.0 / gamma
    lut = np.array([((i / 255.0) ** inv_gamma) * 255 for i in range(256)], dtype=np.uint8)
    enhanced = cv2.LUT(enhanced, lut)

    return enhanced, True, brightness

def detect_faces_opencv(image: np.ndarray) -> dict:
    """
    Detect faces using OpenCV Haar Cascade
    
    Args:
        image: OpenCV image (BGR format)
        
    Returns:
        Dictionary with detection results
    """
    # Convert to grayscale
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    
    # Load face cascade classifier
    face_cascade = cv2.CascadeClassifier(
        cv2.data.haarcascades + 'haarcascade_frontalface_default.xml'
    )
    
    # Detect faces
    faces = face_cascade.detectMultiScale(
        gray,
        scaleFactor=1.1,
        minNeighbors=5,
        minSize=(MIN_FACE_SIZE, MIN_FACE_SIZE)
    )
    
    face_list = [[coord for coord in f] for f in faces] if len(faces) > 0 else []
    
    result = {
        "has_face": len(faces) > 0,
        "face_count": len(faces),
        "faces": face_list,
        "image_width": int(image.shape[1]),
        "image_height": int(image.shape[0])
    }
    
    return result

def detect_faces_deepface(image: np.ndarray) -> dict:
    """
    Detect faces using DeepFace detector backend (retinaface/mtcnn/etc.)
    Returns the same structure as detect_faces_opencv.
    """
    try:
        faces = DeepFace.extract_faces(
            img_path=image,
            detector_backend=DETECTOR_BACKEND,
            enforce_detection=False
        )
    except Exception as e:
        logger.warning(f"DeepFace detection failed, falling back to OpenCV: {e}")
        return detect_faces_opencv(image)

    face_boxes = []
    for f in faces:
        if isinstance(f, dict):
            area = f.get("facial_area") or {}
            x = int(area.get("x", 0))
            y = int(area.get("y", 0))
            w = int(area.get("w", 0))
            h = int(area.get("h", 0))
            if w > 0 and h > 0:
                face_boxes.append([x, y, w, h])

    if len(face_boxes) == 0:
        # Fallback to OpenCV if DeepFace found nothing
        return detect_faces_opencv(image)

    return {
        "has_face": len(face_boxes) > 0,
        "face_count": len(face_boxes),
        "faces": face_boxes,
        "image_width": image.shape[1],
        "image_height": image.shape[0]
    }

def extract_face_crop(image: np.ndarray, face_bbox: list, padding_ratio: float = 0.12) -> np.ndarray:
    """
    Crop a face region from an image with optional padding.
    face_bbox format: [x, y, w, h]
    """
    x, y, w, h = face_bbox
    pad_w = int(w * padding_ratio)
    pad_h = int(h * padding_ratio)

    x1 = max(0, x - pad_w)
    y1 = max(0, y - pad_h)
    x2 = min(image.shape[1], x + w + pad_w)
    y2 = min(image.shape[0], y + h + pad_h)

    crop = image[y1:y2, x1:x2]
    if crop.size == 0:
        raise ValueError("Failed to crop face region from image")
    return crop

def check_face_centered(face: list, image_width: int, image_height: int) -> bool:
    """
    Check if face is centered in the image
    
    Args:
        face: [x, y, width, height] of face bounding box
        image_width: Width of the image
        image_height: Height of the image
        
    Returns:
        True if face is centered (within 20% of center)
    """
    x, y, w, h = face
    face_center_x = x + w / 2
    face_center_y = y + h / 2
    
    image_center_x = image_width / 2
    image_center_y = image_height / 2
    
    # Allow 35% deviation from center (relaxed to accommodate natural handheld camera offsets)
    tolerance_x = image_width * 0.35
    tolerance_y = image_height * 0.35
    
    is_centered_x = abs(face_center_x - image_center_x) < tolerance_x
    is_centered_y = abs(face_center_y - image_center_y) < tolerance_y
    
    return bool(is_centered_x and is_centered_y)

def check_face_size(face: list, image_width: int, image_height: int) -> bool:
    """
    Check if face is large enough (at least 20% of image)
    
    Args:
        face: [x, y, width, height] of face bounding box
        image_width: Width of the image
        image_height: Height of the image
        
    Returns:
        True if face size is adequate
    """
    x, y, w, h = face
    face_area = w * h
    image_area = image_width * image_height
    
    # Face should be at least 8% of image area (more tolerant for low-end cameras)
    min_ratio = 0.08
    # Face should not be more than 80% of image area
    max_ratio = 0.80
    
    ratio = face_area / image_area
    return bool(min_ratio <= ratio <= max_ratio)

def check_image_blur(image: np.ndarray) -> tuple[bool, float]:
    """
    Check if image is blurry using Laplacian variance
    
    Args:
        image: OpenCV image (BGR format)
        
    Returns:
        (is_sharp, blur_score) - True if image is sharp enough
    """
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    laplacian_var = cv2.Laplacian(gray, cv2.CV_64F).var()
    
    # Higher value = sharper image. Tolerate lower-quality mobile cams.
    is_sharp = bool(laplacian_var > BLUR_THRESHOLD)
    
    return is_sharp, float(laplacian_var)

def check_image_brightness(image: np.ndarray) -> tuple[str, float]:
    """
    Check image brightness level
    
    Args:
        image: OpenCV image (BGR format)
        
    Returns:
        (status, brightness_value) - "good", "too_dark", or "too_bright"
    """
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    brightness = np.mean(gray)
    
    if brightness < 40:
        return "too_dark", float(brightness)
    elif brightness > 220:
        return "too_bright", float(brightness)
    else:
        return "good", float(brightness)

def check_liveness_basic(image: np.ndarray, face_bbox: list) -> tuple[bool, dict]:
    """
    Passive Liveness detection (anti-spoofing) powered by MiniFASNetV2 ONNX.
    Detects screen replays, monitor displays, Pinterest photos, and printed photos.
    
    Args:
        image: OpenCV image (BGR format)
        face_bbox: [x, y, w, h] of detected face
        
    Returns:
        (is_real, details) - True if confirmed live human face
    """
    is_real, live_score, details = liveness_detector.predict(image, face_bbox, threshold=0.60)
    details["confidence"] = round(live_score * 100, 2)
    details["liveness_score"] = round(live_score, 4)
    details["min_required"] = 0.60
    return is_real, details

def get_face_embedding(image: np.ndarray) -> list:
    """
    Generate face embedding using DeepFace
    OPTIMIZED: Uses 'skip' detector when face already detected for faster processing
    
    Args:
        image: OpenCV image (BGR format)
        
    Returns:
        128-dimensional face embedding vector (for Facenet)
    """
    try:
        # DeepFace.represent expects BGR image (OpenCV format)
        # Use 'skip' detector if face was already validated - much faster!
        embedding = DeepFace.represent(
            img_path=image,
            model_name=MODEL_NAME,
            detector_backend=DETECTOR_BACKEND,
            enforce_detection=True
        )
        
        if not embedding:
            raise ValueError("No face detected in image")
        
        first_emb = embedding[0] if isinstance(embedding, list) else embedding
        if isinstance(first_emb, dict) and "embedding" in first_emb:
            emb_vec = first_emb["embedding"]
            return list(emb_vec) if not isinstance(emb_vec, list) else emb_vec
        raise ValueError("Could not extract embedding from model output")
    except Exception as e:
        logger.error(f"Face embedding generation failed: {e}")
        raise ValueError(f"Could not generate face embedding: {str(e)}")

def get_face_embedding_fast(face_crop: np.ndarray) -> list:
    """
    FAST embedding extraction for pre-cropped face images.
    Skips face detection entirely - use when face is already extracted.
    
    Args:
        face_crop: Pre-cropped face region (BGR format)
        
    Returns:
        Face embedding vector
    """
    try:
        # Resize to model's expected input (160x160 for Facenet)
        face_resized = cv2.resize(face_crop, (160, 160))
        
        embedding = DeepFace.represent(
            img_path=face_resized,
            model_name=MODEL_NAME,
            detector_backend="skip",  # Skip detection - face already cropped
            enforce_detection=False
        )
        
        if not embedding:
            raise ValueError("Could not generate embedding")
        
        first_emb = embedding[0] if isinstance(embedding, list) else embedding
        if isinstance(first_emb, dict) and "embedding" in first_emb:
            emb_vec = first_emb["embedding"]
            return list(emb_vec) if not isinstance(emb_vec, list) else emb_vec
        raise ValueError("Could not extract embedding from model output")
    except Exception as e:
        logger.error(f"Fast embedding failed: {e}")
        raise ValueError(f"Could not generate face embedding: {str(e)}")

def calculate_similarity(embedding1: list, embedding2: list) -> float:
    """
    Calculate cosine similarity between two embeddings
    
    Args:
        embedding1: First face embedding vector
        embedding2: Second face embedding vector
        
    Returns:
        Similarity score (0-1, higher is more similar)
    """
    e1 = np.array(embedding1)
    e2 = np.array(embedding2)
    
    # Cosine similarity: dot(A,B) / (||A|| * ||B||)
    dot_product = np.dot(e1, e2)
    norm_product = np.linalg.norm(e1) * np.linalg.norm(e2)
    
    if norm_product == 0:
        return 0.0
    
    similarity = dot_product / norm_product
    
    # Ensure result is in valid range
    return float(np.clip(similarity, 0.0, 1.0))

def to_native(obj: Any) -> Any:
    """
    Convert numpy scalars, arrays, and collections to native Python types for JSON serialization.
    """
    if isinstance(obj, np.generic):
        return obj.item()
    if isinstance(obj, np.ndarray):
        return [to_native(v) for v in obj.tolist()]
    if isinstance(obj, dict):
        return {str(k): to_native(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple, set)):
        return [to_native(v) for v in obj]
    return obj

# ============================================
# API ENDPOINTS
# ============================================

@app.get("/")
async def root():
    """Health check endpoint"""
    return {
        "status": "ok", 
        "message": "Face Recognition API is running",
        "registered_users": len(face_database)
    }

@app.get("/api/health")
async def health_check():
    """Detailed health check"""
    # Check MongoDB connection
    db = get_mongo_db()
    mongodb_status = "connected" if db is not None else "disconnected"
    mongodb_residents = 0
    mongodb_logs = 0
    
    if db is not None:
        try:
            mongodb_residents = db.residents.count_documents({})
            mongodb_logs = db.face_registration_logs.count_documents({})
        except:
            pass
    
    return {
        "status": "healthy",
        "model": MODEL_NAME,
        "detector": DETECTOR_BACKEND,
        "registered_users": len(face_database),
        "duplicate_threshold": DUPLICATE_THRESHOLD,
        "match_threshold": FACE_MATCH_THRESHOLD,
        "mongodb": {
            "status": mongodb_status,
            "database": MONGODB_DB_NAME,
            "residents_count": mongodb_residents,
            "logs_count": mongodb_logs
        }
    }

@app.post("/api/face/detect", response_model=FaceDetectionResult)
async def detect_face(request: FaceDetectRequest, http_request: Request):
    """
    STEP 1: Detect and validate face in image
    Enhanced with liveness detection and image quality checks
    
    Checks:
    - Face detected
    - Only 1 face
    - Face is centered
    - Face size is adequate
    - Image not blurry
    - Good lighting
    - Liveness (anti-spoofing)
    """
    validation_details = {}
    try:
        enforce_face_attempt_limit(
            http_request,
            endpoint_name="detect",
            session_key=request.session_key,
        )
        logger.info("Face detection request received")
        
        # Decode image
        image = decode_base64_image(request.image)
        logger.info(f"Image decoded: {image.shape}")
        
        min_side = min(image.shape[0], image.shape[1])
        low_res = min_side < LOW_RES_THRESHOLD
        validation_details["low_res"] = low_res
        validation_details["min_side_px"] = int(min_side)
        
        # Check 1: Image blur
        is_sharp, blur_score = check_image_blur(image)
        validation_details["blur_score"] = blur_score
        validation_details["is_sharp"] = is_sharp
        
        if not is_sharp:
            print("\n" + "="*40)
            print("[Face-Screening] Engine: MiniFASNetV2 Dual-Scale (AI)")
            print(f"[Face-Screening] Quality Check: Blurry (Laplacian: {blur_score:.1f})")
            print("[Face-Screening] Status: REJECTED (Image too blurry)")
            print("="*40 + "\n")
            sys.stdout.flush()
            return FaceDetectionResult(
                has_face=False,
                face_count=0,
                is_centered=False,
                face_size_ok=False,
                is_real_image=False,
                image_quality="blurry",
                is_valid=False,
                message="Image is too blurry. Please hold still and try again.",
                validation_details=to_native(validation_details)
            )
        
        # Check 2: Image brightness
        brightness_status, brightness_value = check_image_brightness(image)
        validation_details["brightness"] = brightness_value
        validation_details["brightness_status"] = brightness_status
        
        if brightness_status == "too_dark":
            print("\n" + "="*40)
            print("[Face-Screening] Engine: MiniFASNetV2 Dual-Scale (AI)")
            print(f"[Face-Screening] Quality Check: Too Dark (Value: {brightness_value:.1f})")
            print("[Face-Screening] Status: REJECTED (Insufficient lighting)")
            print("="*40 + "\n")
            sys.stdout.flush()
            return FaceDetectionResult(
                has_face=False,
                face_count=0,
                is_centered=False,
                face_size_ok=False,
                is_real_image=False,
                image_quality="too_dark",
                is_valid=False,
                message="Image is too dark. Please move to a brighter area.",
                validation_details=to_native(validation_details)
            )
        elif brightness_status == "too_bright":
            print("\n" + "="*40)
            print("[Face-Screening] Engine: MiniFASNetV2 Dual-Scale (AI)")
            print(f"[Face-Screening] Quality Check: Too Bright (Value: {brightness_value:.1f})")
            print("[Face-Screening] Status: REJECTED (Excessive lighting/glare)")
            print("="*40 + "\n")
            sys.stdout.flush()
            return FaceDetectionResult(
                has_face=False,
                face_count=0,
                is_centered=False,
                face_size_ok=False,
                is_real_image=False,
                image_quality="too_bright",
                is_valid=False,
                message="Image is too bright. Please avoid direct light.",
                validation_details=to_native(validation_details)
            )
        
        # Check 3: Detect faces (DeepFace detector is more reliable than Haar)
        if DETECTOR_FOR_DETECT.lower() == "deepface":
            detection = detect_faces_deepface(image)
        else:
            detection = detect_faces_opencv(image)

        logger.info(f"Detection result: has_face={detection['has_face']}, face_count={detection['face_count']}")
        
        # No face detected
        if not detection["has_face"]:
            print("\n" + "="*40)
            print("[Face-Screening] Engine: MiniFASNetV2 Dual-Scale (AI)")
            print("[Face-Screening] Face Detected: False")
            print("[Face-Screening] Status: REJECTED (No face detected in frame)")
            print("="*40 + "\n")
            sys.stdout.flush()
            return FaceDetectionResult(
                has_face=False,
                face_count=0,
                is_centered=False,
                face_size_ok=False,
                is_real_image=False,
                image_quality="good",
                is_valid=False,
                message="No face detected. Please make sure your face is clearly visible.",
                validation_details=to_native(validation_details)
            )
        
        # Multiple faces detected
        if detection["face_count"] > 1:
            print("\n" + "="*40)
            print(f"[Face-Screening] Engine: MiniFASNetV2 Dual-Scale (AI)")
            print(f"[Face-Screening] Face Detected: Multiple ({detection['face_count']} faces)")
            print("[Face-Screening] Status: REJECTED (Only 1 face allowed)")
            print("="*40 + "\n")
            sys.stdout.flush()
            return FaceDetectionResult(
                has_face=True,
                face_count=detection["face_count"],
                is_centered=False,
                face_size_ok=False,
                is_real_image=False,
                image_quality="good",
                is_valid=False,
                message=f"Multiple faces detected ({detection['face_count']}). Only your face should be in the frame.",
                validation_details=to_native(validation_details)
            )
        
        # Single face - check position and size
        face = detection["faces"][0]
        is_centered = check_face_centered(
            face, 
            detection["image_width"], 
            detection["image_height"]
        )
        face_size_ok = check_face_size(
            face, 
            detection["image_width"], 
            detection["image_height"]
        )
        
        validation_details["is_centered"] = is_centered
        validation_details["face_size_ok"] = face_size_ok
        
        # Check 4: Face centering and framing
        if not is_centered:
            print("\n" + "="*40)
            print("[Face-Screening] Engine: MiniFASNetV2 Dual-Scale (AI)")
            print("[Face-Screening] Face Detected: True (1 face)")
            print(f"[Face-Screening] Centered: False | Size OK: {face_size_ok}")
            print("[Face-Screening] Status: REJECTED (Face not aligned inside oval indicator)")
            print("="*40 + "\n")
            sys.stdout.flush()
            return FaceDetectionResult(
                has_face=True,
                face_count=1,
                is_centered=False,
                face_size_ok=face_size_ok,
                is_real_image=True,
                image_quality="good",
                is_valid=False,
                message="Please align and center your face inside the oval indicator.",
                bounding_box={
                    "x": int(face[0]),
                    "y": int(face[1]),
                    "width": int(face[2]),
                    "height": int(face[3])
                },
                validation_details=to_native(validation_details)
            )

        if not face_size_ok:
            print("\n" + "="*40)
            print("[Face-Screening] Engine: MiniFASNetV2 Dual-Scale (AI)")
            print("[Face-Screening] Face Detected: True (1 face)")
            print(f"[Face-Screening] Centered: {bool(is_centered)} | Size OK: False")
            print("[Face-Screening] Status: REJECTED (Face distance/size does not fit oval indicator)")
            print("="*40 + "\n")
            sys.stdout.flush()
            return FaceDetectionResult(
                has_face=True,
                face_count=1,
                is_centered=bool(is_centered),
                face_size_ok=False,
                is_real_image=True,
                image_quality="good",
                is_valid=False,
                message="Please adjust your distance so your face fits inside the oval.",
                bounding_box={
                    "x": int(face[0]),
                    "y": int(face[1]),
                    "width": int(face[2]),
                    "height": int(face[3])
                },
                validation_details=to_native(validation_details)
            )

        # Check 5: Liveness detection (anti-spoofing)
        is_real, liveness_details = check_liveness_basic(image, face)
        validation_details["liveness"] = liveness_details
        
        if not is_real:
            attack_type = liveness_details.get("attack_type", "none")
            quality_flag = low_res or not is_sharp or validation_details.get("brightness_status") != "good"
            if attack_type == "screen_or_replay":
                msg = "Spoofing attempt detected: image appears to be from a screen or digital photo. Please scan a live person directly."
                img_quality = "screen_replay"
            elif attack_type == "printed_photo":
                msg = "Spoofing attempt detected: printed photograph detected. Please scan a live person directly."
                img_quality = "printed_photo"
            elif quality_flag:
                msg = "Image quality is too low to confirm liveness. Please retake with better lighting and move closer."
                img_quality = "low_res" if low_res else "good"
            else:
                msg = "Unable to confirm liveness. Please ensure you are not showing a photo/screen."
                img_quality = "good"

            print("\n" + "="*40)
            print(f"[Face-Screening] Engine: MiniFASNetV2 Dual-Scale (AI)")
            print(f"[Face-Screening] Genuine Live Face: False")
            print(f"[Face-Screening] Attack Type: {attack_type}")
            print(f"[Face-Screening] Live Score: {liveness_details.get('live_score', 0):.1%}")
            print(f"[Face-Screening] Context Live: {liveness_details.get('context_live', 0):.1%} | Detail Live: {liveness_details.get('detail_live', 0):.1%}")
            print(f"[Face-Screening] Screen Replay Score: {liveness_details.get('screen_replay_score', 0):.1%} | Print Score: {liveness_details.get('print_score', 0):.1%}")
            print(f"[Face-Screening] Centered: True | Size OK: True")
            print(f"[Face-Screening] Status: REJECTED (Spoofing attempt detected)")
            print("="*40 + "\n")
            sys.stdout.flush()

            return FaceDetectionResult(
                has_face=True,
                face_count=1,
                is_centered=bool(is_centered),
                face_size_ok=bool(face_size_ok),
                is_real_image=False,
                image_quality=img_quality,
                is_valid=False,
                message=msg,
                bounding_box={
                    "x": int(face[0]),
                    "y": int(face[1]),
                    "width": int(face[2]),
                    "height": int(face[3])
                },
                validation_details=to_native(validation_details)
            )
        
        # Build final response - Real, Centered, and Size OK
        print("\n" + "="*40)
        print(f"[Face-Screening] Engine: MiniFASNetV2 Dual-Scale (AI)")
        print(f"[Face-Screening] Genuine Live Face: True")
        print(f"[Face-Screening] Live Score: {liveness_details.get('live_score', 0):.1%}")
        print(f"[Face-Screening] Context Live: {liveness_details.get('context_live', 0):.1%} | Detail Live: {liveness_details.get('detail_live', 0):.1%}")
        print(f"[Face-Screening] Centered: True | Size OK: True")
        print(f"[Face-Screening] Status: PASSED (Live face accepted)")
        print("="*40 + "\n")
        sys.stdout.flush()
        
        return FaceDetectionResult(
            has_face=True,
            face_count=1,
            is_centered=True,
            face_size_ok=True,
            is_real_image=True,
            image_quality="good",
            is_valid=True,
            message="Perfect! Face validated successfully.",
            bounding_box={
                "x": int(face[0]),
                "y": int(face[1]),
                "width": int(face[2]),
                "height": int(face[3])
            },
            validation_details=to_native(validation_details)
        )
        
    except ValueError as e:
        logger.error(f"Face detection error: {e}")
        return FaceDetectionResult(
            has_face=False,
            face_count=0,
            is_centered=False,
            face_size_ok=False,
            is_real_image=False,
            image_quality="error",
            is_valid=False,
            message="Unable to process face image. Please try again.",
            validation_details=to_native(validation_details)
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Face detection failed: {e}")
        raise HTTPException(status_code=400, detail="Face detection failed.")

@app.post("/api/face/verify-active-liveness", response_model=ActiveLivenessResponse)
async def verify_active_liveness(request: ActiveLivenessRequest, http_request: Request):
    """
    Active 3D Challenge-Response Liveness Verification
    Evaluates:
    1. Frontal Pose: Centering, sizing, and MiniFASNet dual-scale anti-spoofing
    2. Challenge Pose: Real 3D Head rotation (Yaw delta >= 8 deg or symmetry change)
    3. Rejects identical/static photos (e.g. tablet displays, printed pictures held still)
    """
    try:
        enforce_face_attempt_limit(
            http_request,
            endpoint_name="active_liveness",
            session_key=request.session_key,
        )
        frontal_img = decode_base64_image(request.frontal_image)
        challenge_img = decode_base64_image(request.challenge_image)

        res = active_liveness_verifier.verify_active_liveness(
            frontal_image=frontal_img,
            challenge_image=challenge_img,
            challenge_type=request.challenge_type or "turn_any"
        )

        details = res.get("details", {})
        challenge_title = (request.challenge_type or "turn_any").replace("_", " ").title()
        print("\n" + "="*40)
        print(f"[Active-Liveness] Challenge: {challenge_title}")
        print(f"[Active-Liveness] Frontal Live Score: {details.get('frontal_live_score', 0):.1%}")
        print(f"[Active-Liveness] Yaw Delta: {details.get('yaw_delta', 0)} deg (signed: {details.get('signed_yaw_delta', 0)})")
        print(f"[Active-Liveness] Symmetry Delta: {details.get('symmetry_delta', 0)} (signed: {details.get('signed_sym_delta', 0)})")
        print(f"[Active-Liveness] Face Similarity: {details.get('face_similarity', 0)}")
        print(f"[Active-Liveness] Status: {res['status']} ({res['message']})")
        print("="*40 + "\n")
        sys.stdout.flush()

        return ActiveLivenessResponse(
            success=res["success"],
            is_live=res["is_live"],
            status=res["status"],
            message=res["message"],
            details=to_native(details)
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[Active-Liveness] Error: {e}", exc_info=True)
        return ActiveLivenessResponse(
            success=False,
            is_live=False,
            status="ERROR",
            message=f"Liveness verification encountered an error: {str(e)}"
        )

@app.post("/api/face/live-stream/evaluate-frame", response_model=LiveStreamFrameResponse)
async def evaluate_live_stream_frame_endpoint(request: LiveStreamFrameRequest):
    """
    Evaluate a live video frame from the client's continuous camera stream.
    Stage 1: Frontal face alignment + MiniFASNet anti-spoofing + baseline pose capture
    Stage 2: Continuous 3D head rotation tracking + direction validation + foreshortening verification
    """
    try:
        frame_img = decode_base64_image(request.image)
        res = active_liveness_verifier.evaluate_live_stream_frame(
            session_id=request.session_id,
            stage=request.stage or "frontal",
            frame_image=frame_img,
            reset_session=bool(request.reset_session)
        )
        return LiveStreamFrameResponse(
            success=res.get("success", True),
            status=res.get("status", "ALIGNING"),
            stage=res.get("stage", request.stage or "frontal"),
            progress=float(res.get("progress", 0.0)),
            feedback=res.get("feedback", ""),
            is_live=bool(res.get("is_live", False)),
            direction=res.get("direction"),
            details=to_native(res.get("details"))
        )
    except Exception as e:
        logger.error(f"[Live-Stream] Error evaluating frame: {e}", exc_info=True)
        return LiveStreamFrameResponse(
            success=False,
            status="ERROR",
            stage=request.stage or "frontal",
            progress=0.0,
            feedback="Frame processing encountered an error"
        )

@app.post("/api/face/register", response_model=FaceRegisterResponse)
async def register_face(request: FaceRegisterRequest):
    """
    STEP 2: Register a new face in the database
    
    Process:
    1. Decode image
    2. Detect face (ensure exactly 1 face)
    3. Generate face embedding
    4. Check for duplicates (1:N matching)
    5. Save to database if no duplicate
    """
    try:
        logger.info(f"Registration request for user: {request.name}")
        
        # Decode image
        image = decode_base64_image(request.image)
        image, low_light_enhanced, brightness = enhance_low_light_image(image)
        if low_light_enhanced:
            logger.info(f"Low-light enhancement enabled (brightness={brightness:.1f})")
        else:
            logger.info(f"Low-light enhancement not needed (brightness={brightness:.1f})")
        
        # Detect face first
        detection = detect_faces_opencv(image)
        
        if not detection["has_face"]:
            return FaceRegisterResponse(
                success=False,
                message="No face detected. Please ensure your face is visible."
            )
        
        if detection["face_count"] > 1:
            return FaceRegisterResponse(
                success=False,
                message="Multiple faces detected. Please ensure only one face is visible."
            )
        
        # Check if user ID already registered
        if request.user_id in face_database:
            return FaceRegisterResponse(
                success=False,
                message=f"User ID '{request.user_id}' is already registered."
            )
        
        # Generate embedding from pre-cropped face (skip second face detection)
        logger.info("Generating face embedding...")
        face_crop = extract_face_crop(image, detection["faces"][0])
        embedding = get_face_embedding_fast(face_crop)
        logger.info(f"Embedding generated: {len(embedding)} dimensions")
        
        # Check for duplicate face (1:N matching against existing faces)
        matrix = face_index.get("matrix")
        norms = face_index.get("norms")
        if len(face_index["user_ids"]) > 0 and matrix is not None and norms is not None:
            query = np.array(embedding, dtype=np.float32)
            query_norm = np.linalg.norm(query)
            if query_norm > 0:
                sims = np.dot(matrix, query) / (
                    (norms * query_norm) + 1e-12
                )
                best_idx = int(np.argmax(sims))
                best_similarity = float(np.clip(sims[best_idx], 0.0, 1.0))
                logger.info(f"Best duplicate similarity: {best_similarity:.4f}")
                if best_similarity > DUPLICATE_THRESHOLD:
                    return FaceRegisterResponse(
                        success=False,
                        message="This face is already registered. Duplicate registration not allowed."
                    )
        
        # Save to database
        face_database[request.user_id] = {
            "name": request.name,
            "embedding": embedding,
            "registered_at": datetime.now().isoformat()
        }
        rebuild_face_index()
        
        # Persist to file
        if not save_database():
            return FaceRegisterResponse(
                success=False,
                message="Registration failed. Could not save registration data."
            )
        
        logger.info(f"Successfully registered: {request.name}")
        return FaceRegisterResponse(
            success=True,
            message=f"Face registered successfully for {request.name}",
            user_id=request.user_id
        )
        
    except ValueError as e:
        logger.error(f"Registration error: {e}")
        return FaceRegisterResponse(
            success=False,
            message="Registration failed. Please submit a clearer image."
        )
    except Exception as e:
        logger.error(f"Registration failed: {e}")
        raise HTTPException(status_code=500, detail="Registration failed.")

# ============================================
# NEW: DUPLICATE CHECK FOR RESIDENT REGISTRATION
# ============================================

def get_all_embeddings_from_mongodb():
    """
    Fetch all face embeddings from MongoDB for duplicate checking
    Collection: face_embeddings (dedicated for face recognition)
    """
    db = get_mongo_db()
    if db is None:
        return []
    
    try:
        # Get from dedicated face_embeddings collection
        embeddings = list(db.face_embeddings.find(
            {"embedding_vector": {"$exists": True}},
            {"_id": 1, "resident_id": 1, "name": 1, "first_name": 1, "last_name": 1, "embedding_vector": 1}
        ))
        return embeddings
    except Exception as e:
        logger.error(f"Failed to fetch embeddings from MongoDB: {e}")
        return []

def save_registration_log(log_data: dict):
    """
    Save a registration attempt log to MongoDB
    Collection: face_registration_logs
    """
    db = get_mongo_db()
    if db is None:
        logger.warning("MongoDB not available - log not saved")
        return None
    
    try:
        log_data["timestamp"] = datetime.now()
        result = db.face_registration_logs.insert_one(log_data)
        print(f"  Log saved to MongoDB: {result.inserted_id}")
        return str(result.inserted_id)
    except Exception as e:
        logger.error(f"Failed to save registration log: {e}")
        return None

def save_face_embedding_to_mongodb(embedding_data: dict) -> Optional[str]:
    """
    Save face embedding to MongoDB
    Collection: face_embeddings (dedicated collection for face recognition)
    """
    db = get_mongo_db()
    if db is None:
        logger.warning("MongoDB not available - using in-memory storage")
        return None
    
    try:
        embedding_data["created_at"] = datetime.now()
        result = db.face_embeddings.insert_one(embedding_data)
        print(f"  Face embedding saved to MongoDB: {result.inserted_id}")
        return str(result.inserted_id)
    except Exception as e:
        logger.error(f"Failed to save face embedding to MongoDB: {e}")
        return None

@app.post("/api/face/check-duplicate", response_model=DuplicateCheckResponse)
async def check_duplicate_face(request: DuplicateCheckRequest, http_request: Request):
    """
    CHECK FOR DUPLICATE FACE DURING RESIDENT REGISTRATION
    
    This endpoint is called after photo capture to determine if registration should be allowed.
    
    Flow:
    1. Detect face in image
    2. Generate face embedding
    3. Compare against ALL registered residents in MongoDB
    4. Decision: ALLOW (no match) or BLOCK (duplicate found)
    5. Log the attempt
    6. If ALLOW: optionally save the resident
    
    Terminal Output Format:
    ========================
    Face Detected: Yes
    Best Match: Resident_03
    Similarity: 0.82
    Threshold: 0.75
    Decision: BLOCK (Duplicate)
    Processing Time: 214 ms
    ========================
    """
    start_time = time.time()
    
    # Default log entry
    log_entry = {
        "attempt_type": "ERROR",
        "best_match_resident_id": None,
        "similarity_score": None,
        "threshold_used": DUPLICATE_THRESHOLD,
        "decision": "ERROR",
        "processing_time_ms": 0,
        "resident_data": request.resident_data
    }
    
    try:
        resident_data = request.resident_data if isinstance(request.resident_data, dict) else {}
        rate_limit_session_key = str(
            resident_data.get("householdToken")
            or resident_data.get("mobileNumber")
            or ""
        ).strip()
        enforce_face_attempt_limit(
            http_request,
            endpoint_name="check-duplicate",
            session_key=rate_limit_session_key,
        )

        print("\n" + "="*60)
        print("  DUPLICATE FACE CHECK - REGISTRATION")
        print("="*60)
        sys.stdout.flush()
        
        # Step 1: Decode image
        image = decode_base64_image(request.image)
        image, low_light_enhanced, brightness = enhance_low_light_image(image)
        if low_light_enhanced:
            print(f"  Low-light enhancement: ON (brightness={brightness:.1f})")
        else:
            print(f"  Low-light enhancement: OFF (brightness={brightness:.1f})")
        print(f"  Image decoded: {image.shape[1]}x{image.shape[0]} px")
        sys.stdout.flush()
        
        # Step 2: Detect face
        detection = detect_faces_opencv(image)
        
        if not detection["has_face"]:
            processing_time = int((time.time() - start_time) * 1000)
            log_entry.update({
                "attempt_type": "ERROR",
                "decision": "ERROR",
                "processing_time_ms": processing_time
            })
            save_registration_log(log_entry)
            
            print(f"  Face Detected: No")
            print(f"  Decision: ERROR (No face detected)")
            print(f"  Processing Time: {processing_time} ms")
            print("="*60 + "\n")
            
            return DuplicateCheckResponse(
                success=False,
                face_detected=False,
                decision="ERROR",
                similarity=0.0,
                threshold=DUPLICATE_THRESHOLD,
                processing_time_ms=processing_time,
                message="No face detected. Please ensure your face is clearly visible."
            )
        
        if detection["face_count"] > 1:
            processing_time = int((time.time() - start_time) * 1000)
            log_entry.update({
                "attempt_type": "ERROR",
                "decision": "ERROR",
                "processing_time_ms": processing_time
            })
            save_registration_log(log_entry)
            
            print(f"  Face Detected: Yes ({detection['face_count']} faces)")
            print(f"  Decision: ERROR (Multiple faces)")
            print(f"  Processing Time: {processing_time} ms")
            print("="*60 + "\n")
            
            return DuplicateCheckResponse(
                success=False,
                face_detected=True,
                decision="ERROR",
                similarity=0.0,
                threshold=DUPLICATE_THRESHOLD,
                processing_time_ms=processing_time,
                message=f"Multiple faces detected ({detection['face_count']}). Only one face should be visible."
            )
        
        # Step 3: Generate face embedding from pre-cropped face
        print("  Generating face embedding...")
        face_crop = extract_face_crop(image, detection["faces"][0])
        embedding = get_face_embedding_fast(face_crop)
        print(f"  Embedding generated: {len(embedding)} dimensions")
        
        # Step 4: Get all registered embeddings from MongoDB (with in-memory fallback)
        registered_faces = get_all_embeddings_from_mongodb()
        
        # Fallback to local in-memory database only if MongoDB has no records
        if not registered_faces:
            load_database()
            for user_id, data in face_database.items():
                registered_faces.append({
                    "_id": user_id,
                    "resident_id": user_id,
                    "name": data.get("name", "Unknown"),
                    "embedding_vector": data.get("embedding", [])
                })
        
        print(f"  Comparing against {len(registered_faces)} registered faces...")
        
        # Step 5: Vectorized best-match search over all valid embeddings
        best_match = None
        best_similarity = 0.0
        valid_records = []
        embedding_rows = []

        for resident in registered_faces:
            stored_embedding = resident.get("embedding_vector", [])
            if not stored_embedding:
                continue

            valid_records.append(resident)
            embedding_rows.append(np.array(stored_embedding, dtype=np.float32))

        if len(embedding_rows) > 0:
            matrix = np.vstack(embedding_rows)
            norms = np.linalg.norm(matrix, axis=1)
            query = np.array(embedding, dtype=np.float32)
            query_norm = np.linalg.norm(query)

            if query_norm > 0:
                similarities = np.dot(matrix, query) / ((norms * query_norm) + 1e-12)
                similarities = np.clip(similarities, 0.0, 1.0)

                for i, resident in enumerate(valid_records):
                    resident_name = resident.get("name") or f"{resident.get('first_name', '')} {resident.get('last_name', '')}".strip() or str(resident.get("_id", "Unknown"))
                    print(f"    - {resident_name}: {float(similarities[i]):.4f}")

                best_idx = int(np.argmax(similarities))
                best_similarity = float(similarities[best_idx])
                best_resident = valid_records[best_idx]
                best_name = best_resident.get("name") or f"{best_resident.get('first_name', '')} {best_resident.get('last_name', '')}".strip() or str(best_resident.get("_id", "Unknown"))
                best_match = {
                    "id": str(best_resident.get("_id", "")),
                    "resident_id": best_resident.get("resident_id", ""),
                    "name": best_name
                }
        
        # Step 6: Make decision
        processing_time = int((time.time() - start_time) * 1000)
        
        if best_match and best_similarity >= DUPLICATE_THRESHOLD:
            # BLOCK - Duplicate detected
            decision = "BLOCK"
            message = "Face already registered."
            
            log_entry.update({
                "attempt_type": "BLOCK",
                "best_match_resident_id": best_match["id"],
                "similarity_score": round(best_similarity, 4),
                "decision": "BLOCK",
                "processing_time_ms": processing_time
            })
            save_registration_log(log_entry)
            
            # Terminal output - BLOCK
            print("-"*60)
            print(f"  Face Detected: Yes")
            print(f"  Best Match: {best_match['name']}")
            print(f"  Similarity: {best_similarity:.2f}")
            print(f"  Threshold: {DUPLICATE_THRESHOLD:.2f}")
            print(f"  Decision: BLOCK (Duplicate)")
            print(f"  Processing Time: {processing_time} ms")
            print("="*60 + "\n")
            sys.stdout.flush()
            
            return DuplicateCheckResponse(
                success=True,
                face_detected=True,
                decision="BLOCK",
                best_match_id=best_match["id"],
                best_match_name=None,
                similarity=round(best_similarity, 4),
                threshold=DUPLICATE_THRESHOLD,
                processing_time_ms=processing_time,
                message=message
            )
        else:
            # ALLOW - No duplicate found
            decision = "ALLOW"
            best_match_name = best_match["name"] if best_match else "None"
            best_match_id = best_match["id"] if best_match else None
            message = "No duplicate found. Registration allowed."
            
            # Save face embedding if resident_data provided
            embedding_id = None
            if request.resident_data:
                embedding_record = {
                    "resident_id": request.resident_data.get("resident_id", f"RES_{datetime.now().strftime('%Y%m%d%H%M%S')}"),
                    "first_name": request.resident_data.get("firstName", ""),
                    "last_name": request.resident_data.get("lastName", ""),
                    "name": f"{request.resident_data.get('firstName', '')} {request.resident_data.get('lastName', '')}".strip(),
                    "date_of_birth": request.resident_data.get("dateOfBirth", ""),
                    "gender": request.resident_data.get("gender", ""),
                    "mobile_number": request.resident_data.get("mobileNumber", ""),
                    "barangay": request.resident_data.get("barangay", ""),
                    "street_address": request.resident_data.get("streetAddress", ""),
                    "embedding_vector": embedding,
                    "face_image_path": "image not stored for privacy"
                }
                embedding_id = save_face_embedding_to_mongodb(embedding_record)
                
                # Also save to in-memory for backwards compatibility
                face_database[embedding_record["resident_id"]] = {
                    "name": embedding_record["name"],
                    "embedding": embedding,
                    "registered_at": datetime.now().isoformat()
                }
                rebuild_face_index()
                save_database()
            
            log_entry.update({
                "attempt_type": "ALLOW",
                "best_match_resident_id": best_match_id,
                "similarity_score": round(best_similarity, 4) if best_similarity > 0 else None,
                "decision": "ALLOW",
                "processing_time_ms": processing_time,
                "registered_embedding_id": embedding_id if embedding_id else None
            })
            save_registration_log(log_entry)
            
            # Terminal output - ALLOW
            print("-"*60)
            print(f"  Face Detected: Yes")
            print(f"  Best Match: {best_match_name}")
            print(f"  Similarity: {best_similarity:.2f}")
            print(f"  Threshold: {DUPLICATE_THRESHOLD:.2f}")
            print(f"  Decision: ALLOW (New Registration)")
            print(f"  Processing Time: {processing_time} ms")
            if embedding_id:
                print(f"  Embedding Saved: {embedding_id}")
            print("="*60 + "\n")
            sys.stdout.flush()
            
            return DuplicateCheckResponse(
                success=True,
                face_detected=True,
                decision="ALLOW",
                best_match_id=best_match_id,
                best_match_name=best_match_name if best_match else None,
                similarity=round(best_similarity, 4),
                threshold=DUPLICATE_THRESHOLD,
                processing_time_ms=processing_time,
                message=message,
                resident_id=embedding_id if embedding_id else None
            )
    
    except ValueError as e:
        processing_time = int((time.time() - start_time) * 1000)
        log_entry.update({
            "attempt_type": "ERROR",
            "decision": "ERROR",
            "processing_time_ms": processing_time,
            "error": str(e)
        })
        save_registration_log(log_entry)
        
        logger.error(f"Duplicate check error: {e}")
        print(f"  Decision: ERROR")
        print(f"  Processing Time: {processing_time} ms")
        print("="*60 + "\n")
        
        return DuplicateCheckResponse(
            success=False,
            face_detected=False,
            decision="ERROR",
            similarity=0.0,
            threshold=DUPLICATE_THRESHOLD,
            processing_time_ms=processing_time,
            message="Unable to process face check. Please retry."
        )
    except HTTPException:
        raise
    
    except Exception as e:
        processing_time = int((time.time() - start_time) * 1000)
        log_entry.update({
            "attempt_type": "ERROR",
            "decision": "ERROR",
            "processing_time_ms": processing_time,
            "error": str(e)
        })
        save_registration_log(log_entry)
        
        logger.error(f"Duplicate check failed: {e}")
        logger.info("="*60 + "\n")
        
        raise HTTPException(status_code=500, detail="Duplicate check failed.")

@app.get("/api/face/registration-logs")
async def get_registration_logs(limit: int = 50):
    """
    Get recent registration attempt logs
    """
    db = get_mongo_db()
    if db is None:
        return {"logs": [], "count": 0, "message": "MongoDB not connected"}
    
    try:
        logs = list(db.face_registration_logs.find().sort("timestamp", -1).limit(limit))
        # Convert ObjectId to string
        for log in logs:
            log["_id"] = str(log["_id"])
            if log.get("best_match_resident_id"):
                log["best_match_resident_id"] = str(log["best_match_resident_id"])
        
        return {"logs": logs, "count": len(logs)}
    except Exception as e:
        logger.error(f"Failed to fetch logs: {e}")
        return {"logs": [], "count": 0, "message": "Unable to fetch logs."}

@app.get("/api/face/residents")
async def get_residents(limit: int = 100):
    """
    Get registered residents from face_embeddings collection (without embedding vectors for security)
    """
    db = get_mongo_db()
    if db is None:
        # Fall back to in-memory database
        users = []
        for user_id, data in face_database.items():
            users.append({
                "resident_id": user_id,
                "name": data["name"],
                "registered_at": data["registered_at"]
            })
        return {"residents": users, "count": len(users), "source": "in-memory"}
    
    try:
        residents = list(db.face_embeddings.find(
            {},
            {"embedding_vector": 0}  # Exclude embedding for security
        ).sort("created_at", -1).limit(limit))
        
        # Convert ObjectId to string
        for r in residents:
            r["_id"] = str(r["_id"])
        
        return {"residents": residents, "count": len(residents), "source": "mongodb"}
    except Exception as e:
        logger.error(f"Failed to fetch residents: {e}")
        return {"residents": [], "count": 0, "message": "Unable to fetch residents."}

@app.post("/api/face/verify", response_model=FaceVerifyResponse)
async def verify_face(request: FaceVerifyRequest):
    """
    STEP 3: Verify face against all registered faces (1:N matching)
    
    Process:
    1. Decode image
    2. Detect face (ensure exactly 1 face)
    3. Generate face embedding
    4. Compare against ALL registered faces
    5. Find best match above threshold
    6. Return "Verified" or "Not Recognized"
    """
    try:
        logger.info("Verification request received")
        
        # Check if database is empty
        if len(face_index["user_ids"]) == 0:
            return FaceVerifyResponse(
                verified=False,
                confidence=0.0,
                message="No faces registered in the system yet."
            )
        
        # Decode image
        image = decode_base64_image(request.image)
        
        # Detect face first
        detection = detect_faces_opencv(image)
        
        if not detection["has_face"]:
            return FaceVerifyResponse(
                verified=False,
                confidence=0.0,
                message="No face detected. Please position your face properly."
            )
        
        if detection["face_count"] > 1:
            return FaceVerifyResponse(
                verified=False,
                confidence=0.0,
                message="Multiple faces detected. Please ensure only one face is visible."
            )
        
        # Generate embedding from pre-cropped face (skip second face detection)
        logger.info("Generating face embedding for verification...")
        face_crop = extract_face_crop(image, detection["faces"][0])
        embedding = get_face_embedding_fast(face_crop)
        
        # 1:N Matching - Vectorized cosine similarity against all registered faces
        query = np.array(embedding, dtype=np.float32)
        query_norm = np.linalg.norm(query)
        if query_norm == 0:
            return FaceVerifyResponse(
                verified=False,
                confidence=0.0,
                message="Unable to verify this image. Please try again."
            )

        logger.info(f"Comparing against {len(face_index['user_ids'])} registered faces...")
        matrix = face_index.get("matrix")
        norms = face_index.get("norms")
        if matrix is None or norms is None:
            return FaceVerifyResponse(
                verified=False,
                confidence=0.0,
                message="Face index is not initialized. Please try again."
            )

        similarities = np.dot(matrix, query) / (
            (norms * query_norm) + 1e-12
        )
        best_idx = int(np.argmax(similarities))
        best_similarity = float(np.clip(similarities[best_idx], 0.0, 1.0))
        best_match = {
            "user_id": face_index["user_ids"][best_idx],
            "name": face_index["names"][best_idx],
            "similarity": best_similarity,
        }
        
        # Check if best match exceeds threshold
        confidence_percent = round(best_similarity * 100, 2)
        
        if best_match and best_similarity >= FACE_MATCH_THRESHOLD:
            logger.info(f"✅ Verified as {best_match['name']} ({confidence_percent}%)")
            return FaceVerifyResponse(
                verified=True,
                user_id=best_match["user_id"],
                name=best_match["name"],
                confidence=confidence_percent,
                message=f"✅ Verified: {best_match['name']}"
            )
        else:
            logger.info(f"❌ Not recognized (best: {confidence_percent}%)")
            return FaceVerifyResponse(
                verified=False,
                confidence=confidence_percent,
                message="❌ Not Recognized: Face does not match any registered user."
            )
        
    except ValueError as e:
        logger.error(f"Verification error: {e}")
        return FaceVerifyResponse(
            verified=False,
            confidence=0.0,
            message="Unable to verify this image. Please try again."
        )
    except Exception as e:
        logger.error(f"Verification failed: {e}")
        raise HTTPException(status_code=500, detail="Verification failed.")

@app.get("/api/face/registered-users")
async def get_registered_users():
    """
    Get list of all registered users (without embeddings for security)
    """
    users = []
    for user_id, data in face_database.items():
        users.append({
            "user_id": user_id,
            "name": data["name"],
            "registered_at": data["registered_at"]
        })
    
    return {
        "users": users, 
        "count": len(users)
    }

@app.delete("/api/face/user/{user_id}")
async def delete_user(user_id: str, _auth: None = Depends(require_admin_auth)):
    """
    Delete a registered user from the database
    """
    if user_id not in face_database:
        raise HTTPException(status_code=404, detail="User not found")
    
    deleted_name = face_database[user_id]["name"]
    del face_database[user_id]
    rebuild_face_index()
    save_database()
    
    logger.info(f"Deleted user: {deleted_name} ({user_id})")
    return {
        "success": True, 
        "message": f"User '{deleted_name}' deleted successfully"
    }

@app.delete("/api/face/clear-all")
async def clear_all_users(_auth: None = Depends(require_admin_auth)):
    """
    Clear all registered users (for testing)
    """
    count = len(face_database)
    face_database.clear()
    rebuild_face_index()
    save_database()
    
    logger.info(f"Cleared all {count} users from database")
    return {
        "success": True,
        "message": f"Cleared {count} users from database"
    }

# ============================================
# ID DOCUMENT VERIFICATION (RAPIDOCR + FACE-ON-ID)
# ============================================

class IDVerifyRequest(BaseModel):
    image: str
    id_type: Optional[str] = None
    expected_id_number: Optional[str] = None

class IDVerifyResponse(BaseModel):
    success: bool
    is_valid_id: bool
    confidence: float
    has_portrait_face: bool
    aspect_ratio_valid: bool
    extracted_id_number: Optional[str] = None
    id_number_matched: bool = False
    detected_keywords: List[str] = []
    card_type_detected: str = "unknown"
    raw_text: str = ""
    reasons: List[str] = []
    error: Optional[str] = None

@app.post("/api/id/verify-document", response_model=IDVerifyResponse)
async def verify_id_document(request: IDVerifyRequest):
    """
    Verify ID Document Legitimacy:
    1. Checks if a cardholder portrait photo is present on the card
    2. Checks standard ID aspect ratio (ISO 7810 ID-1: ~1.58:1)
    3. Extracts text using RapidOCR (PP-OCRv4)
    4. Validates official Philippine government keywords
    5. Matches ID number if expected_id_number is provided
    """
    try:
        image = decode_base64_image(request.image)
        res = id_verifier.verify_document(
            image,
            id_type=request.id_type,
            expected_id_number=request.expected_id_number
        )
        print("\n" + "="*40)
        print(f"[ID-Screening] Active Engine: RapidOCR PP-OCRv4 (AI)")
        print(f"[ID-Screening] Valid Govt ID: {res['is_valid_id']}")
        print(f"[ID-Screening] Keywords: {res['detected_keywords']}")
        print(f"[ID-Screening] AI Reasons: {res['reasons']}")
        print("="*40 + "\n")
        sys.stdout.flush()
        return IDVerifyResponse(
            success=True,
            is_valid_id=res["is_valid_id"],
            confidence=res["confidence"],
            has_portrait_face=res["has_portrait_face"],
            aspect_ratio_valid=res["aspect_ratio_valid"],
            extracted_id_number=res["extracted_id_number"],
            id_number_matched=res["id_number_matched"],
            detected_keywords=res["detected_keywords"],
            card_type_detected=res["card_type_detected"],
            raw_text=res["raw_text"],
            reasons=res["reasons"]
        )
    except Exception as e:
        logger.error(f"[IDVerification] Verification error: {e}", exc_info=True)
        return IDVerifyResponse(
            success=False,
            is_valid_id=False,
            confidence=0.0,
            has_portrait_face=False,
            aspect_ratio_valid=False,
            error=str(e),
            reasons=[f"Document processing failed: {str(e)}"]
        )

# ============================================
# RUN SERVER
# ============================================

if __name__ == "__main__":
    import uvicorn
    
    print("\n" + "="*60)
    print("  FACE RECOGNITION API SERVER")
    print("="*60)
    print(f"  Model: {MODEL_NAME}")
    print(f"  Detector: {DETECTOR_BACKEND}")
    print(f"  Match Threshold: {FACE_MATCH_THRESHOLD}")
    print(f"  Duplicate Threshold: {DUPLICATE_THRESHOLD}")
    print(f"  Registered Users: {len(face_database)}")
    print("="*60)
    
    # Test MongoDB connection at startup
    print("  Testing MongoDB connection...")
    db = get_mongo_db()
    if db is not None:
        try:
            residents_count = db.residents.count_documents({})
            logs_count = db.face_registration_logs.count_documents({})
            print(f"  [OK] MongoDB Connected: {MONGODB_DB_NAME}")
            print(f"  [OK] Residents in DB: {residents_count}")
            print(f"  [OK] Registration Logs: {logs_count}")
        except Exception as e:
            print(f"  [ERROR] MongoDB Error: {e}")
    else:
        print("  [ERROR] MongoDB Not Connected (using in-memory storage)")
    
    print("="*60)
    print("  API Docs: http://localhost:8000/docs")
    print("  Duplicate Check: POST /api/face/check-duplicate")
    print("="*60 + "\n")
    
    uvicorn.run(app, host="0.0.0.0", port=8000)

