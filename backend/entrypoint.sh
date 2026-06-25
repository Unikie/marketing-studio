#!/bin/bash
# Start backend API + worker (share SQLite in same container)
set -e

echo "[entrypoint] Starting backend API..."
npx tsx src/index.ts &

echo "[entrypoint] Starting worker..."
npx tsx src/worker.ts &

echo "[entrypoint] All services started."
wait -n
echo "[entrypoint] A process exited, shutting down..."
kill 0
