# Memory System - MCP Server

Knowledge graph memory system with Neo4j/file storage fallback and type-safe structured outputs.

**Author**: Trienexus
**License**: MIT
**MCP SDK**: 1.18.2

## Features

- **Dual Storage Backend**: Neo4j primary with automatic JSON file fallback
- **12 MCP Tools**: Full entity/relation CRUD + advanced search capabilities
- **Type-Safe Outputs**: Structured schemas (MCP 2025-06-18) for all tool responses
- **Input Validation**: Runtime type and constraint validation
- **Context-Aware Search**: Bounded queries prevent token window overflow
- **Auto-Failover**: Seamless fallback when Neo4j unavailable

## What Makes This Fork Different

This fork extends the original memory-mcp with production-ready enhancements focused on developer experience, observability, and protocol compliance:

### 1. **MCP Logging Notifications**
Real-time log streaming through MCP protocol with dynamic level control. Clients receive structured log notifications (error/info/warning) without server restart. Perfect for debugging and production monitoring.

### 2. **Consistent Error Code System**
JSON-RPC 2.0 compliant error codes (-32001 to -32099) enable programmatic error handling. Clients can implement smart retry logic, specific error handling, and better user experiences based on error types (entity not found, validation errors, backend failures, etc.).

### 3. **Structured Output Schemas**
All 12 tools include type-safe `outputSchema` declarations per MCP 2025-06-18 spec. LLMs understand response formats before calling tools, improving context efficiency and integration reliability.

### 4. **Production-Ready Wrapper Scripts**
MCP-compliant wrapper scripts (`run-memory.sh`) with proper stdio handling, logging redirection, and environment management. Ready for deployment with Claude Desktop or other MCP clients.

### 5. **Comprehensive Developer Documentation**
Working examples in `docs/development/CLAUDE.md` demonstrate real-world usage patterns: entity creation workflows, debugging with storage status, bounded relationship searches, and context window management.

### 6. **Latest MCP SDK (1.18.2)**
Upgraded from SDK 1.0.1 to 1.18.2 (18 major versions), bringing OAuth support, audio content handling, enhanced error handling, CORS configuration, and middleware composition.

## Installation

### Prerequisites

- **Node.js**: v18.19.0 or higher (v20+ recommended)
- **npm**: v9.2.0 or higher
- **Neo4j** (optional): v5.0+ for graph database storage

### Step 1: Clone or Download

```bash
git clone <repository-url>
cd memory-mcp
```

### Step 2: Install Dependencies

```bash
npm install
```

### Step 3: Configure Environment

Create a `.env` file in the project root:

```bash
# Neo4j Configuration (optional - will use file storage if not configured)
NEO4J_URI=neo4j://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=your-password

# File Storage Path (optional - defaults to memory_fallback.json)
MEMORY_FILE_PATH=./data/memory.json
```

**Note**: If Neo4j variables are not set, the server automatically uses JSON file storage.

### Step 4: Build

```bash
npm run build
```

### Step 5: Start Server

```bash
npm start
```

The MCP server is now running and ready to accept tool calls via the Model Context Protocol.

## Usage Examples

### Example 1: Creating Entities and Relations

```typescript
// Create entities in the knowledge graph
await callTool("create_entities", {
  entities: [
    {
      name: "Alice",
      entityType: "person",
      observations: ["Software engineer", "Loves TypeScript"]
    },
    {
      name: "TypeScript",
      entityType: "technology",
      observations: ["Programming language", "Type-safe JavaScript"]
    }
  ]
});

// Create relationship between entities
await callTool("create_relations", {
  relations: [
    {
      from: "Alice",
      to: "TypeScript",
      relationType: "uses"
    }
  ]
});
```

**Output (Structured)**:
```json
{
  "entities": [
    { "name": "Alice", "entityType": "person", "observations": ["Software engineer", "Loves TypeScript"] },
    { "name": "TypeScript", "entityType": "technology", "observations": ["Programming language", "Type-safe JavaScript"] }
  ]
}
```

### Example 2: Context-Aware Search

```typescript
// Search with bounded results for token efficiency
await callTool("search_with_relationships", {
  query: "TypeScript",
  maxEntities: 10,           // Limit entities for context window
  maxRelationshipsPerEntity: 5  // Prevent relationship explosion
});
```

**Output (Structured with Metadata)**:
```json
{
  "entities": [
    { "name": "TypeScript", "entityType": "technology", "observations": [...] },
    { "name": "Alice", "entityType": "person", "observations": [...] }
  ],
  "relations": [
    { "from": "Alice", "to": "TypeScript", "relationType": "uses" }
  ],
  "metadata": {
    "totalEntitiesFound": 2,
    "relationshipsLimited": false,
    "backendUsed": "neo4j"
  }
}
```

### Example 3: Reading Graph with Pagination

```typescript
// Read knowledge graph with pagination
await callTool("read_graph", {
  limit: 50,   // Max entities per page
  offset: 0    // Starting position
});
```

**Output (Structured)**:
```json
{
  "entities": [ /* ... */ ],
  "relations": [ /* ... */ ]
}
```

### Example 4: Backend Status Monitoring

```typescript
// Check storage backend health
await callTool("get_storage_status", {});
```

**Output (Structured)**:
```json
{
  "currentBackend": "neo4j",
  "lastOperationBackend": "neo4j",
  "neo4jConfigured": true,
  "neo4jAvailable": true,
  "filePath": "/path/to/memory_fallback.json",
  "backendConsistent": true,
  "connectionHealth": "healthy",
  "configuration": {
    "NEO4J_URI": "neo4j://localhost:7687",
    "NEO4J_USER": "neo4j",
    "MEMORY_FILE_PATH": "./data/memory.json"
  }
}
```

## Structured Output Schemas (outputSchema)

All 12 tools provide **type-safe structured outputs** compliant with MCP specification 2025-06-18:

### Tool Categories

**Creation Tools** (return wrapped arrays):
- `create_entities` → `{ entities: Entity[] }`
- `create_relations` → `{ relations: Relation[] }`
- `add_observations` → `{ results: Array<{ entityName, addedObservations }> }`

**Deletion Tools** (return confirmation messages):
- `delete_entities` → `{ message: string }`
- `delete_observations` → `{ message: string }`
- `delete_relations` → `{ message: string }`

**Query Tools** (return graph structures):
- `read_graph` → `{ entities: Entity[], relations: Relation[] }`
- `search_nodes` → `{ entities: Entity[], relations: Relation[] }`
- `search_with_relationships` → `{ entities, relations, metadata }`
- `open_nodes` → `{ entities: Entity[], relations: Relation[] }`

**Status Tools** (return status objects):
- `get_graph_summary` → `{ entityCount, relationCount, entityTypes }`
- `get_storage_status` → `{ currentBackend, connectionHealth, ... }`

### Benefits of Structured Outputs

1. **Type Safety**: Clients can validate responses against declared schemas
2. **LLM Efficiency**: Models understand output formats before making calls
3. **Better Integration**: Clear expectations for response structures
4. **Runtime Validation**: Automatic validation by MCP SDK 1.18.2+

### Compatibility

- **MCP SDK 1.18.2+**: Full structured output support with validation
- **Older SDKs**: `outputSchema` gracefully ignored, tools remain functional
- **Backward Compatible**: 100% compatible with clients not supporting structured outputs

## MCP SDK Version

**Current Version**: TypeScript MCP SDK 1.18.2 (upgraded October 1, 2025)

This server uses the latest Model Context Protocol SDK with significant enhancements:

### New Features Available:
- **Structured Outputs**: Type-safe `outputSchema` for all tools
- **OAuth/OIDC Authentication**: Discovery support and OIDC ID token handling
- **Enhanced Tool Metadata**: `_meta` field support for tool definitions
- **Audio Content Support**: Handle audio content in protocol messages
- **Improved Error Handling**: Enhanced transport reliability and logging
- **CORS Configuration**: Browser-based client support
- **Composable Middleware**: Fetch middleware for authentication flows
- **Default Values**: Elicitation schema default value support

**Previous Version**: 1.0.1 → **Upgrade Jump**: 18 major versions (significant protocol improvements)

**Compatibility**: Fully backward compatible with existing MCP clients. New features are optional and enhance capabilities when supported by the client.

For complete MCP protocol documentation, see [Model Context Protocol](https://modelcontextprotocol.io/).

## Error Codes

This server implements consistent error codes following the JSON-RPC 2.0 specification that MCP is built on. This enables programmatic error handling and better client resilience.

### Standard JSON-RPC 2.0 Error Codes

| Code | Name | Description |
|------|------|-------------|
| `-32700` | Parse error | Invalid JSON received |
| `-32600` | Invalid Request | JSON-RPC request is not valid |
| `-32601` | Method not found | Tool does not exist |
| `-32602` | Invalid params | Invalid tool parameters |
| `-32603` | Internal error | Internal server error |

### Server-Defined Error Codes (-32000 to -32099)

#### Entity Errors
| Code | Name | Description | Example |
|------|------|-------------|---------|
| `-32001` | `ENTITY_NOT_FOUND` | Requested entity does not exist | Adding observations to non-existent entity |
| `-32002` | `DUPLICATE_ENTITY` | Entity already exists | (Reserved for future use) |

#### Relation Errors
| Code | Name | Description | Example |
|------|------|-------------|---------|
| `-32003` | `RELATION_NOT_FOUND` | Requested relation does not exist | (Reserved for future use) |
| `-32004` | `INVALID_RELATION` | Relation structure is invalid | (Reserved for future use) |

#### Storage Backend Errors
| Code | Name | Description | Example |
|------|------|-------------|---------|
| `-32010` | `NEO4J_CONNECTION_ERROR` | Cannot connect to Neo4j | (Reserved for future use) |
| `-32011` | `NEO4J_OPERATION_FAILED` | Neo4j query execution failed | Migration operation failure |
| `-32012` | `FILE_STORAGE_ERROR` | File storage operation failed | (Reserved for future use) |

#### Validation Errors
| Code | Name | Description | Example |
|------|------|-------------|---------|
| `-32020` | `VALIDATION_ERROR` | Input validation failed | (Reserved for future use) |
| `-32021` | `EMPTY_QUERY` | Search query is empty or whitespace | Empty search string provided |
| `-32022` | `PARAMETER_OUT_OF_RANGE` | Parameter value outside valid range | `maxEntities = 150` (valid range: 1-100) |

#### Query Errors
| Code | Name | Description | Example |
|------|------|-------------|---------|
| `-32030` | `GRAPH_QUERY_TIMEOUT` | Query exceeded timeout limit | (Reserved for future use) |
| `-32031` | `QUERY_EXECUTION_ERROR` | Query execution failed | (Reserved for future use) |

### Error Response Format

All errors follow the JSON-RPC 2.0 error response structure:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "error": {
    "code": -32001,
    "message": "Entity with name Alice not found in Neo4j",
    "data": {
      "entityName": "Alice",
      "backend": "neo4j"
    }
  }
}
```

### Client Error Handling Example

```typescript
try {
  await callTool("add_observations", {
    observations: [{ entityName: "NonExistent", contents: ["observation"] }]
  });
} catch (error) {
  if (error.code === -32001) {
    // Handle entity not found - maybe create it first
    console.log(`Entity not found: ${error.data.entityName}`);
  } else if (error.code === -32602) {
    // Handle invalid parameters
    console.log("Invalid parameters provided");
  } else if (error.code === -32022) {
    // Handle parameter out of range
    console.log(`Parameter ${error.data.parameter} out of range: ${error.data.range}`);
  }
}
```

### Benefits of Consistent Error Codes

1. **Programmatic Handling**: Clients can handle specific errors without parsing messages
2. **Retry Logic**: Implement smart retries based on error types (e.g., retry on `-32010` connection errors)
3. **User Experience**: Provide specific, actionable error messages to end users
4. **Debugging**: Track error patterns in logs and analytics
5. **API Stability**: Error codes remain stable even if messages change

## Testing

```bash
npm test                 # All tests
npm run test:unit        # Unit tests only
npm run test:integration # Integration tests
npm run test:validation  # Validation tests
```

## Documentation
- [Architecture Guide](docs/architecture/)
- [Development Setup](docs/development/)
- [Deployment Guide](docs/deployment/)

For detailed documentation, see [docs/README.md](docs/README.md).