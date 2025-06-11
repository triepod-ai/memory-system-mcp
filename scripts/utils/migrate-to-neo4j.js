#!/usr/bin/env node

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import neo4j from 'neo4j-driver';

// Neo4j Configuration
const NEO4J_URI = process.env.NEO4J_URI || 'neo4j://localhost:7687';
const NEO4J_USER = process.env.NEO4J_USER || 'neo4j';
const NEO4J_PASSWORD = process.env.NEO4J_PASSWORD || 'password';

// File path
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MEMORY_FILE_PATH = path.join(__dirname, 'dist', 'memory.json');

async function loadGraphFromFile() {
    try {
        console.log(`Loading data from: ${MEMORY_FILE_PATH}`);
        const data = await fs.readFile(MEMORY_FILE_PATH, "utf-8");
        const lines = data.split("\n").filter(line => line.trim() !== "");
        
        const graph = { entities: [], relations: [] };
        
        for (const line of lines) {
            try {
                const item = JSON.parse(line);
                if (item.type === "entity") {
                    graph.entities.push({
                        name: item.name,
                        entityType: item.entityType,
                        observations: item.observations || []
                    });
                }
                if (item.type === "relation") {
                    graph.relations.push({
                        from: item.from,
                        to: item.to,
                        relationType: item.relationType
                    });
                }
            } catch (parseError) {
                console.warn(`Skipping invalid JSON line: ${line}`);
            }
        }
        
        console.log(`Loaded ${graph.entities.length} entities and ${graph.relations.length} relations`);
        return graph;
    } catch (error) {
        if (error.code === "ENOENT") {
            console.log("No memory file found - starting with empty data");
            return { entities: [], relations: [] };
        }
        throw error;
    }
}

async function migrateToNeo4j() {
    console.log('Starting migration to Neo4j...');
    
    // Connect to Neo4j
    const driver = neo4j.driver(NEO4J_URI, neo4j.auth.basic(NEO4J_USER, NEO4J_PASSWORD));
    
    try {
        // Verify connection
        await driver.verifyConnectivity();
        console.log('Successfully connected to Neo4j');
        
        // Load data from file
        const graph = await loadGraphFromFile();
        
        if (graph.entities.length === 0 && graph.relations.length === 0) {
            console.log('No data to migrate');
            return;
        }
        
        const session = driver.session();
        
        try {
            // Create constraints and indexes
            console.log('Creating constraints and indexes...');
            await session.run('CREATE CONSTRAINT entity_name_unique IF NOT EXISTS FOR (e:Entity) REQUIRE e.name IS UNIQUE');
            await session.run('CREATE INDEX entity_type_index IF NOT EXISTS FOR (e:Entity) ON (e.entityType)');
            
            // Migrate entities (using MERGE to avoid duplicates)
            console.log(`Migrating ${graph.entities.length} entities...`);
            let entityCount = 0;
            let newEntityCount = 0;
            
            for (const entity of graph.entities) {
                const result = await session.run(
                    `MERGE (e:Entity {name: $name})
                     ON CREATE SET e.entityType = $entityType, e.observations = $observations, e.created = timestamp()
                     ON MATCH SET e.observations = coalesce(e.observations, []) + [obs IN $observations WHERE NOT obs IN coalesce(e.observations, []) | obs]
                     RETURN e.created IS NOT NULL as isNew`,
                    { 
                        name: entity.name, 
                        entityType: entity.entityType, 
                        observations: entity.observations || [] 
                    }
                );
                
                if (result.records[0] && result.records[0].get('isNew')) {
                    newEntityCount++;
                }
                entityCount++;
                
                if (entityCount % 100 === 0) {
                    console.log(`Processed ${entityCount} entities (${newEntityCount} new)...`);
                }
            }
            
            // Migrate relations (using MERGE to avoid duplicates)
            console.log(`Migrating ${graph.relations.length} relations...`);
            let relationCount = 0;
            let newRelationCount = 0;
            
            for (const relation of graph.relations) {
                try {
                    const result = await session.run(
                        `MATCH (from:Entity {name: $fromName}), (to:Entity {name: $toName})
                         MERGE (from)-[r:\`${relation.relationType}\`]->(to)
                         ON CREATE SET r.created = timestamp()
                         RETURN r.created IS NOT NULL as isNew`,
                        { fromName: relation.from, toName: relation.to }
                    );
                    
                    if (result.records[0] && result.records[0].get('isNew')) {
                        newRelationCount++;
                    }
                    relationCount++;
                    
                    if (relationCount % 100 === 0) {
                        console.log(`Processed ${relationCount} relations (${newRelationCount} new)...`);
                    }
                } catch (error) {
                    console.warn(`Failed to process relation ${relation.from} -[${relation.relationType}]-> ${relation.to}: ${error.message}`);
                }
            }
            
            console.log('Migration completed successfully!');
            console.log(`Total entities processed: ${entityCount} (${newEntityCount} new)`);
            console.log(`Total relations processed: ${relationCount} (${newRelationCount} new)`);
            
            // Verify the migration
            const entityCountResult = await session.run('MATCH (e:Entity) RETURN count(e) as count');
            const relationCountResult = await session.run('MATCH ()-[r]->() RETURN count(r) as count');
            
            console.log(`Neo4j now contains:`);
            console.log(`  Entities: ${entityCountResult.records[0].get('count').low}`);
            console.log(`  Relations: ${relationCountResult.records[0].get('count').low}`);
            
        } finally {
            await session.close();
        }
        
    } finally {
        await driver.close();
    }
}

// Run migration
migrateToNeo4j().catch(error => {
    console.error('Migration failed:', error);
    process.exit(1);
});