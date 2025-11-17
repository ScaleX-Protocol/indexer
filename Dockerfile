# Use official Node.js image
FROM oven/bun:1.2-slim

# Set workdir
WORKDIR /app

# Copy package files and install dependencies
COPY package.json pnpm-lock.yaml* ./
RUN bun install

# Copy the rest of the app
COPY . .

# Expose ponder port
EXPOSE 42069
EXPOSE 42080

CMD ["bun", "run", "dev:core-chain"]