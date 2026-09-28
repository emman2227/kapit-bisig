# Kapit-Bisig Web Deployment Guide (Vercel & Render)

This guide details the step-by-step procedure to deploy the **Kapit-Bisig** web platform to production:
- **Backend (Express API Server)**: Deployed to [Render.com](https://render.com)
- **Frontend (Next.js Web App)**: Deployed to [Vercel](https://vercel.com)
- **Database (MongoDB Atlas)**: Cloud-hosted MongoDB cluster

---

## 1. Prerequisites & Database Verification

The Superadmin account is now **fully stored and authenticated via MongoDB (`staffusers` collection)**.
Before deploying, ensure your MongoDB Atlas cluster has network access enabled (`0.0.0.0/0` or the specific IP ranges of Render).

You can run the migration command locally anytime to ensure the Superadmin record is seeded:
```bash
cd apps/web/apps
npm run migrate:superadmin
```

---

## 2. Deploying the Backend on Render.com

### Step 2.1: Create a Web Service
1. Log in to [Render Dashboard](https://dashboard.render.com/).
2. Click **New +** → **Web Service**.
3. Connect your GitHub repository (`kapit-bisig`).
4. Configure the service settings:
   - **Name**: `kapitbisig-api` (or your choice)
   - **Region**: Singapore (`ap-southeast`) or nearest to your users
   - **Branch**: `main`
   - **Root Directory**: leave blank (or `.`)
   - **Runtime**: `Docker`
   - **Dockerfile Path**: `Dockerfile.render`
   - **Instance Type**: Free (512 MB RAM)

> [!TIP]
> **Unified Deployment:** Using `Dockerfile.render` packages both the **Node.js Express API Server** and the **Python FastAPI AI Backend (FaceNet ONNX + RapidOCR)** inside a single container via `supervisord`. The entire container uses only **~330 MB idle / ~380 MB peak**, comfortably fitting into Render's 512 MB limit, running 24/7 with zero Cloudflare tunnels needed!

*(Alternative: Node-only without AI)*
- **Root Directory**: `apps/web/apps`
- **Runtime**: `Node`
- **Build Command**: `npm install && npm run server:build`
- **Start Command**: `npm run server:prod`

### Step 2.2: Set Environment Variables on Render
Under the **Environment** tab of your Render service, add the following environment variables:

| Variable | Recommended / Production Value | Notes |
| :--- | :--- | :--- |
| `NODE_ENV` | `production` | Enables production security & optimizations |
| `PORT` | `10000` | Render defaults to port 10000 |
| `MONGODB_URI` | `mongodb+srv://...` | Your MongoDB Atlas connection URI |
| `MONGODB_REQUIRE_TLS` | `true` | Required for secure cloud DB connection |
| `JWT_SECRET` | *32+ character random secret* | Must be at least 32 characters |
| `CORS_ORIGIN` | `https://<your-vercel-app>.vercel.app` | Your Vercel frontend domain |
| `COOKIE_SECURE` | `true` | Enforces HTTPS cookies |
| `SMTP_HOST` | `smtp-relay.brevo.com` | Your transactional email SMTP host |
| `SMTP_PORT` | `587` | SMTP port |
| `SMTP_SECURE` | `false` | TLS on port 587 |
| `SMTP_USER` | `bae989001@smtp-brevo.com` | Brevo SMTP username |
| `SMTP_PASS` | `xsmtpsib-...` | Brevo SMTP password / API key |
| `SMTP_FROM` | `kapitbisig2026@gmail.com` | Verified sender email |
| `APP_NAME` | `KapitBisig` | Sender display name |
| `SMS_PROVIDER` | `unisms` | SMS provider |
| `SMS_API_KEY` | `sk_paoMzls...` | UniSMS API key |
| `SMS_SENDER_NAME` | `Unisoft` | UniSMS sender name |

> [!NOTE]
> `SUPERADMIN_EMAIL` and `SUPERADMIN_PASSWORD_HASH` are now optional on Render because credentials are read directly from MongoDB. However, keeping `SUPERADMIN_EMAIL` in Render env variables allows automatic self-healing if the database is ever wiped or migrated.

---

## 3. Deploying the Frontend on Vercel

### Step 3.1: Import Project into Vercel
1. Log in to [Vercel Dashboard](https://vercel.com/).
2. Click **Add New...** → **Project**.
3. Select your GitHub repository (`kapit-bisig`).
4. In **Project Configuration**:
   - **Framework Preset**: Next.js
   - **Root Directory**: Click *Edit* and select:
     ```
     apps/web/apps
     ```
   - **Build Command**: `next build` (or leave default)
   - **Output Directory**: `.next` (or leave default)
   - **Install Command**: `npm install`

### Step 3.2: Configure Environment Variables on Vercel
In the Vercel **Environment Variables** section, add:

| Variable | Value | Notes |
| :--- | :--- | :--- |
| `API_PROXY_TARGET` | `https://<your-render-backend>.onrender.com/api` | Directs Next.js `/api/:path*` rewrites to Render |
| `NEXT_PUBLIC_API_URL` | `/api` | Uses local proxy route to prevent cross-origin cookie issues |

> [!IMPORTANT]
> Because Next.js uses server-side rewrites for `/api/*` to your Render backend, the browser always communicates with the same origin (`your-app.vercel.app`). This completely avoids third-party cookie restrictions in modern browsers!

---

## 4. Post-Deployment Verification Checklist

1. **Backend Health Check**:
   Visit `https://<your-render-backend>.onrender.com/api/health`
   Expected response:
   ```json
   {
     "status": "ok",
     "timestamp": "2026-09-25T..."
   }
   ```
2. **Superadmin Login Test**:
   - Navigate to `https://<your-vercel-app>.vercel.app/login`.
   - Sign in using the Superadmin credentials (`kapitbisig2026@gmail.com` and password).
   - Enter the 6-digit OTP code delivered to `kapitbisig2026@gmail.com`.
   - Verify successful redirect to `/dashboard` with full Superadmin privileges.
3. **Staff User Management**:
   - Navigate to **Manage Users** (`/users`).
   - Confirm that only `LGU_STAFF` users appear in the list, and the Superadmin account is safely protected and isolated.
4. **Superadmin Profile & Password Rotation**:
   - Go to **Settings** (`/settings`).
   - Confirm that Superadmin can view and update their profile and avatar.
   - For production security, change the Superadmin password under Settings using the email OTP verification.

---

## 5. Mobile App Configuration (`mobile/.env`)

When using the Unified Render Deployment, update `mobile/.env`:

```env
EXPO_PUBLIC_API_URL=https://kapitbisig-api.onrender.com/api
EXPO_PUBLIC_FACE_API_URL=https://kapitbisig-api.onrender.com
```

> [!NOTE]
> Since the Express API server proxies all mobile face recognition and ID OCR endpoints directly to the Python AI engine in the same Render container, no Cloudflare tunnel is needed anymore. Both the backend and AI are online 24/7!

