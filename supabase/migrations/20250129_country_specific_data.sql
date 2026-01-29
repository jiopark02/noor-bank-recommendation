-- ============================================================================
-- Country-Specific Data Tables
-- Migration: Add tables for visa types, documents, health insurance, and banks
-- ============================================================================

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- VISA TYPES TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS visa_types (
    id TEXT PRIMARY KEY,
    country VARCHAR(2) NOT NULL CHECK (country IN ('US', 'UK', 'CA')),
    code VARCHAR(50) NOT NULL,
    name VARCHAR(100) NOT NULL,
    full_name VARCHAR(200),
    description TEXT,
    duration VARCHAR(100),
    work_allowed BOOLEAN DEFAULT false,
    work_restrictions TEXT,
    requirements TEXT[], -- Array of requirements
    documents_needed TEXT[], -- Array of documents
    renewal_info TEXT,
    application_link TEXT,
    display_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_visa_types_country ON visa_types(country);
CREATE INDEX IF NOT EXISTS idx_visa_types_active ON visa_types(is_active);

-- ============================================================================
-- REQUIRED DOCUMENTS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS required_documents (
    id TEXT PRIMARY KEY,
    country VARCHAR(2) NOT NULL CHECK (country IN ('US', 'UK', 'CA')),
    name VARCHAR(100) NOT NULL,
    short_name VARCHAR(20) NOT NULL,
    description TEXT,
    is_required BOOLEAN DEFAULT false,
    how_to_apply TEXT,
    application_link TEXT,
    processing_time VARCHAR(100),
    benefits TEXT[],
    documents_needed TEXT[],
    display_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_required_documents_country ON required_documents(country);

-- ============================================================================
-- HEALTH INSURANCE TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS health_insurance_options (
    id TEXT PRIMARY KEY,
    country VARCHAR(2) NOT NULL CHECK (country IN ('US', 'UK', 'CA')),
    name VARCHAR(100) NOT NULL,
    type VARCHAR(20) NOT NULL CHECK (type IN ('university', 'government', 'private')),
    description TEXT,
    coverage TEXT[],
    monthly_estimate VARCHAR(50),
    is_required BOOLEAN DEFAULT false,
    waiting_period VARCHAR(100),
    link TEXT,
    display_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_health_insurance_country ON health_insurance_options(country);

-- ============================================================================
-- BANKS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS banks (
    id TEXT PRIMARY KEY,
    country VARCHAR(2) NOT NULL CHECK (country IN ('US', 'UK', 'CA')),
    name VARCHAR(100) NOT NULL,
    short_name VARCHAR(50),
    type VARCHAR(20) NOT NULL CHECK (type IN ('traditional', 'digital', 'credit_union')),
    logo_url TEXT,
    description TEXT,
    student_friendly BOOLEAN DEFAULT true,
    no_ssn_required BOOLEAN DEFAULT false, -- US specific
    no_sin_required BOOLEAN DEFAULT false, -- CA specific
    international_transfers BOOLEAN DEFAULT true,
    monthly_fee VARCHAR(50),
    minimum_deposit VARCHAR(50),
    features TEXT[],
    requirements TEXT[],
    website TEXT,
    student_offers TEXT[],
    display_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_banks_country ON banks(country);
CREATE INDEX IF NOT EXISTS idx_banks_student_friendly ON banks(student_friendly);
CREATE INDEX IF NOT EXISTS idx_banks_type ON banks(type);

-- ============================================================================
-- USER COUNTRY PREFERENCES TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS user_country_preferences (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    destination_country VARCHAR(2) NOT NULL CHECK (destination_country IN ('US', 'UK', 'CA')),
    visa_type_id TEXT REFERENCES visa_types(id),
    has_tax_id BOOLEAN DEFAULT false, -- SSN (US), NIN (UK), SIN (CA)
    has_health_coverage BOOLEAN DEFAULT false,
    has_bank_account BOOLEAN DEFAULT false,
    selected_bank_id TEXT REFERENCES banks(id),
    has_local_address BOOLEAN DEFAULT false,
    checklist_progress JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id)
);

CREATE INDEX IF NOT EXISTS idx_user_country_prefs_user ON user_country_preferences(user_id);
CREATE INDEX IF NOT EXISTS idx_user_country_prefs_country ON user_country_preferences(destination_country);

-- ============================================================================
-- COUNTRY CHECKLIST ITEMS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS country_checklist_items (
    id TEXT PRIMARY KEY,
    country VARCHAR(2) NOT NULL CHECK (country IN ('US', 'UK', 'CA')),
    category VARCHAR(50) NOT NULL CHECK (category IN ('visa', 'documents', 'health', 'banking', 'housing', 'other')),
    title VARCHAR(200) NOT NULL,
    description TEXT,
    is_required BOOLEAN DEFAULT false,
    priority INTEGER DEFAULT 0, -- Higher = more important
    estimated_time VARCHAR(50),
    tips TEXT[],
    links JSONB DEFAULT '[]', -- Array of {text, url}
    display_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_checklist_country ON country_checklist_items(country);
CREATE INDEX IF NOT EXISTS idx_checklist_category ON country_checklist_items(category);

-- ============================================================================
-- UPDATE users TABLE TO ADD DESTINATION COUNTRY
-- ============================================================================

DO $$
BEGIN
    -- Add destination_country column if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'users' AND column_name = 'destination_country'
    ) THEN
        ALTER TABLE users ADD COLUMN destination_country VARCHAR(2) CHECK (destination_country IN ('US', 'UK', 'CA'));
    END IF;

    -- Add has_tax_id column if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'users' AND column_name = 'has_tax_id'
    ) THEN
        ALTER TABLE users ADD COLUMN has_tax_id BOOLEAN DEFAULT false;
    END IF;

    -- Add visa_type_code column if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'users' AND column_name = 'visa_type_code'
    ) THEN
        ALTER TABLE users ADD COLUMN visa_type_code VARCHAR(50);
    END IF;
END $$;

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

-- Enable RLS on all new tables
ALTER TABLE visa_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE required_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE health_insurance_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE banks ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_country_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE country_checklist_items ENABLE ROW LEVEL SECURITY;

-- Public read access for reference tables
CREATE POLICY "Public read access for visa_types" ON visa_types FOR SELECT USING (true);
CREATE POLICY "Public read access for required_documents" ON required_documents FOR SELECT USING (true);
CREATE POLICY "Public read access for health_insurance_options" ON health_insurance_options FOR SELECT USING (true);
CREATE POLICY "Public read access for banks" ON banks FOR SELECT USING (true);
CREATE POLICY "Public read access for country_checklist_items" ON country_checklist_items FOR SELECT USING (true);

-- User-specific access for preferences
CREATE POLICY "Users can view own country preferences" ON user_country_preferences
    FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own country preferences" ON user_country_preferences
    FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own country preferences" ON user_country_preferences
    FOR UPDATE USING (auth.uid() = user_id);

-- ============================================================================
-- FUNCTIONS
-- ============================================================================

-- Function to get all country data in one call
CREATE OR REPLACE FUNCTION get_country_data(p_country VARCHAR(2))
RETURNS JSONB AS $$
DECLARE
    result JSONB;
BEGIN
    SELECT jsonb_build_object(
        'visa_types', (SELECT jsonb_agg(row_to_json(v)) FROM visa_types v WHERE v.country = p_country AND v.is_active = true ORDER BY v.display_order),
        'documents', (SELECT jsonb_agg(row_to_json(d)) FROM required_documents d WHERE d.country = p_country AND d.is_active = true ORDER BY d.display_order),
        'health_insurance', (SELECT jsonb_agg(row_to_json(h)) FROM health_insurance_options h WHERE h.country = p_country AND h.is_active = true ORDER BY h.display_order),
        'banks', (SELECT jsonb_agg(row_to_json(b)) FROM banks b WHERE b.country = p_country AND b.is_active = true ORDER BY b.display_order),
        'checklist', (SELECT jsonb_agg(row_to_json(c)) FROM country_checklist_items c WHERE c.country = p_country AND c.is_active = true ORDER BY c.priority DESC, c.display_order)
    ) INTO result;

    RETURN result;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- UPDATED_AT TRIGGER
-- ============================================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply trigger to all new tables
DROP TRIGGER IF EXISTS update_visa_types_updated_at ON visa_types;
CREATE TRIGGER update_visa_types_updated_at BEFORE UPDATE ON visa_types FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_required_documents_updated_at ON required_documents;
CREATE TRIGGER update_required_documents_updated_at BEFORE UPDATE ON required_documents FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_health_insurance_updated_at ON health_insurance_options;
CREATE TRIGGER update_health_insurance_updated_at BEFORE UPDATE ON health_insurance_options FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_banks_updated_at ON banks;
CREATE TRIGGER update_banks_updated_at BEFORE UPDATE ON banks FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_user_country_prefs_updated_at ON user_country_preferences;
CREATE TRIGGER update_user_country_prefs_updated_at BEFORE UPDATE ON user_country_preferences FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_checklist_updated_at ON country_checklist_items;
CREATE TRIGGER update_checklist_updated_at BEFORE UPDATE ON country_checklist_items FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
