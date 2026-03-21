-- Create plaid_connections table for storing user's Plaid access tokens
CREATE TABLE IF NOT EXISTS plaid_connections (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  access_token TEXT NOT NULL,
  item_id TEXT NOT NULL,
  institution_name TEXT NOT NULL,
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'error')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Ensure one active connection per user per item (but allow multiple banks per user)
  CONSTRAINT unique_user_item UNIQUE(user_id, item_id)
);

-- Create index on user_id for fast lookups
CREATE INDEX idx_plaid_connections_user_id ON plaid_connections(user_id);
CREATE INDEX idx_plaid_connections_status ON plaid_connections(status);

-- Add trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_plaid_connections_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER plaid_connections_updated_at_trigger
BEFORE UPDATE ON plaid_connections
FOR EACH ROW
EXECUTE FUNCTION update_plaid_connections_updated_at();
