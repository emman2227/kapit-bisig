# Multi-platform production Dockerfile for Kapit-Bisig AI Backend
# Fully optimized for Hugging Face Spaces (Free 16GB RAM) and standard Docker containers

FROM python:3.10-slim

# Prevent Python from writing .pyc and enable unbuffered output
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    DEBIAN_FRONTEND=noninteractive \
    PORT=7860 \
    HOME=/home/user

# Install OS dependencies for OpenCV, MediaPipe, and ONNX Runtime
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user (Hugging Face Spaces requirement UID 1000)
RUN useradd -m -u 1000 user
WORKDIR $HOME/app

# Install Python dependencies
COPY --chown=user:user requirements-deploy.txt .
RUN pip install --no-cache-dir --upgrade pip setuptools wheel && \
    pip install --no-cache-dir -r requirements-deploy.txt

# Copy backend source code
COPY --chown=user:user . .

# Ensure appropriate permissions for user directory and model weights cache
RUN mkdir -p $HOME/.deepface/weights && \
    chown -R user:user $HOME

USER user

# Hugging Face Spaces listens on port 7860 by default
EXPOSE 7860

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:${PORT}/api/health || exit 1

# Start FastAPI server via uvicorn
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-7860}"]
