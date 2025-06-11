# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an MCP (Model Context Protocol) server that provides persistent memory capabilities for Claude through a knowledge graph. The server supports two storage backends:

1. **Primary**: Neo4j graph database (requires NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD environment variables)
2. **Fallback**: JSON file storage (used when Neo4j is unavailable)

## Architecture

### Core Components

- **KnowledgeGraphManager**: Main class handling all graph operations with automatic Neo4j/file fallback
- **Entity**: Core graph nodes with name, entityType, and observations
- **Relation**: Directed connections between entities 
- **Observations**: Discrete facts attached to entities

### Data Storage

- **Neo4j Database**: Primary storage when configured via environment variables
- **File Storage**: Fallback to `memory_fallback.json` (or path specified by MEMORY_FILE_PATH)
- **Docker Volumes**: neo4j_data and memory_fallback_data for persistence

## Development Commands

### Build and Run
```bash
# Install dependencies and build
npm install
npm run build

# Build with file watching
npm run watch

# Run the server directly (requires build first)
node dist/index.js

# Run with Docker Compose (includes Neo4j)
docker-compose up

# Build Docker image
docker build -t mcp/memory .
```

### Testing the Server
```bash
# Test MCP protocol directly with stdio
echo '{"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2024-11-05", "capabilities": {}, "clientInfo": {"name": "test-client", "version": "1.0.0"}}}' | node dist/index.js
```

### From Virtual Environment (Windows)
```bash
# Activate Python venv and run with mcpo
venv_3_12\Scripts\activate
mcpo --host localhost --port 3333 -- node dist/index.js
```

### Batch Scripts (Windows)
- `build.bat`: Install dependencies and build
- `start-memory.bat`: Start server directly
- `run_mcpo.bat`: Start with mcpo in venv

## Environment Configuration

### Neo4j Setup (Optional but Recommended)
```bash
NEO4J_URI=neo4j://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=your_password
```

### File Storage Setup
```bash
MEMORY_FILE_PATH=/path/to/memory.json  # Optional, defaults to memory_fallback.json
```

## Key Implementation Details

### Automatic Fallback Logic
- Server attempts Neo4j connection on startup using `executeNeo4jOrFallback` pattern
- Falls back to file storage if Neo4j unavailable
- All operations have both Neo4j and file implementations
- Graceful degradation with error logging
- Session management with automatic cleanup

### Neo4j Features
- Unique constraints on entity names
- Indexes on entity types for performance
- MERGE operations prevent duplicates
- Proper relationship direction handling

### File Storage Format
- JSONL format with type indicators
- Entities: `{"type": "entity", "name": "...", "entityType": "...", "observations": [...]}`
- Relations: `{"type": "relation", "from": "...", "to": "...", "relationType": "..."}`

## MCP Tools Available

- `create_entities`: Create new graph entities
- `create_relations`: Create directed relationships
- `add_observations`: Add facts to existing entities  
- `delete_entities`: Remove entities and cascade relations
- `delete_observations`: Remove specific facts
- `delete_relations`: Remove specific relationships
- `read_graph`: Get graph structure with optional pagination (`limit`, `offset` parameters)
- `get_graph_summary`: Get entity/relation counts and entity types without loading data
- `search_nodes`: Query entities by content
- `open_nodes`: Retrieve specific entities by name
- `get_storage_status`: Get current storage backend status and fallback transparency

### Fallback Transparency

- **get_storage_status**: Use this tool to check which storage backend is currently active
- **Backend Tracking**: The system tracks which backend was used for the last operation
- **Status Information**: Shows configuration status, connection health, and file paths
- **Fallback Detection**: Alerts when operations fall back from Neo4j to file storage

Example `get_storage_status` response:
```json
{
  "currentBackend": "file",
  "lastOperationBackend": "file", 
  "neo4jConfigured": false,
  "neo4jAvailable": false,
  "filePath": "/app/dist/memory_fallback.json",
  "configuration": {
    "NEO4J_USER": "neo4j",
    "MEMORY_FILE_PATH": "/app/dist/memory_fallback.json"
  }
}
```

### Performance Considerations

- **read_graph**: Use `limit` and `offset` parameters for large graphs to prevent context overflow
- **get_graph_summary**: Use for quick stats without loading full graph data
- **get_storage_status**: Use to monitor which storage backend is active and detect fallbacks
- Neo4j queries are optimized with indexes on entity names and types

## Docker Deployment

### Single Container
```bash
docker run -i -v claude-memory:/app/dist --rm mcp/memory
```

### With Neo4j (Recommended)
```bash
docker-compose up -d
```

The docker-compose setup includes:
- Neo4j database with browser on port 7474
- Memory server with automatic Neo4j connection
- Persistent volumes for both services
- Process monitoring and cleanup scripts

## Process Management

- Graceful shutdown handling (SIGINT, SIGTERM)
- Automatic Neo4j driver cleanup
- Process cleaner script runs every 5 minutes in Docker
- Memory usage monitoring and restart capabilities