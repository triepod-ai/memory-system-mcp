#!/usr/bin/env node

/**
 * Cleanup Memory-MCP Test Data from Neo4j
 *
 * This script safely removes ONLY test entities created by the MCP Inspector,
 * leaving any real user data intact.
 */

import neo4j from 'neo4j-driver';

// Neo4j connection config (from memory-mcp storage_status)
const NEO4J_URI = process.env.NEO4J_URI || 'neo4j://localhost:7687';
const NEO4J_USER = process.env.NEO4J_USER || 'neo4j';
const NEO4J_PASSWORD = process.env.NEO4J_PASSWORD || 'password';

// Cypher query to match ONLY test entities
const MATCH_TEST_ENTITIES = `
  MATCH (e:Entity)
  WHERE e.entityType = "test"
     OR e.entityType =~ "test_type_.*"
     OR e.entityType = ""
     OR e.entityType =~ "x{90,}"
     OR e.name =~ "test_entity_.*"
     OR e.name IN ["Admin", "Test User", "Demo Application", "Main", "Example Project", "Sample Item", "Default", "TestEntity1", "TestEntity2"]
     OR e.name = ""
     OR e.name =~ "Very Long Name.*"
  RETURN e
`;

const COUNT_TEST_ENTITIES = `
  MATCH (e:Entity)
  WHERE e.entityType = "test"
     OR e.entityType =~ "test_type_.*"
     OR e.entityType = ""
     OR e.entityType =~ "x{90,}"
     OR e.name =~ "test_entity_.*"
     OR e.name IN ["Admin", "Test User", "Demo Application", "Main", "Example Project", "Sample Item", "Default", "TestEntity1", "TestEntity2"]
     OR e.name = ""
     OR e.name =~ "Very Long Name.*"
  RETURN count(e) as count
`;

const DELETE_TEST_ENTITIES = `
  MATCH (e:Entity)
  WHERE e.entityType = "test"
     OR e.entityType =~ "test_type_.*"
     OR e.entityType = ""
     OR e.entityType =~ "x{90,}"
     OR e.name =~ "test_entity_.*"
     OR e.name IN ["Admin", "Test User", "Demo Application", "Main", "Example Project", "Sample Item", "Default", "TestEntity1", "TestEntity2"]
     OR e.name = ""
     OR e.name =~ "Very Long Name.*"
  DETACH DELETE e
`;

async function main() {
  const driver = neo4j.driver(
    NEO4J_URI,
    neo4j.auth.basic(NEO4J_USER, NEO4J_PASSWORD)
  );

  const session = driver.session();

  try {
    console.log('🔍 Connecting to Neo4j...');
    console.log(`   URI: ${NEO4J_URI}`);
    console.log(`   User: ${NEO4J_USER}\n`);

    // Step 1: Count test entities
    console.log('📊 Counting test entities...');
    const countResult = await session.run(COUNT_TEST_ENTITIES);
    const count = countResult.records[0].get('count').toNumber();

    console.log(`✅ Found ${count} test entities\n`);

    if (count === 0) {
      console.log('✨ No test entities found. Database is already clean!');
      return;
    }

    // Step 2: Show sample entities (first 10)
    console.log('📝 Sample entities that will be deleted:');
    const sampleResult = await session.run(MATCH_TEST_ENTITIES + ' LIMIT 10');
    sampleResult.records.forEach((record, i) => {
      const entity = record.get('e').properties;
      console.log(`   ${i + 1}. name: "${entity.name || ''}", entityType: "${entity.entityType || ''}"`);
    });

    if (count > 10) {
      console.log(`   ... and ${count - 10} more\n`);
    } else {
      console.log('');
    }

    // Step 3: Check if running in dry-run mode
    const isDryRun = process.argv.includes('--dry-run');

    if (isDryRun) {
      console.log('🔍 DRY RUN MODE - No changes will be made');
      console.log(`   Run without --dry-run to delete ${count} entities`);
      return;
    }

    // Step 4: Execute deletion
    console.log('⚠️  DELETING test entities...');
    await session.run(DELETE_TEST_ENTITIES);
    console.log(`✅ Successfully deleted ${count} test entities!\n`);

    // Step 5: Verify cleanup
    const verifyResult = await session.run(COUNT_TEST_ENTITIES);
    const remaining = verifyResult.records[0].get('count').toNumber();

    if (remaining === 0) {
      console.log('✨ Cleanup complete! No test entities remain.');
    } else {
      console.log(`⚠️  Warning: ${remaining} test entities still present.`);
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.code === 'ServiceUnavailable') {
      console.error('   Is Neo4j running? Check: sudo systemctl status neo4j');
    } else if (error.code === 'Neo.ClientError.Security.Unauthorized') {
      console.error('   Check NEO4J_PASSWORD environment variable');
    }
    process.exit(1);
  } finally {
    await session.close();
    await driver.close();
  }
}

// Usage help
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`
Usage: node cleanup-memory-mcp-tests.mjs [OPTIONS]

Options:
  --dry-run    Show what would be deleted without making changes
  --help       Show this help message

Environment Variables:
  NEO4J_URI      Neo4j connection URI (default: neo4j://localhost:7687)
  NEO4J_USER     Neo4j username (default: neo4j)
  NEO4J_PASSWORD Neo4j password (default: password)

Examples:
  # Dry run to see what will be deleted
  node cleanup-memory-mcp-tests.mjs --dry-run

  # Actually delete test entities
  node cleanup-memory-mcp-tests.mjs

  # With custom password
  NEO4J_PASSWORD=mypass node cleanup-memory-mcp-tests.mjs
`);
  process.exit(0);
}

main().catch(console.error);
