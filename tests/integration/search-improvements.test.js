#!/usr/bin/env node

/**
 * Comprehensive Test for Search Improvements
 * 
 * Tests the improved search functionality including:
 * - Simplified Neo4j queries
 * - Backend consistency validation  
 * - Enhanced error handling
 * - Performance improvements
 */

import { spawn } from 'child_process';
import { randomBytes } from 'crypto';

class SearchImprovementsTest {
  constructor() {
    this.testResults = [];
  }

  // Generate unique test data
  generateTestEntity() {
    const id = randomBytes(4).toString('hex');
    return {
      name: `improved_test_${id}`,
      entityType: `improved_type_${id}`,
      observations: [`Improved test observation ${id}`, `Enhanced searchable content ${id}`]
    };
  }

  // Send MCP command with environment configuration
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
          clientInfo: { name: "improvements-test", version: "1.0.0" }
        }
      };

      server.stdin.write(JSON.stringify(initCommand) + '\n');
      server.stdin.write(JSON.stringify(command) + '\n');
      server.stdin.end();
    });
  }

  // Test 1: Enhanced storage status validation
  async testEnhancedStorageStatus() {
    console.log('\n🔍 Test 1: Enhanced Storage Status Validation');
    
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

      // Test with Neo4j config
      const neo4jResult = await this.sendMCPCommand(statusCommand, true);
      const neo4jStatus = this.extractMCPResponse(neo4jResult.output);
      console.log('📊 Neo4j Status:', neo4jStatus);

      // Test without Neo4j config  
      const fileResult = await this.sendMCPCommand(statusCommand, false);
      const fileStatus = this.extractMCPResponse(fileResult.output);
      console.log('📊 File Status:', fileStatus);

      // Validate new fields
      const hasNewFields = neo4jStatus && 
                          'backendConsistent' in neo4jStatus && 
                          'connectionHealth' in neo4jStatus;

      const healthStatesValid = neo4jStatus && fileStatus &&
                              ['healthy', 'degraded', 'unavailable'].includes(neo4jStatus.connectionHealth) &&
                              ['healthy', 'degraded', 'unavailable'].includes(fileStatus.connectionHealth);

      this.testResults.push({
        test: 'EnhancedStorageStatus',
        hasNewFields,
        healthStatesValid,
        success: hasNewFields && healthStatesValid
      });

      console.log(hasNewFields && healthStatesValid ? 
        '✅ PASS: Enhanced storage status working' : 
        '❌ FAIL: Enhanced storage status issues');

    } catch (error) {
      console.error('❌ Enhanced storage status test failed:', error.message);
      this.testResults.push({
        test: 'EnhancedStorageStatus',
        success: false,
        error: error.message
      });
    }
  }

  // Test 2: Improved Neo4j search performance
  async testImprovedNeo4jSearch() {
    console.log('\n🔍 Test 2: Improved Neo4j Search Performance');
    
    const testEntity = this.generateTestEntity();
    console.log(`Testing improved search with: ${testEntity.name}`);

    try {
      // Create entity with Neo4j
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

      const startCreate = Date.now();
      const createResult = await this.sendMCPCommand(createCommand, true);
      const createTime = Date.now() - startCreate;
      
      const createResponse = this.extractMCPResponse(createResult.output);
      console.log('✅ Create completed in:', createTime + 'ms');

      // Search with simplified query
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

      const startSearch = Date.now();
      const searchResult = await this.sendMCPCommand(searchCommand, true);
      const searchTime = Date.now() - startSearch;
      
      const searchResponse = this.extractMCPResponse(searchResult.output);
      console.log('🔍 Search completed in:', searchTime + 'ms');

      // Validate results
      const found = searchResponse && searchResponse.entities && 
                   searchResponse.entities.some(e => e.name === testEntity.name);

      const performanceGood = createTime < 5000 && searchTime < 3000; // Reasonable thresholds

      this.testResults.push({
        test: 'ImprovedNeo4jSearch',
        entityName: testEntity.name,
        found,
        createTime,
        searchTime,
        performanceGood,
        success: found && performanceGood
      });

      console.log(found ? '✅ Entity found' : '❌ Entity not found');
      console.log(performanceGood ? '✅ Performance acceptable' : '❌ Performance issues');

    } catch (error) {
      console.error('❌ Improved Neo4j search test failed:', error.message);
      this.testResults.push({
        test: 'ImprovedNeo4jSearch',
        entityName: testEntity.name,
        success: false,
        error: error.message
      });
    }
  }

  // Test 3: Search consistency across backends
  async testBackendSearchConsistency() {
    console.log('\n🔍 Test 3: Backend Search Consistency');
    
    const testEntity = this.generateTestEntity();
    console.log(`Testing consistency with: ${testEntity.name}`);

    try {
      // Create in both backends by testing both configurations
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

      // Create in Neo4j backend (if available)
      await this.sendMCPCommand(createCommand, true);
      
      // Create in file backend (ensure it exists there too)
      await this.sendMCPCommand(createCommand, false);

      // Search in both backends
      const searchCommand = {
        jsonrpc: "2.0",
        id: 6,
        method: "tools/call",
        params: {
          name: "search_nodes",
          arguments: {
            query: testEntity.name
          }
        }
      };

      const neo4jSearchResult = await this.sendMCPCommand(searchCommand, true);
      const neo4jSearchResponse = this.extractMCPResponse(neo4jSearchResult.output);

      const fileSearchResult = await this.sendMCPCommand(searchCommand, false);
      const fileSearchResponse = this.extractMCPResponse(fileSearchResult.output);

      // Check consistency
      const neo4jFound = neo4jSearchResponse && neo4jSearchResponse.entities && 
                        neo4jSearchResponse.entities.some(e => e.name === testEntity.name);
      
      const fileFound = fileSearchResponse && fileSearchResponse.entities && 
                       fileSearchResponse.entities.some(e => e.name === testEntity.name);

      const consistent = neo4jFound === fileFound;

      this.testResults.push({
        test: 'BackendSearchConsistency',
        entityName: testEntity.name,
        neo4jFound,
        fileFound,
        consistent,
        success: consistent && (neo4jFound || fileFound) // At least one should find it
      });

      console.log(`Neo4j found: ${neo4jFound ? '✅' : '❌'}`);
      console.log(`File found: ${fileFound ? '✅' : '❌'}`);
      console.log(consistent ? '✅ PASS: Backends consistent' : '❌ FAIL: Backend inconsistency');

    } catch (error) {
      console.error('❌ Backend consistency test failed:', error.message);
      this.testResults.push({
        test: 'BackendSearchConsistency',
        entityName: testEntity.name,
        success: false,
        error: error.message
      });
    }
  }

  // Test 4: Error handling and fallback behavior
  async testErrorHandlingAndFallback() {
    console.log('\n🔍 Test 4: Error Handling and Fallback');
    
    try {
      // Test search with intentionally problematic query
      const problemQueries = ['', '   ', '\n\t', 'very-long-query-that-should-still-work-' + 'x'.repeat(100)];
      
      for (const query of problemQueries) {
        const searchCommand = {
          jsonrpc: "2.0",
          id: 7,
          method: "tools/call",
          params: {
            name: "search_nodes",
            arguments: { query }
          }
        };

        const result = await this.sendMCPCommand(searchCommand, true);
        const response = this.extractMCPResponse(result.output);
        
        // Should not crash, should return valid response structure
        const validResponse = response && 
                             typeof response === 'object' && 
                             'entities' in response && 
                             'relations' in response;

        console.log(`   Query "${query.substring(0, 20)}...": ${validResponse ? '✅' : '❌'}`);
        
        this.testResults.push({
          test: 'ErrorHandling',
          query: query.substring(0, 50),
          validResponse,
          success: validResponse
        });
      }

    } catch (error) {
      console.error('❌ Error handling test failed:', error.message);
      this.testResults.push({
        test: 'ErrorHandling',
        success: false,
        error: error.message
      });
    }
  }

  // Test 5: Multiple entity batch search
  async testBatchSearchPerformance() {
    console.log('\n🔍 Test 5: Batch Search Performance');
    
    try {
      // Create multiple entities
      const testEntities = Array.from({ length: 5 }, () => this.generateTestEntity());
      
      const createCommand = {
        jsonrpc: "2.0",
        id: 8,
        method: "tools/call",
        params: {
          name: "create_entities",
          arguments: { entities: testEntities }
        }
      };

      await this.sendMCPCommand(createCommand, true);

      // Search for each entity
      const searchResults = [];
      const startTime = Date.now();
      
      for (const entity of testEntities) {
        const searchCommand = {
          jsonrpc: "2.0",
          id: 9,
          method: "tools/call",
          params: {
            name: "search_nodes",
            arguments: { query: entity.name }
          }
        };

        const result = await this.sendMCPCommand(searchCommand, true);
        const response = this.extractMCPResponse(result.output);
        
        const found = response && response.entities && 
                     response.entities.some(e => e.name === entity.name);
        
        searchResults.push({ entity: entity.name, found });
      }

      const totalTime = Date.now() - startTime;
      const averageTime = totalTime / testEntities.length;
      const allFound = searchResults.every(r => r.found);

      console.log(`Batch search: ${searchResults.filter(r => r.found).length}/${testEntities.length} found`);
      console.log(`Average search time: ${averageTime.toFixed(1)}ms`);

      this.testResults.push({
        test: 'BatchSearchPerformance',
        totalEntities: testEntities.length,
        foundEntities: searchResults.filter(r => r.found).length,
        totalTime,
        averageTime,
        allFound,
        success: allFound && averageTime < 2000 // Reasonable performance threshold
      });

      console.log(allFound ? '✅ PASS: All entities found' : '❌ FAIL: Some entities missing');
      console.log(averageTime < 2000 ? '✅ PASS: Performance good' : '❌ FAIL: Performance slow');

    } catch (error) {
      console.error('❌ Batch search test failed:', error.message);
      this.testResults.push({
        test: 'BatchSearchPerformance',
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

  // Generate comprehensive test report
  generateReport() {
    console.log('\n📋 SEARCH IMPROVEMENTS TEST REPORT');
    console.log('='.repeat(70));
    
    const totalTests = this.testResults.length;
    const passedTests = this.testResults.filter(r => r.success).length;
    const failedTests = totalTests - passedTests;
    
    console.log(`Total Tests: ${totalTests}`);
    console.log(`Passed: ${passedTests}`);
    console.log(`Failed: ${failedTests}`);
    console.log(`Success Rate: ${((passedTests / totalTests) * 100).toFixed(1)}%`);
    
    console.log('\nDetailed Results:');
    const testGroups = {};
    this.testResults.forEach(result => {
      if (!testGroups[result.test]) testGroups[result.test] = [];
      testGroups[result.test].push(result);
    });

    Object.entries(testGroups).forEach(([testName, results]) => {
      const groupPassed = results.filter(r => r.success).length;
      const groupTotal = results.length;
      const status = groupPassed === groupTotal ? '✅ PASS' : '❌ FAIL';
      console.log(`${testName}: ${status} (${groupPassed}/${groupTotal})`);
      
      if (groupPassed < groupTotal) {
        results.filter(r => !r.success).forEach(result => {
          console.log(`   - ${result.error || 'Test failed'}`);
        });
      }
    });

    // Performance summary
    console.log('\n⚡ PERFORMANCE SUMMARY');
    const performanceTests = this.testResults.filter(r => r.createTime || r.searchTime || r.averageTime);
    if (performanceTests.length > 0) {
      performanceTests.forEach(test => {
        if (test.createTime) console.log(`   Create time: ${test.createTime}ms`);
        if (test.searchTime) console.log(`   Search time: ${test.searchTime}ms`);
        if (test.averageTime) console.log(`   Average search: ${test.averageTime.toFixed(1)}ms`);
      });
    }

    // Final assessment
    console.log('\n🎯 FINAL ASSESSMENT');
    if (failedTests === 0) {
      console.log('✅ All search improvements are working correctly!');
      console.log('   - Neo4j search queries simplified and optimized');
      console.log('   - Backend consistency validation implemented');
      console.log('   - Error handling improved');
      console.log('   - Performance benchmarks met');
    } else {
      console.log('❌ Some issues remain:');
      const uniqueFailures = [...new Set(this.testResults.filter(r => !r.success).map(r => r.test))];
      uniqueFailures.forEach(failure => {
        console.log(`   - ${failure} needs attention`);
      });
    }
  }

  // Run all improvement tests
  async runAllTests() {
    console.log('🚀 Starting Search Improvements Validation');
    console.log('='.repeat(70));

    await this.testEnhancedStorageStatus();
    await this.testImprovedNeo4jSearch();
    await this.testBackendSearchConsistency();
    await this.testErrorHandlingAndFallback();
    await this.testBatchSearchPerformance();

    this.generateReport();
  }
}

// Run tests if script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const tester = new SearchImprovementsTest();
  tester.runAllTests().catch(console.error);
}

export default SearchImprovementsTest;