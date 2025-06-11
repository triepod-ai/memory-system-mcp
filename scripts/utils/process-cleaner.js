#!/usr/bin/env node

// This script is designed to monitor and clean up stale Node.js processes
// that might be created by the Memory MCP server

const { execSync } = require('child_process');
const fs = require('fs');

const LOG_FILE = '/app/logs/process-cleaner.log';

// Ensure log directory exists
try {
  if (!fs.existsSync('/app/logs')) {
    fs.mkdirSync('/app/logs', { recursive: true });
  }
} catch (error) {
  console.error('Error creating log directory:', error);
}

// Log function
function log(message) {
  const timestamp = new Date().toISOString();
  const logMessage = `${timestamp} - ${message}\n`;
  console.log(logMessage);
  
  try {
    fs.appendFileSync(LOG_FILE, logMessage);
  } catch (error) {
    console.error('Error writing to log file:', error);
  }
}

// Get list of node processes
function getNodeProcesses() {
  try {
    const output = execSync('ps aux | grep "node /app/dist/index.js" | grep -v grep').toString();
    const processes = output.split('\n')
      .filter(line => line.trim() !== '')
      .map(line => {
        const parts = line.trim().split(/\s+/);
        const pid = parseInt(parts[1], 10);
        const startTime = parts[8]; // Time or date column
        const command = parts.slice(10).join(' ');
        const memUsage = parseFloat(parts[3]); // %MEM column
        
        return { pid, startTime, command, memUsage };
      });
    
    return processes;
  } catch (error) {
    // No processes found or error
    return [];
  }
}

// Kill processes based on age or count
function cleanupProcesses() {
  const processes = getNodeProcesses();
  
  if (processes.length <= 1) {
    log(`Only ${processes.length} processes running, no cleanup needed`);
    return;
  }
  
  // Sort by oldest first (assuming TIME format)
  const sortedProcesses = [...processes].sort((a, b) => {
    // This is a simple sort that works for both time and date formats
    return a.startTime.localeCompare(b.startTime);
  });
  
  // Keep the newest process and terminate others
  const keepProcess = sortedProcesses.pop();
  log(`Keeping process ${keepProcess.pid} (${keepProcess.startTime} - ${keepProcess.command})`);
  
  for (const proc of sortedProcesses) {
    try {
      log(`Terminating old process ${proc.pid} (${proc.startTime} - ${proc.command})`);
      execSync(`kill ${proc.pid}`);
    } catch (error) {
      log(`Error terminating process ${proc.pid}: ${error.message}`);
    }
  }
  
  // Check memory usage of the remaining process and restart if too high
  if (keepProcess.memUsage > 80) { // More than 80% memory usage
    log(`Process ${keepProcess.pid} using too much memory (${keepProcess.memUsage}%), restarting`);
    try {
      execSync(`kill ${keepProcess.pid}`);
      // The container should automatically restart the service
    } catch (error) {
      log(`Error restarting high-memory process ${keepProcess.pid}: ${error.message}`);
    }
  }
}

// Run the cleanup
log('Starting process cleaner execution');
cleanupProcesses();
log('Process cleaner finished');