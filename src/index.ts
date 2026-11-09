import { HttpServer } from "./http-server/http";
import { logger } from "./common/logger";

const server = new HttpServer();

server.start();

const shutdown = (eventName: string) => {
  return () => {
    logger.warn(`Received ${eventName}, shutting down`);
    server.stop();
    process.exit(0);
  };
};

process.on("SIGINT", shutdown("SIGINT"));
process.on("SIGTERM", shutdown("SIGTERM"));
