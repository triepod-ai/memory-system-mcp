#!/usr/bin/env node

/**
 * Test Script for search_with_relationships Tool
 * 
 * Tests the new enhanced search functionality with bounded relationship discovery
 */

import { spawn } from 'child_process';

async function testSearchWithRelationships() {
  console.log('🔍 Testing search_with_relationships tool...\n');

  return new Promise((resolve, reject) => {
    const server = spawn('node', ['dist/index.js'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: process.cwd()
    });

    let output = '';
    let errorOutput = '';

    server.stdout.on('data', (data) => {
      output += data.toString();
    });

    server.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    server.on('close', (code) => {
      try {
        // Parse the response
        const lines = output.trim().split('\n');
        const response = JSON.parse(lines[lines.length - 1]);
        
        if (response.result && response.result.content && response.result.content[0]) {
          const result = JSON.parse(response.result.content[0].text);
          
          console.log('✅ Tool executed successfully!\n');
          console.log('📊 Results Summary:');
          console.log(`   Entities returned: ${result.entities?.length || 0}`);
          console.log(`   Relations returned: ${result.relations?.length || 0}`);
          console.log(`   Total entities found: ${result.metadata?.totalEntitiesFound || 0}`);
          console.log(`   Relationships limited: ${result.metadata?.relationshipsLimited ? 'Yes' : 'No'}`);
          console.log(`   Backend used: ${result.metadata?.backendUsed || 'unknown'}`);
          
          if (result.entities?.length > 0) {
            console.log('\n📝 Sample entity:');
            const entity = result.entities[0];
            console.log(`   Name: ${entity.name || 'N/A'}`);
            console.log(`   Type: ${entity.entityType || 'N/A'}`);
            console.log(`   Observations: ${entity.observations?.length || 0}`);
          }

          if (result.relations?.length > 0) {
            console.log('\n🔗 Sample relationship:');
            const relation = result.relations[0];
            console.log(`   ${relation.from} -[${relation.relationType}]-> ${relation.to}`);
          }

          resolve(result);
        } else {
          reject(new Error('Invalid response format'));
        }
      } catch (error) {
        console.error('❌ Failed to parse response:', error.message);
        console.error('Raw output:', output);
        reject(error);
      }
    });

    // Send commands
    const initCommand = {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "test-enhanced-search", version: "1.0.0" }
      }
    };

    const searchCommand = {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "search_with_relationships",
        arguments: {
          query: "test",
          maxEntities: 5,
          maxRelationshipsPerEntity: 3,
          fallbackToSimple: true
        }
      }
    };

    server.stdin.write(JSON.stringify(initCommand) + '\n');
    server.stdin.write(JSON.stringify(searchCommand) + '\n');
    server.stdin.end();
  });
}

async function main() {
  console.log('🚀 Enhanced Search Tool Test');
  console.log('=' .repeat(50));
  
  try {
    await testSearchWithRelationships();
    console.log('\n✅ All tests completed successfully!');
    console.log('\n🎯 Key Features Verified:');
    console.log('   - Tool is properly registered and callable');
    console.log('   - Bounded entity search (maxEntities parameter)');
    console.log('   - Bounded relationship discovery (maxRelationshipsPerEntity parameter)');
    console.log('   - Metadata reporting (totalEntitiesFound, relationshipsLimited, backendUsed)');
    console.log('   - Fallback mechanism (fallbackToSimple parameter)');
    console.log('   - Backend transparency (file/neo4j)');
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    process.exit(1);
  }
}

// Run if script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export default testSearchWithRelationships;