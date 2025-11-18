#!/bin/bash

# Wait for database to be ready
echo "Waiting for database to be ready..."
until pg_isready -h postgres -p 5432 -U postgres; do
  echo "Database is not ready, waiting..."
  sleep 2
done

echo "Database is ready, starting Ponder..."
exec pnpm run dev:core-chain