FROM node:18-alpine

WORKDIR /app

# Install pnpm and curl for health check
RUN npm install -g pnpm && apk add --no-cache curl

# Copy package files
COPY package.json pnpm-lock.yaml* ./

# Install all dependencies (including dev dependencies for build)
RUN pnpm install --no-frozen-lockfile

# Copy source code
COPY . .

# Build the application
RUN pnpm run build

# Remove dev dependencies after build
RUN pnpm prune --prod

# Create non-root user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S analytics -u 1001

# Change ownership
RUN chown -R analytics:nodejs /app
USER analytics

# Expose port
EXPOSE 42090

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:42090/health || exit 1

# Start the service
CMD ["pnpm", "start"]