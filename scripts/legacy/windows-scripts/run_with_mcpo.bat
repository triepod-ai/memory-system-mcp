@echo off
echo Starting MCP Memory Server with mcpo and Neo4j...

:: Set Neo4j environment variables
set NEO4J_URI=neo4j://localhost:7687
set NEO4J_USER=neo4j
set NEO4J_PASSWORD=password

:: Activate virtual environment and run mcpo
call venv_3_12\Scripts\activate.bat
echo Environment activated, starting mcpo on http://localhost:3333
mcpo --host localhost --port 3333 -- node dist/index.js