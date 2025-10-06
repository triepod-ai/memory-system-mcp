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

## Working Examples

This section provides functional example prompts demonstrating core features for developers working with the Memory System.

### Example 1: Entity Creation and Relationship Building Workflow

**Use Case**: Building a knowledge graph of a software project's architecture

**Prompt**: "Create entities for a React application's core components and their relationships"

```javascript
// Step 1: Create entities
await callTool("create_entities", {
  entities: [
    {
      name: "App Component",
      entityType: "react_component",
      observations: [
        "Root component of the application",
        "Manages global state with Context API",
        "Located in src/App.tsx"
      ]
    },
    {
      name: "User Service",
      entityType: "service",
      observations: [
        "Handles user authentication",
        "Uses JWT tokens",
        "Connects to /api/auth endpoint"
      ]
    },
    {
      name: "Dashboard Page",
      entityType: "react_component",
      observations: [
        "Main user interface after login",
        "Displays user metrics",
        "Uses Chart.js for visualizations"
      ]
    }
  ]
});

// Step 2: Create relationships
await callTool("create_relations", {
  relations: [
    {
      from: "App Component",
      to: "User Service",
      relationType: "uses"
    },
    {
      from: "App Component",
      to: "Dashboard Page",
      relationType: "renders"
    },
    {
      from: "Dashboard Page",
      to: "User Service",
      relationType: "depends_on"
    }
  ]
});
```

**Expected Output**: Structured response with created entities and relations, backend confirmation (Neo4j or file)

### Example 2: Debugging with Storage Status and Graph Summary

**Use Case**: Verifying system health and understanding graph state during development

**Prompt**: "Check the current state of my knowledge graph and verify backend connectivity"

```javascript
// Step 1: Check storage backend status
const status = await callTool("get_storage_status", {});
console.log("Backend:", status.currentBackend);
console.log("Neo4j Available:", status.neo4jAvailable);
console.log("Connection Health:", status.connectionHealth);

// Step 2: Get graph summary without loading full data
const summary = await callTool("get_graph_summary", {});
console.log("Total Entities:", summary.entityCount);
console.log("Total Relations:", summary.relationCount);
console.log("Entity Types:", summary.entityTypes);

// Step 3: If graph is large, use pagination
if (summary.entityCount > 50) {
  const page1 = await callTool("read_graph", {
    limit: 50,
    offset: 0
  });
  console.log("First page loaded:", page1.entities.length, "entities");
}
```

**Expected Output**:
- Storage status with backend type (neo4j/file) and health metrics
- Graph summary with counts and entity type distribution
- Paginated graph data if needed

**Developer Insight**: Use this pattern when debugging fallback issues or monitoring graph growth

### Example 3: Advanced Search with Bounded Relationships

**Use Case**: Finding related information in large knowledge graphs without context overflow

**Prompt**: "Search for TypeScript-related entities with controlled relationship loading"

```javascript
// For large graphs: Use bounded search to prevent token overflow
const results = await callTool("search_with_relationships", {
  query: "TypeScript",
  maxEntities: 15,              // Limit to 15 entities for context window
  maxRelationshipsPerEntity: 5  // Max 5 relationships per entity
});

// Check metadata to understand results
console.log("Total matches found:", results.metadata.totalEntitiesFound);
console.log("Relationships limited:", results.metadata.relationshipsLimited);
console.log("Backend used:", results.metadata.backendUsed);

// Process results
results.entities.forEach(entity => {
  console.log(`Entity: ${entity.name} (${entity.entityType})`);
  entity.observations.forEach(obs => console.log(`  - ${obs}`));
});

// Find specific entities by name
const specific = await callTool("open_nodes", {
  names: ["TypeScript", "React", "Node.js"]
});
```

**Expected Output**:
- Bounded result set with metadata transparency
- Relationship limiting detection (if >5 relations per entity exist)
- Backend confirmation and total match count

**Developer Insight**:
- Use `search_with_relationships` for large datasets (>50 entities)
- Use `search_nodes` for smaller datasets (<50 entities)
- Adjust `maxEntities` based on context window: 5-10 (tight), 15-25 (standard), 30-50 (large)
- Monitor `metadata.relationshipsLimited` to detect when you need to increase limits or fetch specific entities