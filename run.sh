#!/usr/bin/env bash
# Keep the game server alive (restarts on crash). Usage: ./run.sh  (PORT env optional)
cd "$(dirname "$0")"
while true; do
  node server.js
  echo "[$(date)] server exited with $?, restarting in 1s" >&2
  sleep 1
done
