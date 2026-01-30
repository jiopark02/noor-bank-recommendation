-- ============================================================================
-- UK & Canada Banks and Bank Branches
-- Migration: Add no_nin_required column and bank_branches table
-- ============================================================================

-- Add no_nin_required column to banks table for UK banks
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'banks' AND column_name = 'no_nin_required'
    ) THEN
        ALTER TABLE banks ADD COLUMN no_nin_required BOOLEAN DEFAULT false;
        COMMENT ON COLUMN banks.no_nin_required IS 'UK - No National Insurance Number required to open';
    END IF;
END $$;

-- ============================================================================
-- BANK BRANCHES TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS bank_branches (
    id TEXT PRIMARY KEY,
    bank_name VARCHAR(100) NOT NULL,
    branch_name VARCHAR(200) NOT NULL,
    university_name VARCHAR(200) NOT NULL,
    country VARCHAR(2) NOT NULL CHECK (country IN ('US', 'UK', 'CA')),
    address TEXT NOT NULL,
    latitude DECIMAL(10, 6) NOT NULL,
    longitude DECIMAL(10, 6) NOT NULL,
    campus_side VARCHAR(20) CHECK (campus_side IN ('north', 'south', 'east', 'west', 'center')),
    phone VARCHAR(50),
    opening_hours JSONB,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bank_branches_country ON bank_branches(country);
CREATE INDEX IF NOT EXISTS idx_bank_branches_university ON bank_branches(university_name);
CREATE INDEX IF NOT EXISTS idx_bank_branches_bank ON bank_branches(bank_name);
CREATE INDEX IF NOT EXISTS idx_bank_branches_location ON bank_branches USING GIST (
    ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)
);

-- Enable RLS
ALTER TABLE bank_branches ENABLE ROW LEVEL SECURITY;

-- Public read access
CREATE POLICY "Public read access for bank_branches" ON bank_branches FOR SELECT USING (true);

-- Apply updated_at trigger
DROP TRIGGER IF EXISTS update_bank_branches_updated_at ON bank_branches;
CREATE TRIGGER update_bank_branches_updated_at BEFORE UPDATE ON bank_branches
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- UK BANKS DATA
-- ============================================================================

INSERT INTO banks (id, country, name, short_name, type, description, student_friendly, no_nin_required, international_transfers, monthly_fee, minimum_deposit, features, requirements, website, student_offers, display_order, is_active)
VALUES
    ('monzo-uk', 'UK', 'Monzo', 'Monzo', 'digital', 'Digital-first bank with instant notifications and easy money management. Perfect for students.', true, true, true, 'Free', '£0',
     ARRAY['No NIN required', 'Instant notifications', 'Fee-free spending abroad', 'Split bills easily', 'Savings pots', 'Get paid early'],
     ARRAY['Proof of UK address', 'Passport or ID', '16+ years old'],
     'https://monzo.com/', ARRAY['No fees', 'Free ATM withdrawals worldwide'], 1, true),

    ('revolut-uk', 'UK', 'Revolut', 'Revolut', 'digital', 'Global finance app with multi-currency accounts and crypto trading.', true, true, true, 'Free', '£0',
     ARRAY['No NIN required', 'Multi-currency accounts', 'Free international transfers', 'Crypto & stocks', 'Budget analytics', 'Virtual cards'],
     ARRAY['Proof of identity', 'Selfie verification', '18+ years old'],
     'https://revolut.com/', ARRAY['Free plan available', 'Student discounts'], 2, true),

    ('starling-uk', 'UK', 'Starling Bank', 'Starling', 'digital', 'Award-winning digital bank with great app and customer service.', true, true, true, 'Free', '£0',
     ARRAY['No NIN required', 'No fees abroad', 'Savings spaces', '24/7 support', 'Instant notifications', 'Apple/Google Pay'],
     ARRAY['Proof of UK address', 'Photo ID', '16+ years old'],
     'https://starlingbank.com/', ARRAY['No monthly fees', 'Free Euro account'], 3, true),

    ('barclays-uk', 'UK', 'Barclays', 'Barclays', 'traditional', 'One of UK largest banks with extensive branch network and student accounts.', true, false, true, 'Free for students', '£0',
     ARRAY['Student account', 'Free railcard', '0% overdraft up to £1,500', 'Barclays app', 'Apple/Google Pay', 'Branch network'],
     ARRAY['Student status proof', 'Proof of address', 'Photo ID'],
     'https://barclays.co.uk/', ARRAY['Free 4-year 16-25 Railcard', '0% overdraft'], 4, true),

    ('hsbc-uk', 'UK', 'HSBC UK', 'HSBC', 'traditional', 'Global bank with strong international presence. Good for students planning to work abroad.', true, false, true, 'Free for students', '£0',
     ARRAY['Student account', 'Interest-free overdraft', 'Global transfers', 'HSBC app', 'Worldwide presence', 'Travel benefits'],
     ARRAY['Student status proof', 'Proof of address', 'Passport'],
     'https://hsbc.co.uk/', ARRAY['Up to £1,000 interest-free overdraft'], 5, true),

    ('lloyds-uk', 'UK', 'Lloyds Bank', 'Lloyds', 'traditional', 'Major UK bank with student accounts and good mobile banking.', true, false, true, 'Free for students', '£0',
     ARRAY['Student account', 'Tiered overdraft', 'Mobile banking', 'Cashback offers', 'Branch network'],
     ARRAY['Student status proof', 'Proof of address', 'Photo ID'],
     'https://lloydsbank.com/', ARRAY['Up to £1,500 overdraft', 'Cashback offers'], 6, true),

    ('natwest-uk', 'UK', 'NatWest', 'NatWest', 'traditional', 'Major UK bank offering competitive student accounts.', true, false, true, 'Free for students', '£0',
     ARRAY['Student account', 'Tastecard membership', 'Interest-free overdraft', 'Mobile banking', 'Apple/Google Pay'],
     ARRAY['Student status proof', 'Proof of address', 'Photo ID'],
     'https://natwest.com/', ARRAY['Free 4-year Tastecard', 'Up to £2,000 overdraft'], 7, true),

    ('santander-uk', 'UK', 'Santander UK', 'Santander', 'traditional', 'Spanish bank with strong UK presence and student offers.', true, false, true, 'Free for students', '£0',
     ARRAY['Student account', '4-year railcard', 'Interest-free overdraft', 'Cashback', 'Mobile banking'],
     ARRAY['Student status proof', 'Proof of address', 'Photo ID'],
     'https://santander.co.uk/', ARRAY['Free 4-year 16-25 Railcard', 'Up to £1,500 overdraft'], 8, true)
ON CONFLICT (id) DO UPDATE SET
    no_nin_required = EXCLUDED.no_nin_required,
    features = EXCLUDED.features,
    updated_at = NOW();

-- ============================================================================
-- CANADA BANKS DATA
-- ============================================================================

INSERT INTO banks (id, country, name, short_name, type, description, student_friendly, no_sin_required, international_transfers, monthly_fee, minimum_deposit, features, requirements, website, student_offers, display_order, is_active)
VALUES
    ('td-canada', 'CA', 'TD Canada Trust', 'TD', 'traditional', 'One of Canada largest banks with excellent student accounts and extensive branch network.', true, false, true, 'Free for students', '$0',
     ARRAY['Student account', 'No monthly fee', 'Unlimited transactions', 'Mobile banking', 'Interac e-Transfer', 'TD app'],
     ARRAY['Study permit', 'Proof of enrollment', 'Passport'],
     'https://td.com/', ARRAY['No monthly fee for students', 'Free Interac e-Transfers'], 1, true),

    ('rbc-canada', 'CA', 'RBC Royal Bank', 'RBC', 'traditional', 'Canada largest bank by market cap with comprehensive student services.', true, false, true, 'Free for students', '$0',
     ARRAY['Student account', 'No monthly fee', 'RBC Rewards', 'Mobile banking', 'Branch network', 'International transfers'],
     ARRAY['Study permit', 'Proof of enrollment', 'Passport'],
     'https://rbc.com/', ARRAY['No monthly fee until graduation + 1 year', 'Earn rewards'], 2, true),

    ('scotiabank-canada', 'CA', 'Scotiabank', 'Scotiabank', 'traditional', 'International bank with strong presence in the Americas. Good for students from Latin America.', true, false, true, 'Free for students', '$0',
     ARRAY['Student account', 'No monthly fee', 'Scene+ rewards', 'Mobile banking', 'International presence'],
     ARRAY['Study permit', 'Proof of enrollment', 'Passport'],
     'https://scotiabank.com/', ARRAY['Free banking for students', 'Scene+ movie points'], 3, true),

    ('bmo-canada', 'CA', 'BMO Bank of Montreal', 'BMO', 'traditional', 'Historic Canadian bank with solid student offerings.', true, false, true, 'Free for students', '$0',
     ARRAY['Student account', 'No monthly fee', 'BMO Rewards', 'Mobile banking', 'US dollar account'],
     ARRAY['Study permit', 'Proof of enrollment', 'Passport'],
     'https://bmo.com/', ARRAY['No monthly fee for students', 'Free transactions'], 4, true),

    ('cibc-canada', 'CA', 'CIBC', 'CIBC', 'traditional', 'Major Canadian bank with good student account options.', true, false, true, 'Free for students', '$0',
     ARRAY['Student account', 'No monthly fee', 'CIBC Rewards', 'Mobile banking', 'Interac e-Transfer'],
     ARRAY['Study permit', 'Proof of enrollment', 'Passport'],
     'https://cibc.com/', ARRAY['No monthly fee for students', 'Free unlimited transactions'], 5, true),

    ('tangerine-canada', 'CA', 'Tangerine', 'Tangerine', 'digital', 'Online-only bank owned by Scotiabank. No fees, high interest savings.', true, true, true, 'Free', '$0',
     ARRAY['No SIN required to open', 'No monthly fees ever', 'High interest savings', 'Free Interac', 'Mobile banking', 'No minimums'],
     ARRAY['Proof of identity', 'Canadian address'],
     'https://tangerine.ca/', ARRAY['No fees ever', '2.5% savings interest'], 6, true),

    ('simplii-canada', 'CA', 'Simplii Financial', 'Simplii', 'digital', 'CIBC digital banking brand. No fees and CIBC ATM access.', true, true, true, 'Free', '$0',
     ARRAY['No SIN required to open', 'No monthly fees', 'CIBC ATM access', 'High interest savings', 'Free Interac', 'Mobile deposit'],
     ARRAY['Proof of identity', 'Canadian address'],
     'https://simplii.com/', ARRAY['No fees ever', 'Free CIBC ATM access'], 7, true),

    ('wealthsimple-canada', 'CA', 'Wealthsimple Cash', 'Wealthsimple', 'digital', 'Modern fintech with high interest and investing integration.', true, false, false, 'Free', '$0',
     ARRAY['High interest savings', 'Investing integration', 'No fees', 'Modern app', 'Round-ups'],
     ARRAY['SIN required', 'Proof of identity'],
     'https://wealthsimple.com/', ARRAY['High interest rate', 'Free trading'], 8, true)
ON CONFLICT (id) DO UPDATE SET
    no_sin_required = EXCLUDED.no_sin_required,
    features = EXCLUDED.features,
    updated_at = NOW();

-- ============================================================================
-- UK BANK BRANCHES DATA (Sample - Major Universities)
-- ============================================================================

INSERT INTO bank_branches (id, bank_name, branch_name, university_name, country, address, latitude, longitude, campus_side, phone)
VALUES
    -- Imperial College London
    ('imperial-barclays-1', 'Barclays', 'South Kensington', 'Imperial College London', 'UK', '35 Thurloe St, London SW7', 51.4960, -0.1730, 'south', '0345 734 5345'),
    ('imperial-hsbc-1', 'HSBC', 'South Kensington', 'Imperial College London', 'UK', '1 Exhibition Rd, London SW7', 51.4985, -0.1745, 'center', '0345 740 4404'),
    ('imperial-lloyds-1', 'Lloyds', 'Gloucester Road', 'Imperial College London', 'UK', '129 Gloucester Rd, London SW7', 51.4945, -0.1835, 'west', '0345 300 0000'),
    ('imperial-natwest-1', 'NatWest', 'South Kensington', 'Imperial College London', 'UK', '176 Cromwell Rd, London SW5', 51.4940, -0.1890, 'west', '0345 788 8444'),

    -- UCL
    ('ucl-barclays-1', 'Barclays', 'Tottenham Court Road', 'UCL', 'UK', '165 Tottenham Court Rd, London W1', 51.5205, -0.1360, 'south', '0345 734 5345'),
    ('ucl-hsbc-1', 'HSBC', 'Gower Street', 'UCL', 'UK', '67-69 Gower St, London WC1', 51.5225, -0.1310, 'center', '0345 740 4404'),
    ('ucl-lloyds-1', 'Lloyds', 'Euston', 'UCL', 'UK', '124 Euston Rd, London NW1', 51.5265, -0.1285, 'north', '0345 300 0000'),
    ('ucl-natwest-1', 'NatWest', 'Tottenham Court Road', 'UCL', 'UK', '175 Tottenham Court Rd, London W1', 51.5210, -0.1355, 'south', '0345 788 8444'),

    -- Oxford
    ('oxford-barclays-1', 'Barclays', 'High Street', 'Oxford', 'UK', '54 Cornmarket St, Oxford OX1', 51.7530, -1.2575, 'center', '0345 734 5345'),
    ('oxford-hsbc-1', 'HSBC', 'Carfax', 'Oxford', 'UK', '65 Cornmarket St, Oxford OX1', 51.7525, -1.2570, 'center', '0345 740 4404'),
    ('oxford-lloyds-1', 'Lloyds', 'Oxford', 'Oxford', 'UK', '1-5 High St, Oxford OX1', 51.7520, -1.2530, 'east', '0345 300 0000'),
    ('oxford-natwest-1', 'NatWest', 'High Street', 'Oxford', 'UK', '121 High St, Oxford OX1', 51.7515, -1.2500, 'east', '0345 788 8444'),

    -- Cambridge
    ('cambridge-barclays-1', 'Barclays', 'St Andrews Street', 'Cambridge', 'UK', '9-11 St Andrews St, Cambridge CB2', 52.2045, 0.1195, 'center', '0345 734 5345'),
    ('cambridge-hsbc-1', 'HSBC', 'Sidney Street', 'Cambridge', 'UK', '77-78 Sidney St, Cambridge CB2', 52.2060, 0.1220, 'east', '0345 740 4404'),
    ('cambridge-lloyds-1', 'Lloyds', 'Cambridge', 'Cambridge', 'UK', '3 Sidney St, Cambridge CB2', 52.2050, 0.1215, 'east', '0345 300 0000'),
    ('cambridge-natwest-1', 'NatWest', 'Market Square', 'Cambridge', 'UK', '23-24 Market Hill, Cambridge CB2', 52.2055, 0.1185, 'center', '0345 788 8444'),

    -- Manchester
    ('manchester-barclays-1', 'Barclays', 'Oxford Road', 'Manchester', 'UK', '51 Oxford St, Manchester M1', 53.4745, -2.2405, 'north', '0345 734 5345'),
    ('manchester-hsbc-1', 'HSBC', 'Oxford Road', 'Manchester', 'UK', '67 Oxford St, Manchester M1', 53.4740, -2.2400, 'north', '0345 740 4404'),
    ('manchester-lloyds-1', 'Lloyds', 'Piccadilly', 'Manchester', 'UK', '63 Piccadilly, Manchester M1', 53.4805, -2.2360, 'north', '0345 300 0000'),
    ('manchester-natwest-1', 'NatWest', 'Oxford Road', 'Manchester', 'UK', '91 Oxford Rd, Manchester M1', 53.4700, -2.2365, 'center', '0345 788 8444'),

    -- Edinburgh
    ('edinburgh-barclays-1', 'Barclays', 'Princes Street', 'Edinburgh', 'UK', '119 Princes St, Edinburgh EH2', 55.9525, -3.1925, 'center', '0345 734 5345'),
    ('edinburgh-rbs-1', 'Royal Bank of Scotland', 'George Street', 'Edinburgh', 'UK', '36 St Andrew Square, Edinburgh EH2', 55.9540, -3.1910, 'east', '0345 724 2424'),
    ('edinburgh-lloyds-1', 'Lloyds', 'Edinburgh', 'Edinburgh', 'UK', '113 George St, Edinburgh EH2', 55.9535, -3.2000, 'west', '0345 300 0000'),
    ('edinburgh-natwest-1', 'NatWest', 'Princes Street', 'Edinburgh', 'UK', '83 Princes St, Edinburgh EH2', 55.9530, -3.1980, 'center', '0345 788 8444'),

    -- Glasgow
    ('glasgow-barclays-1', 'Barclays', 'Sauchiehall Street', 'Glasgow', 'UK', '200 Sauchiehall St, Glasgow G2', 55.8650, -4.2565, 'center', '0345 734 5345'),
    ('glasgow-rbs-1', 'Royal Bank of Scotland', 'Buchanan Street', 'Glasgow', 'UK', '10 Gordon St, Glasgow G1', 55.8595, -4.2555, 'south', '0345 724 2424'),
    ('glasgow-lloyds-1', 'Lloyds', 'Glasgow', 'Glasgow', 'UK', '110 Buchanan St, Glasgow G1', 55.8620, -4.2530, 'center', '0345 300 0000'),
    ('glasgow-natwest-1', 'NatWest', 'Buchanan Street', 'Glasgow', 'UK', '77 Buchanan St, Glasgow G1', 55.8610, -4.2535, 'center', '0345 788 8444')
ON CONFLICT (id) DO UPDATE SET
    address = EXCLUDED.address,
    latitude = EXCLUDED.latitude,
    longitude = EXCLUDED.longitude,
    updated_at = NOW();

-- ============================================================================
-- CANADA BANK BRANCHES DATA (Sample - Major Universities)
-- ============================================================================

INSERT INTO bank_branches (id, bank_name, branch_name, university_name, country, address, latitude, longitude, campus_side, phone)
VALUES
    -- University of Toronto
    ('uoft-td-1', 'TD Canada Trust', 'Bloor & St George', 'University of Toronto', 'CA', '180 Bloor St W, Toronto ON', 43.6680, -79.3990, 'north', '(416) 982-8420'),
    ('uoft-td-2', 'TD Canada Trust', 'College & Spadina', 'University of Toronto', 'CA', '370 College St, Toronto ON', 43.6575, -79.4010, 'west', '(416) 307-1510'),
    ('uoft-rbc-1', 'RBC Royal Bank', 'Bloor & Bedford', 'University of Toronto', 'CA', '130 Bloor St W, Toronto ON', 43.6685, -79.3960, 'north', '(416) 974-2861'),
    ('uoft-bmo-1', 'BMO', 'Bloor & St George', 'University of Toronto', 'CA', '160 Bloor St W, Toronto ON', 43.6682, -79.3985, 'north', '(416) 867-6640'),
    ('uoft-scotia-1', 'Scotiabank', 'College Street', 'University of Toronto', 'CA', '480 College St, Toronto ON', 43.6565, -79.4075, 'west', '(416) 866-3755'),
    ('uoft-cibc-1', 'CIBC', 'Bloor & Spadina', 'University of Toronto', 'CA', '310 Bloor St W, Toronto ON', 43.6670, -79.4045, 'west', '(416) 980-3022'),

    -- McGill
    ('mcgill-td-1', 'TD Canada Trust', 'McGill College', 'McGill', 'CA', '1350 Rene-Levesque Blvd W, Montreal QC', 45.4995, -73.5755, 'south', '(514) 289-0700'),
    ('mcgill-rbc-1', 'RBC Royal Bank', 'Sherbrooke', 'McGill', 'CA', '1 Place Ville Marie, Montreal QC', 45.5020, -73.5695, 'east', '(514) 874-2311'),
    ('mcgill-bmo-1', 'BMO', 'McGill College', 'McGill', 'CA', '1501 McGill College Ave, Montreal QC', 45.5025, -73.5720, 'center', '(514) 877-8020'),
    ('mcgill-scotia-1', 'Scotiabank', 'Sherbrooke', 'McGill', 'CA', '1002 Sherbrooke St W, Montreal QC', 45.5030, -73.5800, 'west', '(514) 499-9600'),

    -- UBC
    ('ubc-td-1', 'TD Canada Trust', 'University Village', 'UBC', 'CA', '5728 University Blvd, Vancouver BC', 49.2685, -123.2505, 'east', '(604) 654-3650'),
    ('ubc-rbc-1', 'RBC Royal Bank', 'Wesbrook Village', 'UBC', 'CA', '5950 University Blvd, Vancouver BC', 49.2655, -123.2405, 'east', '(604) 665-5450'),
    ('ubc-bmo-1', 'BMO', 'UBC Campus', 'UBC', 'CA', '5728 University Blvd, Vancouver BC', 49.2680, -123.2510, 'east', '(604) 665-7100'),
    ('ubc-scotia-1', 'Scotiabank', 'West 10th', 'UBC', 'CA', '4255 W 10th Ave, Vancouver BC', 49.2620, -123.2060, 'south', '(604) 668-2335'),

    -- Waterloo
    ('waterloo-td-1', 'TD Canada Trust', 'University Plaza', 'Waterloo', 'CA', '170 University Ave W, Waterloo ON', 43.4720, -80.5350, 'west', '(519) 888-4567'),
    ('waterloo-rbc-1', 'RBC Royal Bank', 'King & University', 'Waterloo', 'CA', '170 King St S, Waterloo ON', 43.4655, -80.5230, 'south', '(519) 885-1740'),
    ('waterloo-bmo-1', 'BMO', 'University Plaza', 'Waterloo', 'CA', '160 University Ave W, Waterloo ON', 43.4725, -80.5345, 'west', '(519) 884-0060'),
    ('waterloo-scotia-1', 'Scotiabank', 'King Street', 'Waterloo', 'CA', '52 King St S, Waterloo ON', 43.4680, -80.5225, 'south', '(519) 747-2660'),

    -- University of Alberta
    ('ualberta-td-1', 'TD Canada Trust', 'HUB Mall', 'University of Alberta', 'CA', '9004 112 St NW, Edmonton AB', 53.5220, -113.5245, 'center', '(780) 448-8340'),
    ('ualberta-rbc-1', 'RBC Royal Bank', 'Whyte Ave', 'University of Alberta', 'CA', '10508 82 Ave NW, Edmonton AB', 53.5175, -113.5030, 'east', '(780) 448-7760'),
    ('ualberta-bmo-1', 'BMO', 'Campus', 'University of Alberta', 'CA', '8623 112 St NW, Edmonton AB', 53.5265, -113.5240, 'north', '(780) 448-8770'),
    ('ualberta-scotia-1', 'Scotiabank', 'Whyte Avenue', 'University of Alberta', 'CA', '10210 82 Ave NW, Edmonton AB', 53.5180, -113.5080, 'east', '(780) 448-8050'),

    -- University of Calgary
    ('ucalgary-td-1', 'TD Canada Trust', 'Brentwood', 'University of Calgary', 'CA', '3630 Brentwood Rd NW, Calgary AB', 51.0860, -114.1295, 'south', '(403) 292-8620'),
    ('ucalgary-rbc-1', 'RBC Royal Bank', 'University District', 'University of Calgary', 'CA', '3545 32 Ave NE, Calgary AB', 51.0780, -114.0590, 'east', '(403) 292-7060'),
    ('ucalgary-bmo-1', 'BMO', 'Brentwood', 'University of Calgary', 'CA', '3550 Brentwood Rd NW, Calgary AB', 51.0855, -114.1290, 'south', '(403) 292-8240'),
    ('ucalgary-scotia-1', 'Scotiabank', 'Market Mall', 'University of Calgary', 'CA', '3625 Shaganappi Trail NW, Calgary AB', 51.0905, -114.1420, 'west', '(403) 292-8550')
ON CONFLICT (id) DO UPDATE SET
    address = EXCLUDED.address,
    latitude = EXCLUDED.latitude,
    longitude = EXCLUDED.longitude,
    updated_at = NOW();

-- ============================================================================
-- FUNCTION TO GET NEARBY BANK BRANCHES
-- ============================================================================

CREATE OR REPLACE FUNCTION get_bank_branches_by_university(p_university VARCHAR(200), p_country VARCHAR(2) DEFAULT NULL)
RETURNS SETOF bank_branches AS $$
BEGIN
    RETURN QUERY
    SELECT *
    FROM bank_branches
    WHERE university_name ILIKE '%' || p_university || '%'
    AND (p_country IS NULL OR country = p_country)
    AND is_active = true
    ORDER BY bank_name, branch_name;
END;
$$ LANGUAGE plpgsql;

-- Function to get all banks for a country
CREATE OR REPLACE FUNCTION get_banks_by_country(p_country VARCHAR(2))
RETURNS SETOF banks AS $$
BEGIN
    RETURN QUERY
    SELECT *
    FROM banks
    WHERE country = p_country
    AND is_active = true
    ORDER BY display_order, name;
END;
$$ LANGUAGE plpgsql;

-- Function to get banks that don't require tax ID
CREATE OR REPLACE FUNCTION get_banks_no_tax_id(p_country VARCHAR(2))
RETURNS SETOF banks AS $$
BEGIN
    RETURN QUERY
    SELECT *
    FROM banks
    WHERE country = p_country
    AND is_active = true
    AND (
        (p_country = 'US' AND no_ssn_required = true) OR
        (p_country = 'UK' AND no_nin_required = true) OR
        (p_country = 'CA' AND no_sin_required = true)
    )
    ORDER BY display_order, name;
END;
$$ LANGUAGE plpgsql;
