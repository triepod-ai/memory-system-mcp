# Local Development Setup

This guide explains how to set up the Memory System MCP Server for local development while keeping the repository clean for public distribution.

## Local Development Files

The following files are created for local development and are automatically ignored by git:

### `docker-compose.override.yml`
Contains your local development paths and configurations. Docker Compose automatically merges this with the main `docker-compose.yml`.

```yaml
services:
  memory-server:
    volumes:
      # Your local development path
      - /mnt/l/mcp_servers/memory/dist:/app/dist
    environment:
      # Your local Neo4j settings
      NEO4J_URI: neo4j://host.docker.internal:7687
      NEO4J_USER: neo4j
      NEO4J_PASSWORD: your_password
```

### `run-memory-local.sh`
Local development script that uses your preferred log directory and paths.

### `.env.local` (optional)
For any local environment variables you need.

## Setup Instructions

1. **Create your local override file**:
   ```bash
   cp docker-compose.override.yml.example docker-compose.override.yml
   # Edit with your local paths and credentials
   ```

2. **Create your local run script**:
   ```bash
   cp run-memory-local.sh.example run-memory-local.sh
   chmod +x run-memory-local.sh
   # Edit with your local paths
   ```

3. **Use local development commands**:
   ```bash
   # For local Docker development
   docker-compose up  # Automatically uses override file
   
   # For local script development
   ./run-memory-local.sh
   ```

## Public vs Local Configurations

| File | Public (in repo) | Local (gitignored) |
|------|------------------|-------------------|
| `docker-compose.yml` | Generic named volumes | `docker-compose.override.yml` with your paths |
| `run-memory.sh` | Uses `./logs` directory | `run-memory-local.sh` with `$HOME/.memory-mcp/logs` |
| Environment variables | Generic examples | `.env.local` with real credentials |

## Benefits

- **Repository stays clean**: No personal paths or credentials in git
- **Local development works**: Your existing setup continues to function
- **Easy sharing**: Others can clone and create their own local overrides
- **Docker Compose automatic**: Override files are automatically merged

## Important Notes

- Never commit `docker-compose.override.yml` - it contains your personal paths
- The main `docker-compose.yml` works for new users with named volumes
- Your local development setup remains exactly as it was before
- Use `./run-memory-local.sh` for your personal development workflow