#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ErrorCode,
  SetLevelRequestSchema,
  LoggingLevel,
} from "@modelcontextprotocol/sdk/types.js";
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from './logger.js';
import {
  createKnowledgeGraphManager,
  MCP_ERROR_CODES,
  type Entity,
  type Relation,
  type KnowledgeGraph,
  type KnowledgeGraphConfig
} from './knowledge-graph-manager.js';

// Neo4j Configuration from Environment Variables
const NEO4J_URI = process.env.NEO4J_URI;
const NEO4J_USER = process.env.NEO4J_USER;
const NEO4J_PASSWORD = process.env.NEO4J_PASSWORD;

// Define memory file path using environment variable with fallback
const defaultMemoryPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'memory_fallback.json');

const MEMORY_FILE_PATH = process.env.MEMORY_FILE_PATH
  ? path.isAbsolute(process.env.MEMORY_FILE_PATH)
    ? process.env.MEMORY_FILE_PATH
    : path.join(path.dirname(fileURLToPath(import.meta.url)), process.env.MEMORY_FILE_PATH)
  : defaultMemoryPath;

// Create knowledge graph manager
const config: KnowledgeGraphConfig = {
  NEO4J_URI,
  NEO4J_USER,
  NEO4J_PASSWORD,
  MEMORY_FILE_PATH
};

const knowledgeGraphManager = createKnowledgeGraphManager(config);


// Graceful shutdown
process.on('SIGINT', async () => {
  logger.info("Received SIGINT, shutting down...");
  await knowledgeGraphManager.close(); // Ensure Neo4j driver is closed
  await server.close();
  process.exit(0);
});
process.on('SIGTERM', async () => {
  logger.info("Received SIGTERM, shutting down...");
  await knowledgeGraphManager.close(); // Ensure Neo4j driver is closed
  await server.close();
  process.exit(0);
});


// The server instance and tools exposed to Claude
const server = new Server({
  name: "memory-server",
  version: "1.1.0", // Version bump reflecting Neo4j integration
},    {
    capabilities: {
      tools: {}, // Tools are defined below via setRequestHandler
      logging: {}, // Enable logging notifications
    },
  },);

// --- Logging Configuration ---
// Wire up the logger to send MCP notifications
logger.setMcpServer(server);
logger.setLoggingLevel("info");

server.setRequestHandler(SetLevelRequestSchema, async (request) => {
  const level = request.params.level;
  logger.setLoggingLevel(level);
  logger.info(`Logging level set to: ${level}`);
  return {};
});

// --- Tool Definitions and Handlers ---

// Define schemas separately for clarity
const entitySchema = {
    type: "object",
    properties: {
        name: { type: "string", description: "The name of the entity" },
        entityType: { type: "string", description: "The type of the entity" },
        observations: {
            type: "array",
            items: { type: "string" },
            description: "An array of observation contents associated with the entity",
            default: [] // Ensure observations default to empty array
        },
    },
    required: ["name", "entityType"], // Observations are optional on creation
};

const relationSchema = {
    type: "object",
    properties: {
        from: { type: "string", description: "The name of the entity where the relation starts" },
        to: { type: "string", description: "The name of the entity where the relation ends" },
        relationType: { type: "string", description: "The type of the relation" },
    },
    required: ["from", "to", "relationType"],
};

// Output schemas for type-safe responses (MCP 2025-06-18 feature)
const entityOutputSchema = {
    type: "object",
    properties: {
        name: { type: "string", description: "The name of the entity" },
        entityType: { type: "string", description: "The type of the entity" },
        observations: {
            type: "array",
            items: { type: "string" },
            description: "Array of observation contents associated with the entity"
        },
    },
    required: ["name", "entityType", "observations"],
};

const relationOutputSchema = {
    type: "object",
    properties: {
        from: { type: "string", description: "The name of the entity where the relation starts" },
        to: { type: "string", description: "The name of the entity where the relation ends" },
        relationType: { type: "string", description: "The type of the relation" },
    },
    required: ["from", "to", "relationType"],
};

const knowledgeGraphOutputSchema = {
    type: "object",
    properties: {
        entities: {
            type: "array",
            items: entityOutputSchema,
            description: "Array of entities in the knowledge graph"
        },
        relations: {
            type: "array",
            items: relationOutputSchema,
            description: "Array of relations between entities"
        },
    },
    required: ["entities", "relations"],
};

server.setRequestHandler(ListToolsRequestSchema, async () => {
  // Tools remain largely the same, description might be updated to mention Neo4j/fallback
  return {
    tools: [
      {
        name: "create_entities",
        description: "Create multiple new entities in the knowledge graph (Neo4j primary, file fallback)",
        inputSchema: {
          type: "object",
          properties: { entities: { type: "array", items: entitySchema, description: "An array of entity objects to create in the knowledge graph" } },
          required: ["entities"],
        },
        outputSchema: {
          type: "object",
          properties: {
            entities: {
              type: "array",
              items: entityOutputSchema,
              description: "Array of successfully created entities"
            }
          },
          required: ["entities"]
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
        },
      },
      {
        name: "create_relations",
        description: "Create multiple new relations between entities (Neo4j primary, file fallback). Relations should be in active voice",
        inputSchema: {
          type: "object",
          properties: { relations: { type: "array", items: relationSchema, description: "An array of relation objects to create between entities in the knowledge graph" } },
          required: ["relations"],
        },
        outputSchema: {
          type: "object",
          properties: {
            relations: {
              type: "array",
              items: relationOutputSchema,
              description: "Array of successfully created relations"
            }
          },
          required: ["relations"]
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
        },
      },
      {
        name: "add_observations",
        description: "Add new observations to existing entities (Neo4j primary, file fallback)",
        inputSchema: {
          type: "object",
          properties: {
            observations: {
              type: "array",
              description: "An array of objects, each specifying an entity and the observation contents to add to it",
              items: {
                type: "object",
                properties: {
                  entityName: { type: "string", description: "The name of the entity to add the observations to" },
                  contents: { type: "array", items: { type: "string" }, description: "An array of observation contents to add" },
                },
                required: ["entityName", "contents"],
              },
            },
          },
          required: ["observations"],
        },
        outputSchema: {
          type: "object",
          properties: {
            results: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  entityName: { type: "string", description: "Name of the entity that was updated" },
                  addedObservations: {
                    type: "array",
                    items: { type: "string" },
                    description: "Array of observations that were successfully added (excluding duplicates)"
                  }
                },
                required: ["entityName", "addedObservations"]
              },
              description: "Results showing which observations were added to each entity"
            }
          },
          required: ["results"]
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
        },
      },
      {
        name: "delete_entities",
        description: "Delete multiple entities and their associated relations (Neo4j primary, file fallback)",
        inputSchema: {
          type: "object",
          properties: { entityNames: { type: "array", items: { type: "string" }, description: "An array of entity names to delete" } },
          required: ["entityNames"],
        },
        outputSchema: {
          type: "object",
          properties: {
            message: {
              type: "string",
              description: "Success confirmation message"
            }
          },
          required: ["message"]
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
        },
      },
      {
        name: "delete_observations",
        description: "Delete specific observations from entities (Neo4j primary, file fallback)",
        inputSchema: {
          type: "object",
          properties: {
            deletions: {
              type: "array",
              description: "An array of objects, each specifying an entity and the observations to delete from it",
              items: {
                type: "object",
                properties: {
                  entityName: { type: "string", description: "The name of the entity containing the observations" },
                  observations: { type: "array", items: { type: "string" }, description: "An array of observations to delete" },
                },
                required: ["entityName", "observations"],
              },
            },
          },
          required: ["deletions"],
        },
        outputSchema: {
          type: "object",
          properties: {
            message: {
              type: "string",
              description: "Success confirmation message"
            }
          },
          required: ["message"]
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
        },
      },
      {
        name: "delete_relations",
        description: "Delete multiple relations (Neo4j primary, file fallback)",
        inputSchema: {
          type: "object",
          properties: { relations: { type: "array", items: relationSchema, description: "An array of relations to delete" } },
          required: ["relations"],
        },
        outputSchema: {
          type: "object",
          properties: {
            message: {
              type: "string",
              description: "Success confirmation message"
            }
          },
          required: ["message"]
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
        },
      },
      {
        name: "read_graph",
        description: "Read the knowledge graph with optional pagination (Neo4j primary, file fallback)",
        inputSchema: {
          type: "object",
          properties: {
            limit: { type: "number", description: "Maximum number of entities to return" },
            offset: { type: "number", description: "Number of entities to skip (for pagination)" }
          }
        },
        outputSchema: knowledgeGraphOutputSchema,
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
        },
      },
      {
        name: "search_nodes",
        description: "Basic knowledge graph search returning entities and their direct relationships. WHEN TO USE: Simple entity discovery, small-medium datasets (<100 entities expected), when you don't need relationship context, or for initial exploration. SELECTION CRITERIA: Choose this for straightforward searches where relationship explosion isn't a concern. Returns all matching entities without bounds. Searches entity names, types, and observations using case-insensitive matching. FALLBACK: Automatically falls back from Neo4j to file storage if needed.",
        inputSchema: {
          type: "object",
          properties: { query: { type: "string", description: "Search query to match against entity names, types, and observation content using case-insensitive partial matching. Will search across all entities without limits - consider search_with_relationships for large datasets or bounded results." } },
          required: ["query"],
        },
        outputSchema: knowledgeGraphOutputSchema,
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
        },
      },
      {
        name: "search_with_relationships",
        description: "Context-safe knowledge graph search with bounded relationship discovery to prevent overwhelming results. WHEN TO USE: Large datasets (>50 entities expected), when you need relationship context, tight context windows, or adaptive behavior based on result size. SELECTION CRITERIA: Choose for complex analysis, relationship mapping, or when context management is critical. BOUNDED RESULTS: maxEntities (default: 20) and maxRelationshipsPerEntity (default: 5) prevent result explosion. METADATA TRANSPARENCY: Returns totalEntitiesFound, relationshipsLimited flag, and backendUsed for adaptive behavior. FALLBACK STRATEGY: Falls back to simple search on query failures, then to file storage if Neo4j unavailable.",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search query to match against entity names, types, and observation content using case-insensitive partial matching. Results will be bounded by maxEntities and maxRelationshipsPerEntity parameters." },
            maxEntities: { type: "number", description: "Maximum number of entities to return for context management (default: 20). Use 5-10 for tight context windows (~16K tokens), 15-25 for standard windows (~32K tokens), 30-50 for large context windows (~128K+ tokens).", default: 20 },
            maxRelationshipsPerEntity: { type: "number", description: "Maximum relationships per entity to prevent relationship explosion (default: 5). Use 2-3 for minimal context usage, 4-6 for balanced analysis, 8-12 for comprehensive relationship mapping. Higher values increase token usage exponentially.", default: 5 },
            fallbackToSimple: { type: "boolean", description: "Automatically fallback to simple search if enhanced search fails (default: true). Recommended to keep enabled for reliability.", default: true }
          },
          required: ["query"],
        },
        outputSchema: {
          type: "object",
          properties: {
            entities: {
              type: "array",
              items: entityOutputSchema,
              description: "Array of matching entities"
            },
            relations: {
              type: "array",
              items: relationOutputSchema,
              description: "Array of relations between matching entities (bounded by maxRelationshipsPerEntity)"
            },
            metadata: {
              type: "object",
              properties: {
                totalEntitiesFound: { type: "number", description: "Total number of entities that matched the query" },
                relationshipsLimited: { type: "boolean", description: "True if relationship results were truncated due to maxRelationshipsPerEntity limit" },
                backendUsed: { type: "string", enum: ["neo4j", "file"], description: "Storage backend that was used for this query" }
              },
              required: ["totalEntitiesFound", "relationshipsLimited", "backendUsed"],
              description: "Metadata about search execution and result bounding"
            }
          },
          required: ["entities", "relations", "metadata"],
          description: "Knowledge graph search results with metadata for adaptive behavior"
        },
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
        },
      },
      {
        name: "open_nodes",
        description: "Open specific nodes in the knowledge graph by their names (Neo4j primary, file fallback)",
        inputSchema: {
          type: "object",
          properties: { names: { type: "array", items: { type: "string" }, description: "An array of entity names to retrieve" } },
          required: ["names"],
        },
        outputSchema: knowledgeGraphOutputSchema,
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
        },
      },
      {
        name: "get_graph_summary",
        description: "Get summary statistics of the knowledge graph (Neo4j primary, file fallback)",
        inputSchema: { type: "object", properties: {} },
        outputSchema: {
          type: "object",
          properties: {
            entityCount: { type: "number", description: "Total number of entities in the graph" },
            relationCount: { type: "number", description: "Total number of relations in the graph" },
            entityTypes: {
              type: "array",
              items: { type: "string" },
              description: "List of unique entity types in the graph (sorted alphabetically)"
            }
          },
          required: ["entityCount", "relationCount", "entityTypes"],
          description: "Summary statistics of the knowledge graph"
        },
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
        },
      },
      {
        name: "get_storage_status",
        description: "Get current storage backend status and connection information",
        inputSchema: { type: "object", properties: {} },
        outputSchema: {
          type: "object",
          properties: {
            currentBackend: { type: "string", enum: ["neo4j", "file"], description: "Currently active storage backend" },
            lastOperationBackend: { type: "string", enum: ["neo4j", "file"], description: "Backend used for the last operation" },
            neo4jConfigured: { type: "boolean", description: "Whether Neo4j connection is configured via environment variables" },
            neo4jAvailable: { type: "boolean", description: "Whether Neo4j is currently available and connected" },
            filePath: { type: "string", description: "Path to the fallback JSON file" },
            backendConsistent: { type: "boolean", description: "Whether current backend matches last operation backend" },
            connectionHealth: {
              type: "string",
              enum: ["healthy", "degraded", "unavailable"],
              description: "Overall connection health status"
            },
            configuration: {
              type: "object",
              properties: {
                NEO4J_URI: { type: "string", description: "Neo4j connection URI (password masked if present)" },
                NEO4J_USER: { type: "string", description: "Neo4j username" },
                MEMORY_FILE_PATH: { type: "string", description: "Fallback file path" }
              },
              description: "Current configuration details"
            }
          },
          required: ["currentBackend", "lastOperationBackend", "neo4jConfigured", "neo4jAvailable", "filePath", "backendConsistent", "connectionHealth", "configuration"],
          description: "Detailed storage backend status and health information"
        },
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
        },
      },
    ]
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  // Basic validation, more specific validation could be added per tool using JSON schema validation if needed
  // Allow tools with no arguments like read_graph and get_storage_status
  if (!args && name !== "read_graph" && name !== "get_graph_summary" && name !== "get_storage_status") {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Arguments are required for tool: ${name}`,
        { toolName: name }
      );
  }

  try {
    let result: any; // To hold the result from the manager
    switch (name) {
      case "create_entities":
        if (!args?.entities || !Array.isArray(args.entities)) {
          throw new McpError(
            ErrorCode.InvalidParams,
            "Invalid arguments for create_entities: entities array is required."
          );
        }
        result = await knowledgeGraphManager.createEntities(args.entities as Entity[]);
        break;
      case "create_relations":
        if (!args?.relations || !Array.isArray(args.relations)) {
          throw new McpError(
            ErrorCode.InvalidParams,
            "Invalid arguments for create_relations: relations array is required."
          );
        }
        result = await knowledgeGraphManager.createRelations(args.relations as Relation[]);
        break;
      case "add_observations":
        if (!args?.observations || !Array.isArray(args.observations)) {
          throw new McpError(
            ErrorCode.InvalidParams,
            "Invalid arguments for add_observations: observations array is required."
          );
        }
        result = await knowledgeGraphManager.addObservations(args.observations as { entityName: string; contents: string[] }[]);
        break;
      case "delete_entities":
        if (!args?.entityNames || !Array.isArray(args.entityNames)) {
          throw new McpError(
            ErrorCode.InvalidParams,
            "Invalid arguments for delete_entities: entityNames array is required."
          );
        }
        await knowledgeGraphManager.deleteEntities(args.entityNames as string[]);
        result = "Entities deleted successfully"; // Return confirmation message
        break;
      case "delete_observations":
        if (!args?.deletions || !Array.isArray(args.deletions)) {
          throw new McpError(
            ErrorCode.InvalidParams,
            "Invalid arguments for delete_observations: deletions array is required."
          );
        }
        await knowledgeGraphManager.deleteObservations(args.deletions as { entityName: string; observations: string[] }[]);
        result = "Observations deleted successfully";
        break;
      case "delete_relations":
        if (!args?.relations || !Array.isArray(args.relations)) {
          throw new McpError(
            ErrorCode.InvalidParams,
            "Invalid arguments for delete_relations: relations array is required."
          );
        }
        await knowledgeGraphManager.deleteRelations(args.relations as Relation[]);
        result = "Relations deleted successfully";
        break;
      case "read_graph":
        // Validate optional limit parameter
        if (args?.limit !== undefined) {
          if (typeof args.limit !== 'number' || !Number.isInteger(args.limit) || args.limit < 1) {
            throw new McpError(
              MCP_ERROR_CODES.PARAMETER_OUT_OF_RANGE,
              "limit must be a positive integer",
              { parameter: "limit", value: args.limit }
            );
          }
        }

        // Validate optional offset parameter
        if (args?.offset !== undefined) {
          if (typeof args.offset !== 'number' || !Number.isInteger(args.offset) || args.offset < 0) {
            throw new McpError(
              MCP_ERROR_CODES.PARAMETER_OUT_OF_RANGE,
              "offset must be a non-negative integer",
              { parameter: "offset", value: args.offset }
            );
          }
        }

        result = await knowledgeGraphManager.readGraph(
          args?.limit as number | undefined,
          args?.offset as number | undefined
        );
        break;
      case "search_nodes":
        if (!args || typeof args.query !== 'string') {
          throw new McpError(
            ErrorCode.InvalidParams,
            "Invalid arguments for search_nodes: query string is required and cannot be empty."
          );
        }
        if (args.query.trim().length === 0) {
          throw new McpError(
            MCP_ERROR_CODES.EMPTY_QUERY,
            "search_nodes query cannot be empty or only whitespace.",
            { query: args.query }
          );
        }
        result = await knowledgeGraphManager.searchNodes(args.query as string);
        break;
      case "search_with_relationships":
        if (!args || typeof args.query !== 'string') {
          throw new McpError(
            ErrorCode.InvalidParams,
            "Invalid arguments for search_with_relationships: query string is required and cannot be empty."
          );
        }
        if (args.query.trim().length === 0) {
          throw new McpError(
            MCP_ERROR_CODES.EMPTY_QUERY,
            "search_with_relationships query cannot be empty or only whitespace.",
            { query: args.query }
          );
        }

        // Validate maxEntities range
        if (args.maxEntities !== undefined) {
          if (typeof args.maxEntities !== 'number' || args.maxEntities < 1 || args.maxEntities > 100) {
            throw new McpError(
              MCP_ERROR_CODES.PARAMETER_OUT_OF_RANGE,
              "maxEntities must be a number between 1 and 100. Use 5-10 for tight context windows, 15-25 for standard windows, 30-50 for large contexts.",
              { parameter: "maxEntities", value: args.maxEntities, range: "1-100" }
            );
          }
        }

        // Validate maxRelationshipsPerEntity range
        if (args.maxRelationshipsPerEntity !== undefined) {
          if (typeof args.maxRelationshipsPerEntity !== 'number' || args.maxRelationshipsPerEntity < 1 || args.maxRelationshipsPerEntity > 50) {
            throw new McpError(
              MCP_ERROR_CODES.PARAMETER_OUT_OF_RANGE,
              "maxRelationshipsPerEntity must be a number between 1 and 50. Use 2-3 for minimal context, 4-6 for balanced analysis, 8-12 for comprehensive mapping.",
              { parameter: "maxRelationshipsPerEntity", value: args.maxRelationshipsPerEntity, range: "1-50" }
            );
          }
        }
        
        result = await knowledgeGraphManager.searchWithRelationships(args.query as string, {
          maxEntities: args.maxEntities as number | undefined,
          maxRelationshipsPerEntity: args.maxRelationshipsPerEntity as number | undefined,
          fallbackToSimple: args.fallbackToSimple as boolean | undefined
        });
        break;
      case "open_nodes":
        if (!args || !Array.isArray(args.names)) {
          throw new McpError(
            ErrorCode.InvalidParams,
            "Invalid arguments for open_nodes: names array is required."
          );
        }
        result = await knowledgeGraphManager.openNodes(args.names as string[]);
        break;
      case "get_graph_summary":
        result = await knowledgeGraphManager.getGraphSummary();
        break;
      case "get_storage_status":
        result = await knowledgeGraphManager.getStorageStatus();
        break;
      default:
        throw new McpError(
          ErrorCode.MethodNotFound,
          `Unknown tool: ${name}`,
          { toolName: name }
        );
    }
    // Return result with both text content (backward compat) and structuredContent (MCP 2025-06-18)
    return {
      content: [{ type: "text", text: typeof result === 'string' ? result : JSON.stringify(result, null, 2) }],
      structuredContent: typeof result === 'object' ? result : undefined
    };

  } catch (error) {
      logger.error(`Error executing tool ${name}`, error instanceof Error ? error : new Error(String(error)));
      // Return an error response to the client
      return {
          content: [{ type: "text", text: `Error executing tool ${name}: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true, // Mark the response as an error
      };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Knowledge Graph MCP Server (Neo4j/File Fallback) running on stdio"); // Startup logging to stderr
}

main().catch((error) => {
  logger.error("Fatal error in main()", error instanceof Error ? error : new Error(String(error)));
  process.exit(1);
});
// --- REMOVE ALL DUPLICATED CODE BELOW THIS LINE ---
