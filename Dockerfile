# Use official Node.js image
FROM node:22

# Install pnpm globally
RUN npm install -g pnpm

# Set workdir
WORKDIR /app

# Copy package files and install dependencies
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install


# Copy the rest of the app
COPY . .

# Expose ponder port
EXPOSE 42069

EXPOSE 54321

# Crash recovery: restart ponder on crash, using $timestamp as schema
CMD while true; do \
        pnpm ponder db prune \
        TIMESTAMP=$(date +%s); \
        pnpm ponder start --schema public; \
        echo "Ponder crashed. Restarting in 5 seconds..."; \
        sleep 5; \
    done