# Local Development Setup

This guide explains how to set up the Memory System MCP Server for local development while keeping the repository clean for public distribution.

## Local Development Files

The following files are created for local development and are automatically ignored by git:

### `docker-compose.override.yml`
Contains your local development paths and configurations. Docker Compose automatically merges this with the main `docker-compose.yml`.

```yaml
services:
  memory-server:
    volumes:
      # Your local development path
      - /mnt/l/mcp_servers/memory/dist:/app/dist
    environment:
      # Your local Neo4j settings
      NEO4J_URI: neo4j://host.docker.internal:7687
      NEO4J_USER: neo4j
      NEO4J_PASSWORD: your_password
```

### `run-memory-local.sh`
Local development script that uses your preferred log directory and paths.

### `.env.local` (optional)
For any local environment variables you need.

## Setup Instructions

1. **Create your local override file**:
   ```bash
   cp docker-compose.override.yml.example docker-compose.override.yml
   # Edit with your local paths and credentials
   ```

2. **Create your local run script**:
   ```bash
   cp run-memory-local.sh.example run-memory-local.sh
   chmod +x run-memory-local.sh
   # Edit with your local paths
   ```

3. **Use local development commands**:
   ```bash
   # For local Docker development
   docker-compose up  # Automatically uses override file
   
   # For local script development
   ./run-memory-local.sh
   ```

## Public vs Local Configurations

| File | Public (in repo) | Local (gitignored) |
|------|------------------|-------------------|
| `docker-compose.yml` | Generic named volumes | `docker-compose.override.yml` with your paths |
| `run-memory.sh` | Uses `./logs` directory | `run-memory-local.sh` with `$HOME/.memory-mcp/logs` |
| Environment variables | Generic examples | `.env.local` with real credentials |

## Benefits

- **Repository stays clean**: No personal paths or credentials in git
- **Local development works**: Your existing setup continues to function
- **Easy sharing**: Others can clone and create their own local overrides
- **Docker Compose automatic**: Override files are automatically merged

## Important Notes

- Never commit `docker-compose.override.yml` - it contains your personal paths
- The main `docker-compose.yml` works for new users with named volumes
- Your local development setup remains exactly as it was before
- Use `./run-memory-local.sh` for your personal development workflow

## Working Examples

After completing your local setup, use these examples to verify the Memory System is working correctly.

### Example 1: Testing Basic Create/Read Operations

**Purpose**: Verify that entity creation and retrieval are working after setup

**Test Steps**:

```javascript
// Step 1: Create test entities
await callTool("create_entities", {
  entities: [
    {
      name: "Test Entity 1",
      entityType: "test",
      observations: ["Created during local setup verification"]
    },
    {
      name: "Test Entity 2",
      entityType: "test",
      observations: ["Second test entity"]
    }
  ]
});

// Step 2: Create a relationship
await callTool("create_relations", {
  relations: [
    {
      from: "Test Entity 1",
      to: "Test Entity 2",
      relationType: "connected_to"
    }
  ]
});

// Step 3: Read back the graph
const graph = await callTool("read_graph", {
  limit: 10,
  offset: 0
});

console.log("Entities created:", graph.entities.length);
console.log("Relations created:", graph.relations.length);
```

**Expected Result**:
- 2 entities created successfully
- 1 relation created successfully
- Graph read returns both entities and the relation
- No errors in console/logs

### Example 2: Verifying Neo4j Connection and Fallback Behavior

**Purpose**: Ensure Neo4j is properly connected OR fallback storage is working

**Test Steps**:

```javascript
// Step 1: Check storage backend status
const status = await callTool("get_storage_status", {});

console.log("Current Backend:", status.currentBackend);
console.log("Neo4j Configured:", status.neo4jConfigured);
console.log("Neo4j Available:", status.neo4jAvailable);
console.log("Connection Health:", status.connectionHealth);
console.log("File Path:", status.filePath);

// Step 2: Verify configuration
console.log("Configuration:", status.configuration);

// Step 3: Create entity to confirm backend is writable
await callTool("create_entities", {
  entities: [{
    name: "Backend Test Entity",
    entityType: "test",
    observations: ["Testing " + status.currentBackend + " backend"]
  }]
});
```

**Expected Results**:

**If Neo4j is configured and working**:
- `currentBackend: "neo4j"`
- `neo4jConfigured: true`
- `neo4jAvailable: true`
- `connectionHealth: "healthy"`
- Entity created in Neo4j database

**If using file fallback**:
- `currentBackend: "file"`
- `neo4jConfigured: false` OR `neo4jAvailable: false`
- `connectionHealth: "file_storage"`
- `filePath` shows location of JSON file
- Entity created in the JSON file

**Troubleshooting**:
- If Neo4j should be available but isn't, check `.env` or `docker-compose.override.yml` credentials
- Verify Neo4j is running on the configured port (default: 7687)
- Check logs: `docker-compose logs neo4j` or `docker-compose logs memory-server`

### Example 3: Testing Search Functionality with Sample Data

**Purpose**: Verify search capabilities are working with different query types

**Test Steps**:

```javascript
// Step 1: Create sample dataset
await callTool("create_entities", {
  entities: [
    {
      name: "JavaScript",
      entityType: "programming_language",
      observations: ["Dynamic typing", "Used for web development", "Runs on Node.js"]
    },
    {
      name: "Python",
      entityType: "programming_language",
      observations: ["Static/Dynamic typing", "Used for data science", "Great for automation"]
    },
    {
      name: "Docker",
      entityType: "tool",
      observations: ["Container platform", "Used for deployment", "Supports Node.js and Python"]
    }
  ]
});

await callTool("create_relations", {
  relations: [
    { from: "Docker", to: "JavaScript", relationType: "supports" },
    { from: "Docker", to: "Python", relationType: "supports" }
  ]
});

// Step 2: Test basic search
const searchResults = await callTool("search_nodes", {
  query: "Node.js"
});
console.log("Search 'Node.js' found:", searchResults.entities.length, "entities");

// Step 3: Test search with relationships
const advancedSearch = await callTool("search_with_relationships", {
  query: "Docker",
  maxEntities: 10,
  maxRelationshipsPerEntity: 5
});

console.log("Advanced search found:", advancedSearch.entities.length, "entities");
console.log("Metadata:", advancedSearch.metadata);

// Step 4: Get graph summary
const summary = await callTool("get_graph_summary", {});
console.log("Total entities in graph:", summary.entityCount);
console.log("Entity types:", summary.entityTypes);
```

**Expected Results**:
- Basic search finds JavaScript (contains "Node.js" in observations)
- Advanced search finds Docker + related entities
- Metadata shows `totalEntitiesFound`, `relationshipsLimited`, `backendUsed`
- Graph summary shows all entity types: `programming_language`, `tool`
- No search errors or timeouts

**Success Indicators**:
- ✅ All 3 entities created
- ✅ 2 relations created
- ✅ Search by observation content works (found "Node.js")
- ✅ Search with relationships returns entities + relations
- ✅ Metadata transparency working
- ✅ Graph summary accurate

If all three examples work correctly, your local setup is complete and functioning properly!