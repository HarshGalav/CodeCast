export const config = {
  database: {
    url: process.env.DATABASE_URL || "postgresql://postgres:password@localhost:5432/collaborative_coding_room",
  },
  redis: {
    url: process.env.REDIS_URL || "redis://localhost:6379",
  },
  auth: {
    secret: process.env.NEXTAUTH_SECRET || "development-secret-key",
    url: process.env.NEXTAUTH_URL || "http://localhost:3000",
  },
  docker: {
    host: process.env.DOCKER_HOST || "unix:///var/run/docker.sock",
  },
  security: {
    rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX || "100"),
    rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || "900000"),
  },
  compilation: {
    maxExecutionTime: parseInt(process.env.MAX_EXECUTION_TIME || "30000"),
    maxMemoryLimit: process.env.MAX_MEMORY_LIMIT || "128m",
    maxCpuLimit: process.env.MAX_CPU_LIMIT || "0.5",
  },
  websocket: {
    port: parseInt(process.env.WEBSOCKET_PORT || "3001"),
  },
} as const;

export type Config = typeof config;