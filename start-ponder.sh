#!/bin/bash

# Usage: ./start-ponder.sh [--production|production]
# - Default: Runs ponder in development mode (ponder dev)
# - With --production or production: Runs ponder in production mode (ponder start)

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Script configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEBSOCKET_SCRIPT_TS="$SCRIPT_DIR/websocket-enable-block.ts"
WEBSOCKET_SCRIPT_JS="$SCRIPT_DIR/websocket-enable-block.cjs"
REDIS_KEY="websocket:enable:block"
MAX_RETRIES=5
RETRY_DELAY=2

echo -e "${BLUE}🚀 Starting Ponder with WebSocket block number initialization...${NC}"

# Function to check if Redis is available
check_redis() {
    local redis_url="${REDIS_URL:-redis://localhost:6379}"
    echo -e "${YELLOW}📡 Checking Redis connection...${NC}"
    
    if command -v redis-cli &> /dev/null; then
        redis-cli ping &> /dev/null
        return $?
    else
        # Try with bun and redis client
        bun -e "
        import { createClient } from 'redis';
        const client = createClient({ url: '$redis_url' });
        try {
            await client.connect();
            await client.ping();
            await client.quit();
            console.log('Redis connection successful');
            process.exit(0);
        } catch (error) {
            console.error('Redis connection failed:', error.message);
            process.exit(1);
        }
        " &> /dev/null
        return $?
    fi
}

# Function to check if the websocket enable block is set in Redis
check_websocket_block() {
    local redis_url="${REDIS_URL:-redis://localhost:6379}"
    echo -e "${YELLOW}🔍 Checking if WebSocket enable block is set in Redis...${NC}"
    
    if command -v redis-cli &> /dev/null; then
        local result=$(redis-cli get "$REDIS_KEY" 2>/dev/null)
        if [[ -n "$result" && "$result" != "(nil)" ]]; then
            echo -e "${GREEN}✅ WebSocket enable block found in Redis: $result${NC}"
            return 0
        fi
    else
        # Try with bun and redis client
        local result=$(bun -e "
        import { createClient } from 'redis';
        const client = createClient({ url: '$redis_url' });
        try {
            await client.connect();
            const value = await client.get('$REDIS_KEY');
            await client.quit();
            if (value) {
                console.log(value);
                process.exit(0);
            } else {
                process.exit(1);
            }
        } catch (error) {
            process.exit(1);
        }
        " 2>/dev/null)
        
        if [[ $? -eq 0 && -n "$result" ]]; then
            echo -e "${GREEN}✅ WebSocket enable block found in Redis: $result${NC}"
            return 0
        fi
    fi
    
    echo -e "${YELLOW}⚠️  WebSocket enable block not found in Redis${NC}"
    return 1
}

# Function to run the websocket enable block script
run_websocket_script() {
    echo -e "${YELLOW}🔧 Running WebSocket enable block script...${NC}"
    
    # Prefer Node.js version if available
    if [[ -f "$WEBSOCKET_SCRIPT_JS" ]] && command -v node &> /dev/null; then
        echo -e "${YELLOW}🚀 Running JavaScript version with Node.js...${NC}"
        cd "$SCRIPT_DIR" && node "$WEBSOCKET_SCRIPT_JS"
    elif [[ -f "$WEBSOCKET_SCRIPT_TS" ]] && command -v tsx &> /dev/null; then
        echo -e "${YELLOW}🚀 Running TypeScript with tsx...${NC}"
        cd "$SCRIPT_DIR" && tsx "$WEBSOCKET_SCRIPT_TS"
    elif [[ -f "$WEBSOCKET_SCRIPT_TS" ]] && command -v ts-node &> /dev/null; then
        echo -e "${YELLOW}🚀 Running TypeScript with ts-node...${NC}"
        cd "$SCRIPT_DIR" && ts-node "$WEBSOCKET_SCRIPT_TS"
    elif [[ -f "$WEBSOCKET_SCRIPT_TS" ]] && command -v bun &> /dev/null; then
        echo -e "${YELLOW}🚀 Running TypeScript with Bun...${NC}"
        cd "$SCRIPT_DIR" && bun "$WEBSOCKET_SCRIPT_TS"
    else
        echo -e "${RED}❌ No suitable script runner found or WebSocket script missing${NC}"
        echo -e "${YELLOW}📄 Available files:${NC}"
        ls -la "$SCRIPT_DIR"/websocket-enable-block.*
        return 1
    fi
    local exit_code=$?
    
    if [[ $exit_code -eq 0 ]]; then
        echo -e "${GREEN}✅ WebSocket enable block script completed successfully${NC}"
        return 0
    else
        echo -e "${RED}❌ WebSocket enable block script failed with exit code: $exit_code${NC}"
        return 1
    fi
}

# Function to start PM2 process
start_pm2_process() {
    echo -e "${YELLOW}🚀 Starting PM2 process...${NC}"
    
    # Check if PM2 is installed
    if ! command -v pm2 &> /dev/null; then
        echo -e "${RED}❌ PM2 is not installed. Please install it with: npm install -g pm2${NC}"
        return 1
    fi
    
    # Determine if we're in production mode
    local is_production=false
    for arg in "$@"; do
        if [[ "$arg" == "--production" || "$arg" == "production" ]]; then
            is_production=true
            break
        fi
    done
    
    # Set command and process name based on mode
    local ponder_command
    local process_name
    if [[ "$is_production" == true ]]; then
        # Use timestamp-based schema for production (similar to Dockerfile pattern)
        local timestamp=$(date +%s)
        ponder_command="pnpm run start --config pg-ponder.config.ts --schema public_${timestamp}"
        process_name="ponder-prod"
        echo -e "${GREEN}🏭 Running in PRODUCTION mode with schema: public_${timestamp}${NC}"
    else
        ponder_command="pnpm run dev --config pg-ponder.config.ts --disable-ui"
        process_name="ponder-dev"
        echo -e "${BLUE}🛠️  Running in DEVELOPMENT mode${NC}"
    fi
    
    # Stop existing process if running
    pm2 delete "$process_name" 2>/dev/null || true
    
    # Start the new process
    pm2 start "$ponder_command" \
        --name "$process_name" \
        --log "$process_name.log" \
        --time
    
    local exit_code=$?
    
    if [[ $exit_code -eq 0 ]]; then
        echo -e "${GREEN}✅ PM2 process '$process_name' started successfully${NC}"
        echo -e "${BLUE}📊 View logs with: pm2 logs $process_name${NC}"
        echo -e "${BLUE}📊 View status with: pm2 status${NC}"
        return 0
    else
        echo -e "${RED}❌ Failed to start PM2 process${NC}"
        return 1
    fi
}

# Main execution flow
main() {
    echo -e "${BLUE}📋 Starting initialization process...${NC}"
    
    # Check Redis connection
    if ! check_redis; then
        echo -e "${RED}❌ Redis is not available. Please ensure Redis is running.${NC}"
        exit 1
    fi
    
    # Check if websocket block is already set
    if check_websocket_block; then
        echo -e "${GREEN}✅ WebSocket enable block already set, skipping initialization${NC}"
    else
        echo -e "${YELLOW}🔄 WebSocket enable block not set, running initialization...${NC}"
        
        # Run the websocket script with retries
        retry_count=0
        while [[ $retry_count -lt $MAX_RETRIES ]]; do
            if run_websocket_script; then
                break
            else
                retry_count=$((retry_count + 1))
                if [[ $retry_count -lt $MAX_RETRIES ]]; then
                    echo -e "${YELLOW}⏳ Retrying in $RETRY_DELAY seconds... (Attempt $((retry_count + 1))/$MAX_RETRIES)${NC}"
                    sleep $RETRY_DELAY
                else
                    echo -e "${RED}❌ Failed to set WebSocket enable block after $MAX_RETRIES attempts${NC}"
                    exit 1
                fi
            fi
        done
        
        # Verify the block was set
        sleep 1
        if ! check_websocket_block; then
            echo -e "${RED}❌ WebSocket enable block was not set properly${NC}"
            exit 1
        fi
    fi
    
    # Start PM2 process
    if start_pm2_process "$@"; then
        echo -e "${GREEN}🎉 All done! Ponder is now running with PM2.${NC}"
        echo -e "${BLUE}💡 Use 'pm2 stop ponder-dev' to stop the process${NC}"
    else
        echo -e "${RED}❌ Failed to start PM2 process${NC}"
        exit 1
    fi
}

# Handle script interruption
trap 'echo -e "\n${YELLOW}⚠️  Script interrupted${NC}"; exit 130' INT

# Run main function
main "$@"
