-- Initialize the Ponder database
-- This script runs automatically when the container starts

-- Create any additional schemas or extensions if needed
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Set default timezone
SET timezone = 'UTC';

-- Create indexes for better performance (optional)
-- These will be created by Ponder automatically, but can be pre-created here if needed

-- Grant permissions
GRANT ALL PRIVILEGES ON DATABASE ponder_scalex TO ponder;