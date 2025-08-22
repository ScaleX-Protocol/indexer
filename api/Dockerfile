# Use the smallest Bun Alpine image
FROM oven/bun:alpine AS base

# Install only necessary packages for PostgreSQL connectivity
RUN apk add --no-cache postgresql-client

WORKDIR /app

# Copy package files for dependency installation
COPY package.json bun.lockb ./

# Install dependencies with clean cache
RUN bun install --frozen-lockfile --production && \
    bun pm cache rm

# Copy application source code
COPY src ./src
COPY drizzle.config.ts ./
COPY tsconfig.json ./

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S bunjs -u 1001 -G nodejs

# Set ownership and permissions
RUN chown -R bunjs:nodejs /app
USER bunjs

# Expose the port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD bun --version || exit 1

# Start the application
CMD ["bun", "run", "src/index.ts"]