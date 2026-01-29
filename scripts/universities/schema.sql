-- ============================================================================
-- UNIVERSITIES DATABASE SCHEMA
-- Comprehensive database for US, UK, and Canada institutions
-- ============================================================================

-- Drop existing table if needed (be careful in production!)
-- DROP TABLE IF EXISTS universities;

CREATE TABLE IF NOT EXISTS universities (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  short_name TEXT NOT NULL,
  system_name TEXT,

  -- Location
  city TEXT NOT NULL,
  state TEXT NOT NULL,           -- state/province/region code
  country TEXT NOT NULL,         -- 'US', 'UK', 'CA'
  zip_code TEXT,                 -- postal code
  address TEXT,
  latitude DECIMAL(10, 7),
  longitude DECIMAL(10, 7),

  -- Institution details
  type TEXT NOT NULL,            -- 'university', 'community_college', 'college', 'technical_college', 'russell_group', 'ivy_league', 'cegep'
  campus_type TEXT DEFAULT 'main', -- 'main', 'branch', 'satellite', 'online', 'regional'
  carnegie_class TEXT,           -- Carnegie classification (US)
  sector TEXT,                   -- 'public', 'private_nonprofit', 'private_forprofit'
  is_public BOOLEAN DEFAULT true,

  -- Enrollment & demographics
  enrollment INTEGER,
  undergraduate_enrollment INTEGER,
  graduate_enrollment INTEGER,
  international_students INTEGER,
  international_percentage DECIMAL(5, 2),

  -- Admissions
  acceptance_rate DECIMAL(5, 2),
  sat_avg INTEGER,
  act_avg INTEGER,

  -- Costs (annual, in local currency)
  tuition_in_state INTEGER,
  tuition_out_state INTEGER,
  tuition_international INTEGER,
  room_board INTEGER,

  -- Branding
  primary_color TEXT,
  secondary_color TEXT,
  logo_url TEXT,

  -- Contact
  website TEXT,
  phone TEXT,

  -- Search helpers
  aliases TEXT[],                -- Alternative names for search
  keywords TEXT[],               -- Additional search keywords

  -- Data source tracking
  source TEXT,                   -- 'college_scorecard', 'hesa', 'universities_canada', 'manual'
  source_id TEXT,                -- Original ID from source

  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for fast search
CREATE INDEX IF NOT EXISTS idx_universities_country ON universities(country);
CREATE INDEX IF NOT EXISTS idx_universities_state ON universities(state);
CREATE INDEX IF NOT EXISTS idx_universities_type ON universities(type);
CREATE INDEX IF NOT EXISTS idx_universities_name ON universities(name);
CREATE INDEX IF NOT EXISTS idx_universities_short_name ON universities(short_name);

-- Full-text search index
CREATE INDEX IF NOT EXISTS idx_universities_search ON universities
  USING GIN (to_tsvector('english', name || ' ' || COALESCE(short_name, '') || ' ' || COALESCE(city, '') || ' ' || COALESCE(array_to_string(aliases, ' '), '')));

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger for updated_at
DROP TRIGGER IF EXISTS update_universities_updated_at ON universities;
CREATE TRIGGER update_universities_updated_at
    BEFORE UPDATE ON universities
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Enable Row Level Security (optional, uncomment if needed)
-- ALTER TABLE universities ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY "Universities are viewable by everyone" ON universities FOR SELECT USING (true);
