#!/bin/sh
set -e

export PORT=${PORT:-10000}
export PYTHON_BACKEND_URL=${PYTHON_BACKEND_URL:-http://127.0.0.1:8000}

echo "=== Starting Kapit-Bisig Unified Service ==="
echo "Node.js Port: $PORT"
echo "Python Internal URL: $PYTHON_BACKEND_URL"

mkdir -p /var/log/supervisor /var/run

exec /usr/bin/supervisord -n -c /etc/supervisor/conf.d/supervisord.conf
