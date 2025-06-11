#!/usr/bin/env node

/**
 * Direct Tool Description Validation Test
 * 
 * Tests the optimized tool descriptions by directly checking the tool definitions
 * and validating the content matches our optimization criteria.
 */

import { spawn } from 'child_process';

class ToolDescriptionValidator {
    constructor() {
        this.results = {
            descriptions: [],
            criteria: {
                mcp_format: { passed: 0, total: 0 },
                decision_criteria: { passed: 0, total: 0 },
                parameter_guidance: { passed: 0, total: 0 },
                context_management: { passed: 0, total: 0 },
                fallback_documentation: { passed: 0, total: 0 }
            }
        };
    }

    async getToolDescriptions() {
        return new Promise((resolve, reject) => {
            const request = JSON.stringify({
                jsonrpc: "2.0",
                id: 1,
                method: "tools/list"
            });

            const child = spawn('node', ['dist/index.js'], {
                stdio: ['pipe', 'pipe', 'pipe']
            });

            let stdout = '';
            let stderr = '';

            child.stdout.on('data', (data) => {
                stdout += data.toString();
            });

            child.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            child.on('close', (code) => {
                if (code !== 0) {
                    reject(new Error(`Process exited with code ${code}. stderr: ${stderr}`));
                    return;
                }

                try {
                    // Parse the JSON response - look for the tools/list response
                    const lines = stdout.split('\n').filter(line => line.trim());
                    for (const line of lines) {
                        try {
                            const response = JSON.parse(line);
                            if (response.result && response.result.tools) {
                                resolve(response.result.tools);
                                return;
                            }
                        } catch (e) {
                            // Continue to next line
                        }
                    }
                    reject(new Error('No valid tools/list response found'));
                } catch (error) {
                    reject(new Error(`Failed to parse response: ${error.message}`));
                }
            });

            child.stdin.write(request);
            child.stdin.end();
        });
    }

    validateMCPFormat(tool) {
        const description = tool.description;
        
        // Check for MCP format: [PRIMARY BENEFIT]. [WHEN TO USE]. [KEY FEATURES]. [LIMITATIONS]. [TECHNICAL INFO].
        const criteria = {
            has_primary_benefit: description.includes('search') || description.includes('knowledge graph'),
            has_when_to_use: description.includes('WHEN TO USE') || description.includes('Use when'),
            has_selection_criteria: description.includes('SELECTION CRITERIA') || description.includes('Choose'),
            has_technical_info: description.includes('Neo4j') || description.includes('fallback'),
            proper_structure: description.length > 100 // Reasonable length for detailed description
        };
        
        const passed = Object.values(criteria).filter(Boolean).length >= 4;
        return { passed, criteria, score: Object.values(criteria).filter(Boolean).length / Object.keys(criteria).length };
    }

    validateDecisionCriteria(tool) {
        const description = tool.description;
        
        const criteria = {
            dataset_size_guidance: description.includes('dataset') || description.includes('entities expected'),
            relationship_context: description.includes('relationship') || description.includes('context'),
            use_case_clarity: description.includes('simple') || description.includes('complex') || description.includes('discovery'),
            selection_guidance: description.includes('Choose') || description.includes('WHEN TO USE')
        };
        
        const passed = Object.values(criteria).filter(Boolean).length >= 3;
        return { passed, criteria, score: Object.values(criteria).filter(Boolean).length / Object.keys(criteria).length };
    }

    validateParameterGuidance(tool) {
        if (!tool.inputSchema || !tool.inputSchema.properties) {
            return { passed: true, criteria: {}, score: 1 }; // Tools without parameters pass
        }
        
        const properties = tool.inputSchema.properties;
        const criteria = {
            query_description: properties.query?.description?.length > 50,
            maxEntities_guidance: properties.maxEntities?.description?.includes('context') || !properties.maxEntities,
            maxRelationships_guidance: properties.maxRelationshipsPerEntity?.description?.includes('explosion') || !properties.maxRelationshipsPerEntity,
            fallback_explanation: properties.fallbackToSimple?.description?.includes('reliability') || !properties.fallbackToSimple,
            default_values: !properties.maxEntities || properties.maxEntities.default !== undefined
        };
        
        const passed = Object.values(criteria).filter(Boolean).length >= 3;
        return { passed, criteria, score: Object.values(criteria).filter(Boolean).length / Object.keys(criteria).length };
    }

    validateContextManagement(tool) {
        const description = tool.description;
        const properties = tool.inputSchema?.properties || {};
        
        const criteria = {
            bounded_results: description.includes('bounded') || description.includes('limit'),
            context_window_awareness: description.includes('context window') || 
                                     Object.values(properties).some(p => p.description?.includes('context')),
            token_considerations: description.includes('token') || 
                                 Object.values(properties).some(p => p.description?.includes('token')),
            explosion_prevention: description.includes('explosion') || description.includes('overwhelming')
        };
        
        const passed = Object.values(criteria).filter(Boolean).length >= 2;
        return { passed, criteria, score: Object.values(criteria).filter(Boolean).length / Object.keys(criteria).length };
    }

    validateFallbackDocumentation(tool) {
        const description = tool.description;
        
        const criteria = {
            backend_fallback: description.includes('Neo4j') && description.includes('file'),
            fallback_strategy: description.includes('FALLBACK') || description.includes('falls back'),
            error_handling: description.includes('fail') || description.includes('unavailable'),
            transparency: description.includes('backend') || description.includes('storage')
        };
        
        const passed = Object.values(criteria).filter(Boolean).length >= 2;
        return { passed, criteria, score: Object.values(criteria).filter(Boolean).length / Object.keys(criteria).length };
    }

    analyzeSearchTools(tools) {
        const searchTools = tools.filter(tool => 
            tool.name === 'search_nodes' || tool.name === 'search_with_relationships'
        );
        
        console.log('\n🔍 ANALYZING SEARCH TOOL DESCRIPTIONS');
        console.log('='.repeat(60));
        
        for (const tool of searchTools) {
            console.log(`\n📋 Tool: ${tool.name}`);
            console.log('─'.repeat(40));
            
            // Store the description for detailed analysis
            this.results.descriptions.push({
                name: tool.name,
                description: tool.description,
                inputSchema: tool.inputSchema
            });
            
            // Test MCP Format
            const mcpResult = this.validateMCPFormat(tool);
            this.results.criteria.mcp_format.total++;
            if (mcpResult.passed) this.results.criteria.mcp_format.passed++;
            console.log(`MCP Format: ${mcpResult.passed ? '✅' : '❌'} (${(mcpResult.score * 100).toFixed(0)}%)`);
            
            // Test Decision Criteria
            const decisionResult = this.validateDecisionCriteria(tool);
            this.results.criteria.decision_criteria.total++;
            if (decisionResult.passed) this.results.criteria.decision_criteria.passed++;
            console.log(`Decision Criteria: ${decisionResult.passed ? '✅' : '❌'} (${(decisionResult.score * 100).toFixed(0)}%)`);
            
            // Test Parameter Guidance
            const paramResult = this.validateParameterGuidance(tool);
            this.results.criteria.parameter_guidance.total++;
            if (paramResult.passed) this.results.criteria.parameter_guidance.passed++;
            console.log(`Parameter Guidance: ${paramResult.passed ? '✅' : '❌'} (${(paramResult.score * 100).toFixed(0)}%)`);
            
            // Test Context Management
            const contextResult = this.validateContextManagement(tool);
            this.results.criteria.context_management.total++;
            if (contextResult.passed) this.results.criteria.context_management.passed++;
            console.log(`Context Management: ${contextResult.passed ? '✅' : '❌'} (${(contextResult.score * 100).toFixed(0)}%)`);
            
            // Test Fallback Documentation
            const fallbackResult = this.validateFallbackDocumentation(tool);
            this.results.criteria.fallback_documentation.total++;
            if (fallbackResult.passed) this.results.criteria.fallback_documentation.passed++;
            console.log(`Fallback Documentation: ${fallbackResult.passed ? '✅' : '❌'} (${(fallbackResult.score * 100).toFixed(0)}%)`);
            
            // Show actual description for manual review
            console.log('\n📄 Description:');
            console.log(`"${tool.description}"`);
            
            if (tool.inputSchema && tool.inputSchema.properties) {
                console.log('\n⚙️ Key Parameters:');
                for (const [param, config] of Object.entries(tool.inputSchema.properties)) {
                    if (config.description) {
                        console.log(`  ${param}: "${config.description}"`);
                    }
                }
            }
        }
    }

    generateReport() {
        console.log('\n' + '='.repeat(80));
        console.log('📊 TOOL DESCRIPTION VALIDATION RESULTS');
        console.log('='.repeat(80));
        
        const categories = [
            { key: 'mcp_format', name: 'MCP Format Compliance', target: 100 },
            { key: 'decision_criteria', name: 'Decision Criteria Clarity', target: 100 },
            { key: 'parameter_guidance', name: 'Parameter Guidance Quality', target: 90 },
            { key: 'context_management', name: 'Context Management Emphasis', target: 90 },
            { key: 'fallback_documentation', name: 'Fallback Documentation', target: 85 }
        ];
        
        let overallScore = 0;
        let totalWeight = 0;
        
        for (const category of categories) {
            const result = this.results.criteria[category.key];
            const percentage = result.total > 0 ? (result.passed / result.total * 100).toFixed(1) : 0;
            const status = percentage >= category.target ? '✅' : '❌';
            
            console.log(`${category.name}: ${status} ${result.passed}/${result.total} (${percentage}%)`);
            
            overallScore += (result.passed / Math.max(result.total, 1)) * category.target;
            totalWeight += category.target;
        }
        
        const finalScore = (overallScore / totalWeight * 100).toFixed(1);
        console.log(`\n🎯 Overall Optimization Score: ${finalScore}%`);
        
        // Success criteria assessment
        console.log('\n📋 Phase Success Criteria:');
        const mcpFormatOk = this.results.criteria.mcp_format.passed === this.results.criteria.mcp_format.total;
        const decisionOk = this.results.criteria.decision_criteria.passed === this.results.criteria.decision_criteria.total;
        const contextOk = (this.results.criteria.context_management.passed / this.results.criteria.context_management.total) >= 0.9;
        
        console.log(`  ✓ MCP Format: ${mcpFormatOk ? '✅' : '❌'} All tools follow structured format`);
        console.log(`  ✓ Decision Clarity: ${decisionOk ? '✅' : '❌'} Clear selection criteria provided`);
        console.log(`  ✓ Context Management: ${contextOk ? '✅' : '❌'} Bounded behavior emphasized`);
        
        if (finalScore >= 90) {
            console.log('\n🎉 PHASE 4 VALIDATION SUCCESSFUL!');
            console.log('Tool descriptions are optimized for thinking model decision-making.');
        } else {
            console.log('\n⚠️  PHASE 4 NEEDS IMPROVEMENT');
            console.log('Some optimization criteria not fully met.');
        }
        
        return {
            score: parseFloat(finalScore),
            passed: finalScore >= 90,
            details: this.results
        };
    }

    async run() {
        console.log('🚀 Starting Tool Description Validation...');
        console.log('Validating Phase 1-3 optimization effectiveness\n');
        
        try {
            const tools = await this.getToolDescriptions();
            console.log(`✅ Retrieved ${tools.length} tool definitions`);
            
            this.analyzeSearchTools(tools);
            
            return this.generateReport();
        } catch (error) {
            console.error('❌ Validation failed:', error);
            throw error;
        }
    }
}

// Run validation if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
    const validator = new ToolDescriptionValidator();
    validator.run().then(result => {
        console.log('\n✅ Tool description validation completed');
        process.exit(result.passed ? 0 : 1);
    }).catch(error => {
        console.error('\n❌ Validation failed:', error);
        process.exit(1);
    });
}

export default ToolDescriptionValidator;