# Deployment Guide: Mobile (EAS & OTA Updates) and AI Backend (Hugging Face Spaces)

This guide documents the exact steps to deploy both the **Mobile App** (via Expo EAS & OTA Updates) and the **Python AI Face Recognition Backend** (via Hugging Face Spaces for 100% free 16GB RAM hosting).

---

## Part 1: Python AI Backend Deployment (Hugging Face Spaces)

### Why Hugging Face Spaces?
The Kapit-Bisig AI backend uses **DeepFace (Facenet)**, **TensorFlow**, **MediaPipe**, and **ONNXRuntime**, which require **~1GB to 2GB RAM** during inference. Most free cloud tiers (Render, Koyeb) only offer 512MB RAM and immediately crash with Out Of Memory (OOM). 
Hugging Face Spaces provides **2 vCPUs and 16 GB RAM completely free forever**, with native HTTPS and private environment variables.

### Step 1: Create a Space on Hugging Face
1. Log in or create a free account at [huggingface.co](https://huggingface.co).
2. Go to **New Space**: [huggingface.co/new-space](https://huggingface.co/new-space).
3. Fill in the details:
   - **Space name**: `kapit-bisig-face-api`
   - **License**: `mit`
   - **Space SDK**: Select **Docker** (choose **Blank** template)
   - **Space hardware**: Select **CPU basic • 2 vCPU • 16 GB RAM • Free**
   - **Privacy**: `Public` (or `Private` if you want it unlisted)
4. Click **Create Space**.

### Step 2: Configure Environment Variables (Secrets)
In your newly created Space:
1. Go to **Settings** > **Variables and secrets**.
2. Under **Secrets**, add:
   - `MONGODB_URI`: Your MongoDB Atlas connection string:
     ```text
     mongodb://emmandv_db_user:OdNGChGjS3uU1FQ5@ac-jm96xjz-shard-00-00.qdsctid.mongodb.net:27017,ac-jm96xjz-shard-00-01.qdsctid.mongodb.net:27017,ac-jm96xjz-shard-00-02.qdsctid.mongodb.net:27017/kapit-bisig?ssl=true&replicaSet=atlas-3983uk-shard-0&authSource=admin&retryWrites=true&w=majority
     ```
   - `MONGODB_DB_NAME`: `kapit-bisig`
   - `FACE_API_ALLOWED_ORIGINS`: `*`
   - `FACE_API_ADMIN_TOKEN`: Set a secure random string (e.g. `kapit-bisig-secret-admin-key-2026`)

### Step 3: Ensure MongoDB Atlas Accepts Cloud Connections
Because cloud containers have dynamic IP addresses:
1. Log in to [cloud.mongodb.com](https://cloud.mongodb.com).
2. Navigate to **Network Access** (under Security).
3. Click **Add IP Address**.
4. Select **Allow Access from Anywhere** (`0.0.0.0/0`) and click **Confirm**.

### Step 4: Push the Backend to Hugging Face
In your terminal, you can push the `backend/` directory to the Space repository:
```bash
# In the backend directory:
cd backend

# Initialize git if needed or add remote:
git remote add space https://huggingface.co/spaces/<YOUR_HF_USERNAME>/kapit-bisig-face-api

# Push to Hugging Face
git add .
git commit -m "Deploy AI backend to Hugging Face Spaces"
git push space main --force
```

*(Note: Hugging Face provides your personal access token in Settings > Access Tokens if password prompt appears).*

Once built, your public HTTPS endpoint will be:
`https://<YOUR_HF_USERNAME>-kapit-bisig-face-api.hf.space`

You can verify it by opening:
`https://<YOUR_HF_USERNAME>-kapit-bisig-face-api.hf.space/api/health`

---

## Part 2: Mobile App Deployment (Expo EAS & OTA Updates)

The mobile project is configured and linked to EAS account **`mrprinceu`**:
- **Project Name**: `@mrprinceu/kapit-bisig`
- **Project ID**: `ce00ce67-ccf9-4868-9fff-bf67223dd80c`
- **Updates URL**: `https://u.expo.dev/ce00ce67-ccf9-4868-9fff-bf67223dd80c`

### Step 1: Create an Android Preview APK Build
To generate a standalone APK that can be installed on Android devices:
```bash
cd mobile
npx eas-cli build --profile preview --platform android
```
- EAS will build the `.apk` in the cloud.
- Once finished, you will receive a QR code and download link to install the APK directly on Android phones.

### Step 2: Push Over-The-Air (OTA) Updates
Whenever you change JavaScript, React Native components, images, or offline sync logic (without adding new native Android/iOS native libraries):

**To push an update to Preview APK users:**
```bash
cd mobile
npx eas-cli update --branch preview --message "Description of changes"
```

**To push an update to Production users:**
```bash
cd mobile
npx eas-cli update --branch production --message "Description of changes"
```

The app's built-in `useOTAUpdates()` hook will automatically detect the new update on startup, download it in the background, and prompt the user to restart or reload the latest version!

### Step 3: Production Environment Variables in EAS
When deploying your production mobile app, point it to your deployed cloud backend and face API:
You can set them in EAS secrets so they are embedded during production builds:
```bash
cd mobile
npx eas-cli secret:create --name EXPO_PUBLIC_API_URL --value "https://your-main-backend.com/api" --type string
npx eas-cli secret:create --name EXPO_PUBLIC_FACE_API_URL --value "https://<YOUR_HF_USERNAME>-kapit-bisig-face-api.hf.space" --type string
```
Or define them directly under `"production": { "env": { ... } }` in `mobile/eas.json`.

---

## Part 3: Safety & Verification Checklist

- [x] **EAS Ownership**: Linked to `@mrprinceu/kapit-bisig` (`ce00ce67-ccf9-4868-9fff-bf67223dd80c`).
- [x] **OTA Updates**: `app.json` has `updates.url`, `checkAutomatically: "ON_LOAD"`, and runtime `useOTAUpdates()` hook.
- [x] **URL Security Guard**: `apiSecurity.ts` supports explicit `EXPO_PUBLIC_ALLOW_INSECURE_HTTP` for preview APK LAN testing, while strictly enforcing HTTPS for production.
- [x] **AI Docker Spec**: `backend/Dockerfile` configured with headless OpenCV, MediaPipe runtime libraries, non-root user (UID 1000), dynamic `$PORT`, and health check.
- [x] **AI Deploy Dependencies**: `backend/requirements-deploy.txt` created with `tensorflow-cpu` and `opencv-python-headless` for fast cloud container builds.
- [x] **TypeScript Validation**: `mobile` codebase passes `tsc --noEmit` with 0 errors.
