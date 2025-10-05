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