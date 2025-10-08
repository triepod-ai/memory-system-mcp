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
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import neo4j, { Driver, ManagedTransaction } from 'neo4j-driver';
import { logger } from './logger.js'; // Removed unused Session import

// Neo4j Configuration from Environment Variables
const NEO4J_URI = process.env.NEO4J_URI; // e.g., "neo4j://localhost:7687" or "neo4j+s://instance.databases.neo4j.io"
const NEO4J_USER = process.env.NEO4J_USER; // e.g., "neo4j"
const NEO4J_PASSWORD = process.env.NEO4J_PASSWORD;

// Define memory file path using environment variable with fallback (for fallback storage)
const defaultMemoryPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'memory_fallback.json'); // Renamed to avoid conflict if original file exists

// If MEMORY_FILE_PATH is just a filename, put it in the same directory as the script
const MEMORY_FILE_PATH = process.env.MEMORY_FILE_PATH
  ? path.isAbsolute(process.env.MEMORY_FILE_PATH)
    ? process.env.MEMORY_FILE_PATH
    : path.join(path.dirname(fileURLToPath(import.meta.url)), process.env.MEMORY_FILE_PATH)
  : defaultMemoryPath;

/**
 * MCP Error Codes for Memory System
 * Following JSON-RPC 2.0 specification
 *
 * Standard codes:
 * -32700: Parse error
 * -32600: Invalid Request
 * -32601: Method not found
 * -32602: Invalid params
 * -32603: Internal error
 *
 * Server-defined codes (-32000 to -32099):
 */
const MCP_ERROR_CODES = {
  // Entity-related errors
  ENTITY_NOT_FOUND: -32001,
  DUPLICATE_ENTITY: -32002,

  // Relation-related errors
  RELATION_NOT_FOUND: -32003,
  INVALID_RELATION: -32004,

  // Storage backend errors
  NEO4J_CONNECTION_ERROR: -32010,
  NEO4J_OPERATION_FAILED: -32011,
  FILE_STORAGE_ERROR: -32012,

  // Validation errors
  VALIDATION_ERROR: -32020,
  EMPTY_QUERY: -32021,
  PARAMETER_OUT_OF_RANGE: -32022,

  // Query errors
  GRAPH_QUERY_TIMEOUT: -32030,
  QUERY_EXECUTION_ERROR: -32031,
} as const;

// We are storing our memory using entities, relations, and observations in a graph structure
interface Entity {
  name: string;
  entityType: string;
  observations: string[];
}

interface Relation {
  from: string;
  to: string;
  relationType: string;
}

interface KnowledgeGraph {
  entities: Entity[];
  relations: Relation[];
}

// The KnowledgeGraphManager class contains all operations to interact with the knowledge graph
class KnowledgeGraphManager {
  private driver: Driver | null = null;
  private neo4jAvailable: boolean = false;
  private lastOperationBackend: 'neo4j' | 'file' = 'file';

  constructor() {
    if (NEO4J_URI && NEO4J_USER && NEO4J_PASSWORD) {
      try {
        this.driver = neo4j.driver(NEO4J_URI, neo4j.auth.basic(NEO4J_USER, NEO4J_PASSWORD));
        // Asynchronous check for connectivity and constraints
        this.verifyConnectionAndSetup();
      } catch (error) {
        logger.error("Failed to initialize Neo4j driver", error instanceof Error ? error : new Error(String(error)));
        this.neo4jAvailable = false;
      }
    } else {
      logger.info("Neo4j environment variables (NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD) not fully configured. Falling back to file storage.");
      this.neo4jAvailable = false;
    }
  }

  // Perform initial connection verification and setup constraints/indexes
  private async verifyConnectionAndSetup(): Promise<void> {
    if (!this.driver) {
        this.neo4jAvailable = false;
        return;
    }
    try {
        await this.driver.verifyConnectivity();
        console.error("Successfully connected to Neo4j."); // Startup logging to stderr
        this.neo4jAvailable = true;
        await this.ensureConstraintsAndIndexes(); // Ensure constraints/indexes exist
    } catch (error) {
        logger.error("Neo4j connection failed on startup check", error instanceof Error ? error : new Error(String(error)));
        this.neo4jAvailable = false;
        await this.driver.close(); // Close driver if initial check fails
        this.driver = null;
    }
  }

  // Ensure necessary constraints/indexes exist in Neo4j for performance
  private async ensureConstraintsAndIndexes(): Promise<void> {
    if (!this.neo4jAvailable || !this.driver) return;
    // Use executeQuery for schema operations (Corrected typo)
    try {
      await this.driver.executeQuery(
          'CREATE CONSTRAINT entity_name_unique IF NOT EXISTS FOR (e:Entity) REQUIRE e.name IS UNIQUE'
      ); // executeQuery doesn't return an object with .execute()
      await this.driver.executeQuery(
          'CREATE INDEX entity_type_index IF NOT EXISTS FOR (e:Entity) ON (e.entityType)'
      ); // executeQuery doesn't return an object with .execute()
      console.error("Ensured Neo4j constraints and indexes exist."); // Startup logging to stderr
    } catch (error: any) { // Add type annotation
      logger.error("Failed to ensure Neo4j constraints/indexes", error instanceof Error ? error : new Error(String(error)));
      // Decide if this failure should disable Neo4j usage - potentially set neo4jAvailable to false
      // this.neo4jAvailable = false;
    }
    // No need to manage session explicitly for executableQuery
  }

  // Helper to execute Neo4j queries with fallback logic integrated
  private async executeNeo4jOrFallback<T>(
    neo4jWriteCallback: ((tx: ManagedTransaction) => Promise<T>) | null,
    neo4jReadCallback: ((tx: ManagedTransaction) => Promise<T>) | null,
    fallbackCallback: () => Promise<T>
  ): Promise<T> {
    if (this.neo4jAvailable && this.driver) {
      const session = this.driver.session({ database: 'neo4j' }); // Use appropriate database if needed
      try {
        let result: T;
        if (neo4jWriteCallback) {
          result = await session.executeWrite(neo4jWriteCallback);
        } else if (neo4jReadCallback) {
          result = await session.executeRead(neo4jReadCallback);
        } else {
          // Should not happen if called correctly, but handle defensively
          throw new McpError(
            ErrorCode.InternalError,
            "No Neo4j operation provided"
          );
        }
        this.lastOperationBackend = 'neo4j';
        return result; // Return result immediately after successful operation
      } catch (error) {
        logger.error(`Neo4j operation failed. Falling back to file storage.`, error instanceof Error ? error : new Error(String(error)));
        this.neo4jAvailable = false; // Consider temporary vs permanent fallback based on error type
        // Potentially close the driver if the error is connection-related:
        // if (error indicates connection issue) {
        //   await this.driver?.close();
        //   this.driver = null;
        // }
        this.lastOperationBackend = 'file';
        return fallbackCallback(); // Execute fallback
      } finally {
         await session.close(); // Ensure session is always closed
      }
    } else {
      // console.error("Neo4j not available, using file storage fallback.");
      this.lastOperationBackend = 'file';
      return fallbackCallback();
    }
  }


  // --- File Fallback Methods ---
  private async loadGraphFromFile(): Promise<KnowledgeGraph> {
    try {
      const data = await fs.readFile(MEMORY_FILE_PATH, "utf-8");
      const lines = data.split("\n").filter(line => line.trim() !== "");
      return lines.reduce((graph: KnowledgeGraph, line) => {
        const item = JSON.parse(line);
        if (item.type === "entity") graph.entities.push(item as Entity);
        if (item.type === "relation") graph.relations.push(item as Relation);
        return graph;
      }, { entities: [], relations: [] });
    } catch (error) {
      if (error instanceof Error && 'code' in error && (error as any).code === "ENOENT") {
        return { entities: [], relations: [] };
      }
      throw error;
    }
  }

  private async saveGraphToFile(graph: KnowledgeGraph): Promise<void> {
    // Ensure the directory exists
    try {
      await fs.mkdir(path.dirname(MEMORY_FILE_PATH), { recursive: true });
    } catch (error) {
      // Ignore error if directory already exists
      if (error instanceof Error && 'code' in error && (error as any).code !== 'EEXIST') {
        throw error;
      }
    }
    const lines = [
      ...graph.entities.map(e => JSON.stringify({ type: "entity", ...e })), // Keep original file format
      ...graph.relations.map(r => JSON.stringify({ type: "relation", ...r })),
    ];
    await fs.writeFile(MEMORY_FILE_PATH, lines.join("\n") + "\n"); // Add trailing newline
  }

  // --- CRUD Operations with Fallback ---

  async createEntities(entities: Entity[]): Promise<Entity[]> {
    return this.executeNeo4jOrFallback(
      // Neo4j Write Operation
      async (tx) => {
        const results = await Promise.all(entities.map(async (entity) => {
          // MERGE prevents creating duplicates based on name
          const result = await tx.run(
            `MERGE (e:Entity {name: $name})
             ON CREATE SET e.entityType = $entityType, e.observations = $observations
             ON MATCH SET e.entityType = $entityType, e.observations = coalesce(e.observations, []) + [obs IN $observations WHERE NOT obs IN e.observations | obs] // Merge observations on match
             RETURN e, id(e) as nodeId, 'created' as action`, // Return indicator if created or matched
            { name: entity.name, entityType: entity.entityType, observations: entity.observations || [] }
          );
          // Check if the node was newly created or just matched
          // This logic might need refinement based on exact MERGE behavior and desired return value
          if (result.records.length > 0) { // Simplified: assumes success means it's "new" for this call's context
             return { ...entity, id: result.records[0].get('nodeId').toNumber() }; // Return the entity potentially with its new DB ID
          }
          return null; // Indicate no new entity was created (it already existed)
        }));
        return results.filter(e => e !== null) as Entity[]; // Filter out nulls (already existing)
      },
      // Neo4j Read Operation (Not applicable for create)
      null as any,
      // File Fallback Operation
      async () => {
        // Corrected fallback logic - removed duplicate declarations
        logger.info("Executing createEntities fallback");
        const graph = await this.loadGraphFromFile(); // Load existing graph
        const newEntities = entities.filter(e => !graph.entities.some(existingEntity => existingEntity.name === e.name)); // Determine new ones
        graph.entities.push(...newEntities); // Add only new entities
        await this.saveGraphToFile(graph); // Save the updated graph
        return newEntities; // Return only the newly added entities
      }
    );
  }


  async createRelations(relations: Relation[]): Promise<Relation[]> {
     return this.executeNeo4jOrFallback(
      // Neo4j Write Operation
      async (tx) => {
        const results = await Promise.all(relations.map(async (rel) => {
          // MERGE relation only if it doesn't exist, check if nodes exist first
          const result = await tx.run(
            `MATCH (from:Entity {name: $fromName}), (to:Entity {name: $toName})
             MERGE (from)-[r:\`${rel.relationType}\`]->(to)
             ON CREATE SET r.created = timestamp() // Mark creation time or a flag
             RETURN r, r.created as newlyCreated`, // Return the flag
            { fromName: rel.from, toName: rel.to }
          );
           // Check if the relation was newly created
           if (result.records.length > 0 && result.records[0].get('newlyCreated')) {
             return rel;
           }
           return null; // Indicate relation already existed or nodes not found
        }));
        return results.filter(r => r !== null) as Relation[]; // Filter out nulls
      },
      // Neo4j Read Operation (Not applicable for create)
      null,
      // File Fallback Operation
      async () => {
        logger.info("Executing createRelations fallback");
        const graph = await this.loadGraphFromFile();
        const newRelations = relations.filter(r => {
            // Check if 'from' and 'to' entities exist in the file graph
            const fromExists = graph.entities.some(e => e.name === r.from);
            const toExists = graph.entities.some(e => e.name === r.to);
            if (!fromExists || !toExists) {
                logger.warn(`Skipping relation creation (fallback): Entity ${!fromExists ? r.from : r.to} not found.`);
                return false; // Don't add relation if entities don't exist
            }
            // Check if relation already exists
            return !graph.relations.some(existingRelation =>
                existingRelation.from === r.from &&
                existingRelation.to === r.to &&
                existingRelation.relationType === r.relationType
            );
        });
        graph.relations.push(...newRelations);
        await this.saveGraphToFile(graph);
        return newRelations;
      }
    );
  }

  async addObservations(observations: { entityName: string; contents: string[] }[]): Promise<{ entityName: string; addedObservations: string[] }[]> {
     return this.executeNeo4jOrFallback(
      // Neo4j Write Operation
      async (tx) => {
        const results = await Promise.all(observations.map(async (obs) => {
          // Check if entity exists first
          const checkResult = await tx.run(`MATCH (e:Entity {name: $entityName}) RETURN count(e) as count`, { entityName: obs.entityName });
          if (checkResult.records[0].get('count').low === 0) { // Use .low for standard integers
             throw new McpError(
               MCP_ERROR_CODES.ENTITY_NOT_FOUND,
               `Entity with name ${obs.entityName} not found in Neo4j`,
               { entityName: obs.entityName, backend: 'neo4j' }
             );
          }

          // Add observations, ensuring uniqueness within the list property
          const updateResult = await tx.run(
            `MATCH (e:Entity {name: $entityName})
             WITH e, [content IN $contents WHERE NOT content IN coalesce(e.observations, []) | content] as newObs // Calculate new observations first
             SET e.observations = coalesce(e.observations, []) + newObs // Append only new observations
             RETURN newObs`, // Return only the newly added observations
            { entityName: obs.entityName, contents: obs.contents }
          );
          // Return the observations that were actually added
          return { entityName: obs.entityName, addedObservations: updateResult.records[0]?.get('newObs') || [] };
        }));
        return results;
      },
      // Neo4j Read Operation (Not applicable for add)
      null,
      // File Fallback Operation
      async () => {
        logger.info("Executing addObservations fallback");
        const graph = await this.loadGraphFromFile();
        const results = observations.map(o => {
          const entity = graph.entities.find(e => e.name === o.entityName);
          if (!entity) {
            // Optionally create the entity if it doesn't exist in fallback? Or throw error?
            // Sticking to original behavior: throw error
            throw new McpError(
              MCP_ERROR_CODES.ENTITY_NOT_FOUND,
              `Entity with name ${o.entityName} not found in file`,
              { entityName: o.entityName, backend: 'file' }
            );
          }
          // Ensure observations array exists
          entity.observations = entity.observations || [];
          const newObservations = o.contents.filter(content => !entity.observations.includes(content));
          entity.observations.push(...newObservations);
          return { entityName: o.entityName, addedObservations: newObservations };
        });
        await this.saveGraphToFile(graph);
        return results;
      }
    );
  }

  async deleteEntities(entityNames: string[]): Promise<void> {
     await this.executeNeo4jOrFallback(
      // Neo4j Write Operation
      async (tx) => {
        // DETACH DELETE removes node and its relationships
        await tx.run(
          'MATCH (e:Entity) WHERE e.name IN $names DETACH DELETE e',
          { names: entityNames }
        );
      },
      // Neo4j Read Operation (Not applicable for delete)
      null,
      // File Fallback Operation
      async () => {
        logger.info("Executing deleteEntities fallback");
        const graph = await this.loadGraphFromFile();
        graph.entities = graph.entities.filter(e => !entityNames.includes(e.name));
        // Also remove relations connected to the deleted entities
        graph.relations = graph.relations.filter(r => !entityNames.includes(r.from) && !entityNames.includes(r.to));
        await this.saveGraphToFile(graph);
      }
    );
  }

  async deleteObservations(deletions: { entityName: string; observations: string[] }[]): Promise<void> {
     await this.executeNeo4jOrFallback(
      // Neo4j Write Operation
      async (tx) => {
         await Promise.all(deletions.map(async (del) => {
            // Use list comprehension to filter observations
            await tx.run(
             `MATCH (e:Entity {name: $entityName})
              SET e.observations = [obs IN coalesce(e.observations, []) WHERE NOT obs IN $observationsToDelete]`, // Correct Cypher syntax
             { entityName: del.entityName, observationsToDelete: del.observations }
           );
         }));
      },
      // Neo4j Read Operation (Not applicable for delete)
      null,
      // File Fallback Operation
      async () => {
        logger.info("Executing deleteObservations fallback");
        const graph = await this.loadGraphFromFile();
        deletions.forEach(d => {
          const entity = graph.entities.find(e => e.name === d.entityName);
          if (entity && entity.observations) {
            entity.observations = entity.observations.filter(o => !d.observations.includes(o));
          }
        });
        await this.saveGraphToFile(graph);
      }
    );
  }

  async deleteRelations(relations: Relation[]): Promise<void> {
     await this.executeNeo4jOrFallback(
      // Neo4j Write Operation
      async (tx) => {
         await Promise.all(relations.map(async (rel) => {
           // Match the specific relation and delete it
           await tx.run(
             `MATCH (from:Entity {name: $fromName})-[r:\`${rel.relationType}\`]->(to:Entity {name: $toName})
              DELETE r`, // Correct Cypher syntax
             { fromName: rel.from, toName: rel.to }
           );
         }));
      },
      // Neo4j Read Operation (Not applicable for delete)
      null,
      // File Fallback Operation
      async () => {
        logger.info("Executing deleteRelations fallback");
        const graph = await this.loadGraphFromFile();
        graph.relations = graph.relations.filter(r =>
            !relations.some(delRelation =>
                r.from === delRelation.from &&
                r.to === delRelation.to &&
                r.relationType === delRelation.relationType
            )
        );
        await this.saveGraphToFile(graph);
      }
    );
  }

  async readGraph(limit?: number, offset?: number): Promise<KnowledgeGraph> {
     return this.executeNeo4jOrFallback(
      // Neo4j Write Operation (Not applicable for read)
      null,
      // Neo4j Read Operation
      async (tx) => {
        // Add LIMIT and SKIP for pagination
        const entityQuery = limit 
          ? 'MATCH (e:Entity) RETURN e.name as name, e.entityType as entityType, e.observations as observations SKIP $offset LIMIT $limit'
          : 'MATCH (e:Entity) RETURN e.name as name, e.entityType as entityType, e.observations as observations';
        
        const entitiesResult = await tx.run(entityQuery, { limit: limit || 0, offset: offset || 0 });
        
        // Only get relations between the returned entities
        const entityNames = entitiesResult.records.map(r => r.get('name'));
        const relationsResult = entityNames.length > 0 
          ? await tx.run('MATCH (from:Entity)-[r]->(to:Entity) WHERE from.name IN $names AND to.name IN $names RETURN from.name as from, to.name as to, type(r) as relationType', { names: entityNames })
          : { records: [] };

        const entities: Entity[] = entitiesResult.records.map(record => ({
          name: record.get('name'),
          entityType: record.get('entityType'),
          // Ensure observations is always an array, even if null in DB
          observations: record.get('observations') || [],
        }));

        const relations: Relation[] = relationsResult.records.map(record => ({
          from: record.get('from'),
          to: record.get('to'),
          relationType: record.get('relationType'),
        }));

        return { entities, relations };
      },
      // File Fallback Operation
      async () => {
        logger.info("Executing readGraph fallback");
        const graph = await this.loadGraphFromFile();
        
        if (limit !== undefined) {
          const startIdx = offset || 0;
          const endIdx = startIdx + limit;
          const limitedEntities = graph.entities.slice(startIdx, endIdx);
          const entityNames = new Set(limitedEntities.map(e => e.name));
          const limitedRelations = graph.relations.filter(r => 
            entityNames.has(r.from) && entityNames.has(r.to)
          );
          return { entities: limitedEntities, relations: limitedRelations };
        }
        
        return graph;
      }
    );
  }

  // Enhanced search function with relationships - simplified 2-step approach
  async searchWithRelationships(query: string, options?: {
    maxEntities?: number;
    maxRelationshipsPerEntity?: number;
    fallbackToSimple?: boolean;
  }): Promise<KnowledgeGraph & { 
    metadata: { 
      totalEntitiesFound: number; 
      relationshipsLimited: boolean; 
      backendUsed: 'neo4j' | 'file' 
    } 
  }> {
    const opts = {
      maxEntities: options?.maxEntities || 20,
      maxRelationshipsPerEntity: options?.maxRelationshipsPerEntity || 5,
      fallbackToSimple: options?.fallbackToSimple !== false
    };

    return this.executeNeo4jOrFallback(
      // Neo4j Write Operation (Not applicable for search)
      null,
      // Neo4j Read Operation
      async (tx) => {
        try {
          logger.info(`Executing Neo4j enhanced search for query: "${query}"`);
          
          // Step 1: Find matching entities with limit
          const entityResult = await tx.run(
            `MATCH (e:Entity)
             WHERE toLower(e.name) CONTAINS toLower($query)
                OR toLower(e.entityType) CONTAINS toLower($query)
                OR any(obs IN coalesce(e.observations, []) WHERE toLower(obs) CONTAINS toLower($query))
             RETURN e.name as name, e.entityType as entityType, e.observations as observations
             LIMIT $maxEntities`,
            { query, maxEntities: opts.maxEntities }
          );

          const entities: Entity[] = entityResult.records.map(record => ({
            name: record.get('name'),
            entityType: record.get('entityType'),
            observations: record.get('observations') || [],
          }));

          // Step 2: Get bounded relationships for found entities
          let relations: Relation[] = [];
          let relationshipsLimited = false;

          if (entities.length > 0) {
            const entityNames = entities.map(e => e.name);
            
            // Get relationships with per-entity limits to prevent explosion
            const relationResult = await tx.run(
              `MATCH (from:Entity)-[r]->(to:Entity)
               WHERE from.name IN $names OR to.name IN $names
               WITH from, to, r, 
                    CASE WHEN from.name IN $names THEN from.name ELSE to.name END as primaryEntity
               ORDER BY primaryEntity, from.name, to.name
               WITH primaryEntity, collect({from: from.name, to: to.name, type: type(r)}) as rels
               RETURN primaryEntity, 
                      rels[0..$maxRelsPerEntity] as limitedRels,
                      size(rels) as totalRels`,
              { names: entityNames, maxRelsPerEntity: opts.maxRelationshipsPerEntity }
            );

            const relationshipsMap = new Map<string, Relation>();
            
            relationResult.records.forEach(record => {
              const totalRels = record.get('totalRels').toNumber();
              const limitedRels = record.get('limitedRels');
              
              if (totalRels > opts.maxRelationshipsPerEntity) {
                relationshipsLimited = true;
              }

              limitedRels.forEach((rel: any) => {
                const relKey = `${rel.from}-${rel.type}-${rel.to}`;
                if (!relationshipsMap.has(relKey)) {
                  relationshipsMap.set(relKey, {
                    from: rel.from,
                    to: rel.to,
                    relationType: rel.type
                  });
                }
              });
            });

            relations = Array.from(relationshipsMap.values());
          }

          logger.info(`Neo4j enhanced search found ${entities.length} entities and ${relations.length} relations`);
          
          return {
            entities,
            relations,
            metadata: {
              totalEntitiesFound: entities.length,
              relationshipsLimited,
              backendUsed: 'neo4j' as ('neo4j' | 'file')
            }
          };

        } catch (error) {
          logger.error(`Neo4j enhanced search query failed for "${query}"`, error instanceof Error ? error : new Error(String(error)));
          
          if (opts.fallbackToSimple) {
            logger.info('Falling back to simple search due to enhanced search failure');
            const simpleResult = await this.searchNodes(query);
            return {
              ...simpleResult,
              metadata: {
                totalEntitiesFound: simpleResult.entities.length,
                relationshipsLimited: false,
                backendUsed: this.lastOperationBackend
              }
            };
          }
          throw error;
        }
      },
      // File Fallback Operation
      async () => {
        logger.info("Executing searchWithRelationships fallback");
        const graph = await this.loadGraphFromFile();
        const lowerQuery = query.toLowerCase();

        // Step 1: Find matching entities with limit
        const matchedEntities = graph.entities.filter(e =>
          e.name.toLowerCase().includes(lowerQuery) ||
          e.entityType.toLowerCase().includes(lowerQuery) ||
          (e.observations && e.observations.some(o => o.toLowerCase().includes(lowerQuery)))
        );

        const limitedEntities = matchedEntities.slice(0, opts.maxEntities);
        const filteredEntityNames = new Set(limitedEntities.map(e => e.name));

        // Step 2: Get bounded relationships
        const entityRelationships = new Map<string, Relation[]>();
        let relationshipsLimited = false;

        // Group relations by entity
        graph.relations.forEach(rel => {
          if (filteredEntityNames.has(rel.from)) {
            if (!entityRelationships.has(rel.from)) {
              entityRelationships.set(rel.from, []);
            }
            entityRelationships.get(rel.from)!.push(rel);
          }
          if (filteredEntityNames.has(rel.to) && rel.from !== rel.to) {
            if (!entityRelationships.has(rel.to)) {
              entityRelationships.set(rel.to, []);
            }
            entityRelationships.get(rel.to)!.push(rel);
          }
        });

        // Apply per-entity limits
        const boundedRelations: Relation[] = [];
        const relationSet = new Set<string>();

        entityRelationships.forEach((rels, entityName) => {
          if (rels.length > opts.maxRelationshipsPerEntity) {
            relationshipsLimited = true;
          }
          
          rels.slice(0, opts.maxRelationshipsPerEntity).forEach(rel => {
            const relKey = `${rel.from}-${rel.relationType}-${rel.to}`;
            if (!relationSet.has(relKey)) {
              boundedRelations.push(rel);
              relationSet.add(relKey);
            }
          });
        });

        return {
          entities: limitedEntities,
          relations: boundedRelations,
          metadata: {
            totalEntitiesFound: matchedEntities.length,
            relationshipsLimited,
            backendUsed: 'file' as ('neo4j' | 'file')
          }
        };
      }
    );
  }

  // Search function with fallback
  async searchNodes(query: string): Promise<KnowledgeGraph> {
     return this.executeNeo4jOrFallback(
      // Neo4j Write Operation (Not applicable for search)
      null,
       // Neo4j Read Operation
      async (tx) => {
        try {
          // Step 1: Find matching entities with simplified query
          logger.info(`Executing Neo4j search for query: "${query}"`);
          const entityResult = await tx.run(
            `MATCH (e:Entity)
             WHERE toLower(e.name) CONTAINS toLower($query)
                OR toLower(e.entityType) CONTAINS toLower($query)
                OR any(obs IN coalesce(e.observations, []) WHERE toLower(obs) CONTAINS toLower($query))
             RETURN e.name as name, e.entityType as entityType, e.observations as observations`,
            { query }
          );

          // Convert to entity objects
          const entities: Entity[] = entityResult.records.map(record => ({
            name: record.get('name'),
            entityType: record.get('entityType'),
            observations: record.get('observations') || [],
          }));

          // Step 2: Get relationships between found entities (if any entities found)
          let relations: Relation[] = [];
          if (entities.length > 0) {
            const entityNames = entities.map(e => e.name);
            
            const relationResult = await tx.run(
              `MATCH (from:Entity)-[r]->(to:Entity)
               WHERE from.name IN $names AND to.name IN $names
               RETURN from.name as fromName, to.name as toName, type(r) as relationType`,
              { names: entityNames }
            );

            relations = relationResult.records.map(record => ({
              from: record.get('fromName'),
              to: record.get('toName'),
              relationType: record.get('relationType'),
            }));
          }

          logger.info(`Neo4j search found ${entities.length} entities and ${relations.length} relations`);
          return { entities, relations };

        } catch (error) {
          logger.error(`Neo4j search query failed for "${query}"`, error instanceof Error ? error : new Error(String(error)));
          throw error; // Re-throw to trigger fallback
        }
      },
      // File Fallback Operation
      async () => {
        logger.info("Executing searchNodes fallback");
        const graph = await this.loadGraphFromFile();
        const lowerQuery = query.toLowerCase();

        const filteredEntities = graph.entities.filter(e =>
          e.name.toLowerCase().includes(lowerQuery) ||
          e.entityType.toLowerCase().includes(lowerQuery) ||
          (e.observations && e.observations.some(o => o.toLowerCase().includes(lowerQuery)))
        );

        const filteredEntityNames = new Set(filteredEntities.map(e => e.name));

        // Filter relations to only include those between the filtered entities
        const filteredRelations = graph.relations.filter(r =>
          filteredEntityNames.has(r.from) && filteredEntityNames.has(r.to)
        );

        return { entities: filteredEntities, relations: filteredRelations };
      }
    );
  }

  async openNodes(names: string[]): Promise<KnowledgeGraph> {
     return this.executeNeo4jOrFallback(
       // Neo4j Write Operation (Not applicable)
      null,
      // Neo4j Read Operation
      async (tx) => {
        // Find specified entities and relationships *only between them*
         const result = await tx.run(
           `MATCH (e:Entity) WHERE e.name IN $names
            WITH collect(e) as nodes // Collect the matched nodes
            UNWIND nodes as e // Unwind to process each node
            OPTIONAL MATCH (e)-[r]-(related:Entity) WHERE related IN nodes // Match relationships only between nodes in the collection
            RETURN DISTINCT e, r, related // Return distinct nodes and relationships
           `, // Corrected Cypher query
           { names }
         );

         const entitiesMap = new Map<string, Entity>();
         const relationsSet = new Set<string>();
         const relations: Relation[] = [];

         result.records.forEach(record => {
           const entityNodeData = record.get('e').properties;
           const relatedNodeData = record.get('related')?.properties;
           const relationship = record.get('r');

           // Add entity if not already added
           if (entityNodeData && !entitiesMap.has(entityNodeData.name)) {
             entitiesMap.set(entityNodeData.name, {
               name: entityNodeData.name,
               entityType: entityNodeData.entityType,
               observations: entityNodeData.observations || [],
             });
           }
           // Related node will also be added via the loop if it was in the initial 'names' list

           // Add relationship if it exists and connects two nodes in our map
           if (relationship && entityNodeData && relatedNodeData) {
               const fromNode = entitiesMap.get(entityNodeData.name);
               const toNode = entitiesMap.get(relatedNodeData.name);

               if (fromNode && toNode) {
                   const startNodeId = relationship.startNodeElementId;
                   const endNodeId = relationship.endNodeElementId;
                   const eNodeId = record.get('e').elementId;

                   const actualFrom = (startNodeId === eNodeId) ? fromNode : toNode;
                   const actualTo = (endNodeId === eNodeId) ? fromNode : toNode;

                   const relKey = `${actualFrom.name}-${relationship.type}->${actualTo.name}`;

                   if (!relationsSet.has(relKey)) {
                     relations.push({
                       from: actualFrom.name,
                       to: actualTo.name,
                       relationType: relationship.type,
                     });
                     relationsSet.add(relKey);
                   }
               }
           }
         });

         // Ensure all requested entities that were found are included, even if they have no relations among the requested set
         names.forEach(name => {
           // Check if the entity was found by the initial MATCH
           const foundEntity = result.records.find(rec => rec.get('e').properties.name === name);
           if (foundEntity && !entitiesMap.has(name)) {
                const entityNodeData = foundEntity.get('e').properties;
                entitiesMap.set(entityNodeData.name, {
                    name: entityNodeData.name,
                    entityType: entityNodeData.entityType,
                    observations: entityNodeData.observations || [],
                });
           }
         });

         return { entities: Array.from(entitiesMap.values()), relations };
       },
       // File Fallback Operation
      async () => {
        logger.info("Executing openNodes fallback");
        const graph = await this.loadGraphFromFile();
        const filteredEntities = graph.entities.filter(e => names.includes(e.name));
        const filteredEntityNames = new Set(filteredEntities.map(e => e.name));
        // Filter relations to only include those between the filtered entities
        const filteredRelations = graph.relations.filter(r =>
          filteredEntityNames.has(r.from) && filteredEntityNames.has(r.to)
        );
        return { entities: filteredEntities, relations: filteredRelations };
      }
    );
  }

  async getGraphSummary(): Promise<{ entityCount: number; relationCount: number; entityTypes: string[] }> {
    return this.executeNeo4jOrFallback(
      null,
      // Neo4j Read Operation
      async (tx) => {
        const entityCountResult = await tx.run('MATCH (e:Entity) RETURN count(e) as count');
        const relationCountResult = await tx.run('MATCH ()-[r]->() RETURN count(r) as count');
        const entityTypesResult = await tx.run('MATCH (e:Entity) RETURN DISTINCT e.entityType as entityType ORDER BY e.entityType');
        
        return {
          entityCount: entityCountResult.records[0].get('count').toNumber(),
          relationCount: relationCountResult.records[0].get('count').toNumber(),
          entityTypes: entityTypesResult.records.map(r => r.get('entityType'))
        };
      },
      // File Fallback Operation
      async () => {
        logger.info("Executing getGraphSummary fallback");
        const graph = await this.loadGraphFromFile();
        const entityTypes = [...new Set(graph.entities.map(e => e.entityType))].sort();
        return {
          entityCount: graph.entities.length,
          relationCount: graph.relations.length,
          entityTypes
        };
      }
    );
  }

  async getStorageStatus(): Promise<{ 
    currentBackend: 'neo4j' | 'file';
    lastOperationBackend: 'neo4j' | 'file';
    neo4jConfigured: boolean;
    neo4jAvailable: boolean;
    filePath: string;
    backendConsistent: boolean;
    connectionHealth: 'healthy' | 'degraded' | 'unavailable';
    configuration: {
      NEO4J_URI?: string;
      NEO4J_USER?: string;
      MEMORY_FILE_PATH: string;
    };
  }> {
    const currentBackend = this.neo4jAvailable ? 'neo4j' : 'file';
    const backendConsistent = currentBackend === this.lastOperationBackend;
    
    // Determine connection health
    let connectionHealth: 'healthy' | 'degraded' | 'unavailable';
    if (this.neo4jAvailable && !!(NEO4J_URI && NEO4J_USER && NEO4J_PASSWORD)) {
      connectionHealth = 'healthy';
    } else if (!!(NEO4J_URI && NEO4J_USER && NEO4J_PASSWORD) && !this.neo4jAvailable) {
      connectionHealth = 'degraded'; // Configured but not available
    } else {
      connectionHealth = 'unavailable'; // Not configured
    }

    return {
      currentBackend,
      lastOperationBackend: this.lastOperationBackend,
      neo4jConfigured: !!(NEO4J_URI && NEO4J_USER && NEO4J_PASSWORD),
      neo4jAvailable: this.neo4jAvailable,
      filePath: MEMORY_FILE_PATH,
      backendConsistent,
      connectionHealth,
      configuration: {
        NEO4J_URI: NEO4J_URI ? (NEO4J_URI.includes('@') ? `${NEO4J_URI.split('@')[0]}@***` : NEO4J_URI) : undefined, // Mask password in URI
        NEO4J_USER,
        MEMORY_FILE_PATH
      }
    };
  }

  // Migration tool to migrate fallback file data to Neo4j
  async migrateFallbackToNeo4j(options?: { 
    dryRun?: boolean; 
    conflictResolution?: 'skip' | 'overwrite' | 'merge'; 
  }): Promise<{
    summary: {
      entitiesProcessed: number;
      entitiesCreated: number;
      entitiesSkipped: number;
      entitiesUpdated: number;
      relationsProcessed: number;
      relationsCreated: number;
      relationsSkipped: number;
      errors: string[];
    };
    logs: string[];
    crossReferences: {
      entityMappings: { fileEntity: string; neo4jStatus: 'created' | 'existed' | 'error' }[];
      relationMappings: { fileRelation: string; neo4jStatus: 'created' | 'existed' | 'error' }[];
    };
  }> {
    const logs: string[] = [];
    const errors: string[] = [];
    const crossReferences = {
      entityMappings: [] as { fileEntity: string; neo4jStatus: 'created' | 'existed' | 'error' }[],
      relationMappings: [] as { fileRelation: string; neo4jStatus: 'created' | 'existed' | 'error' }[]
    };

    const dryRun = options?.dryRun || false;
    const conflictResolution = options?.conflictResolution || 'merge';

    logs.push(`Migration started at ${new Date().toISOString()}`);
    logs.push(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE MIGRATION'}`);
    logs.push(`Conflict resolution: ${conflictResolution}`);

    // Check if Neo4j is available
    if (!this.neo4jAvailable) {
      const error = 'Cannot migrate: Neo4j is not available';
      logs.push(`ERROR: ${error}`);
      errors.push(error);
      return {
        summary: {
          entitiesProcessed: 0, entitiesCreated: 0, entitiesSkipped: 0, entitiesUpdated: 0,
          relationsProcessed: 0, relationsCreated: 0, relationsSkipped: 0, errors
        },
        logs, crossReferences
      };
    }

    try {
      // Load fallback file data
      const fallbackGraph = await this.loadGraphFromFile();
      logs.push(`Loaded fallback file: ${fallbackGraph.entities.length} entities, ${fallbackGraph.relations.length} relations`);

      let entitiesCreated = 0, entitiesSkipped = 0, entitiesUpdated = 0;
      let relationsCreated = 0, relationsSkipped = 0;

      // Migrate entities
      logs.push('Starting entity migration...');
      for (const entity of fallbackGraph.entities) {
        try {
          const entityDesc = `${entity.name} (${entity.entityType})`;
          logs.push(`Processing entity: ${entityDesc}`);

          if (!dryRun) {
            const result = await this.executeNeo4jOrFallback(
              // Neo4j operation for entity migration
              async (tx) => {
                // Check if entity exists
                const existsResult = await tx.run(
                  'MATCH (e:Entity {name: $name}) RETURN e',
                  { name: entity.name }
                );

                if (existsResult.records.length > 0) {
                  // Entity exists - handle conflict
                  if (conflictResolution === 'skip') {
                    logs.push(`  Skipped existing entity: ${entityDesc}`);
                    crossReferences.entityMappings.push({ fileEntity: entityDesc, neo4jStatus: 'existed' });
                    return { action: 'skipped' };
                  } else if (conflictResolution === 'overwrite') {
                    await tx.run(
                      'MATCH (e:Entity {name: $name}) SET e.entityType = $entityType, e.observations = $observations',
                      { name: entity.name, entityType: entity.entityType, observations: entity.observations || [] }
                    );
                    logs.push(`  Overwrote existing entity: ${entityDesc}`);
                    crossReferences.entityMappings.push({ fileEntity: entityDesc, neo4jStatus: 'existed' });
                    return { action: 'updated' };
                  } else { // merge
                    const existingEntity = existsResult.records[0].get('e').properties;
                    const mergedObservations = [
                      ...(existingEntity.observations || []),
                      ...(entity.observations || []).filter(obs => !(existingEntity.observations || []).includes(obs))
                    ];
                    await tx.run(
                      'MATCH (e:Entity {name: $name}) SET e.observations = $observations',
                      { name: entity.name, observations: mergedObservations }
                    );
                    logs.push(`  Merged observations for existing entity: ${entityDesc}`);
                    crossReferences.entityMappings.push({ fileEntity: entityDesc, neo4jStatus: 'existed' });
                    return { action: 'updated' };
                  }
                } else {
                  // Create new entity
                  await tx.run(
                    'CREATE (e:Entity {name: $name, entityType: $entityType, observations: $observations})',
                    { name: entity.name, entityType: entity.entityType, observations: entity.observations || [] }
                  );
                  logs.push(`  Created new entity: ${entityDesc}`);
                  crossReferences.entityMappings.push({ fileEntity: entityDesc, neo4jStatus: 'created' });
                  return { action: 'created' };
                }
              },
              null,
              // Fallback - should not happen since we checked Neo4j availability
              async () => {
                throw new McpError(
                  MCP_ERROR_CODES.NEO4J_OPERATION_FAILED,
                  'Neo4j operation failed during migration',
                  { operation: 'entity migration' }
                );
              }
            );

            if (result.action === 'created') entitiesCreated++;
            else if (result.action === 'updated') entitiesUpdated++;
            else entitiesSkipped++;
          } else {
            logs.push(`  DRY RUN: Would process entity: ${entityDesc}`);
            crossReferences.entityMappings.push({ fileEntity: entityDesc, neo4jStatus: 'created' });
          }
        } catch (error) {
          const errorMsg = `Failed to migrate entity ${entity.name}: ${error instanceof Error ? error.message : String(error)}`;
          logs.push(`  ERROR: ${errorMsg}`);
          errors.push(errorMsg);
          crossReferences.entityMappings.push({ fileEntity: `${entity.name} (${entity.entityType})`, neo4jStatus: 'error' });
        }
      }

      // Migrate relations
      logs.push('Starting relation migration...');
      for (const relation of fallbackGraph.relations) {
        try {
          const relationDesc = `${relation.from} -[${relation.relationType}]-> ${relation.to}`;
          logs.push(`Processing relation: ${relationDesc}`);

          if (!dryRun) {
            const result = await this.executeNeo4jOrFallback(
              // Neo4j operation for relation migration
              async (tx) => {
                // Check if both entities exist
                const entitiesExistResult = await tx.run(
                  'MATCH (from:Entity {name: $fromName}), (to:Entity {name: $toName}) RETURN from, to',
                  { fromName: relation.from, toName: relation.to }
                );

                if (entitiesExistResult.records.length === 0) {
                  logs.push(`  Skipped relation (entities don't exist): ${relationDesc}`);
                  crossReferences.relationMappings.push({ fileRelation: relationDesc, neo4jStatus: 'error' });
                  return { action: 'skipped' };
                }

                // Check if relation already exists
                const relationExistsResult = await tx.run(
                  `MATCH (from:Entity {name: $fromName})-[r:\`${relation.relationType}\`]->(to:Entity {name: $toName}) RETURN r`,
                  { fromName: relation.from, toName: relation.to }
                );

                if (relationExistsResult.records.length > 0) {
                  if (conflictResolution === 'skip') {
                    logs.push(`  Skipped existing relation: ${relationDesc}`);
                    crossReferences.relationMappings.push({ fileRelation: relationDesc, neo4jStatus: 'existed' });
                    return { action: 'skipped' };
                  } else {
                    logs.push(`  Relation already exists: ${relationDesc}`);
                    crossReferences.relationMappings.push({ fileRelation: relationDesc, neo4jStatus: 'existed' });
                    return { action: 'skipped' };
                  }
                } else {
                  // Create new relation
                  await tx.run(
                    `MATCH (from:Entity {name: $fromName}), (to:Entity {name: $toName}) 
                     CREATE (from)-[r:\`${relation.relationType}\`]->(to)`,
                    { fromName: relation.from, toName: relation.to }
                  );
                  logs.push(`  Created new relation: ${relationDesc}`);
                  crossReferences.relationMappings.push({ fileRelation: relationDesc, neo4jStatus: 'created' });
                  return { action: 'created' };
                }
              },
              null,
              // Fallback - should not happen since we checked Neo4j availability
              async () => {
                throw new McpError(
                  MCP_ERROR_CODES.NEO4J_OPERATION_FAILED,
                  'Neo4j operation failed during migration',
                  { operation: 'relation migration' }
                );
              }
            );

            if (result.action === 'created') relationsCreated++;
            else relationsSkipped++;
          } else {
            logs.push(`  DRY RUN: Would process relation: ${relationDesc}`);
            crossReferences.relationMappings.push({ fileRelation: relationDesc, neo4jStatus: 'created' });
          }
        } catch (error) {
          const errorMsg = `Failed to migrate relation ${relation.from}->${relation.to}: ${error instanceof Error ? error.message : String(error)}`;
          logs.push(`  ERROR: ${errorMsg}`);
          errors.push(errorMsg);
          crossReferences.relationMappings.push({ fileRelation: `${relation.from} -[${relation.relationType}]-> ${relation.to}`, neo4jStatus: 'error' });
        }
      }

      logs.push(`Migration completed at ${new Date().toISOString()}`);
      logs.push(`Summary: ${entitiesCreated} entities created, ${entitiesUpdated} updated, ${entitiesSkipped} skipped`);
      logs.push(`Summary: ${relationsCreated} relations created, ${relationsSkipped} skipped`);
      logs.push(`Errors: ${errors.length}`);

      return {
        summary: {
          entitiesProcessed: fallbackGraph.entities.length,
          entitiesCreated,
          entitiesSkipped,
          entitiesUpdated,
          relationsProcessed: fallbackGraph.relations.length,
          relationsCreated,
          relationsSkipped,
          errors
        },
        logs,
        crossReferences
      };

    } catch (error) {
      const errorMsg = `Migration failed: ${error instanceof Error ? error.message : String(error)}`;
      logs.push(`FATAL ERROR: ${errorMsg}`);
      errors.push(errorMsg);
      
      return {
        summary: {
          entitiesProcessed: 0, entitiesCreated: 0, entitiesSkipped: 0, entitiesUpdated: 0,
          relationsProcessed: 0, relationsCreated: 0, relationsSkipped: 0, errors
        },
        logs, crossReferences
      };
    }
  }

  // Method to close the Neo4j driver connection gracefully
  async close(): Promise<void> {
    if (this.driver) {
      await this.driver.close();
      this.driver = null;
      this.neo4jAvailable = false;
      logger.info("Neo4j driver closed.");
    }
  }
}
const knowledgeGraphManager = new KnowledgeGraphManager();


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
    // Return result, stringifying if it's an object/array
    return { content: [{ type: "text", text: typeof result === 'string' ? result : JSON.stringify(result, null, 2) }] };

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
