@echo off
cd /d %~dp0
if not exist dist (
    echo Building project...
    npm install
    npm run build
)
echo Starting Memory MCP Server from: %CD%
node dist\index.js
