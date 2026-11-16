type LogLevel = "debug" | "info" | "warn" | "error";

const levelPriority: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function isLogLevel(value: string): value is LogLevel {
  return Object.keys(levelPriority).includes(value);
}

export function parseLogLevel(value: string | undefined): LogLevel {
  if (!value) {
    return "info";
  }
  if (isLogLevel(value)) {
    return value;
  }
  console.warn(
    `LOG_LEVEL "${value}" is not one of ${Object.keys(levelPriority).join(", ")}; using info`,
  );
  return "info";
}

const envLevel = parseLogLevel(process.env.LOG_LEVEL);

function shouldLog(level: LogLevel) {
  return levelPriority[level] >= levelPriority[envLevel];
}

function format(
  level: LogLevel,
  message: string,
  meta?: Record<string, unknown>,
) {
  const base = `[${new Date().toISOString()}] [${level.toUpperCase()}] ${message}`;
  if (!meta || Object.keys(meta).length === 0) {
    return base;
  }
  return `${base} ${JSON.stringify(meta)}`;
}

export const logger = {
  debug(message: string, meta?: Record<string, unknown>) {
    if (shouldLog("debug")) {
      console.debug(format("debug", message, meta));
    }
  },
  info(message: string, meta?: Record<string, unknown>) {
    if (shouldLog("info")) {
      console.info(format("info", message, meta));
    }
  },
  warn(message: string, meta?: Record<string, unknown>) {
    if (shouldLog("warn")) {
      console.warn(format("warn", message, meta));
    }
  },
  error(message: string, meta?: Record<string, unknown>) {
    if (shouldLog("error")) {
      console.error(format("error", message, meta));
    }
  },
};
