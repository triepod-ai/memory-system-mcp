#!/bin/bash

# Memory MCP Server Wrapper Script
# This script runs the memory MCP server from the current directory

# MCP protocol compliance setup
set -euo pipefail

# Log redirection setup (following MCP wrapper patterns)
LOG_DIR="$HOME/.memory-mcp/logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/memory-mcp-$(date +%Y%m%d-%H%M%S).log"

# Set Neo4j environment variables (update these as needed)
export NEO4J_URI="neo4j://localhost:7687"
export NEO4J_USER="neo4j"
export NEO4J_PASSWORD="password"

# Optional: Set custom memory file path for fallback storage
# export MEMORY_FILE_PATH="/path/to/custom/memory.json"

# Get the script directory to ensure we run from the correct location
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Change to the project directory
cd "$SCRIPT_DIR"

# Ensure the project is built
if [ ! -d "dist" ]; then
    echo "Building project..." >&2
    npm install >&2
    npm run build >&2
fi

# Log startup information to log file (not stderr to keep stdio clean)
{
    echo "Memory MCP Server starting..."
    echo "Running from directory: $SCRIPT_DIR"
    echo "Neo4j URI: $NEO4J_URI"
    echo "Logging to: $LOG_FILE"
    echo "---"
} >> "$LOG_FILE"

# Run the memory server with stderr redirected to log file
# stdout remains clean for MCP JSON-RPC protocol
exec node dist/index.js "$@" 2>> "$LOG_FILE"