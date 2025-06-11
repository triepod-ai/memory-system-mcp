#!/usr/bin/env node

/**
 * Test Script for Neo4j Search Issues
 * 
 * This script tests search_nodes with Neo4j backend enabled to identify
 * the specific issue that occurs with Neo4j vs file fallback.
 */

import { spawn } from 'child_process';
import { randomBytes } from 'crypto';

class Neo4jSearchTest {
  constructor() {
    this.testResults = [];
  }

  // Generate unique test data
  generateTestEntity() {
    const id = randomBytes(4).toString('hex');
    return {
      name: `neo4j_test_${id}`,
      entityType: `neo4j_type_${id}`,
      observations: [`Neo4j test observation ${id}`, `Searchable Neo4j content ${id}`]
    };
  }

  // Send MCP command to server with Neo4j environment
  async sendMCPCommandWithNeo4j(command) {
    return new Promise((resolve, reject) => {
      const server = spawn('node', ['dist/index.js'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: process.cwd(),
        env: {
          ...process.env,
          NEO4J_URI: 'neo4j://localhost:7687',
          NEO4J_USER: 'neo4j',
          NEO4J_PASSWORD: 'password'
        }
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

      // Send initialize command first
      const initCommand = {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "neo4j-search-test", version: "1.0.0" }
        }
      };

      server.stdin.write(JSON.stringify(initCommand) + '\n');

      // Send the actual test command
      server.stdin.write(JSON.stringify(command) + '\n');
      server.stdin.end();
    });
  }

  // Test Neo4j backend availability
  async testNeo4jConnection() {
    console.log('\n🔍 Test 1: Neo4j Connection Check');
    
    try {
      const statusCommand = {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "get_storage_status",
          arguments: {}
        }
      };

      const result = await this.sendMCPCommandWithNeo4j(statusCommand);
      const status = this.extractMCPResponse(result.output);
      
      console.log('📊 Neo4j Status:', status);
      
      const neo4jAvailable = status && status.neo4jAvailable;
      const currentBackend = status && status.currentBackend;
      
      this.testResults.push({
        test: 'Neo4jConnection',
        neo4jAvailable: neo4jAvailable,
        currentBackend: currentBackend,
        success: neo4jAvailable === true
      });

      if (neo4jAvailable) {
        console.log('✅ PASS: Neo4j is available and connected');
      } else {
        console.log('❌ FAIL: Neo4j is not available - this may be the root cause');
        console.log('   Backend in use:', currentBackend);
      }

      return neo4jAvailable;

    } catch (error) {
      console.error('❌ Neo4j connection test failed:', error.message);
      this.testResults.push({
        test: 'Neo4jConnection',
        neo4jAvailable: false,
        success: false,
        error: error.message
      });
      return false;
    }
  }

  // Test create and search with Neo4j backend
  async testNeo4jCreateAndSearch() {
    console.log('\n🔍 Test 2: Neo4j Create and Search');
    
    const testEntity = this.generateTestEntity();
    console.log(`Creating entity in Neo4j: ${testEntity.name}`);

    try {
      // Create entity
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

      const createResult = await this.sendMCPCommandWithNeo4j(createCommand);
      const createResponse = this.extractMCPResponse(createResult.output);
      console.log('✅ Create Result:', createResponse);

      // Immediate search
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

      const searchResult = await this.sendMCPCommandWithNeo4j(searchCommand);
      const searchResponse = this.extractMCPResponse(searchResult.output);
      console.log('🔍 Search Result:', searchResponse);

      // Check if entity was found
      const found = searchResponse && searchResponse.entities && 
                   searchResponse.entities.some(e => e.name === testEntity.name);

      this.testResults.push({
        test: 'Neo4jCreateAndSearch',
        entityName: testEntity.name,
        found: found,
        success: found,
        createResponse: createResponse,
        searchResponse: searchResponse
      });

      console.log(found ? '✅ PASS: Entity found in Neo4j' : '❌ FAIL: Entity not found in Neo4j');

    } catch (error) {
      console.error('❌ Neo4j create and search test failed:', error.message);
      this.testResults.push({
        test: 'Neo4jCreateAndSearch',
        entityName: testEntity.name,
        found: false,
        success: false,
        error: error.message
      });
    }
  }

  // Test complex search query issues
  async testComplexSearchQuery() {
    console.log('\n🔍 Test 3: Complex Search Query Analysis');
    
    try {
      // Create entities with various content types
      const entities = [
        {
          name: 'complex_test_name',
          entityType: 'complex_test_type',
          observations: ['observation with UPPERCASE', 'observation with numbers 123']
        },
        {
          name: 'UPPERCASE_NAME',
          entityType: 'lowercase_type',
          observations: ['mixed Case Observation']
        }
      ];

      // Create entities
      const createCommand = {
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: {
          name: "create_entities",
          arguments: { entities }
        }
      };

      await this.sendMCPCommandWithNeo4j(createCommand);

      // Test various search patterns
      const searchTests = [
        { query: 'complex_test', expected: 'complex_test_name' },
        { query: 'COMPLEX_TEST', expected: 'complex_test_name' },
        { query: 'uppercase_name', expected: 'UPPERCASE_NAME' },
        { query: 'UPPERCASE', expected: 'UPPERCASE_NAME' },
        { query: 'numbers 123', expected: 'complex_test_name' },
        { query: 'mixed Case', expected: 'UPPERCASE_NAME' }
      ];

      for (const searchTest of searchTests) {
        const searchCommand = {
          jsonrpc: "2.0",
          id: 6,
          method: "tools/call",
          params: {
            name: "search_nodes",
            arguments: { query: searchTest.query }
          }
        };

        const searchResult = await this.sendMCPCommandWithNeo4j(searchCommand);
        const searchResponse = this.extractMCPResponse(searchResult.output);
        
        const found = searchResponse && searchResponse.entities && 
                     searchResponse.entities.some(e => e.name === searchTest.expected);

        console.log(`   Query: "${searchTest.query}" → ${found ? '✅' : '❌'} (expected: ${searchTest.expected})`);
        
        this.testResults.push({
          test: 'ComplexSearchQuery',
          query: searchTest.query,
          expected: searchTest.expected,
          found: found,
          success: found
        });
      }

    } catch (error) {
      console.error('❌ Complex search query test failed:', error.message);
      this.testResults.push({
        test: 'ComplexSearchQuery',
        success: false,
        error: error.message
      });
    }
  }

  // Test backend switching behavior
  async testBackendSwitching() {
    console.log('\n🔍 Test 4: Backend Switching Analysis');
    
    try {
      // Get initial status with Neo4j
      const statusCommand = {
        jsonrpc: "2.0",
        id: 7,
        method: "tools/call",
        params: {
          name: "get_storage_status",
          arguments: {}
        }
      };

      const neo4jStatus = await this.sendMCPCommandWithNeo4j(statusCommand);
      const neo4jStatusResponse = this.extractMCPResponse(neo4jStatus.output);
      console.log('📊 Neo4j Backend Status:', neo4jStatusResponse);

      // Compare with file backend (no Neo4j env vars)
      const fileStatus = await this.sendMCPCommand(statusCommand);
      const fileStatusResponse = this.extractMCPResponse(fileStatus.output);
      console.log('📊 File Backend Status:', fileStatusResponse);

      // Check for backend consistency
      const neo4jWorking = neo4jStatusResponse && neo4jStatusResponse.neo4jAvailable;
      const backendsDifferent = neo4jStatusResponse && fileStatusResponse && 
                               neo4jStatusResponse.currentBackend !== fileStatusResponse.currentBackend;

      this.testResults.push({
        test: 'BackendSwitching',
        neo4jWorking: neo4jWorking,
        backendsDifferent: backendsDifferent,
        success: neo4jWorking && backendsDifferent,
        neo4jStatus: neo4jStatusResponse,
        fileStatus: fileStatusResponse
      });

      if (neo4jWorking && backendsDifferent) {
        console.log('✅ PASS: Backend switching works correctly');
      } else {
        console.log('❌ FAIL: Backend switching issue detected');
      }

    } catch (error) {
      console.error('❌ Backend switching test failed:', error.message);
      this.testResults.push({
        test: 'BackendSwitching',
        success: false,
        error: error.message
      });
    }
  }

  // Send MCP command without Neo4j env vars
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
        resolve({ output, errorOutput, code });
      });

      const initCommand = {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "test-client", version: "1.0.0" }
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

  // Generate test report
  generateReport() {
    console.log('\n📋 NEO4J SEARCH TEST REPORT');
    console.log('='.repeat(60));
    
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

    // Root cause analysis
    console.log('\n🔍 ROOT CAUSE ANALYSIS');
    const neo4jConnectionTest = this.testResults.find(r => r.test === 'Neo4jConnection');
    
    if (neo4jConnectionTest && !neo4jConnectionTest.neo4jAvailable) {
      console.log('❌ PRIMARY ISSUE: Neo4j database is not available');
      console.log('   - Server falls back to file storage automatically');
      console.log('   - User reports may be comparing Neo4j vs file behavior');
      console.log('   - Recommendation: Ensure Neo4j is running and accessible');
    } else {
      const failedSearchTests = this.testResults.filter(r => 
        r.test.includes('Search') && !r.success
      );
      
      if (failedSearchTests.length > 0) {
        console.log('❌ SEARCH QUERY ISSUES DETECTED:');
        failedSearchTests.forEach(test => {
          console.log(`   - ${test.test}: ${test.error || 'Search failed'}`);
        });
      } else {
        console.log('✅ Neo4j search functionality appears to be working correctly');
        console.log('   - Issue may be environment-specific');
        console.log('   - Check actual production Neo4j configuration');
      }
    }
  }

  // Run all Neo4j-specific tests
  async runAllTests() {
    console.log('🚀 Starting Neo4j Search Tests');
    console.log('='.repeat(60));

    const neo4jAvailable = await this.testNeo4jConnection();
    
    if (neo4jAvailable) {
      await this.testNeo4jCreateAndSearch();
      await this.testComplexSearchQuery();
    } else {
      console.log('\n⚠️  Skipping Neo4j-specific tests (Neo4j not available)');
    }
    
    await this.testBackendSwitching();
    this.generateReport();
  }
}

// Run tests if script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const tester = new Neo4jSearchTest();
  tester.runAllTests().catch(console.error);
}

export default Neo4jSearchTest;