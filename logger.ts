import { writeFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { LoggingLevel } from "@modelcontextprotocol/sdk/types.js";

export class Logger {
  private logDir: string;
  private errorLogPath: string;
  private infoLogPath: string;
  private mcpServer: Server | null = null;
  private loggingLevel: LoggingLevel = "info";

  constructor(logDir: string = './logs') {
    this.logDir = logDir;
    this.errorLogPath = `${logDir}/error.log`;
    this.infoLogPath = `${logDir}/info.log`;

    this.ensureLogDirectory();
  }

  setMcpServer(server: Server): void {
    this.mcpServer = server;
  }

  setLoggingLevel(level: LoggingLevel): void {
    this.loggingLevel = level;
  }

  private ensureLogDirectory(): void {
    if (!existsSync(this.logDir)) {
      mkdirSync(this.logDir, { recursive: true });
    }
  }

  private formatMessage(level: string, message: string, error?: Error): string {
    const timestamp = new Date().toISOString();
    const errorInfo = error ? ` | Error: ${error.message} | Stack: ${error.stack}` : '';
    return `[${timestamp}] [${level}] ${message}${errorInfo}\n`;
  }

  private shouldLog(level: LoggingLevel): boolean {
    const levels: LoggingLevel[] = ["debug", "info", "notice", "warning", "error", "critical", "alert", "emergency"];
    const currentIndex = levels.indexOf(this.loggingLevel);
    const messageIndex = levels.indexOf(level);
    return messageIndex >= currentIndex;
  }

  private async sendMcpNotification(level: LoggingLevel, data: string): Promise<void> {
    if (this.mcpServer && this.shouldLog(level)) {
      try {
        await this.mcpServer.notification({
          method: "notifications/message",
          params: {
            level,
            logger: "memory-mcp",
            data,
          },
        });
      } catch (err) {
        // Silently fail MCP notifications to avoid recursion
      }
    }
  }

  error(message: string, error?: Error): void {
    const formattedMessage = this.formatMessage('ERROR', message, error);
    try {
      appendFileSync(this.errorLogPath, formattedMessage, 'utf8');
    } catch (writeError) {
      // Fallback: if we can't write to file, don't crash
    }

    // Send MCP notification
    this.sendMcpNotification("error", error ? `${message}: ${error.message}` : message);
  }

  info(message: string): void {
    const formattedMessage = this.formatMessage('INFO', message);
    try {
      appendFileSync(this.infoLogPath, formattedMessage, 'utf8');
    } catch (writeError) {
      // Fallback: if we can't write to file, don't crash
    }

    // Send MCP notification
    this.sendMcpNotification("info", message);
  }

  warn(message: string): void {
    const formattedMessage = this.formatMessage('WARN', message);
    try {
      appendFileSync(this.infoLogPath, formattedMessage, 'utf8');
    } catch (writeError) {
      // Fallback: if we can't write to file, don't crash
    }

    // Send MCP notification
    this.sendMcpNotification("warning", message);
  }
}

export const logger = new Logger();