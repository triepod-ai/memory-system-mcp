# Memory System Documentation

This directory contains comprehensive documentation for the Memory System MCP Server.

## Documentation Structure

### [Architecture](architecture/)
Technical documentation about the system design and implementation.

- **[Complex Search Logic](architecture/COMPLEX_SEARCH_LOGIC.md)** - Technical architecture details for search functionality

### [Development](development/)
Guidelines and resources for developers working on the project.

- **[Claude Development Guidelines](development/CLAUDE.md)** - Development guidelines for Claude Code integration
- **[Completed Projects](development/projects/)** - Archive of completed development projects
  - **[Tool Optimization Project](development/projects/tool-optimization/)** - Tool description optimization implementation
  - **[Multi-System Coordinator](development/projects/multi-system/)** - Multi-system memory coordinator specifications

### [Deployment](deployment/)
Deployment guides and configuration documentation.

*Documentation to be added as needed.*

## Quick Navigation

- **Getting Started**: See the main [README.md](../README.md) in the project root
- **API Reference**: Detailed API documentation is in the main README
- **Testing**: Test organization and structure documented in the main README
- **Docker Setup**: Docker configuration and deployment instructions in the main README

## Core Concepts

The Memory System is an MCP (Model Context Protocol) server that provides persistent memory capabilities through a knowledge graph with dual storage backend support:

1. **Primary Storage**: Neo4j graph database
2. **Fallback Storage**: JSON file storage

### Key Components

- **Entities**: Core graph nodes with name, type, and observations
- **Relations**: Directed connections between entities
- **Observations**: Discrete facts attached to entities
- **Storage Manager**: Handles automatic Neo4j/file fallback

For detailed API documentation and usage examples, refer to the main project [README.md](../README.md).