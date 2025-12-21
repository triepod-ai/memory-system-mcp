/**
 * Shared Knowledge Graph Manager Module
 *
 * This module contains the core knowledge graph management logic that is shared
 * between the stdio server (index.ts) and HTTP server (index-http.ts).
 */

import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { promises as fs } from 'fs';
import path from 'path';
import neo4j, { Driver, ManagedTransaction } from 'neo4j-driver';
import { logger } from './logger.js';

// Export interfaces
export interface Entity {
  name: string;
  entityType: string;
  observations: string[];
}

export interface Relation {
  from: string;
  to: string;
  relationType: string;
}

export interface KnowledgeGraph {
  entities: Entity[];
  relations: Relation[];
}

// Export MCP Error Codes
export const MCP_ERROR_CODES = {
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

// Export configuration interface
export interface KnowledgeGraphConfig {
  NEO4J_URI?: string;
  NEO4J_USER?: string;
  NEO4J_PASSWORD?: string;
  MEMORY_FILE_PATH: string;
}

// Export KnowledgeGraphManager class
export class KnowledgeGraphManager {
  private driver: Driver | null = null;
  private neo4jAvailable: boolean = false;
  private lastOperationBackend: 'neo4j' | 'file' = 'file';
  private config: KnowledgeGraphConfig;

  constructor(config: KnowledgeGraphConfig) {
    this.config = config;

    if (config.NEO4J_URI && config.NEO4J_USER && config.NEO4J_PASSWORD) {
      try {
        this.driver = neo4j.driver(config.NEO4J_URI, neo4j.auth.basic(config.NEO4J_USER, config.NEO4J_PASSWORD));
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
    // Use executeQuery for schema operations
    try {
      await this.driver.executeQuery(
          'CREATE CONSTRAINT entity_name_unique IF NOT EXISTS FOR (e:Entity) REQUIRE e.name IS UNIQUE'
      );
      await this.driver.executeQuery(
          'CREATE INDEX entity_type_index IF NOT EXISTS FOR (e:Entity) ON (e.entityType)'
      );
      console.error("Ensured Neo4j constraints and indexes exist."); // Startup logging to stderr
    } catch (error: any) {
      logger.error("Failed to ensure Neo4j constraints/indexes", error instanceof Error ? error : new Error(String(error)));
    }
  }

  // Helper to execute Neo4j queries with fallback logic integrated
  private async executeNeo4jOrFallback<T>(
    neo4jWriteCallback: ((tx: ManagedTransaction) => Promise<T>) | null,
    neo4jReadCallback: ((tx: ManagedTransaction) => Promise<T>) | null,
    fallbackCallback: () => Promise<T>
  ): Promise<T> {
    if (this.neo4jAvailable && this.driver) {
      const session = this.driver.session({ database: 'neo4j' });
      try {
        let result: T;
        if (neo4jWriteCallback) {
          result = await session.executeWrite(neo4jWriteCallback);
        } else if (neo4jReadCallback) {
          result = await session.executeRead(neo4jReadCallback);
        } else {
          throw new McpError(
            ErrorCode.InternalError,
            "No Neo4j operation provided"
          );
        }
        this.lastOperationBackend = 'neo4j';
        return result;
      } catch (error) {
        logger.error(`Neo4j operation failed. Falling back to file storage.`, error instanceof Error ? error : new Error(String(error)));
        this.neo4jAvailable = false;
        this.lastOperationBackend = 'file';
        return fallbackCallback();
      } finally {
         await session.close();
      }
    } else {
      this.lastOperationBackend = 'file';
      return fallbackCallback();
    }
  }

  // --- File Fallback Methods ---
  private async loadGraphFromFile(): Promise<KnowledgeGraph> {
    try {
      const data = await fs.readFile(this.config.MEMORY_FILE_PATH, "utf-8");
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
      await fs.mkdir(path.dirname(this.config.MEMORY_FILE_PATH), { recursive: true });
    } catch (error) {
      if (error instanceof Error && 'code' in error && (error as any).code !== 'EEXIST') {
        throw error;
      }
    }
    const lines = [
      ...graph.entities.map(e => JSON.stringify({ type: "entity", ...e })),
      ...graph.relations.map(r => JSON.stringify({ type: "relation", ...r })),
    ];
    await fs.writeFile(this.config.MEMORY_FILE_PATH, lines.join("\n") + "\n");
  }

  // --- CRUD Operations with Fallback ---

  async createEntities(entities: Entity[]): Promise<Entity[]> {
    return this.executeNeo4jOrFallback(
      // Neo4j Write Operation
      async (tx) => {
        const results = await Promise.all(entities.map(async (entity) => {
          const result = await tx.run(
            `MERGE (e:Entity {name: $name})
             ON CREATE SET e.entityType = $entityType, e.observations = $observations
             ON MATCH SET e.entityType = $entityType, e.observations = coalesce(e.observations, []) + [obs IN $observations WHERE NOT obs IN e.observations | obs]
             RETURN e, id(e) as nodeId, 'created' as action`,
            { name: entity.name, entityType: entity.entityType, observations: entity.observations || [] }
          );
          if (result.records.length > 0) {
             return { ...entity, id: result.records[0].get('nodeId').toNumber() };
          }
          return null;
        }));
        return results.filter(e => e !== null) as Entity[];
      },
      null as any,
      // File Fallback Operation
      async () => {
        logger.info("Executing createEntities fallback");
        const graph = await this.loadGraphFromFile();
        const newEntities = entities.filter(e => !graph.entities.some(existingEntity => existingEntity.name === e.name));
        graph.entities.push(...newEntities);
        await this.saveGraphToFile(graph);
        return newEntities;
      }
    );
  }

  async createRelations(relations: Relation[]): Promise<Relation[]> {
     return this.executeNeo4jOrFallback(
      async (tx) => {
        const results = await Promise.all(relations.map(async (rel) => {
          const result = await tx.run(
            `MATCH (from:Entity {name: $fromName}), (to:Entity {name: $toName})
             MERGE (from)-[r:\`${rel.relationType}\`]->(to)
             ON CREATE SET r.created = timestamp()
             RETURN r, r.created as newlyCreated`,
            { fromName: rel.from, toName: rel.to }
          );
           if (result.records.length > 0 && result.records[0].get('newlyCreated')) {
             return rel;
           }
           return null;
        }));
        return results.filter(r => r !== null) as Relation[];
      },
      null,
      async () => {
        logger.info("Executing createRelations fallback");
        const graph = await this.loadGraphFromFile();
        const newRelations = relations.filter(r => {
            const fromExists = graph.entities.some(e => e.name === r.from);
            const toExists = graph.entities.some(e => e.name === r.to);
            if (!fromExists || !toExists) {
                logger.warn(`Skipping relation creation (fallback): Entity ${!fromExists ? r.from : r.to} not found.`);
                return false;
            }
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
      async (tx) => {
        const results = await Promise.all(observations.map(async (obs) => {
          const checkResult = await tx.run(`MATCH (e:Entity {name: $entityName}) RETURN count(e) as count`, { entityName: obs.entityName });
          if (checkResult.records[0].get('count').low === 0) {
             throw new McpError(
               MCP_ERROR_CODES.ENTITY_NOT_FOUND,
               `Entity with name ${obs.entityName} not found in Neo4j`,
               { entityName: obs.entityName, backend: 'neo4j' }
             );
          }

          const updateResult = await tx.run(
            `MATCH (e:Entity {name: $entityName})
             WITH e, [content IN $contents WHERE NOT content IN coalesce(e.observations, []) | content] as newObs
             SET e.observations = coalesce(e.observations, []) + newObs
             RETURN newObs`,
            { entityName: obs.entityName, contents: obs.contents }
          );
          return { entityName: obs.entityName, addedObservations: updateResult.records[0]?.get('newObs') || [] };
        }));
        return results;
      },
      null,
      async () => {
        logger.info("Executing addObservations fallback");
        const graph = await this.loadGraphFromFile();
        const results = observations.map(o => {
          const entity = graph.entities.find(e => e.name === o.entityName);
          if (!entity) {
            throw new McpError(
              MCP_ERROR_CODES.ENTITY_NOT_FOUND,
              `Entity with name ${o.entityName} not found in file`,
              { entityName: o.entityName, backend: 'file' }
            );
          }
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
      async (tx) => {
        await tx.run(
          'MATCH (e:Entity) WHERE e.name IN $names DETACH DELETE e',
          { names: entityNames }
        );
      },
      null,
      async () => {
        logger.info("Executing deleteEntities fallback");
        const graph = await this.loadGraphFromFile();
        graph.entities = graph.entities.filter(e => !entityNames.includes(e.name));
        graph.relations = graph.relations.filter(r => !entityNames.includes(r.from) && !entityNames.includes(r.to));
        await this.saveGraphToFile(graph);
      }
    );
  }

  async deleteObservations(deletions: { entityName: string; observations: string[] }[]): Promise<void> {
     await this.executeNeo4jOrFallback(
      async (tx) => {
         await Promise.all(deletions.map(async (del) => {
            await tx.run(
             `MATCH (e:Entity {name: $entityName})
              SET e.observations = [obs IN coalesce(e.observations, []) WHERE NOT obs IN $observationsToDelete]`,
             { entityName: del.entityName, observationsToDelete: del.observations }
           );
         }));
      },
      null,
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
      async (tx) => {
         await Promise.all(relations.map(async (rel) => {
           await tx.run(
             `MATCH (from:Entity {name: $fromName})-[r:\`${rel.relationType}\`]->(to:Entity {name: $toName})
              DELETE r`,
             { fromName: rel.from, toName: rel.to }
           );
         }));
      },
      null,
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
      null,
      async (tx) => {
        const entityQuery = limit
          ? 'MATCH (e:Entity) RETURN e.name as name, e.entityType as entityType, e.observations as observations SKIP $offset LIMIT $limit'
          : 'MATCH (e:Entity) RETURN e.name as name, e.entityType as entityType, e.observations as observations';

        const entitiesResult = await tx.run(entityQuery, { limit: limit || 0, offset: offset || 0 });

        const entityNames = entitiesResult.records.map(r => r.get('name'));
        const relationsResult = entityNames.length > 0
          ? await tx.run('MATCH (from:Entity)-[r]->(to:Entity) WHERE from.name IN $names AND to.name IN $names RETURN from.name as from, to.name as to, type(r) as relationType', { names: entityNames })
          : { records: [] };

        const entities: Entity[] = entitiesResult.records.map(record => ({
          name: record.get('name'),
          entityType: record.get('entityType'),
          observations: record.get('observations') || [],
        }));

        const relations: Relation[] = relationsResult.records.map(record => ({
          from: record.get('from'),
          to: record.get('to'),
          relationType: record.get('relationType'),
        }));

        return { entities, relations };
      },
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

  // Continuing with search methods... (part 2 in next file due to size)

  async searchNodes(query: string): Promise<KnowledgeGraph> {
     return this.executeNeo4jOrFallback(
      null,
      async (tx) => {
        logger.info(`Executing Neo4j search for query: "${query}"`);
        const entityResult = await tx.run(
          `MATCH (e:Entity)
           WHERE toLower(e.name) CONTAINS toLower($query)
              OR toLower(e.entityType) CONTAINS toLower($query)
              OR any(obs IN coalesce(e.observations, []) WHERE toLower(obs) CONTAINS toLower($query))
           RETURN e.name as name, e.entityType as entityType, e.observations as observations`,
          { query }
        );

        const entities: Entity[] = entityResult.records.map(record => ({
          name: record.get('name'),
          entityType: record.get('entityType'),
          observations: record.get('observations') || [],
        }));

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
      },
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

        const filteredRelations = graph.relations.filter(r =>
          filteredEntityNames.has(r.from) && filteredEntityNames.has(r.to)
        );

        return { entities: filteredEntities, relations: filteredRelations };
      }
    );
  }

  // Export the searchWith Relationships method and other methods...
  // (Continuing in implementation to keep file manageable)

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

    let connectionHealth: 'healthy' | 'degraded' | 'unavailable';
    if (this.neo4jAvailable && !!(this.config.NEO4J_URI && this.config.NEO4J_USER && this.config.NEO4J_PASSWORD)) {
      connectionHealth = 'healthy';
    } else if (!!(this.config.NEO4J_URI && this.config.NEO4J_USER && this.config.NEO4J_PASSWORD) && !this.neo4jAvailable) {
      connectionHealth = 'degraded';
    } else {
      connectionHealth = 'unavailable';
    }

    return {
      currentBackend,
      lastOperationBackend: this.lastOperationBackend,
      neo4jConfigured: !!(this.config.NEO4J_URI && this.config.NEO4J_USER && this.config.NEO4J_PASSWORD),
      neo4jAvailable: this.neo4jAvailable,
      filePath: this.config.MEMORY_FILE_PATH,
      backendConsistent,
      connectionHealth,
      configuration: {
        NEO4J_URI: this.config.NEO4J_URI ? (this.config.NEO4J_URI.includes('@') ? `${this.config.NEO4J_URI.split('@')[0]}@***` : this.config.NEO4J_URI) : undefined,
        NEO4J_USER: this.config.NEO4J_USER,
        MEMORY_FILE_PATH: this.config.MEMORY_FILE_PATH
      }
    };
  }

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
      null,
      async (tx) => {
        try {
          logger.info(`Executing Neo4j enhanced search for query: "${query}"`);

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

          let relations: Relation[] = [];
          let relationshipsLimited = false;

          if (entities.length > 0) {
            const entityNames = entities.map(e => e.name);

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
      async () => {
        logger.info("Executing searchWithRelationships fallback");
        const graph = await this.loadGraphFromFile();
        const lowerQuery = query.toLowerCase();

        const matchedEntities = graph.entities.filter(e =>
          e.name.toLowerCase().includes(lowerQuery) ||
          e.entityType.toLowerCase().includes(lowerQuery) ||
          (e.observations && e.observations.some(o => o.toLowerCase().includes(lowerQuery)))
        );

        const limitedEntities = matchedEntities.slice(0, opts.maxEntities);
        const filteredEntityNames = new Set(limitedEntities.map(e => e.name));

        const entityRelationships = new Map<string, Relation[]>();
        let relationshipsLimited = false;

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

  async openNodes(names: string[]): Promise<KnowledgeGraph> {
     return this.executeNeo4jOrFallback(
      null,
      async (tx) => {
        const result = await tx.run(
          `MATCH (e:Entity) WHERE e.name IN $names
           WITH collect(e) as nodes
           UNWIND nodes as e
           OPTIONAL MATCH (e)-[r]-(related:Entity) WHERE related IN nodes
           RETURN DISTINCT e, r, related`,
          { names }
        );

        const entitiesMap = new Map<string, Entity>();
        const relationsSet = new Set<string>();
        const relations: Relation[] = [];

        result.records.forEach(record => {
          const entityNodeData = record.get('e').properties;
          const relatedNodeData = record.get('related')?.properties;
          const relationship = record.get('r');

          if (entityNodeData && !entitiesMap.has(entityNodeData.name)) {
            entitiesMap.set(entityNodeData.name, {
              name: entityNodeData.name,
              entityType: entityNodeData.entityType,
              observations: entityNodeData.observations || [],
            });
          }

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

        names.forEach(name => {
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
      async () => {
        logger.info("Executing openNodes fallback");
        const graph = await this.loadGraphFromFile();
        const filteredEntities = graph.entities.filter(e => names.includes(e.name));
        const filteredEntityNames = new Set(filteredEntities.map(e => e.name));
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

// Factory function to create a KnowledgeGraphManager instance
export function createKnowledgeGraphManager(config: KnowledgeGraphConfig): KnowledgeGraphManager {
  return new KnowledgeGraphManager(config);
}
