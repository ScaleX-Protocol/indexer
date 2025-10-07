# Deployment Guide

This guide covers deployment scripts and procedures for the CLOB Indexer system.

## Overview

The CLOB Indexer consists of multiple components:
- **Core Chain** (Chain ID 31337, Port 42070): OrderBook, PoolManager events
- **Side Chain** (Chain ID 31338, Port 42071): ChainBalanceManager, Hyperlane cross-chain events
- **WebSocket Service**: Real-time event broadcasting
- **Database**: PostgreSQL for data persistence

## Prerequisites

- Node.js >= 18.14
- PM2 installed globally: `npm install -g pm2`
- PostgreSQL database running on port 5433
- Redis running on port 6380

## Database Operations

### Core Chain Database
```bash
# Drop and recreate core chain database
PGPASSWORD=password psql -h localhost -p 5433 -U postgres -c "DROP DATABASE IF EXISTS ponder_core;"
PGPASSWORD=password psql -h localhost -p 5433 -U postgres -c "CREATE DATABASE ponder_core;"
```

### Side Chain Database
```bash
# Drop and recreate side chain database
PGPASSWORD=password psql -h localhost -p 5433 -U postgres -c "DROP DATABASE IF EXISTS ponder_side;"
PGPASSWORD=password psql -h localhost -p 5433 -U postgres -c "CREATE DATABASE ponder_side;"
```

## Deployment Scripts

### Core Chain Deployment

**Production with PM2:**
```bash
./start-ponder.sh core --pm2 --prod
```

**Development:**
```bash
./start-ponder.sh core --dev
```

**Configuration:**
- Chain ID: 31337
- Port: 42070
- Database: `ponder_core`
- Process Name: `chain-core`

### Side Chain Deployment

**Production with PM2:**
```bash
./start-ponder.sh side --pm2 --prod
```

**Development:**
```bash
./start-ponder.sh side --dev
```

**Configuration:**
- Chain ID: 31338
- Port: 42071
- Database: `ponder_side`
- Process Name: `chain-side`

### Both Chains Deployment

**Production with PM2:**
```bash
./start-ponder.sh both --pm2 --prod
```

**Development (with concurrently):**
```bash
./start-ponder.sh both --dev
```

### WebSocket Service Deployment

**Production with PM2:**
```bash
pnpm pm2:prod:websocket
```

**Development:**
```bash
cd websocket-service && pnpm dev
```

**Configuration:**
- Port: 42080
- Process Name: `gtx-websocket-service`

## Monitoring and Management

### Check Status
```bash
# Check all processes
./start-ponder.sh status

# PM2 status
pm2 status
```

### View Logs
```bash
# All chain logs
./start-ponder.sh logs

# Follow logs in real-time
./start-ponder.sh logs --follow

# Specific process logs
pm2 logs chain-core
pm2 logs chain-side
pm2 logs gtx-websocket-service
```

### Stop Services
```bash
# Stop all chain processes
./start-ponder.sh stop

# Stop specific PM2 process
pm2 stop chain-core
pm2 stop chain-side
pm2 stop gtx-websocket-service
```

### Restart Services
```bash
# Restart specific PM2 process
pm2 restart chain-core
pm2 restart chain-side
pm2 restart gtx-websocket-service
```

## Environment Configuration

### Core Chain Environment
File: `.env.core-chain`
- Database: `postgresql://postgres:password@localhost:5433/ponder_core`
- Port: 42070
- Chain ID: 31337

### Side Chain Environment
File: `.env.side-chain`
- Database: `postgresql://postgres:password@localhost:5433/ponder_side`
- Port: 42071
- Chain ID: 31338

### WebSocket Environment
File: `websocket-service/.env`
- Port: 42080
- Redis: `redis://localhost:6380`

## Troubleshooting

### Schema Conflicts
If you encounter schema conflicts:
```bash
# Drop and recreate the problematic database
PGPASSWORD=password psql -h localhost -p 5433 -U postgres -c "DROP DATABASE IF EXISTS [database_name];"
PGPASSWORD=password psql -h localhost -p 5433 -U postgres -c "CREATE DATABASE [database_name];"
```

### Git Permission Issues
If you encounter dubious ownership errors:
```bash
git config --global --add safe.directory /path/to/repository
```

### Process Management
```bash
# Kill all related processes
pm2 delete all

# Save PM2 configuration
pm2 save

# Startup PM2 on boot
pm2 startup
```

## Deployment Checklist

1. **Pre-deployment:**
   - [ ] Update environment variables
   - [ ] Drop and recreate databases if schema conflicts exist
   - [ ] Ensure PostgreSQL and Redis are running
   - [ ] Pull latest code changes

2. **Deployment:**
   - [ ] Deploy Core Chain: `./start-ponder.sh core --pm2 --prod`
   - [ ] Deploy Side Chain: `./start-ponder.sh side --pm2 --prod`
   - [ ] Deploy WebSocket Service: `pnpm pm2:prod:websocket`

3. **Post-deployment:**
   - [ ] Check status: `./start-ponder.sh status`
   - [ ] Verify logs: `./start-ponder.sh logs`
   - [ ] Test endpoints:
     - Core Chain: http://localhost:42070
     - Side Chain: http://localhost:42071
     - WebSocket: wss://core-devnet.gtxdex.xyz

## URL Endpoints

- **Core Chain GraphQL:** http://localhost:42070
- **Side Chain GraphQL:** http://localhost:42071
- **WebSocket Service:** wss://core-devnet.gtxdex.xyz

## Package.json Scripts Reference

### Core Chain Scripts
- `pnpm run dev:core-chain` - Development mode
- `pnpm run start:core-chain` - Production mode
- `pnpm run db:core-chain` - Database operations
- `pnpm run codegen:core-chain` - Code generation

### Side Chain Scripts
- `pnpm run dev:side-chain` - Development mode
- `pnpm run start:side-chain` - Production mode
- `pnpm run db:side-chain` - Database operations
- `pnpm run codegen:side-chain` - Code generation

### Combined Scripts
- `pnpm run dev:both-chains` - Both chains in development
- `pnpm run start:both-chains` - Both chains in production

### WebSocket Scripts
- `pnpm pm2:prod:websocket` - WebSocket service with PM2