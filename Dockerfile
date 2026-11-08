# Build stage for the Nebula MCP server (Bun + Elysia)
FROM oven/bun:1.4.4 AS build
WORKDIR /app

RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

# Cache dependency installation
COPY package.json bun.lock ./
RUN bun install

# Copy source
COPY ./src ./src

ENV NODE_ENV=production
ENV PORT=1922
EXPOSE 1922
CMD ["bun", "run", "start"]
