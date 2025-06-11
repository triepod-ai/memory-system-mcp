#!/bin/bash

# Memory MCP Server Wrapper Script
# This script runs the memory MCP server from the current directory

# Log redirection setup
LOG_DIR="./logs"
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
    echo "Building project..."
    npm install
    npm run build
fi

# Run the memory server
# Note: Removed stderr redirection to maintain MCP protocol compliance
# All logging is now handled via file-based logger in the application
exec node dist/index.js "$@"