const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 } as const;
type Level = keyof typeof LEVELS;

const threshold = LEVELS[(process.env.LOG_LEVEL as Level) ?? "info"] ?? LEVELS.info;

export interface Logger {
  debug(msg: string, ...args: unknown[]): void;
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
  child(taskId: string): Logger;
}

function write(level: Level, taskId: string | undefined, msg: string, args: unknown[]) {
  if (LEVELS[level] < threshold) return;
  const prefix = taskId ? `[${taskId}] ` : "";
  const line = `${new Date().toISOString()} ${level.toUpperCase()} ${prefix}${msg}`;
  const out = level === "error" || level === "warn" ? console.error : console.log;
  out(line, ...args);
}

function createLogger(taskId?: string): Logger {
  return {
    debug: (msg, ...args) => write("debug", taskId, msg, args),
    info: (msg, ...args) => write("info", taskId, msg, args),
    warn: (msg, ...args) => write("warn", taskId, msg, args),
    error: (msg, ...args) => write("error", taskId, msg, args),
    child: (childTaskId: string) => createLogger(childTaskId),
  };
}

export const logger = createLogger();

export function startTimer(): () => string {
  const start = Date.now();
  return () => {
    const ms = Date.now() - start;
    return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
  };
}
