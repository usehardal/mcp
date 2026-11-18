import { HttpServer } from "./http-server/http";
import { logger } from "./common/logger";
import { usageAnalytics } from "./analytics/usage-analytics";

const server = new HttpServer();

server.start();

const shutdown = (eventName: string) => {
  return async () => {
    logger.warn(`Received ${eventName}, shutting down`);
    server.stop();
    await usageAnalytics.shutdown();
    process.exit(0);
  };
};

process.on("SIGINT", shutdown("SIGINT"));
process.on("SIGTERM", shutdown("SIGTERM"));
