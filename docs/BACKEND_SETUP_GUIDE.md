# Kapit-Bisig Backend Setup Guide

Complete guide for running the Python AI Face Recognition & ID Verification service, managing dependencies, and configuring environment variables.

---

## Table of Contents

1. [Python AI Backend Setup](#1-python-ai-backend-setup)
2. [Running the AI Service (Local & Production)](#2-running-the-ai-service-local--production)
3. [Environment Variables](#3-environment-variables)
4. [Models & Architecture](#4-models--architecture)
5. [Generating Household Tokens](#5-generating-household-tokens)
6. [Troubleshooting](#6-troubleshooting)

---

## 1. Python AI Backend Setup

### Prerequisites

- Python 3.10 or higher (Python 3.10 or 3.11 recommended)
- pip (Python package manager)
- MongoDB Atlas account (or local MongoDB)

### Installation Steps

```powershell
# 1. Navigate to the backend directory from project root
cd backend

# 2. Create a virtual environment
python -m venv venv

# 3. Activate the virtual environment
# Windows:
.\venv\Scripts\Activate
# macOS / Linux:
# source venv/bin/activate

# 4. Upgrade pip and install production dependencies
pip install --upgrade pip
pip install -r requirements-deploy.txt
```

### Core Dependencies Installed

| Package | Purpose |
|---------|---------|
| `fastapi` | High-performance asynchronous REST API framework |
| `uvicorn[standard]` | ASGI web server |
| `onnxruntime` | Pure CPU-optimized deep-learning inference engine |
| `opencv-python-headless` | Image pre-processing, Haar Cascade face detection, Canny edge detection |
| `rapidocr-onnxruntime` | PaddleOCR PP-OCRv4 deep-learning text detection and recognition |
| `mediapipe` | 3D facial landmark mesh detection for active liveness |
| `pymongo` | MongoDB driver for storing embeddings and audit logs |
| `pillow` | Image format conversion and EXIF orientation normalization |

---

## 2. Running the AI Service (Local & Production)

### Option A: Local Run via Project Root Script
From the monorepo root:
```powershell
npm run dev:face
```

### Option B: Direct Python Run
```powershell
cd backend
.\venv\Scripts\Activate
python main.py
```

### Option C: Uvicorn with Hot Reload (Development)
```powershell
cd backend
.\venv\Scripts\Activate
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

### Expected Startup Log

```text
INFO:main:Connecting to MongoDB Atlas...
INFO:main:Connected to MongoDB database: kapit-bisig
INFO:services.face_embedding_service:[FaceEmbedding] Model loaded from .../models/facenet/facenet.onnx (input: input, output: output)
INFO:services.id_verification_service:[IDVerification] RapidOCR engine initialized
INFO:uvicorn:Uvicorn running on http://0.0.0.0:8000 (Press CTRL+C to quit)
```

### Verify Service Health

Open your browser or run curl:
- **Health Check:** `http://localhost:8000/api/health`
- **Swagger Documentation:** `http://localhost:8000/docs`

---

## 3. Environment Variables (`backend/.env`)

```env
# Server
PORT=8000
HOST=0.0.0.0

# MongoDB Atlas
MONGODB_URI=mongodb+srv://<username>:<password>@<cluster>.mongodb.net/kapit-bisig?retryWrites=true&w=majority
MONGODB_DB_NAME=kapit-bisig

# Biometric & Anti-Spoofing Thresholds
MODEL_NAME=Facenet-ONNX
DUPLICATE_THRESHOLD=0.85
FACE_MATCH_THRESHOLD=0.65
BLUR_THRESHOLD=18
LOW_LIGHT_MEAN_THRESHOLD=75
LOW_LIGHT_GAMMA=1.4

# Face Capture Rate Limiting
ENABLE_FACE_ATTEMPT_LIMIT=true
FACE_ATTEMPT_LIMIT=10
FACE_ATTEMPT_WINDOW_SECONDS=900
FACE_ATTEMPT_LOCK_SECONDS=300

# CORS & Admin Token
FACE_API_ALLOWED_ORIGINS=*
FACE_API_ADMIN_TOKEN=your-random-secure-admin-token
```

---

## 4. Models & Architecture

All pre-trained ONNX models are stored locally under `backend/models/`:

```text
backend/models/
├── facenet/
│   └── facenet.onnx           # FaceNet-512 embedding engine (~90 MB)
├── minifasnet/
│   └── minifasnet_v2.onnx     # Passive anti-spoofing classifier (~1.7 MB)
└── rapidocr/                  # PP-OCRv4 detection and recognition ONNX models
```

### Memory Optimization Highlights
- **Lazy Loading**: FaceNet is initialized on-demand on the first face request, saving ~130 MB at idle startup.
- **Single Threading**: `intra_op_num_threads=1` and `inter_op_num_threads=1` prevent CPU thread storms from allocating excessive buffer memory.
- **Unified Render Container**: Runs alongside the Node.js Express server inside Render's 512 MB Free tier via `Dockerfile.render` and `supervisord`.

---

## 5. Generating Household Tokens

Tokens are required for household registration in the mobile app.

### Run Token Generation Script
```powershell
cd apps/web/apps
npm run generate:qr-sheet
```
This generates cryptographic household QR tokens and registers them in MongoDB.

---

## 6. Troubleshooting

### Problem: "Model not found at models/facenet/facenet.onnx"
- **Solution**: Ensure the ONNX file exists in `backend/models/facenet/facenet.onnx`.

### Problem: "RapidOCR failed to initialize"
- **Solution**: Ensure `rapidocr-onnxruntime>=1.4.0` is installed. Run `pip install -r requirements-deploy.txt`.

### Problem: "Container OOM / Process terminated on cloud"
- **Solution**: Ensure `det_limit_side_len=720` and `use_cls=False` are configured in `id_verification_service.py`, and that the Express server downscales incoming images to 900 px via Sharp before forwarding.
