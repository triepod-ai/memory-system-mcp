# Tool Description Optimization for Thinking Models - Implementation TODO

Based on MCP best practices research and thinking model decision-making analysis, this TODO list outlines the implementation steps for optimizing tool descriptions to improve thinking model tool selection and usage.

## Phase 1: Core Tool Description Updates

### 1.1 Update `search_nodes` Tool Description
- [ ] **Current**: "Search for nodes in the knowledge graph based on a query (Neo4j primary, file fallback)"
- [ ] **Target**: "Basic knowledge graph search returning entities and their direct relationships. Use when you need simple entity discovery without relationship explosion concerns. Returns all matching entities without bounds - use search_with_relationships for large datasets. Searches entity names, types, and observations using case-insensitive matching."
- [ ] **File**: `./index.ts` line 1296
- [ ] **Priority**: High - Primary search tool needs clear guidance

### 1.2 Update `search_with_relationships` Tool Description  
- [ ] **Current**: "Enhanced search for nodes with bounded relationship discovery (Neo4j primary, file fallback). Uses simplified 2-step approach for performance."
- [ ] **Target**: "Context-safe knowledge graph search with bounded relationship discovery to prevent overwhelming results. Use when you need relationship context or working with large datasets. Limits results via maxEntities (default: 20) and maxRelationshipsPerEntity (default: 5). Returns metadata showing if results were limited. Falls back to simple search on complex query failures."
- [ ] **File**: `./index.ts` line 1305
- [ ] **Priority**: High - Enhanced tool needs clear decision criteria

### 1.3 Add Decision Tree Guidance
- [ ] Create tool selection guidance using MCP format: "[PRIMARY BENEFIT]. [WHEN TO USE]. [KEY FEATURES]. [LIMITATIONS]. [TECHNICAL INFO]."
- [ ] Implement progressive complexity guidance (simple → enhanced → specialized)
- [ ] Add clear decision criteria in tool descriptions
- [ ] **Priority**: High - Core optimization strategy

## Phase 2: Parameter Schema Optimization

### 2.1 Enhanced Parameter Descriptions
- [ ] **search_nodes query parameter**: Add guidance about search scope and case-insensitive matching
- [ ] **search_with_relationships maxEntities**: Emphasize context management benefit, suggest values for different use cases
- [ ] **search_with_relationships maxRelationshipsPerEntity**: Explain relationship explosion prevention, provide usage examples
- [ ] **search_with_relationships fallbackToSimple**: Clarify when fallback triggers and benefits
- [ ] **Priority**: Medium - Improves parameter selection accuracy

### 2.2 Default Value Optimization
- [ ] Review current defaults: maxEntities=20, maxRelationshipsPerEntity=5
- [ ] Test with thinking models to validate optimal defaults
- [ ] Consider context window size implications
- [ ] Add parameter validation with helpful error messages
- [ ] **Priority**: Medium - Ensures good out-of-box experience

### 2.3 Context Management Emphasis
- [ ] Add parameter descriptions emphasizing bounded behavior
- [ ] Document context window size considerations
- [ ] Highlight when to use limits vs unlimited search
- [ ] **Priority**: High - Critical for thinking model context management

## Phase 3: Tool Flow Documentation

### 3.1 Decision Criteria Documentation
- [ ] Document when to use `search_nodes` vs `search_with_relationships`
- [ ] Create clear selection criteria based on:
  - Dataset size expectations
  - Relationship context needs  
  - Context window constraints
  - Performance requirements
- [ ] **Priority**: High - Core decision-making guidance

### 3.2 Metadata Reporting Emphasis
- [ ] Highlight metadata transparency in `search_with_relationships` description
- [ ] Document how thinking models should use metadata for adaptive behavior
- [ ] Emphasize `relationshipsLimited` flag for context management decisions
- [ ] Document `backendUsed` for fallback transparency
- [ ] **Priority**: Medium - Enables adaptive tool usage

### 3.3 Fallback Strategy Documentation
- [ ] Document automatic fallback from enhanced to simple search
- [ ] Explain Neo4j to file storage fallback behavior
- [ ] Add guidance on when fallbacks trigger
- [ ] **Priority**: Medium - Improves error handling understanding

## Phase 4: Testing and Validation

### 4.1 Thinking Model Testing
- [ ] Test tool descriptions with thinking models for selection accuracy
- [ ] Validate that improved descriptions lead to correct tool choices
- [ ] Measure decision-making time improvements
- [ ] Document common selection patterns
- [ ] **Priority**: High - Validates optimization effectiveness

### 4.2 Parameter Guidance Effectiveness
- [ ] Test parameter selection accuracy with new descriptions
- [ ] Validate default values work well for common use cases
- [ ] Measure context usage improvements
- [ ] Test edge cases and error scenarios
- [ ] **Priority**: Medium - Ensures parameter optimization works

### 4.3 Integration Testing
- [ ] Test both tools work correctly with optimized descriptions
- [ ] Validate metadata reporting accuracy
- [ ] Test fallback mechanisms function properly
- [ ] Ensure backward compatibility maintained
- [ ] **Priority**: High - Prevents regressions

## Phase 5: Advanced Features (Future)

### 5.1 Dynamic Tool Recommendations
- [ ] Consider implementing tool recommendation system based on query analysis
- [ ] Add adaptive descriptions based on usage patterns
- [ ] Implement query complexity analysis for automatic tool selection
- [ ] **Priority**: Low - Future enhancement

### 5.2 Usage Analytics
- [ ] Implement tool usage analytics for optimization
- [ ] Track tool selection patterns
- [ ] Measure effectiveness of optimized descriptions
- [ ] Create feedback loop for continuous improvement
- [ ] **Priority**: Low - Long-term optimization

### 5.3 Context-Aware Parameters
- [ ] Add dynamic parameter suggestions based on query analysis
- [ ] Implement context window size detection
- [ ] Create adaptive parameter defaults
- [ ] **Priority**: Low - Advanced optimization

## Implementation Notes

### Technical Requirements
- **Files to modify**: `./index.ts` (lines 1296, 1305)
- **Testing approach**: Use existing test framework (`test-search-with-relationships.js`)
- **Validation method**: Compare before/after tool selection accuracy
- **Rollback plan**: Keep current descriptions as backup in comments

### Success Criteria
1. **Improved Tool Selection**: Thinking models choose correct tool for use case
2. **Better Parameter Usage**: Parameters used appropriately for context management
3. **Enhanced Decision Speed**: Faster tool selection with clear criteria
4. **Maintained Functionality**: All existing functionality preserved
5. **Better Context Management**: Reduced context overflow issues

### Risk Mitigation
- **Backward Compatibility**: Maintain existing parameter names and defaults
- **Gradual Rollout**: Test descriptions extensively before full deployment
- **Documentation**: Keep old descriptions in comments for reference
- **Monitoring**: Track tool usage patterns after changes

## Completion Timeline
- **Phase 1**: 1-2 days (Core descriptions)
- **Phase 2**: 1 day (Parameter optimization)  
- **Phase 3**: 1 day (Documentation)
- **Phase 4**: 2-3 days (Testing and validation)
- **Total**: 5-7 days for complete implementation

## Dependencies
- **MCP SDK**: No changes required to underlying MCP framework
- **Neo4j/File Storage**: No changes to backend storage systems
- **Test Framework**: Existing test infrastructure can be reused
- **Context7 Research**: Completed - provides implementation guidance

---

*This TODO list is based on comprehensive analysis of thinking model decision-making processes and MCP best practices research completed on June 10, 2025.*