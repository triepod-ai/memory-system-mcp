import { writeFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';

export class Logger {
  private logDir: string;
  private errorLogPath: string;
  private infoLogPath: string;

  constructor(logDir: string = './logs') {
    this.logDir = logDir;
    this.errorLogPath = `${logDir}/error.log`;
    this.infoLogPath = `${logDir}/info.log`;
    
    this.ensureLogDirectory();
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

  error(message: string, error?: Error): void {
    const formattedMessage = this.formatMessage('ERROR', message, error);
    try {
      appendFileSync(this.errorLogPath, formattedMessage, 'utf8');
    } catch (writeError) {
      // Fallback: if we can't write to file, don't crash
    }
  }

  info(message: string): void {
    const formattedMessage = this.formatMessage('INFO', message);
    try {
      appendFileSync(this.infoLogPath, formattedMessage, 'utf8');
    } catch (writeError) {
      // Fallback: if we can't write to file, don't crash
    }
  }

  warn(message: string): void {
    const formattedMessage = this.formatMessage('WARN', message);
    try {
      appendFileSync(this.infoLogPath, formattedMessage, 'utf8');
    } catch (writeError) {
      // Fallback: if we can't write to file, don't crash
    }
  }
}

export const logger = new Logger();