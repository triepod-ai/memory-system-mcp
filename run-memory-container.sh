#!/bin/bash

# Memory MCP Server Docker Wrapper Script
# This script runs the memory MCP server using Docker Compose

# Log redirection setup
LOG_DIR="$HOME/.memory-mcp/logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/memory-mcp-docker-$(date +%Y%m%d-%H%M%S).log"

# Get the script directory to ensure we run from the correct location
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Change to the project directory
cd "$SCRIPT_DIR"

# Function to handle cleanup on exit
cleanup() {
    echo "Shutting down Memory MCP Server..." >&2
    docker-compose down >> "$LOG_FILE" 2>&1
}

# Set up signal handlers for graceful shutdown
trap cleanup EXIT SIGINT SIGTERM

# Start the memory server using Docker Compose
echo "Starting Memory MCP Server with Docker from: $SCRIPT_DIR" >&2
echo "Logging output to: $LOG_FILE" >&2

# Start the service and follow logs
exec docker-compose up memory-server "$@" >> "$LOG_FILE" 2>&1