import { Elysia } from "elysia";
import { healthRoutes } from "./health/routes";
import { wellKnownRoutes } from "./well-known/routes";
import { mcpRoutes } from "./mcp/routes";

export function registerModules(app: Elysia) {
  return app.use(healthRoutes).use(wellKnownRoutes).use(mcpRoutes);
}
