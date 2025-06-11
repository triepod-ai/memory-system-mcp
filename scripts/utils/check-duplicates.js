#!/usr/bin/env node

import neo4j from 'neo4j-driver';

// Neo4j Configuration
const NEO4J_URI = process.env.NEO4J_URI || 'neo4j://localhost:7687';
const NEO4J_USER = process.env.NEO4J_USER || 'neo4j';
const NEO4J_PASSWORD = process.env.NEO4J_PASSWORD || 'password';

async function checkDuplicates() {
    console.log('Connecting to Neo4j to check for duplicates...');
    
    const driver = neo4j.driver(NEO4J_URI, neo4j.auth.basic(NEO4J_USER, NEO4J_PASSWORD));
    
    try {
        await driver.verifyConnectivity();
        console.log('Successfully connected to Neo4j\n');
        
        const session = driver.session();
        
        try {
            // Check for duplicate entities (same name)
            console.log('=== CHECKING FOR DUPLICATE ENTITIES ===');
            const duplicateEntities = await session.run(`
                MATCH (e:Entity)
                WITH e.name as name, collect(e) as entities, count(e) as count
                WHERE count > 1
                RETURN name, count, entities
                ORDER BY count DESC
            `);
            
            if (duplicateEntities.records.length === 0) {
                console.log('✅ No duplicate entities found');
            } else {
                console.log(`❌ Found ${duplicateEntities.records.length} sets of duplicate entities:`);
                duplicateEntities.records.forEach(record => {
                    const name = record.get('name');
                    const count = record.get('count').low;
                    const entities = record.get('entities');
                    
                    console.log(`  - "${name}": ${count} duplicates`);
                    entities.forEach((entity, index) => {
                        const props = entity.properties;
                        console.log(`    ${index + 1}. Type: ${props.entityType}, Observations: ${props.observations?.length || 0}`);
                    });
                });
            }
            
            // Check for duplicate relations (same from, to, relationType)
            console.log('\n=== CHECKING FOR DUPLICATE RELATIONS ===');
            const duplicateRelations = await session.run(`
                MATCH (from:Entity)-[r]->(to:Entity)
                WITH from.name as fromName, to.name as toName, type(r) as relationType, collect(r) as relations, count(r) as count
                WHERE count > 1
                RETURN fromName, toName, relationType, count, relations
                ORDER BY count DESC
            `);
            
            if (duplicateRelations.records.length === 0) {
                console.log('✅ No duplicate relations found');
            } else {
                console.log(`❌ Found ${duplicateRelations.records.length} sets of duplicate relations:`);
                duplicateRelations.records.forEach(record => {
                    const fromName = record.get('fromName');
                    const toName = record.get('toName');
                    const relationType = record.get('relationType');
                    const count = record.get('count').low;
                    
                    console.log(`  - "${fromName}" -[${relationType}]-> "${toName}": ${count} duplicates`);
                });
            }
            
            // Check for duplicate observations within entities
            console.log('\n=== CHECKING FOR DUPLICATE OBSERVATIONS ===');
            const duplicateObservations = await session.run(`
                MATCH (e:Entity)
                WHERE size(e.observations) > 0
                WITH e.name as name, e.observations as obs
                WITH name, obs, [i IN range(0, size(obs)-1) | 
                    size([j IN range(i+1, size(obs)-1) WHERE obs[i] = obs[j]]) 
                ] as duplicateCounts
                WITH name, obs, reduce(total = 0, count IN duplicateCounts | total + count) as totalDuplicates
                WHERE totalDuplicates > 0
                RETURN name, totalDuplicates, size(obs) as totalObservations
                ORDER BY totalDuplicates DESC
            `);
            
            if (duplicateObservations.records.length === 0) {
                console.log('✅ No duplicate observations found');
            } else {
                console.log(`❌ Found ${duplicateObservations.records.length} entities with duplicate observations:`);
                duplicateObservations.records.forEach(record => {
                    const name = record.get('name');
                    const duplicates = record.get('totalDuplicates').low;
                    const total = record.get('totalObservations').low;
                    
                    console.log(`  - "${name}": ${duplicates} duplicate observations out of ${total} total`);
                });
            }
            
            // Overall summary
            console.log('\n=== SUMMARY ===');
            const totalEntities = await session.run('MATCH (e:Entity) RETURN count(e) as count');
            const totalRelations = await session.run('MATCH ()-[r]->() RETURN count(r) as count');
            
            console.log(`Total entities: ${totalEntities.records[0].get('count').low}`);
            console.log(`Total relations: ${totalRelations.records[0].get('count').low}`);
            console.log(`Duplicate entity sets: ${duplicateEntities.records.length}`);
            console.log(`Duplicate relation sets: ${duplicateRelations.records.length}`);
            console.log(`Entities with duplicate observations: ${duplicateObservations.records.length}`);
            
            // Suggest cleanup if duplicates found
            if (duplicateEntities.records.length > 0 || duplicateRelations.records.length > 0 || duplicateObservations.records.length > 0) {
                console.log('\n💡 Run with --clean flag to remove duplicates automatically');
                console.log('   Example: node check-duplicates.js --clean');
            }
            
        } finally {
            await session.close();
        }
        
    } finally {
        await driver.close();
    }
}

async function cleanDuplicates() {
    console.log('Connecting to Neo4j to clean duplicates...');
    
    const driver = neo4j.driver(NEO4J_URI, neo4j.auth.basic(NEO4J_USER, NEO4J_PASSWORD));
    
    try {
        await driver.verifyConnectivity();
        console.log('Successfully connected to Neo4j\n');
        
        const session = driver.session();
        
        try {
            let cleanedCount = 0;
            
            // Clean duplicate entities (keep the first one, merge observations)
            console.log('=== CLEANING DUPLICATE ENTITIES ===');
            const duplicateEntities = await session.run(`
                MATCH (e:Entity)
                WITH e.name as name, collect(e) as entities
                WHERE size(entities) > 1
                RETURN name, entities
            `);
            
            for (const record of duplicateEntities.records) {
                const name = record.get('name');
                const entities = record.get('entities');
                
                console.log(`Cleaning duplicate entities for: "${name}"`);
                
                // Merge all observations into the first entity
                const firstEntity = entities[0];
                const allObservations = new Set();
                
                entities.forEach(entity => {
                    const obs = entity.properties.observations || [];
                    obs.forEach(o => allObservations.add(o));
                });
                
                // Update first entity with merged observations
                await session.run(`
                    MATCH (e:Entity) WHERE id(e) = $id
                    SET e.observations = $observations
                `, {
                    id: firstEntity.identity,
                    observations: Array.from(allObservations)
                });
                
                // Delete duplicate entities (except the first)
                for (let i = 1; i < entities.length; i++) {
                    await session.run(`
                        MATCH (e:Entity) WHERE id(e) = $id
                        DETACH DELETE e
                    `, { id: entities[i].identity });
                    cleanedCount++;
                }
            }
            
            // Clean duplicate relations
            console.log('\n=== CLEANING DUPLICATE RELATIONS ===');
            const duplicateRelations = await session.run(`
                MATCH (from:Entity)-[r]->(to:Entity)
                WITH from, to, type(r) as relationType, collect(r) as relations
                WHERE size(relations) > 1
                RETURN from, to, relationType, relations
            `);
            
            for (const record of duplicateRelations.records) {
                const fromEntity = record.get('from');
                const toEntity = record.get('to');
                const relationType = record.get('relationType');
                const relations = record.get('relations');
                
                console.log(`Cleaning duplicate relations: "${fromEntity.properties.name}" -[${relationType}]-> "${toEntity.properties.name}"`);
                
                // Delete all but the first relation
                for (let i = 1; i < relations.length; i++) {
                    await session.run(`
                        MATCH ()-[r]->() WHERE id(r) = $id
                        DELETE r
                    `, { id: relations[i].identity });
                    cleanedCount++;
                }
            }
            
            // Clean duplicate observations within entities
            console.log('\n=== CLEANING DUPLICATE OBSERVATIONS ===');
            const entitiesWithDuplicateObs = await session.run(`
                MATCH (e:Entity)
                WHERE size(e.observations) > 0
                RETURN e, e.observations as obs
            `);
            
            for (const record of entitiesWithDuplicateObs.records) {
                const entity = record.get('e');
                const observations = record.get('obs') || [];
                
                const uniqueObservations = [...new Set(observations)];
                
                if (uniqueObservations.length < observations.length) {
                    console.log(`Cleaning duplicate observations for: "${entity.properties.name}"`);
                    console.log(`  Reduced from ${observations.length} to ${uniqueObservations.length} observations`);
                    
                    await session.run(`
                        MATCH (e:Entity) WHERE id(e) = $id
                        SET e.observations = $observations
                    `, {
                        id: entity.identity,
                        observations: uniqueObservations
                    });
                    cleanedCount++;
                }
            }
            
            console.log(`\n✅ Cleanup completed! Removed/fixed ${cleanedCount} duplicates`);
            
        } finally {
            await session.close();
        }
        
    } finally {
        await driver.close();
    }
}

// Main execution
const shouldClean = process.argv.includes('--clean');

if (shouldClean) {
    cleanDuplicates().catch(error => {
        console.error('Cleanup failed:', error);
        process.exit(1);
    });
} else {
    checkDuplicates().catch(error => {
        console.error('Duplicate check failed:', error);
        process.exit(1);
    });
}