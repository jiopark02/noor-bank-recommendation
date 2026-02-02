-- ============================================================
-- NOOR Location Data Schema
-- Universities, Apartments, Bank Branches
-- Run this in Supabase Dashboard > SQL Editor
-- ============================================================

-- 1. Universities Table
CREATE TABLE IF NOT EXISTS universities (
    id text PRIMARY KEY,
    name text NOT NULL,
    short_name text NOT NULL,
    city text NOT NULL,
    state text,
    country text NOT NULL DEFAULT 'US',
    latitude numeric(10, 6) NOT NULL,
    longitude numeric(10, 6) NOT NULL,
    type text,
    aliases text[],
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_universities_short_name ON universities(short_name);
CREATE INDEX IF NOT EXISTS idx_universities_country ON universities(country);
CREATE INDEX IF NOT EXISTS idx_universities_location ON universities(latitude, longitude);

-- 2. Apartments Table (Real data from OpenStreetMap/APIs)
CREATE TABLE IF NOT EXISTS apartments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    address text NOT NULL,
    university_id text REFERENCES universities(id),
    university_short_name text NOT NULL,
    latitude numeric(10, 6) NOT NULL,
    longitude numeric(10, 6) NOT NULL,
    bedrooms text,
    bathrooms text,
    price_min integer,
    price_max integer,
    sqft_min integer,
    sqft_max integer,
    walking_minutes integer,
    biking_minutes integer,
    transit_minutes integer,
    driving_minutes integer,
    rating numeric(2, 1),
    review_count integer,
    pet_policy text,
    campus_side text,
    furnished boolean DEFAULT false,
    gym boolean DEFAULT false,
    parking boolean DEFAULT false,
    laundry boolean DEFAULT false,
    pool boolean DEFAULT false,
    contact_phone text,
    contact_website text,
    images text[],
    source text DEFAULT 'openstreetmap',
    osm_id text,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_apartments_university ON apartments(university_short_name);
CREATE INDEX IF NOT EXISTS idx_apartments_location ON apartments(latitude, longitude);
CREATE INDEX IF NOT EXISTS idx_apartments_price ON apartments(price_min, price_max);

-- 3. Bank Branches Table (Real data from OpenStreetMap/APIs)
CREATE TABLE IF NOT EXISTS bank_branches (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    bank_name text NOT NULL,
    branch_name text,
    address text NOT NULL,
    university_id text REFERENCES universities(id),
    university_short_name text NOT NULL,
    latitude numeric(10, 6) NOT NULL,
    longitude numeric(10, 6) NOT NULL,
    campus_side text,
    phone text,
    hours text,
    has_atm boolean DEFAULT true,
    has_drive_thru boolean DEFAULT false,
    source text DEFAULT 'openstreetmap',
    osm_id text,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bank_branches_university ON bank_branches(university_short_name);
CREATE INDEX IF NOT EXISTS idx_bank_branches_bank ON bank_branches(bank_name);
CREATE INDEX IF NOT EXISTS idx_bank_branches_location ON bank_branches(latitude, longitude);

-- 4. Enable RLS
ALTER TABLE universities ENABLE ROW LEVEL SECURITY;
ALTER TABLE apartments ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_branches ENABLE ROW LEVEL SECURITY;

-- 5. Public read policies
CREATE POLICY "Public read universities" ON universities FOR SELECT USING (true);
CREATE POLICY "Public read apartments" ON apartments FOR SELECT USING (true);
CREATE POLICY "Public read bank_branches" ON bank_branches FOR SELECT USING (true);

-- Done!
SELECT 'Location schema created successfully!' as result;
