-- ============================================================
-- NOOR Essential Schema Updates
-- Run this in Supabase Dashboard > SQL Editor
-- ============================================================

-- 1. Add missing columns to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS language text DEFAULT 'en';
ALTER TABLE users ADD COLUMN IF NOT EXISTS visa_type text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS major text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS gpa numeric(3,2);
ALTER TABLE users ADD COLUMN IF NOT EXISTS student_level text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS arrival_date date;
ALTER TABLE users ADD COLUMN IF NOT EXISTS international_transfer_frequency text DEFAULT 'monthly';
ALTER TABLE users ADD COLUMN IF NOT EXISTS avg_transfer_amount numeric DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS has_us_credit_history boolean DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS prefers_online_banking boolean DEFAULT true;
ALTER TABLE users ADD COLUMN IF NOT EXISTS needs_nearby_branch boolean DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS needs_zelle boolean DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_completed boolean DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_step integer DEFAULT 0;

-- 2. Add missing columns to bank_accounts table
ALTER TABLE bank_accounts ADD COLUMN IF NOT EXISTS intl_student_score integer DEFAULT 50;
ALTER TABLE bank_accounts ADD COLUMN IF NOT EXISTS opening_difficulty integer DEFAULT 3;
ALTER TABLE bank_accounts ADD COLUMN IF NOT EXISTS digital_experience_score integer DEFAULT 50;
ALTER TABLE bank_accounts ADD COLUMN IF NOT EXISTS customer_service_score integer DEFAULT 50;
ALTER TABLE bank_accounts ADD COLUMN IF NOT EXISTS supported_languages text[];
ALTER TABLE bank_accounts ADD COLUMN IF NOT EXISTS logo_url text;
ALTER TABLE bank_accounts ADD COLUMN IF NOT EXISTS display_priority integer DEFAULT 100;
ALTER TABLE bank_accounts ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true;

-- 3. Create recommendations_new table
CREATE TABLE IF NOT EXISTS recommendations_new (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    recommendation_type text NOT NULL,
    bank_account_id text,
    apartment_id uuid,
    scholarship_id text,
    fit_score numeric(5,2) NOT NULL,
    score_breakdown jsonb,
    reasons text[],
    warnings text[],
    is_viewed boolean DEFAULT false,
    is_saved boolean DEFAULT false,
    is_dismissed boolean DEFAULT false,
    user_rating integer,
    user_feedback text,
    algorithm_version text DEFAULT 'v1',
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- 4. Create saved tables
CREATE TABLE IF NOT EXISTS saved_banks (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    bank_account_id text NOT NULL,
    notes text,
    created_at timestamptz DEFAULT now(),
    UNIQUE(user_id, bank_account_id)
);

CREATE TABLE IF NOT EXISTS saved_apartments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    apartment_id uuid NOT NULL,
    notes text,
    created_at timestamptz DEFAULT now(),
    UNIQUE(user_id, apartment_id)
);

CREATE TABLE IF NOT EXISTS saved_scholarships (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    scholarship_id text NOT NULL,
    notes text,
    application_status text DEFAULT 'not_started',
    created_at timestamptz DEFAULT now(),
    UNIQUE(user_id, scholarship_id)
);

-- 5. Create chat_history table for Noor AI
CREATE TABLE IF NOT EXISTS chat_history (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role text NOT NULL CHECK (role IN ('user', 'assistant')),
    message text NOT NULL,
    created_at timestamptz DEFAULT now()
);

-- 6. Create indexes
CREATE INDEX IF NOT EXISTS idx_recommendations_user ON recommendations_new(user_id);
CREATE INDEX IF NOT EXISTS idx_recommendations_type ON recommendations_new(recommendation_type);
CREATE INDEX IF NOT EXISTS idx_recommendations_score ON recommendations_new(fit_score DESC);
CREATE INDEX IF NOT EXISTS idx_chat_history_user ON chat_history(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_history_created ON chat_history(created_at DESC);

-- Done!
SELECT 'Schema updates applied successfully!' as result;
