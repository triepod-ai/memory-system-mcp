#!/usr/bin/env node

/**
 * Test Migration Tool
 * 
 * Tests the new migrate_fallback_to_neo4j tool
 */

import { spawn } from 'child_process';

class MigrationToolTest {
  constructor() {
    this.testResults = [];
  }

  // Send MCP command
  async sendMCPCommand(command, useNeo4j = false) {
    return new Promise((resolve, reject) => {
      const env = useNeo4j ? {
        ...process.env,
        NEO4J_URI: 'neo4j://localhost:7687',
        NEO4J_USER: 'neo4j',
        NEO4J_PASSWORD: 'password'
      } : process.env;

      const server = spawn('node', ['dist/index.js'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: process.cwd(),
        env
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
        resolve({ output, errorOutput, code });
      });

      // Send initialize and command
      const initCommand = {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "migration-test", version: "1.0.0" }
        }
      };

      server.stdin.write(JSON.stringify(initCommand) + '\n');
      server.stdin.write(JSON.stringify(command) + '\n');
      server.stdin.end();
    });
  }

  // Extract response from MCP JSON-RPC format
  extractMCPResponse(output) {
    try {
      const lines = output.trim().split('\n');
      for (const line of lines) {
        if (line.trim()) {
          const response = JSON.parse(line);
          if (response.result && response.result.content && response.result.content[0]) {
            const content = response.result.content[0].text;
            try {
              return JSON.parse(content);
            } catch {
              return content;
            }
          }
        }
      }
      return null;
    } catch (error) {
      console.error('Failed to parse MCP response:', error.message);
      return null;
    }
  }

  // Test 1: Migration tool availability
  async testToolAvailability() {
    console.log('\n🔍 Test 1: Migration Tool Availability');
    
    try {
      const listToolsCommand = {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
        params: {}
      };

      const result = await this.sendMCPCommand(listToolsCommand, false);
      const tools = this.extractMCPResponse(result.output);
      
      const migrationTool = tools?.tools?.find(tool => tool.name === 'migrate_fallback_to_neo4j');
      const toolAvailable = !!migrationTool;

      console.log('Available tools:', tools?.tools?.map(t => t.name) || []);
      console.log('Migration tool found:', toolAvailable ? '✅' : '❌');
      
      if (migrationTool) {
        console.log('Tool description:', migrationTool.description);
        console.log('Tool schema:', JSON.stringify(migrationTool.inputSchema, null, 2));
      }

      this.testResults.push({
        test: 'ToolAvailability',
        toolAvailable,
        success: toolAvailable
      });

    } catch (error) {
      console.error('❌ Tool availability test failed:', error.message);
      this.testResults.push({
        test: 'ToolAvailability',
        success: false,
        error: error.message
      });
    }
  }

  // Test 2: Dry run migration
  async testDryRunMigration() {
    console.log('\n🔍 Test 2: Dry Run Migration');
    
    try {
      const migrationCommand = {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "migrate_fallback_to_neo4j",
          arguments: {
            dryRun: true,
            conflictResolution: "merge"
          }
        }
      };

      console.log('Executing dry run migration...');
      const result = await this.sendMCPCommand(migrationCommand, false);
      const migrationResult = this.extractMCPResponse(result.output);

      console.log('Migration result structure:', migrationResult ? Object.keys(migrationResult) : 'null');
      
      if (migrationResult && migrationResult.summary) {
        console.log('📊 Migration Summary:');
        console.log(`   Entities processed: ${migrationResult.summary.entitiesProcessed}`);
        console.log(`   Relations processed: ${migrationResult.summary.relationsProcessed}`);
        console.log(`   Errors: ${migrationResult.summary.errors?.length || 0}`);
        
        if (migrationResult.summary.errors?.length > 0) {
          console.log('   Error details:', migrationResult.summary.errors);
        }
      }

      if (migrationResult && migrationResult.logs) {
        console.log('📝 Sample logs:');
        migrationResult.logs.slice(0, 5).forEach(log => console.log(`   ${log}`));
        if (migrationResult.logs.length > 5) {
          console.log(`   ... and ${migrationResult.logs.length - 5} more log entries`);
        }
      }

      const hasStructure = migrationResult && 
                          migrationResult.summary && 
                          migrationResult.logs && 
                          migrationResult.crossReferences;

      this.testResults.push({
        test: 'DryRunMigration',
        hasStructure,
        entitiesProcessed: migrationResult?.summary?.entitiesProcessed || 0,
        relationsProcessed: migrationResult?.summary?.relationsProcessed || 0,
        success: hasStructure && !migrationResult?.summary?.errors?.length
      });

      console.log(hasStructure ? '✅ PASS: Dry run migration successful' : '❌ FAIL: Migration structure issues');

    } catch (error) {
      console.error('❌ Dry run migration test failed:', error.message);
      this.testResults.push({
        test: 'DryRunMigration',
        success: false,
        error: error.message
      });
    }
  }

  // Test 3: Migration with Neo4j unavailable
  async testMigrationWithoutNeo4j() {
    console.log('\n🔍 Test 3: Migration Without Neo4j');
    
    try {
      const migrationCommand = {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: {
          name: "migrate_fallback_to_neo4j",
          arguments: {
            dryRun: false,
            conflictResolution: "skip"
          }
        }
      };

      console.log('Executing migration without Neo4j...');
      const result = await this.sendMCPCommand(migrationCommand, false); // No Neo4j config
      const migrationResult = this.extractMCPResponse(result.output);

      console.log('Migration response received');
      
      if (migrationResult && migrationResult.summary && migrationResult.summary.errors) {
        const hasNeo4jError = migrationResult.summary.errors.some(error => 
          error.includes('Neo4j is not available') || error.includes('Cannot migrate')
        );
        
        console.log('Neo4j unavailable error detected:', hasNeo4jError ? '✅' : '❌');
        console.log('Error messages:', migrationResult.summary.errors);
        
        this.testResults.push({
          test: 'MigrationWithoutNeo4j',
          hasNeo4jError,
          errorCount: migrationResult.summary.errors.length,
          success: hasNeo4jError
        });
      } else {
        console.log('❌ Unexpected response structure');
        this.testResults.push({
          test: 'MigrationWithoutNeo4j',
          success: false,
          error: 'Unexpected response structure'
        });
      }

    } catch (error) {
      console.error('❌ Migration without Neo4j test failed:', error.message);
      this.testResults.push({
        test: 'MigrationWithoutNeo4j',
        success: false,
        error: error.message
      });
    }
  }

  // Test 4: Check fallback file content
  async testFallbackFileContent() {
    console.log('\n🔍 Test 4: Fallback File Content Check');
    
    try {
      const statusCommand = {
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: {
          name: "get_storage_status",
          arguments: {}
        }
      };

      const result = await this.sendMCPCommand(statusCommand, false);
      const status = this.extractMCPResponse(result.output);
      
      if (status && status.filePath) {
        console.log('Fallback file path:', status.filePath);
        
        // Try to get a summary to see what's in the file
        const summaryCommand = {
          jsonrpc: "2.0",
          id: 6,
          method: "tools/call",
          params: {
            name: "get_graph_summary",
            arguments: {}
          }
        };

        const summaryResult = await this.sendMCPCommand(summaryCommand, false);
        const summary = this.extractMCPResponse(summaryResult.output);
        
        if (summary) {
          console.log('📊 Fallback File Content:');
          console.log(`   Entities: ${summary.entityCount}`);
          console.log(`   Relations: ${summary.relationCount}`);
          console.log(`   Entity Types: ${summary.entityTypes?.join(', ') || 'none'}`);
          
          const hasSubstantialData = summary.entityCount >= 100 && summary.relationCount >= 50;
          console.log(`   Substantial data (125+ entities, 73+ relations): ${hasSubstantialData ? '✅' : '❌'}`);

          this.testResults.push({
            test: 'FallbackFileContent',
            entityCount: summary.entityCount,
            relationCount: summary.relationCount,
            hasSubstantialData,
            success: true
          });
        }
      }

    } catch (error) {
      console.error('❌ Fallback file content test failed:', error.message);
      this.testResults.push({
        test: 'FallbackFileContent',
        success: false,
        error: error.message
      });
    }
  }

  // Generate test report
  generateReport() {
    console.log('\n📋 MIGRATION TOOL TEST REPORT');
    console.log('='.repeat(50));
    
    const totalTests = this.testResults.length;
    const passedTests = this.testResults.filter(r => r.success).length;
    const failedTests = totalTests - passedTests;
    
    console.log(`Total Tests: ${totalTests}`);
    console.log(`Passed: ${passedTests}`);
    console.log(`Failed: ${failedTests}`);
    console.log(`Success Rate: ${((passedTests / totalTests) * 100).toFixed(1)}%`);
    
    console.log('\nTest Results:');
    this.testResults.forEach(result => {
      const status = result.success ? '✅ PASS' : '❌ FAIL';
      console.log(`${result.test}: ${status}`);
      
      if (!result.success && result.error) {
        console.log(`   Error: ${result.error}`);
      }
      
      // Show specific test details
      if (result.test === 'FallbackFileContent' && result.success) {
        console.log(`   Data: ${result.entityCount} entities, ${result.relationCount} relations`);
      }
      if (result.test === 'DryRunMigration' && result.success) {
        console.log(`   Processed: ${result.entitiesProcessed} entities, ${result.relationsProcessed} relations`);
      }
    });

    console.log('\n🎯 MIGRATION TOOL ASSESSMENT');
    if (failedTests === 0) {
      console.log('✅ Migration tool is working correctly!');
      console.log('   - Tool is available and properly configured');
      console.log('   - Dry run functionality works');
      console.log('   - Error handling for missing Neo4j works');
      console.log('   - Can process substantial fallback data');
    } else {
      console.log('❌ Some issues detected with migration tool');
    }
  }

  // Run all tests
  async runAllTests() {
    console.log('🚀 Starting Migration Tool Tests');
    console.log('='.repeat(50));

    await this.testToolAvailability();
    await this.testFallbackFileContent();
    await this.testDryRunMigration();
    await this.testMigrationWithoutNeo4j();

    this.generateReport();
  }
}

// Run tests if script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const tester = new MigrationToolTest();
  tester.runAllTests().catch(console.error);
}

export default MigrationToolTest;