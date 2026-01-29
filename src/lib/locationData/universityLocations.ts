/**
 * Comprehensive University Location Data
 * Center coordinates for all supported universities
 */

export interface UniversityLocation {
  name: string;
  center: { lat: number; lng: number };
  country: 'US' | 'UK' | 'CA';
  city: string;
  state?: string;
}

// ============================================================================
// US UNIVERSITY LOCATIONS
// ============================================================================

export const US_UNIVERSITY_LOCATIONS: Record<string, UniversityLocation> = {
  // California - UC System
  'Stanford': { name: 'Stanford University', center: { lat: 37.4275, lng: -122.1697 }, country: 'US', city: 'Stanford', state: 'CA' },
  'UC Berkeley': { name: 'UC Berkeley', center: { lat: 37.8719, lng: -122.2585 }, country: 'US', city: 'Berkeley', state: 'CA' },
  'UCLA': { name: 'UCLA', center: { lat: 34.0689, lng: -118.4452 }, country: 'US', city: 'Los Angeles', state: 'CA' },
  'USC': { name: 'USC', center: { lat: 34.0224, lng: -118.2851 }, country: 'US', city: 'Los Angeles', state: 'CA' },
  'UC San Diego': { name: 'UC San Diego', center: { lat: 32.8801, lng: -117.2340 }, country: 'US', city: 'La Jolla', state: 'CA' },
  'UC Irvine': { name: 'UC Irvine', center: { lat: 33.6405, lng: -117.8443 }, country: 'US', city: 'Irvine', state: 'CA' },
  'UC Davis': { name: 'UC Davis', center: { lat: 38.5382, lng: -121.7617 }, country: 'US', city: 'Davis', state: 'CA' },
  'UC Santa Barbara': { name: 'UC Santa Barbara', center: { lat: 34.4140, lng: -119.8489 }, country: 'US', city: 'Santa Barbara', state: 'CA' },
  'UC Santa Cruz': { name: 'UC Santa Cruz', center: { lat: 36.9916, lng: -122.0583 }, country: 'US', city: 'Santa Cruz', state: 'CA' },
  'UC Riverside': { name: 'UC Riverside', center: { lat: 33.9737, lng: -117.3281 }, country: 'US', city: 'Riverside', state: 'CA' },
  'UC Merced': { name: 'UC Merced', center: { lat: 37.3660, lng: -120.4225 }, country: 'US', city: 'Merced', state: 'CA' },

  // California - CSU & Community Colleges
  'San Jose State': { name: 'San Jose State University', center: { lat: 37.3352, lng: -121.8811 }, country: 'US', city: 'San Jose', state: 'CA' },
  'San Diego State': { name: 'San Diego State University', center: { lat: 32.7757, lng: -117.0719 }, country: 'US', city: 'San Diego', state: 'CA' },
  'Cal Poly SLO': { name: 'Cal Poly San Luis Obispo', center: { lat: 35.3050, lng: -120.6625 }, country: 'US', city: 'San Luis Obispo', state: 'CA' },
  'Cal State Fullerton': { name: 'Cal State Fullerton', center: { lat: 33.8829, lng: -117.8854 }, country: 'US', city: 'Fullerton', state: 'CA' },
  'Cal State Long Beach': { name: 'Cal State Long Beach', center: { lat: 33.7838, lng: -118.1141 }, country: 'US', city: 'Long Beach', state: 'CA' },
  'De Anza College': { name: 'De Anza College', center: { lat: 37.3195, lng: -122.0448 }, country: 'US', city: 'Cupertino', state: 'CA' },
  'Santa Monica College': { name: 'Santa Monica College', center: { lat: 34.0200, lng: -118.4695 }, country: 'US', city: 'Santa Monica', state: 'CA' },
  'Pasadena City College': { name: 'Pasadena City College', center: { lat: 34.1477, lng: -118.1255 }, country: 'US', city: 'Pasadena', state: 'CA' },

  // New York
  'Columbia': { name: 'Columbia University', center: { lat: 40.8075, lng: -73.9626 }, country: 'US', city: 'New York', state: 'NY' },
  'NYU': { name: 'New York University', center: { lat: 40.7295, lng: -73.9965 }, country: 'US', city: 'New York', state: 'NY' },
  'Cornell': { name: 'Cornell University', center: { lat: 42.4534, lng: -76.4735 }, country: 'US', city: 'Ithaca', state: 'NY' },
  'Syracuse': { name: 'Syracuse University', center: { lat: 43.0392, lng: -76.1351 }, country: 'US', city: 'Syracuse', state: 'NY' },
  'SUNY Buffalo': { name: 'University at Buffalo', center: { lat: 43.0008, lng: -78.7890 }, country: 'US', city: 'Buffalo', state: 'NY' },
  'Stony Brook': { name: 'Stony Brook University', center: { lat: 40.9126, lng: -73.1234 }, country: 'US', city: 'Stony Brook', state: 'NY' },
  'Rochester': { name: 'University of Rochester', center: { lat: 43.1285, lng: -77.6296 }, country: 'US', city: 'Rochester', state: 'NY' },
  'Fordham': { name: 'Fordham University', center: { lat: 40.8614, lng: -73.8854 }, country: 'US', city: 'Bronx', state: 'NY' },

  // Massachusetts
  'MIT': { name: 'MIT', center: { lat: 42.3601, lng: -71.0942 }, country: 'US', city: 'Cambridge', state: 'MA' },
  'Harvard': { name: 'Harvard University', center: { lat: 42.3770, lng: -71.1167 }, country: 'US', city: 'Cambridge', state: 'MA' },
  'Northeastern': { name: 'Northeastern University', center: { lat: 42.3398, lng: -71.0892 }, country: 'US', city: 'Boston', state: 'MA' },
  'Boston U': { name: 'Boston University', center: { lat: 42.3505, lng: -71.1054 }, country: 'US', city: 'Boston', state: 'MA' },
  'Boston College': { name: 'Boston College', center: { lat: 42.3355, lng: -71.1685 }, country: 'US', city: 'Chestnut Hill', state: 'MA' },
  'Tufts': { name: 'Tufts University', center: { lat: 42.4085, lng: -71.1183 }, country: 'US', city: 'Medford', state: 'MA' },
  'UMass Amherst': { name: 'UMass Amherst', center: { lat: 42.3912, lng: -72.5267 }, country: 'US', city: 'Amherst', state: 'MA' },

  // Pennsylvania
  'UPenn': { name: 'University of Pennsylvania', center: { lat: 39.9522, lng: -75.1932 }, country: 'US', city: 'Philadelphia', state: 'PA' },
  'Penn State': { name: 'Penn State University', center: { lat: 40.7982, lng: -77.8599 }, country: 'US', city: 'State College', state: 'PA' },
  'Carnegie Mellon': { name: 'Carnegie Mellon University', center: { lat: 40.4432, lng: -79.9428 }, country: 'US', city: 'Pittsburgh', state: 'PA' },
  'Pitt': { name: 'University of Pittsburgh', center: { lat: 40.4444, lng: -79.9608 }, country: 'US', city: 'Pittsburgh', state: 'PA' },
  'Drexel': { name: 'Drexel University', center: { lat: 39.9566, lng: -75.1899 }, country: 'US', city: 'Philadelphia', state: 'PA' },
  'Temple': { name: 'Temple University', center: { lat: 39.9812, lng: -75.1552 }, country: 'US', city: 'Philadelphia', state: 'PA' },

  // Illinois
  'UIUC': { name: 'UIUC', center: { lat: 40.1020, lng: -88.2272 }, country: 'US', city: 'Champaign', state: 'IL' },
  'Northwestern': { name: 'Northwestern University', center: { lat: 42.0565, lng: -87.6753 }, country: 'US', city: 'Evanston', state: 'IL' },
  'UChicago': { name: 'University of Chicago', center: { lat: 41.7886, lng: -87.5987 }, country: 'US', city: 'Chicago', state: 'IL' },
  'DePaul': { name: 'DePaul University', center: { lat: 41.9242, lng: -87.6554 }, country: 'US', city: 'Chicago', state: 'IL' },
  'UIC': { name: 'University of Illinois Chicago', center: { lat: 41.8716, lng: -87.6501 }, country: 'US', city: 'Chicago', state: 'IL' },

  // Texas
  'UT Austin': { name: 'UT Austin', center: { lat: 30.2849, lng: -97.7341 }, country: 'US', city: 'Austin', state: 'TX' },
  'Texas A&M': { name: 'Texas A&M University', center: { lat: 30.6187, lng: -96.3365 }, country: 'US', city: 'College Station', state: 'TX' },
  'Rice': { name: 'Rice University', center: { lat: 29.7174, lng: -95.4028 }, country: 'US', city: 'Houston', state: 'TX' },
  'UT Dallas': { name: 'UT Dallas', center: { lat: 32.9858, lng: -96.7501 }, country: 'US', city: 'Richardson', state: 'TX' },
  'SMU': { name: 'Southern Methodist University', center: { lat: 32.8412, lng: -96.7854 }, country: 'US', city: 'Dallas', state: 'TX' },
  'UH': { name: 'University of Houston', center: { lat: 29.7199, lng: -95.3422 }, country: 'US', city: 'Houston', state: 'TX' },
  'TCU': { name: 'Texas Christian University', center: { lat: 32.7098, lng: -97.3628 }, country: 'US', city: 'Fort Worth', state: 'TX' },

  // Midwest
  'University of Michigan': { name: 'University of Michigan', center: { lat: 42.2780, lng: -83.7382 }, country: 'US', city: 'Ann Arbor', state: 'MI' },
  'Michigan State': { name: 'Michigan State University', center: { lat: 42.7018, lng: -84.4822 }, country: 'US', city: 'East Lansing', state: 'MI' },
  'Ohio State': { name: 'Ohio State University', center: { lat: 40.0067, lng: -83.0305 }, country: 'US', city: 'Columbus', state: 'OH' },
  'Purdue': { name: 'Purdue University', center: { lat: 40.4237, lng: -86.9212 }, country: 'US', city: 'West Lafayette', state: 'IN' },
  'Indiana': { name: 'Indiana University', center: { lat: 39.1682, lng: -86.5186 }, country: 'US', city: 'Bloomington', state: 'IN' },
  'Notre Dame': { name: 'University of Notre Dame', center: { lat: 41.7056, lng: -86.2353 }, country: 'US', city: 'Notre Dame', state: 'IN' },
  'Case Western': { name: 'Case Western Reserve University', center: { lat: 41.5045, lng: -81.6078 }, country: 'US', city: 'Cleveland', state: 'OH' },

  // Southeast
  'Georgia Tech': { name: 'Georgia Tech', center: { lat: 33.7756, lng: -84.3963 }, country: 'US', city: 'Atlanta', state: 'GA' },
  'Emory': { name: 'Emory University', center: { lat: 33.7925, lng: -84.3242 }, country: 'US', city: 'Atlanta', state: 'GA' },
  'UGA': { name: 'University of Georgia', center: { lat: 33.9480, lng: -83.3773 }, country: 'US', city: 'Athens', state: 'GA' },
  'UF': { name: 'University of Florida', center: { lat: 29.6436, lng: -82.3549 }, country: 'US', city: 'Gainesville', state: 'FL' },
  'FSU': { name: 'Florida State University', center: { lat: 30.4419, lng: -84.2985 }, country: 'US', city: 'Tallahassee', state: 'FL' },
  'Miami': { name: 'University of Miami', center: { lat: 25.7215, lng: -80.2792 }, country: 'US', city: 'Coral Gables', state: 'FL' },
  'Duke': { name: 'Duke University', center: { lat: 36.0010, lng: -78.9382 }, country: 'US', city: 'Durham', state: 'NC' },
  'UNC Chapel Hill': { name: 'UNC Chapel Hill', center: { lat: 35.9049, lng: -79.0469 }, country: 'US', city: 'Chapel Hill', state: 'NC' },
  'NC State': { name: 'NC State University', center: { lat: 35.7847, lng: -78.6821 }, country: 'US', city: 'Raleigh', state: 'NC' },
  'Wake Forest': { name: 'Wake Forest University', center: { lat: 36.1336, lng: -80.2776 }, country: 'US', city: 'Winston-Salem', state: 'NC' },

  // Washington & West
  'University of Washington': { name: 'University of Washington', center: { lat: 47.6553, lng: -122.3035 }, country: 'US', city: 'Seattle', state: 'WA' },
  'Washington State': { name: 'Washington State University', center: { lat: 46.7298, lng: -117.1817 }, country: 'US', city: 'Pullman', state: 'WA' },
  'CU Boulder': { name: 'CU Boulder', center: { lat: 40.0076, lng: -105.2659 }, country: 'US', city: 'Boulder', state: 'CO' },
  'Colorado State': { name: 'Colorado State University', center: { lat: 40.5734, lng: -105.0865 }, country: 'US', city: 'Fort Collins', state: 'CO' },
  'Arizona State': { name: 'Arizona State University', center: { lat: 33.4255, lng: -111.9400 }, country: 'US', city: 'Tempe', state: 'AZ' },
  'University of Arizona': { name: 'University of Arizona', center: { lat: 32.2319, lng: -110.9501 }, country: 'US', city: 'Tucson', state: 'AZ' },
};

// ============================================================================
// UK UNIVERSITY LOCATIONS
// ============================================================================

export const UK_UNIVERSITY_LOCATIONS: Record<string, UniversityLocation> = {
  // London
  'Imperial College London': { name: 'Imperial College London', center: { lat: 51.4988, lng: -0.1749 }, country: 'UK', city: 'London' },
  'UCL': { name: 'University College London', center: { lat: 51.5246, lng: -0.1340 }, country: 'UK', city: 'London' },
  'LSE': { name: 'London School of Economics', center: { lat: 51.5144, lng: -0.1165 }, country: 'UK', city: 'London' },
  'Kings College London': { name: "King's College London", center: { lat: 51.5115, lng: -0.1160 }, country: 'UK', city: 'London' },
  'Queen Mary University': { name: 'Queen Mary University of London', center: { lat: 51.5235, lng: -0.0405 }, country: 'UK', city: 'London' },
  'SOAS': { name: 'SOAS University of London', center: { lat: 51.5220, lng: -0.1290 }, country: 'UK', city: 'London' },
  'City University London': { name: 'City, University of London', center: { lat: 51.5280, lng: -0.1025 }, country: 'UK', city: 'London' },
  'Royal Holloway': { name: 'Royal Holloway, University of London', center: { lat: 51.4257, lng: -0.5632 }, country: 'UK', city: 'Egham' },

  // Oxbridge
  'Oxford': { name: 'University of Oxford', center: { lat: 51.7548, lng: -1.2544 }, country: 'UK', city: 'Oxford' },
  'Cambridge': { name: 'University of Cambridge', center: { lat: 52.2043, lng: 0.1149 }, country: 'UK', city: 'Cambridge' },

  // Northern England
  'Manchester': { name: 'University of Manchester', center: { lat: 53.4668, lng: -2.2339 }, country: 'UK', city: 'Manchester' },
  'Leeds': { name: 'University of Leeds', center: { lat: 53.8067, lng: -1.5550 }, country: 'UK', city: 'Leeds' },
  'Sheffield': { name: 'University of Sheffield', center: { lat: 53.3811, lng: -1.4855 }, country: 'UK', city: 'Sheffield' },
  'Newcastle': { name: 'Newcastle University', center: { lat: 54.9783, lng: -1.6178 }, country: 'UK', city: 'Newcastle' },
  'Liverpool': { name: 'University of Liverpool', center: { lat: 53.4084, lng: -2.9673 }, country: 'UK', city: 'Liverpool' },
  'York': { name: 'University of York', center: { lat: 53.9460, lng: -1.0536 }, country: 'UK', city: 'York' },
  'Durham': { name: 'Durham University', center: { lat: 54.7680, lng: -1.5713 }, country: 'UK', city: 'Durham' },

  // Midlands
  'Warwick': { name: 'University of Warwick', center: { lat: 52.3838, lng: -1.5619 }, country: 'UK', city: 'Coventry' },
  'Birmingham': { name: 'University of Birmingham', center: { lat: 52.4508, lng: -1.9305 }, country: 'UK', city: 'Birmingham' },
  'Nottingham': { name: 'University of Nottingham', center: { lat: 52.9388, lng: -1.1966 }, country: 'UK', city: 'Nottingham' },

  // Scotland
  'Edinburgh': { name: 'University of Edinburgh', center: { lat: 55.9445, lng: -3.1892 }, country: 'UK', city: 'Edinburgh' },
  'Glasgow': { name: 'University of Glasgow', center: { lat: 55.8721, lng: -4.2882 }, country: 'UK', city: 'Glasgow' },
  'St Andrews': { name: 'University of St Andrews', center: { lat: 56.3398, lng: -2.7967 }, country: 'UK', city: 'St Andrews' },
  'Aberdeen': { name: 'University of Aberdeen', center: { lat: 57.1645, lng: -2.1018 }, country: 'UK', city: 'Aberdeen' },

  // Wales
  'Cardiff': { name: 'Cardiff University', center: { lat: 51.4866, lng: -3.1773 }, country: 'UK', city: 'Cardiff' },
  'Swansea': { name: 'Swansea University', center: { lat: 51.6100, lng: -3.9787 }, country: 'UK', city: 'Swansea' },

  // South England
  'Bristol': { name: 'University of Bristol', center: { lat: 51.4584, lng: -2.6030 }, country: 'UK', city: 'Bristol' },
  'Bath': { name: 'University of Bath', center: { lat: 51.3794, lng: -2.3257 }, country: 'UK', city: 'Bath' },
  'Southampton': { name: 'University of Southampton', center: { lat: 50.9340, lng: -1.3957 }, country: 'UK', city: 'Southampton' },
  'Exeter': { name: 'University of Exeter', center: { lat: 50.7365, lng: -3.5344 }, country: 'UK', city: 'Exeter' },
  'Brighton': { name: 'University of Brighton', center: { lat: 50.8429, lng: -0.1305 }, country: 'UK', city: 'Brighton' },
  'Reading': { name: 'University of Reading', center: { lat: 51.4414, lng: -0.9418 }, country: 'UK', city: 'Reading' },
  'Surrey': { name: 'University of Surrey', center: { lat: 51.2430, lng: -0.5893 }, country: 'UK', city: 'Guildford' },
  'Sussex': { name: 'University of Sussex', center: { lat: 50.8677, lng: -0.0866 }, country: 'UK', city: 'Brighton' },
};

// ============================================================================
// CANADA UNIVERSITY LOCATIONS
// ============================================================================

export const CANADA_UNIVERSITY_LOCATIONS: Record<string, UniversityLocation> = {
  // Ontario
  'University of Toronto': { name: 'University of Toronto', center: { lat: 43.6629, lng: -79.3957 }, country: 'CA', city: 'Toronto', state: 'ON' },
  'York University': { name: 'York University', center: { lat: 43.7735, lng: -79.5019 }, country: 'CA', city: 'Toronto', state: 'ON' },
  'Toronto Metropolitan University': { name: 'Toronto Metropolitan University', center: { lat: 43.6577, lng: -79.3788 }, country: 'CA', city: 'Toronto', state: 'ON' },
  'Waterloo': { name: 'University of Waterloo', center: { lat: 43.4723, lng: -80.5449 }, country: 'CA', city: 'Waterloo', state: 'ON' },
  'McMaster': { name: 'McMaster University', center: { lat: 43.2609, lng: -79.9192 }, country: 'CA', city: 'Hamilton', state: 'ON' },
  'Western': { name: 'Western University', center: { lat: 43.0096, lng: -81.2737 }, country: 'CA', city: 'London', state: 'ON' },
  "Queen's": { name: "Queen's University", center: { lat: 44.2253, lng: -76.4951 }, country: 'CA', city: 'Kingston', state: 'ON' },
  'Ottawa': { name: 'University of Ottawa', center: { lat: 45.4231, lng: -75.6831 }, country: 'CA', city: 'Ottawa', state: 'ON' },
  'Carleton': { name: 'Carleton University', center: { lat: 45.3876, lng: -75.6960 }, country: 'CA', city: 'Ottawa', state: 'ON' },
  'Guelph': { name: 'University of Guelph', center: { lat: 43.5327, lng: -80.2262 }, country: 'CA', city: 'Guelph', state: 'ON' },

  // British Columbia
  'UBC': { name: 'University of British Columbia', center: { lat: 49.2606, lng: -123.2460 }, country: 'CA', city: 'Vancouver', state: 'BC' },
  'SFU': { name: 'Simon Fraser University', center: { lat: 49.2781, lng: -122.9199 }, country: 'CA', city: 'Burnaby', state: 'BC' },
  'UVic': { name: 'University of Victoria', center: { lat: 48.4634, lng: -123.3117 }, country: 'CA', city: 'Victoria', state: 'BC' },
  'BCIT': { name: 'British Columbia Institute of Technology', center: { lat: 49.2500, lng: -123.0000 }, country: 'CA', city: 'Burnaby', state: 'BC' },
  'Langara': { name: 'Langara College', center: { lat: 49.2246, lng: -123.1086 }, country: 'CA', city: 'Vancouver', state: 'BC' },
  'Douglas College': { name: 'Douglas College', center: { lat: 49.2043, lng: -122.9108 }, country: 'CA', city: 'New Westminster', state: 'BC' },

  // Quebec
  'McGill': { name: 'McGill University', center: { lat: 45.5048, lng: -73.5772 }, country: 'CA', city: 'Montreal', state: 'QC' },
  'Concordia': { name: 'Concordia University', center: { lat: 45.4973, lng: -73.5789 }, country: 'CA', city: 'Montreal', state: 'QC' },
  'Université de Montréal': { name: 'Université de Montréal', center: { lat: 45.5017, lng: -73.6157 }, country: 'CA', city: 'Montreal', state: 'QC' },
  'Laval': { name: 'Université Laval', center: { lat: 46.7800, lng: -71.2761 }, country: 'CA', city: 'Quebec City', state: 'QC' },
  'UQAM': { name: 'UQAM', center: { lat: 45.5088, lng: -73.5687 }, country: 'CA', city: 'Montreal', state: 'QC' },

  // Alberta
  'University of Alberta': { name: 'University of Alberta', center: { lat: 53.5232, lng: -113.5263 }, country: 'CA', city: 'Edmonton', state: 'AB' },
  'University of Calgary': { name: 'University of Calgary', center: { lat: 51.0778, lng: -114.1300 }, country: 'CA', city: 'Calgary', state: 'AB' },
  'MacEwan': { name: 'MacEwan University', center: { lat: 53.5472, lng: -113.5055 }, country: 'CA', city: 'Edmonton', state: 'AB' },
  'Mount Royal': { name: 'Mount Royal University', center: { lat: 51.0109, lng: -114.1298 }, country: 'CA', city: 'Calgary', state: 'AB' },
  'NAIT': { name: 'Northern Alberta Institute of Technology', center: { lat: 53.5695, lng: -113.5054 }, country: 'CA', city: 'Edmonton', state: 'AB' },
  'SAIT': { name: 'Southern Alberta Institute of Technology', center: { lat: 51.0648, lng: -114.0883 }, country: 'CA', city: 'Calgary', state: 'AB' },

  // Prairie Provinces
  'University of Manitoba': { name: 'University of Manitoba', center: { lat: 49.8075, lng: -97.1365 }, country: 'CA', city: 'Winnipeg', state: 'MB' },
  'University of Saskatchewan': { name: 'University of Saskatchewan', center: { lat: 52.1332, lng: -106.6316 }, country: 'CA', city: 'Saskatoon', state: 'SK' },
  'University of Regina': { name: 'University of Regina', center: { lat: 50.4189, lng: -104.5859 }, country: 'CA', city: 'Regina', state: 'SK' },
  'Red River College': { name: 'Red River College', center: { lat: 49.8838, lng: -97.1478 }, country: 'CA', city: 'Winnipeg', state: 'MB' },

  // Atlantic
  'Dalhousie': { name: 'Dalhousie University', center: { lat: 44.6366, lng: -63.5917 }, country: 'CA', city: 'Halifax', state: 'NS' },
  'Memorial': { name: 'Memorial University of Newfoundland', center: { lat: 47.5731, lng: -52.7327 }, country: 'CA', city: "St. John's", state: 'NL' },
  'UNB': { name: 'University of New Brunswick', center: { lat: 45.9500, lng: -66.6400 }, country: 'CA', city: 'Fredericton', state: 'NB' },
  'UPEI': { name: 'University of Prince Edward Island', center: { lat: 46.2592, lng: -63.1350 }, country: 'CA', city: 'Charlottetown', state: 'PE' },
  'Acadia': { name: 'Acadia University', center: { lat: 45.0883, lng: -64.3641 }, country: 'CA', city: 'Wolfville', state: 'NS' },
};

// Combine all university locations
export const ALL_UNIVERSITY_LOCATIONS: Record<string, UniversityLocation> = {
  ...US_UNIVERSITY_LOCATIONS,
  ...UK_UNIVERSITY_LOCATIONS,
  ...CANADA_UNIVERSITY_LOCATIONS,
};
