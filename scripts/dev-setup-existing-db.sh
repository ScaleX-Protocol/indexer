#!/bin/bash

# GTX CLOB Development Setup Script - Use Existing PostgreSQL and Redis
# This script sets up the development environment using your existing database instances

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Helper functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Default values
POSTGRES_HOST="localhost"
POSTGRES_PORT="5432"
POSTGRES_USER="postgres"
POSTGRES_PASSWORD=""
POSTGRES_DB="ponder"
REDIS_HOST="localhost"
REDIS_PORT="6379"

# Function to prompt for database configuration
prompt_for_config() {
    echo
    log_info "PostgreSQL Configuration"
    read -p "PostgreSQL host [$POSTGRES_HOST]: " input_host
    POSTGRES_HOST=${input_host:-$POSTGRES_HOST}
    
    read -p "PostgreSQL port [$POSTGRES_PORT]: " input_port
    POSTGRES_PORT=${input_port:-$POSTGRES_PORT}
    
    read -p "PostgreSQL user [$POSTGRES_USER]: " input_user
    POSTGRES_USER=${input_user:-$POSTGRES_USER}
    
    read -p "PostgreSQL database [$POSTGRES_DB]: " input_db
    POSTGRES_DB=${input_db:-$POSTGRES_DB}
    
    read -s -p "PostgreSQL password: " POSTGRES_PASSWORD
    echo
    
    echo
    log_info "Redis Configuration"
    read -p "Redis host [$REDIS_HOST]: " input_redis_host
    REDIS_HOST=${input_redis_host:-$REDIS_HOST}
    
    read -p "Redis port [$REDIS_PORT]: " input_redis_port
    REDIS_PORT=${input_redis_port:-$REDIS_PORT}
}

# Check if we're in the right directory
if [ ! -f "package.json" ] || [ ! -d "websocket-service" ] || [ ! -d "analytics-service" ]; then
    log_error "Please run this script from the clob-indexer root directory"
    exit 1
fi

log_info "GTX CLOB Development Setup - Using Existing Database Instances"
echo

# Check if user wants to configure database settings
read -p "Do you want to configure database settings? (y/N): " configure_db
if [[ $configure_db =~ ^[Yy]$ ]]; then
    prompt_for_config
else
    log_info "Using default configuration (PostgreSQL: localhost:5432, Redis: localhost:6380)"
    read -s -p "PostgreSQL password: " POSTGRES_PASSWORD
    echo
fi

log_info "Starting setup with:"
echo "  PostgreSQL: $POSTGRES_USER@$POSTGRES_HOST:$POSTGRES_PORT/$POSTGRES_DB"
echo "  Redis: $REDIS_HOST:$REDIS_PORT"
echo

# Step 1: Check prerequisites
log_info "Step 1: Checking prerequisites..."

if ! command -v node &> /dev/null; then
    log_error "Node.js is not installed. Please install Node.js 18+ first."
    exit 1
fi

log_success "Prerequisites check passed"

# Step 2: Test database connections
log_info "Step 2: Testing database connections..."

# Test PostgreSQL connection
if command -v psql &> /dev/null; then
    if PGPASSWORD=$POSTGRES_PASSWORD psql -h $POSTGRES_HOST -p $POSTGRES_PORT -U $POSTGRES_USER -d postgres -c '\q' 2>/dev/null; then
        log_success "PostgreSQL connection successful"
    else
        log_error "PostgreSQL connection failed. Please check your credentials and ensure PostgreSQL is running."
        exit 1
    fi
else
    log_warning "psql not found. Skipping PostgreSQL connection test."
fi

# Test Redis connection
if command -v redis-cli &> /dev/null; then
    if redis-cli -h $REDIS_HOST -p $REDIS_PORT ping > /dev/null 2>&1; then
        log_success "Redis connection successful"
    else
        log_error "Redis connection failed. Please ensure Redis is running on $REDIS_HOST:$REDIS_PORT"
        exit 1
    fi
else
    log_warning "redis-cli not found. Skipping Redis connection test."
fi

# Step 3: Create database if it doesn't exist
log_info "Step 3: Setting up database..."

if command -v psql &> /dev/null; then
    # Check if database exists
    if PGPASSWORD=$POSTGRES_PASSWORD psql -h $POSTGRES_HOST -p $POSTGRES_PORT -U $POSTGRES_USER -lqt | cut -d \| -f 1 | grep -qw $POSTGRES_DB; then
        log_info "Database '$POSTGRES_DB' already exists"
    else
        log_info "Creating database '$POSTGRES_DB'..."
        PGPASSWORD=$POSTGRES_PASSWORD createdb -h $POSTGRES_HOST -p $POSTGRES_PORT -U $POSTGRES_USER $POSTGRES_DB
        log_success "Database '$POSTGRES_DB' created"
    fi
fi

# Step 4: Install dependencies
log_info "Step 4: Installing dependencies for all services..."

log_info "Installing main indexer dependencies..."
npm install

log_info "Installing WebSocket service dependencies..."
cd websocket-service
npm install
cd ..

log_info "Installing Analytics service dependencies..."
cd analytics-service
npm install
cd ..

log_success "All dependencies installed"

# Step 5: Setup environment files
log_info "Step 5: Setting up environment files..."

# Build connection strings
POSTGRES_URL="postgresql://$POSTGRES_USER:$POSTGRES_PASSWORD@$POSTGRES_HOST:$POSTGRES_PORT/$POSTGRES_DB"
REDIS_URL="redis://$REDIS_HOST:$REDIS_PORT"

# Main indexer .env
cat > .env << EOF
# GTX CLOB Indexer Configuration
PONDER_DATABASE_URL=$POSTGRES_URL
REDIS_URL=$REDIS_URL
ENABLE_EVENT_PUBLISHING=true
ENABLE_WEBSOCKET=false
ENABLE_SYSTEM_MONITOR=true
SYSTEM_MONITOR_INTERVAL=60
EOF
log_info "Created main .env file"

# WebSocket service .env
cat > websocket-service/.env << EOF
# WebSocket Service Configuration
PORT=42080
HOST=localhost
HEALTH_PORT=8080

# Redis Configuration
REDIS_URL=$REDIS_URL

# Database Configuration (Read-only access)
DATABASE_URL=$POSTGRES_URL

# Service Configuration
SERVICE_NAME=websocket-service
LOG_LEVEL=info

# Consumer Group Configuration
CONSUMER_GROUP=websocket-consumers
CONSUMER_ID=ws-consumer-dev-1

# Batch Processing
BATCH_SIZE=10
POLL_INTERVAL=1000

# WebSocket Configuration
WS_PING_INTERVAL=30000
WS_PONG_TIMEOUT=5000
MAX_CONNECTIONS=1000
EOF
log_info "Created websocket-service/.env file"

# Analytics service .env
cat > analytics-service/.env << EOF
# Analytics Service Configuration
PORT=3001
HOST=localhost

# Redis Configuration
REDIS_URL=$REDIS_URL

# Database Configuration (Read-only access)
DATABASE_URL=$POSTGRES_URL

# Service Configuration
SERVICE_NAME=analytics-service
LOG_LEVEL=info

# Consumer Group Configuration
CONSUMER_GROUP=analytics-consumers
CONSUMER_ID=analytics-consumer-dev-1

# Batch Processing
ANALYTICS_BATCH_SIZE=5
ANALYTICS_POLL_INTERVAL=5000

# Cache Configuration
CACHE_TTL=300
REFRESH_INTERVAL=60

# Periodic Tasks
ENABLE_DAILY_SNAPSHOTS=true
ENABLE_HOURLY_AGGREGATION=true
ENABLE_CACHE_REFRESH=true
EOF
log_info "Created analytics-service/.env file"

log_success "Environment files created"

# Step 6: Make scripts executable
log_info "Step 6: Making scripts executable..."
chmod +x scripts/microservices.sh
log_success "Scripts are now executable"

# Step 7: Show next steps
echo
log_success "🎉 Development environment setup complete!"
echo
echo "Your existing database instances will be used:"
echo "  PostgreSQL: $POSTGRES_HOST:$POSTGRES_PORT/$POSTGRES_DB"
echo "  Redis: $REDIS_HOST:$REDIS_PORT"
echo
echo "Next steps:"
echo
echo "1. Start services individually (since you're using existing databases):"
echo
echo "   ${YELLOW}# Terminal 1 - Start indexer${NC}"
echo "   npm run dev"
echo
echo "   ${YELLOW}# Terminal 2 - Start WebSocket service${NC}"
echo "   cd websocket-service && npm run dev"
echo
echo "   ${YELLOW}# Terminal 3 - Start Analytics service${NC}"
echo "   cd analytics-service && npm run dev"
echo
echo "2. Or start additional monitoring services with Docker:"
echo "   ${GREEN}docker-compose -f docker-compose.microservices.yml up -d prometheus grafana nginx${NC}"
echo
echo "3. Test the system:"
echo "   ${GREEN}./scripts/test-system.sh${NC}"
echo
echo "Available URLs (after starting services):"
echo "  • WebSocket: ws://localhost:42080/ws"
echo "  • Analytics API: http://localhost:3001/api"
echo "  • WebSocket Health: http://localhost:8080/health"
echo "  • Analytics Health: http://localhost:3001/health"
echo
echo "Note: Since you're using existing databases, make sure they remain running"
echo "during development. The Docker-based setup won't start PostgreSQL/Redis containers."