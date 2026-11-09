import { Elysia } from "elysia";
import { config } from "../config";
import { logger } from "../common/logger";
import { registerModules } from "../modules";

export class HttpServer {
  private app: any;
  private server?: ReturnType<Elysia["listen"]>;

  constructor() {
    this.app = new Elysia().use(registerModules);
  }

  start() {
    if (this.server) {
      return;
    }

    this.server = this.app.listen(config.server.port, () => {
      logger.info(`Hardal MCP ready on port ${config.server.port}`, {
        issuer: config.oauth.issuer,
        resource: config.oauth.mcpResource,
      });
    });
  }

  stop() {
    this.server?.stop();
    this.server = undefined;
  }
}
