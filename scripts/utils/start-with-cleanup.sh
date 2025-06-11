#!/bin/bash

# Start the server in the background
node dist/index.js &

# Get PID of the server process
SERVER_PID=$!

# Function to clean up child processes
cleanup() {
  echo "Cleaning up processes..."
  # Kill all node processes except the main one
  pkill -f "node.*index.js" || true
  exit 0
}

# Set trap to catch SIGTERM and other signals
trap cleanup SIGINT SIGTERM

# Set up a cron job to run the process cleaner every 5 minutes
echo "*/5 * * * * node /app/scripts/process-cleaner.js >> /app/logs/cron.log 2>&1" > /tmp/crontab
crontab /tmp/crontab

# Start crond in the background
crond || echo "Warning: cron not available"

# Wait for the server process
wait $SERVER_PID