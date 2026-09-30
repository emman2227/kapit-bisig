# API Documentation

This document covers the complete active API surface for the **Kapit-Bisig** platform:
- **Express API Gateway** (`apps/web/apps/server`): Local port `3001` / Production `https://kapit-bisig.onrender.com/api`
- **FastAPI AI Service** (`backend/main.py`): Local port `8000` / Production internal `http://127.0.0.1:8000` (proxied by Express)

---

## 1. Express API Gateway (Node.js / Express)

**Local Base URL**: `http://localhost:3001/api`  
**Production Base URL**: `https://kapit-bisig.onrender.com/api`

### 1.1 Authentication & Profile
- `POST /api/auth/login`: Unified login for Superadmin and LGU Staff (issues email OTP for Superadmin).
- `POST /api/auth/verify-otp`: Verifies 6-digit OTP code and issues HTTP-only JWT cookie.
- `POST /api/auth/logout`: Clears session cookies and invalidates session token.
- `GET /api/auth/me`: Fetches authenticated user profile and permissions.
- `POST /api/auth/forgot-password/request-otp`: Initiates password reset OTP via registered email/SMS.
- `POST /api/auth/forgot-password/verify-otp`: Confirms OTP and returns a password reset authorization token.
- `POST /api/auth/forgot-password/reset-password`: Sets new password with confirmation token.
- `GET /api/users/me/profile`: Fetches detailed profile of currently logged-in user.
- `PUT /api/users/me/profile`: Updates profile details (enforces 24-hour cooldown and OTP confirmation).
- `POST /api/users/me/change-password`: Changes password with current password verification.

### 1.2 Mobile Client Authentication
- `POST /api/mobile-auth/login`: Volunteer and field staff token-based mobile authentication.
- `POST /api/mobile-auth/activate`: First-time mobile account activation via SMS OTP.
- `POST /api/household/login`: Resident login via mobile number and PIN.
- `POST /api/household/register`: Digital household registration and face descriptor submission.

### 1.3 Superadmin & Staff Management
- `GET /api/admin/users`: Lists all LGU staff accounts (isolated from Superadmin).
- `POST /api/admin/users`: Creates new LGU staff member with assigned barangay scopes.
- `PUT /api/admin/users/:id`: Modifies assigned barangays, status, or details.
- `DELETE /api/admin/users/:id`: Deactivates staff user.

### 1.4 AI Proxy Routes (Reverse-Proxied to Python FastAPI)
These routes are exposed directly by Express, automatically downscaled to 900 px via Sharp, and proxied internally to FastAPI:
- `POST /api/face/detect`: Validates face bounding box, lighting, blur, and centering.
- `POST /api/face/check-duplicate`: Checks face embedding against all residents in MongoDB (supports `exclude_resident_id`).
- `POST /api/face/verify`: Performs 1:N facial biometric match during distribution claims.
- `POST /api/face/verify-active-liveness`: 2-step challenge-response verifying 3D head rotation and parallax.
- `POST /api/id/verify-document`: Screens Philippine government IDs using RapidOCR PP-OCRv4 ONNX and Haar portrait face detector.

### 1.5 Distributions & Relief Operations
- `GET /api/distributions`: Lists active, planned, and archived distributions.
- `POST /api/distributions`: Creates new distribution event (supports General and Targeted types).
- `GET /api/distributions/:id`: Fetches distribution details, assigned staff, and progress metrics.
- `PATCH /api/distributions/:id/reschedule`: Reschedules a missed or postponed distribution cycle.
- `POST /api/distributions/:id/archive`: Manually archives a completed distribution.

### 1.6 Claims & Field Verification
- `POST /api/claims/verify`: Validates household proof QR code or face scan.
- `POST /api/claims/claim`: Records aid disbursement and marks household as claimed.
- `GET /api/claims/history/:householdId`: Fetches past distribution claim records for a household.

### 1.7 Offline Field Scanner Sync
- `GET /api/distributions/:id/offline-pack`: Pre-downloads encrypted beneficiary rosters for offline field centers.
- `POST /api/claims/sync`: Batches and synchronizes offline claims queued during network outages.

### 1.8 Reporting & Audit Logs
- `GET /api/reports/distribution-summary`: Aggregated distribution metrics, claim percentages, and timelines.
- `GET /api/audit-logs`: Immutable log of administrative actions, logins, status changes, and duplicate detections.
- `GET /api/notifications`: System alerts and distribution schedule announcements.

---

## 2. Python FastAPI AI Service

**Local Base URL**: `http://localhost:8000`  
**Swagger UI**: `http://localhost:8000/docs`  
*(In production, internal to Render container on `127.0.0.1:8000`)*

### 2.1 Health & Diagnostics
- `GET /`: Basic service ping.
- `GET /api/health`: Returns model name (`Facenet-ONNX`), active detector, threshold settings, and MongoDB status.

### 2.2 Biometrics & Face Embeddings
- `POST /api/face/detect`: Validates face image. Returns `has_face`, `face_count`, `is_centered`, `is_real_image`, `blur_score`.
- `POST /api/face/check-duplicate`: Converts face to 512-float FaceNet embedding and executes Cosine Similarity query against MongoDB Atlas.
- `POST /api/face/register`: Extracts and commits 512-d face vector to resident record.
- `POST /api/face/verify`: 1:N cosine similarity search returning matched `user_id`, `name`, and `confidence`.
- `POST /api/face/verify-active-liveness`: Evaluates frontal image and 3D rotated challenge image via `solvePnP`.

### 2.3 Deep-Learning ID Verification
- `POST /api/id/verify-document`:
  - Request: `{"image": "<base64_string>", "expected_id_type": "philsys", "applicant_name": "..."}`
  - Evaluates:
    - Auto-crop card boundary and ISO-7810 aspect ratio.
    - Cardholder portrait detection (`has_portrait`).
    - RapidOCR PP-OCRv4 text detection and recognition.
    - Philippine statutory issuing authority matching.
    - ID number format and applicant name Levenshtein cross-verification.
