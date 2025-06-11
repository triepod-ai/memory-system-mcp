#!/usr/bin/env node

/**
 * Test Script for Search Indexing Issue
 * 
 * This script tests the search_nodes functionality to identify why newly created entities
 * cannot be found immediately after creation.
 */

import { spawn } from 'child_process';
import { randomBytes } from 'crypto';

class MCPSearchTest {
  constructor() {
    this.serverProcess = null;
    this.testResults = [];
  }

  // Generate unique test data
  generateTestEntity() {
    const id = randomBytes(4).toString('hex');
    return {
      name: `test_entity_${id}`,
      entityType: `test_type_${id}`,
      observations: [`Test observation ${id}`, `Searchable content ${id}`]
    };
  }

  // Send MCP command to server
  async sendMCPCommand(command) {
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
        if (code === 0) {
          resolve({ output, errorOutput, code });
        } else {
          reject(new Error(`Server exited with code ${code}. Error: ${errorOutput}`));
        }
      });

      // Send initialize command first
      const initCommand = {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "search-test", version: "1.0.0" }
        }
      };

      server.stdin.write(JSON.stringify(initCommand) + '\n');

      // Send the actual test command
      server.stdin.write(JSON.stringify(command) + '\n');
      server.stdin.end();
    });
  }

  // Test Case 1: Create entity and immediately search
  async testCreateAndSearch() {
    console.log('\n🔍 Test 1: Create Entity and Immediate Search');
    
    const testEntity = this.generateTestEntity();
    console.log(`Creating entity: ${testEntity.name}`);

    try {
      // Step 1: Get storage status
      const statusCommand = {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "get_storage_status",
          arguments: {}
        }
      };

      const statusResult = await this.sendMCPCommand(statusCommand);
      console.log('📊 Storage Status:', this.extractMCPResponse(statusResult.output));

      // Step 2: Create entity
      const createCommand = {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "create_entities",
          arguments: {
            entities: [testEntity]
          }
        }
      };

      const createResult = await this.sendMCPCommand(createCommand);
      console.log('✅ Create Result:', this.extractMCPResponse(createResult.output));

      // Step 3: Immediate search for the entity
      const searchCommand = {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: {
          name: "search_nodes",
          arguments: {
            query: testEntity.name
          }
        }
      };

      const searchResult = await this.sendMCPCommand(searchCommand);
      const searchResponse = this.extractMCPResponse(searchResult.output);
      console.log('🔍 Search Result:', searchResponse);

      // Analyze result
      const found = searchResponse && searchResponse.entities && 
                   searchResponse.entities.some(e => e.name === testEntity.name);
      
      this.testResults.push({
        test: 'CreateAndSearch',
        entityName: testEntity.name,
        found: found,
        success: found,
        details: { searchResponse }
      });

      console.log(found ? '✅ PASS: Entity found immediately' : '❌ FAIL: Entity not found');

    } catch (error) {
      console.error('❌ Test failed:', error.message);
      this.testResults.push({
        test: 'CreateAndSearch',
        entityName: testEntity.name,
        found: false,
        success: false,
        error: error.message
      });
    }
  }

  // Test Case 2: Search by entity type
  async testSearchByType() {
    console.log('\n🔍 Test 2: Search by Entity Type');
    
    const testEntity = this.generateTestEntity();
    console.log(`Creating entity with type: ${testEntity.entityType}`);

    try {
      // Create entity
      const createCommand = {
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: {
          name: "create_entities",
          arguments: {
            entities: [testEntity]
          }
        }
      };

      await this.sendMCPCommand(createCommand);

      // Search by type
      const searchCommand = {
        jsonrpc: "2.0",
        id: 6,
        method: "tools/call",
        params: {
          name: "search_nodes",
          arguments: {
            query: testEntity.entityType
          }
        }
      };

      const searchResult = await this.sendMCPCommand(searchCommand);
      const searchResponse = this.extractMCPResponse(searchResult.output);

      const found = searchResponse && searchResponse.entities && 
                   searchResponse.entities.some(e => e.entityType === testEntity.entityType);

      this.testResults.push({
        test: 'SearchByType',
        entityType: testEntity.entityType,
        found: found,
        success: found
      });

      console.log(found ? '✅ PASS: Entity found by type' : '❌ FAIL: Entity not found by type');

    } catch (error) {
      console.error('❌ Test failed:', error.message);
      this.testResults.push({
        test: 'SearchByType',
        entityType: testEntity.entityType,
        found: false,
        success: false,
        error: error.message
      });
    }
  }

  // Test Case 3: Search by observation content
  async testSearchByObservation() {
    console.log('\n🔍 Test 3: Search by Observation Content');
    
    const testEntity = this.generateTestEntity();
    const searchTerm = testEntity.observations[0].split(' ')[2]; // Extract unique part
    console.log(`Creating entity with searchable observation: ${searchTerm}`);

    try {
      // Create entity
      const createCommand = {
        jsonrpc: "2.0",
        id: 7,
        method: "tools/call",
        params: {
          name: "create_entities",
          arguments: {
            entities: [testEntity]
          }
        }
      };

      await this.sendMCPCommand(createCommand);

      // Search by observation content
      const searchCommand = {
        jsonrpc: "2.0",
        id: 8,
        method: "tools/call",
        params: {
          name: "search_nodes",
          arguments: {
            query: searchTerm
          }
        }
      };

      const searchResult = await this.sendMCPCommand(searchCommand);
      const searchResponse = this.extractMCPResponse(searchResult.output);

      const found = searchResponse && searchResponse.entities && 
                   searchResponse.entities.some(e => 
                     e.observations && e.observations.some(obs => obs.includes(searchTerm))
                   );

      this.testResults.push({
        test: 'SearchByObservation',
        searchTerm: searchTerm,
        found: found,
        success: found
      });

      console.log(found ? '✅ PASS: Entity found by observation' : '❌ FAIL: Entity not found by observation');

    } catch (error) {
      console.error('❌ Test failed:', error.message);
      this.testResults.push({
        test: 'SearchByObservation',
        searchTerm: searchTerm,
        found: false,
        success: false,
        error: error.message
      });
    }
  }

  // Test Case 4: Backend consistency verification
  async testBackendConsistency() {
    console.log('\n🔍 Test 4: Backend Consistency Check');
    
    try {
      // Get initial status
      const statusCommand1 = {
        jsonrpc: "2.0",
        id: 9,
        method: "tools/call",
        params: {
          name: "get_storage_status",
          arguments: {}
        }
      };

      const status1 = await this.sendMCPCommand(statusCommand1);
      const initialStatus = this.extractMCPResponse(status1.output);
      console.log('📊 Initial Status:', initialStatus);

      // Create an entity
      const testEntity = this.generateTestEntity();
      const createCommand = {
        jsonrpc: "2.0",
        id: 10,
        method: "tools/call",
        params: {
          name: "create_entities",
          arguments: {
            entities: [testEntity]
          }
        }
      };

      await this.sendMCPCommand(createCommand);

      // Get status after create
      const statusCommand2 = {
        jsonrpc: "2.0",
        id: 11,
        method: "tools/call",
        params: {
          name: "get_storage_status",
          arguments: {}
        }
      };

      const status2 = await this.sendMCPCommand(statusCommand2);
      const afterCreateStatus = this.extractMCPResponse(status2.output);
      console.log('📊 After Create Status:', afterCreateStatus);

      // Perform search
      const searchCommand = {
        jsonrpc: "2.0",
        id: 12,
        method: "tools/call",
        params: {
          name: "search_nodes",
          arguments: {
            query: testEntity.name
          }
        }
      };

      await this.sendMCPCommand(searchCommand);

      // Get status after search
      const statusCommand3 = {
        jsonrpc: "2.0",
        id: 13,
        method: "tools/call",
        params: {
          name: "get_storage_status",
          arguments: {}
        }
      };

      const status3 = await this.sendMCPCommand(statusCommand3);
      const afterSearchStatus = this.extractMCPResponse(status3.output);
      console.log('📊 After Search Status:', afterSearchStatus);

      // Check consistency
      const consistent = (
        initialStatus.currentBackend === afterCreateStatus.currentBackend &&
        afterCreateStatus.currentBackend === afterSearchStatus.currentBackend &&
        afterCreateStatus.lastOperationBackend === afterSearchStatus.lastOperationBackend
      );

      this.testResults.push({
        test: 'BackendConsistency',
        consistent: consistent,
        success: consistent,
        details: {
          initial: initialStatus,
          afterCreate: afterCreateStatus,
          afterSearch: afterSearchStatus
        }
      });

      console.log(consistent ? '✅ PASS: Backend consistent' : '❌ FAIL: Backend inconsistent');

    } catch (error) {
      console.error('❌ Test failed:', error.message);
      this.testResults.push({
        test: 'BackendConsistency',
        consistent: false,
        success: false,
        error: error.message
      });
    }
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

  // Generate test report
  generateReport() {
    console.log('\n📋 TEST REPORT');
    console.log('='.repeat(50));
    
    const totalTests = this.testResults.length;
    const passedTests = this.testResults.filter(r => r.success).length;
    const failedTests = totalTests - passedTests;
    
    console.log(`Total Tests: ${totalTests}`);
    console.log(`Passed: ${passedTests}`);
    console.log(`Failed: ${failedTests}`);
    console.log(`Success Rate: ${((passedTests / totalTests) * 100).toFixed(1)}%`);
    
    console.log('\nDetailed Results:');
    this.testResults.forEach((result, index) => {
      const status = result.success ? '✅ PASS' : '❌ FAIL';
      console.log(`${index + 1}. ${result.test}: ${status}`);
      if (result.error) {
        console.log(`   Error: ${result.error}`);
      }
    });

    // Analysis
    console.log('\n🔍 ANALYSIS');
    if (failedTests > 0) {
      console.log('❌ Search indexing issues detected:');
      this.testResults.filter(r => !r.success).forEach(result => {
        console.log(`   - ${result.test}: ${result.error || 'Entity not found after creation'}`);
      });
    } else {
      console.log('✅ All search indexing tests passed');
    }
  }

  // Run all tests
  async runAllTests() {
    console.log('🚀 Starting Search Indexing Tests');
    console.log('='.repeat(50));

    await this.testCreateAndSearch();
    await this.testSearchByType();
    await this.testSearchByObservation();
    await this.testBackendConsistency();

    this.generateReport();
  }
}

// Run tests if script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const tester = new MCPSearchTest();
  tester.runAllTests().catch(console.error);
}

export default MCPSearchTest;