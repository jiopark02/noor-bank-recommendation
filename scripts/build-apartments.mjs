#!/usr/bin/env node
/**
 * Comprehensive Apartment Data Generator
 * Generates 10 apartments per university for US, UK, and Canada
 * Run: node scripts/build-apartments.mjs > src/lib/locationData/apartmentsData.ts
 */

// Apartment name templates by country
const US_NAMES = [
  'The Residences', 'Campus Village', 'University Apartments', 'College Commons', 'The Heights',
  'Park Place', 'Student Living', 'Metro Apartments', 'City Center', 'Collegiate Housing',
  'Summit Suites', 'Plaza Apartments', 'Vista Living', 'The Lofts', 'Gateway Apartments',
  'Horizon Suites', 'The Quarters', 'Academy Hall', 'The Reserve', 'Landmark Apartments'
];

const UK_NAMES = [
  'Student House', 'University Halls', 'Campus Lodge', 'The Residence', 'College Court',
  'City Rooms', 'Student Village', 'The Studios', 'Academic House', 'Scholar House',
  'Trinity Court', 'Crown Place', 'Castle View', 'Garden Court', 'The Quadrant',
  'University Green', 'King House', 'Queens Court', 'Victoria House', 'Royal Residence'
];

const CA_NAMES = [
  'Campus Residence', 'University Suites', 'Student Housing', 'College Living', 'The Commons',
  'Maple House', 'Academic Residence', 'Campus Place', 'The Towers', 'University Village',
  'Scholar Suites', 'Northern Residence', 'Lakeside Living', 'Cedar Hall', 'Oak Residence',
  'The Quarters', 'Campus View', 'Metro Suites', 'City Living', 'Pioneer House'
];

const CAMPUS_SIDES = ['north', 'south', 'east', 'west', 'center'];
const PET_POLICIES = ['No pets', 'Cats only', 'Cats allowed', 'Small pets', 'Pets welcome'];
const BEDROOMS = ['Studio', 'Studio - 1BR', '1BR', '1BR - 2BR', 'Studio - 2BR', '2BR - 3BR', '1BR - 3BR', 'Studio - 4BR'];
const US_STREETS = ['University Ave', 'College Ave', 'Main St', 'Oak St', 'Campus Dr', 'Student Ln', 'Academic Blvd', 'Park Ave', 'Elm St', 'Cedar Rd'];
const UK_STREETS = ['High Street', 'Market Street', 'Station Road', 'Church Lane', 'Oxford Road', 'Cambridge Road', 'University Road', 'College Street', 'Kings Road', 'Queens Way'];
const CA_STREETS = ['University Ave', 'College Street', 'King Street', 'Queen Street', 'Main Street', 'Campus Drive', 'Maple Road', 'Bay Street', 'Dundas St', 'Yonge St'];

// Price tiers
const EXPENSIVE_US = ['New York', 'San Francisco', 'Los Angeles', 'Boston', 'Washington', 'Seattle', 'San Jose', 'Palo Alto', 'Cambridge', 'Santa Monica', 'Berkeley'];
const MODERATE_US = ['Chicago', 'Philadelphia', 'San Diego', 'Denver', 'Austin', 'Miami', 'Atlanta', 'Portland', 'Minneapolis', 'Dallas', 'Houston'];
const EXPENSIVE_UK = ['London'];
const MODERATE_UK = ['Manchester', 'Edinburgh', 'Bristol', 'Birmingham', 'Leeds', 'Glasgow', 'Liverpool', 'Oxford', 'Cambridge'];
const EXPENSIVE_CA = ['Toronto', 'Vancouver'];
const MODERATE_CA = ['Calgary', 'Ottawa', 'Montreal', 'Edmonton'];

function random(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function randomFloat(min, max, decimals = 4) { return parseFloat((Math.random() * (max - min) + min).toFixed(decimals)); }

function getPriceRange(country, city) {
  if (country === 'US') {
    if (EXPENSIVE_US.some(c => city.includes(c))) return { min: 1800, max: 4500 };
    if (MODERATE_US.some(c => city.includes(c))) return { min: 1200, max: 2800 };
    return { min: 700, max: 1800 };
  } else if (country === 'UK') {
    if (EXPENSIVE_UK.some(c => city.includes(c))) return { min: 1200, max: 2800 };
    if (MODERATE_UK.some(c => city.includes(c))) return { min: 600, max: 1400 };
    return { min: 400, max: 900 };
  } else {
    if (EXPENSIVE_CA.some(c => city.includes(c))) return { min: 1600, max: 3500 };
    if (MODERATE_CA.some(c => city.includes(c))) return { min: 1000, max: 2200 };
    return { min: 600, max: 1400 };
  }
}

function generateCoords(lat, lng, index) {
  const angle = (index / 10) * 2 * Math.PI + randomFloat(-0.3, 0.3);
  const distance = randomFloat(0.005, 0.025);
  return { lat: lat + distance * Math.cos(angle), lng: lng + distance * Math.sin(angle) };
}

function generateApartments(unis, country) {
  const names = country === 'US' ? US_NAMES : country === 'UK' ? UK_NAMES : CA_NAMES;
  const streets = country === 'US' ? US_STREETS : country === 'UK' ? UK_STREETS : CA_STREETS;
  const apartments = [];

  for (const u of unis) {
    const cleanId = u.id.toLowerCase().replace(/[^a-z0-9]/g, '-').substring(0, 25);
    const priceRange = getPriceRange(country, u.city);
    const uniRef = u.short_name || u.name;

    for (let i = 0; i < 10; i++) {
      const name = names[i % names.length];
      const coords = generateCoords(u.latitude, u.longitude, i);
      const streetNum = random(100, 9999);
      const street = streets[random(0, streets.length - 1)];
      const address = u.state ? `${streetNum} ${street}, ${u.city}, ${u.state}` : `${streetNum} ${street}, ${u.city}`;

      const priceMin = Math.max(400, priceRange.min + random(-200, 200));
      const priceMax = Math.max(priceMin + 400, priceRange.max + random(-300, 300));
      const walkingMin = random(3, 25);

      apartments.push({
        id: `${cleanId}-${i + 1}`,
        name,
        address,
        university: uniRef,
        bedrooms: BEDROOMS[random(0, BEDROOMS.length - 1)],
        bathrooms: random(1, 2) === 1 ? '1' : '1-2',
        price_min: priceMin,
        price_max: priceMax,
        sqft_min: random(350, 600),
        sqft_max: random(700, 1200),
        walking_minutes: walkingMin,
        biking_minutes: Math.max(1, Math.floor(walkingMin / 3)),
        transit_minutes: walkingMin + random(2, 8),
        driving_minutes: Math.max(2, Math.floor(walkingMin / 4)),
        rating: randomFloat(3.8, 4.9, 1),
        review_count: random(50, 400),
        pet_policy: PET_POLICIES[random(0, PET_POLICIES.length - 1)],
        campus_side: CAMPUS_SIDES[i % 5],
        furnished: Math.random() > 0.5,
        gym: Math.random() > 0.4,
        parking: Math.random() > 0.3,
        latitude: parseFloat(coords.lat.toFixed(6)),
        longitude: parseFloat(coords.lng.toFixed(6)),
      });
    }
  }
  return apartments;
}

// University data - extracted from the codebase
const US_UNIVERSITIES = [
  { id: 'uc-berkeley', short_name: 'UC Berkeley', city: 'Berkeley', state: 'CA', latitude: 37.8719, longitude: -122.2585 },
  { id: 'ucla', short_name: 'UCLA', city: 'Los Angeles', state: 'CA', latitude: 34.0689, longitude: -118.4452 },
  { id: 'ucsd', short_name: 'UC San Diego', city: 'La Jolla', state: 'CA', latitude: 32.8801, longitude: -117.2340 },
  { id: 'uci', short_name: 'UC Irvine', city: 'Irvine', state: 'CA', latitude: 33.6405, longitude: -117.8443 },
  { id: 'ucsb', short_name: 'UC Santa Barbara', city: 'Santa Barbara', state: 'CA', latitude: 34.4140, longitude: -119.8489 },
  { id: 'ucdavis', short_name: 'UC Davis', city: 'Davis', state: 'CA', latitude: 38.5382, longitude: -121.7617 },
  { id: 'ucsc', short_name: 'UC Santa Cruz', city: 'Santa Cruz', state: 'CA', latitude: 36.9916, longitude: -122.0583 },
  { id: 'ucr', short_name: 'UC Riverside', city: 'Riverside', state: 'CA', latitude: 33.9737, longitude: -117.3281 },
  { id: 'ucmerced', short_name: 'UC Merced', city: 'Merced', state: 'CA', latitude: 37.3660, longitude: -120.4248 },
  { id: 'stanford', short_name: 'Stanford', city: 'Stanford', state: 'CA', latitude: 37.4275, longitude: -122.1697 },
  { id: 'usc', short_name: 'USC', city: 'Los Angeles', state: 'CA', latitude: 34.0224, longitude: -118.2851 },
  { id: 'caltech', short_name: 'Caltech', city: 'Pasadena', state: 'CA', latitude: 34.1377, longitude: -118.1253 },
  { id: 'csu-fullerton', short_name: 'CSU Fullerton', city: 'Fullerton', state: 'CA', latitude: 33.8829, longitude: -117.8869 },
  { id: 'csu-long-beach', short_name: 'CSU Long Beach', city: 'Long Beach', state: 'CA', latitude: 33.7838, longitude: -118.1141 },
  { id: 'san-diego-state', short_name: 'San Diego State', city: 'San Diego', state: 'CA', latitude: 32.7757, longitude: -117.0719 },
  { id: 'san-jose-state', short_name: 'San Jose State', city: 'San Jose', state: 'CA', latitude: 37.3352, longitude: -121.8811 },
  { id: 'cal-poly-slo', short_name: 'Cal Poly SLO', city: 'San Luis Obispo', state: 'CA', latitude: 35.3050, longitude: -120.6625 },
  { id: 'sf-state', short_name: 'SF State', city: 'San Francisco', state: 'CA', latitude: 37.7241, longitude: -122.4783 },
  { id: 'harvard', short_name: 'Harvard', city: 'Cambridge', state: 'MA', latitude: 42.3770, longitude: -71.1167 },
  { id: 'mit', short_name: 'MIT', city: 'Cambridge', state: 'MA', latitude: 42.3601, longitude: -71.0942 },
  { id: 'boston-u', short_name: 'Boston U', city: 'Boston', state: 'MA', latitude: 42.3505, longitude: -71.1054 },
  { id: 'northeastern', short_name: 'Northeastern', city: 'Boston', state: 'MA', latitude: 42.3398, longitude: -71.0892 },
  { id: 'yale', short_name: 'Yale', city: 'New Haven', state: 'CT', latitude: 41.3163, longitude: -72.9223 },
  { id: 'princeton', short_name: 'Princeton', city: 'Princeton', state: 'NJ', latitude: 40.3431, longitude: -74.6551 },
  { id: 'columbia', short_name: 'Columbia', city: 'New York', state: 'NY', latitude: 40.8075, longitude: -73.9626 },
  { id: 'nyu', short_name: 'NYU', city: 'New York', state: 'NY', latitude: 40.7295, longitude: -73.9965 },
  { id: 'cornell', short_name: 'Cornell', city: 'Ithaca', state: 'NY', latitude: 42.4534, longitude: -76.4735 },
  { id: 'upenn', short_name: 'Penn', city: 'Philadelphia', state: 'PA', latitude: 39.9522, longitude: -75.1932 },
  { id: 'carnegie-mellon', short_name: 'CMU', city: 'Pittsburgh', state: 'PA', latitude: 40.4433, longitude: -79.9436 },
  { id: 'uiuc', short_name: 'UIUC', city: 'Champaign', state: 'IL', latitude: 40.1020, longitude: -88.2272 },
  { id: 'northwestern', short_name: 'Northwestern', city: 'Evanston', state: 'IL', latitude: 42.0565, longitude: -87.6753 },
  { id: 'uchicago', short_name: 'UChicago', city: 'Chicago', state: 'IL', latitude: 41.7886, longitude: -87.5987 },
  { id: 'umich', short_name: 'Michigan', city: 'Ann Arbor', state: 'MI', latitude: 42.2780, longitude: -83.7382 },
  { id: 'ohio-state', short_name: 'Ohio State', city: 'Columbus', state: 'OH', latitude: 40.0067, longitude: -83.0305 },
  { id: 'purdue', short_name: 'Purdue', city: 'West Lafayette', state: 'IN', latitude: 40.4237, longitude: -86.9212 },
  { id: 'indiana', short_name: 'Indiana', city: 'Bloomington', state: 'IN', latitude: 39.1682, longitude: -86.5186 },
  { id: 'uw-madison', short_name: 'Wisconsin', city: 'Madison', state: 'WI', latitude: 43.0766, longitude: -89.4125 },
  { id: 'umn', short_name: 'Minnesota', city: 'Minneapolis', state: 'MN', latitude: 44.9740, longitude: -93.2277 },
  { id: 'ut-austin', short_name: 'UT Austin', city: 'Austin', state: 'TX', latitude: 30.2849, longitude: -97.7341 },
  { id: 'texas-am', short_name: 'Texas A&M', city: 'College Station', state: 'TX', latitude: 30.6187, longitude: -96.3365 },
  { id: 'rice', short_name: 'Rice', city: 'Houston', state: 'TX', latitude: 29.7174, longitude: -95.4028 },
  { id: 'georgia-tech', short_name: 'Georgia Tech', city: 'Atlanta', state: 'GA', latitude: 33.7756, longitude: -84.3963 },
  { id: 'emory', short_name: 'Emory', city: 'Atlanta', state: 'GA', latitude: 33.7925, longitude: -84.3242 },
  { id: 'uf', short_name: 'Florida', city: 'Gainesville', state: 'FL', latitude: 29.6436, longitude: -82.3549 },
  { id: 'miami', short_name: 'Miami', city: 'Coral Gables', state: 'FL', latitude: 25.7215, longitude: -80.2792 },
  { id: 'duke', short_name: 'Duke', city: 'Durham', state: 'NC', latitude: 36.0014, longitude: -78.9382 },
  { id: 'unc', short_name: 'UNC', city: 'Chapel Hill', state: 'NC', latitude: 35.9049, longitude: -79.0469 },
  { id: 'uva', short_name: 'UVA', city: 'Charlottesville', state: 'VA', latitude: 38.0336, longitude: -78.5080 },
  { id: 'georgetown', short_name: 'Georgetown', city: 'Washington', state: 'DC', latitude: 38.9076, longitude: -77.0723 },
  { id: 'jhu', short_name: 'Johns Hopkins', city: 'Baltimore', state: 'MD', latitude: 39.3299, longitude: -76.6205 },
  { id: 'uw-seattle', short_name: 'UW', city: 'Seattle', state: 'WA', latitude: 47.6553, longitude: -122.3035 },
  { id: 'oregon', short_name: 'Oregon', city: 'Eugene', state: 'OR', latitude: 44.0448, longitude: -123.0726 },
  { id: 'cu-boulder', short_name: 'Colorado', city: 'Boulder', state: 'CO', latitude: 40.0076, longitude: -105.2659 },
  { id: 'asu', short_name: 'ASU', city: 'Tempe', state: 'AZ', latitude: 33.4242, longitude: -111.9281 },
  { id: 'arizona', short_name: 'Arizona', city: 'Tucson', state: 'AZ', latitude: 32.2319, longitude: -110.9501 },
  // More US universities
  { id: 'brown', short_name: 'Brown', city: 'Providence', state: 'RI', latitude: 41.8268, longitude: -71.4025 },
  { id: 'dartmouth', short_name: 'Dartmouth', city: 'Hanover', state: 'NH', latitude: 43.7044, longitude: -72.2887 },
  { id: 'notre-dame', short_name: 'Notre Dame', city: 'South Bend', state: 'IN', latitude: 41.7056, longitude: -86.2353 },
  { id: 'vanderbilt', short_name: 'Vanderbilt', city: 'Nashville', state: 'TN', latitude: 36.1447, longitude: -86.8027 },
  { id: 'wustl', short_name: 'WashU', city: 'St. Louis', state: 'MO', latitude: 38.6488, longitude: -90.3108 },
  { id: 'penn-state', short_name: 'Penn State', city: 'State College', state: 'PA', latitude: 40.7982, longitude: -77.8599 },
  { id: 'rutgers', short_name: 'Rutgers', city: 'New Brunswick', state: 'NJ', latitude: 40.5008, longitude: -74.4474 },
  { id: 'umd', short_name: 'Maryland', city: 'College Park', state: 'MD', latitude: 38.9869, longitude: -76.9426 },
  { id: 'nc-state', short_name: 'NC State', city: 'Raleigh', state: 'NC', latitude: 35.7872, longitude: -78.6705 },
  { id: 'vt', short_name: 'Virginia Tech', city: 'Blacksburg', state: 'VA', latitude: 37.2284, longitude: -80.4234 },
  { id: 'iowa', short_name: 'Iowa', city: 'Iowa City', state: 'IA', latitude: 41.6611, longitude: -91.5302 },
  { id: 'nebraska', short_name: 'Nebraska', city: 'Lincoln', state: 'NE', latitude: 40.8202, longitude: -96.7005 },
  { id: 'kansas', short_name: 'Kansas', city: 'Lawrence', state: 'KS', latitude: 38.9543, longitude: -95.2558 },
  { id: 'oklahoma', short_name: 'Oklahoma', city: 'Norman', state: 'OK', latitude: 35.2058, longitude: -97.4457 },
  { id: 'msu', short_name: 'Michigan State', city: 'East Lansing', state: 'MI', latitude: 42.7018, longitude: -84.4822 },
  { id: 'uconn', short_name: 'UConn', city: 'Storrs', state: 'CT', latitude: 41.8084, longitude: -72.2495 },
  { id: 'syracuse', short_name: 'Syracuse', city: 'Syracuse', state: 'NY', latitude: 43.0392, longitude: -76.1351 },
  { id: 'pitt', short_name: 'Pitt', city: 'Pittsburgh', state: 'PA', latitude: 40.4444, longitude: -79.9608 },
  { id: 'case-western', short_name: 'Case Western', city: 'Cleveland', state: 'OH', latitude: 41.5045, longitude: -81.6078 },
  { id: 'tufts', short_name: 'Tufts', city: 'Medford', state: 'MA', latitude: 42.4085, longitude: -71.1183 },
  { id: 'brandeis', short_name: 'Brandeis', city: 'Waltham', state: 'MA', latitude: 42.3659, longitude: -71.2586 },
  { id: 'boston-college', short_name: 'Boston College', city: 'Chestnut Hill', state: 'MA', latitude: 42.3355, longitude: -71.1685 },
  { id: 'rochester', short_name: 'Rochester', city: 'Rochester', state: 'NY', latitude: 43.1285, longitude: -77.6296 },
  { id: 'stony-brook', short_name: 'Stony Brook', city: 'Stony Brook', state: 'NY', latitude: 40.9126, longitude: -73.1234 },
  { id: 'buffalo', short_name: 'Buffalo', city: 'Buffalo', state: 'NY', latitude: 43.0008, longitude: -78.7890 },
  { id: 'temple', short_name: 'Temple', city: 'Philadelphia', state: 'PA', latitude: 39.9812, longitude: -75.1552 },
  { id: 'drexel', short_name: 'Drexel', city: 'Philadelphia', state: 'PA', latitude: 39.9566, longitude: -75.1899 },
  { id: 'depaul', short_name: 'DePaul', city: 'Chicago', state: 'IL', latitude: 41.9242, longitude: -87.6554 },
  { id: 'uic', short_name: 'UIC', city: 'Chicago', state: 'IL', latitude: 41.8716, longitude: -87.6501 },
  { id: 'usf', short_name: 'USF', city: 'Tampa', state: 'FL', latitude: 28.0587, longitude: -82.4139 },
  { id: 'fsu', short_name: 'FSU', city: 'Tallahassee', state: 'FL', latitude: 30.4419, longitude: -84.2985 },
  { id: 'fiu', short_name: 'FIU', city: 'Miami', state: 'FL', latitude: 25.7563, longitude: -80.3746 },
  { id: 'ucf', short_name: 'UCF', city: 'Orlando', state: 'FL', latitude: 28.6024, longitude: -81.2001 },
  { id: 'auburn', short_name: 'Auburn', city: 'Auburn', state: 'AL', latitude: 32.6010, longitude: -85.4858 },
  { id: 'alabama', short_name: 'Alabama', city: 'Tuscaloosa', state: 'AL', latitude: 33.2140, longitude: -87.5391 },
  { id: 'clemson', short_name: 'Clemson', city: 'Clemson', state: 'SC', latitude: 34.6834, longitude: -82.8374 },
  { id: 'south-carolina', short_name: 'South Carolina', city: 'Columbia', state: 'SC', latitude: 33.9940, longitude: -81.0281 },
  { id: 'tennessee', short_name: 'Tennessee', city: 'Knoxville', state: 'TN', latitude: 35.9544, longitude: -83.9295 },
  { id: 'kentucky', short_name: 'Kentucky', city: 'Lexington', state: 'KY', latitude: 38.0380, longitude: -84.5037 },
  { id: 'lsu', short_name: 'LSU', city: 'Baton Rouge', state: 'LA', latitude: 30.4133, longitude: -91.1800 },
  { id: 'tulane', short_name: 'Tulane', city: 'New Orleans', state: 'LA', latitude: 29.9395, longitude: -90.1205 },
  { id: 'arkansas', short_name: 'Arkansas', city: 'Fayetteville', state: 'AR', latitude: 36.0679, longitude: -94.1748 },
  { id: 'ole-miss', short_name: 'Ole Miss', city: 'Oxford', state: 'MS', latitude: 34.3647, longitude: -89.5381 },
  { id: 'ut-dallas', short_name: 'UT Dallas', city: 'Richardson', state: 'TX', latitude: 32.9858, longitude: -96.7501 },
  { id: 'uh', short_name: 'Houston', city: 'Houston', state: 'TX', latitude: 29.7199, longitude: -95.3422 },
  { id: 'smu', short_name: 'SMU', city: 'Dallas', state: 'TX', latitude: 32.8412, longitude: -96.7854 },
  { id: 'tcu', short_name: 'TCU', city: 'Fort Worth', state: 'TX', latitude: 32.7098, longitude: -97.3628 },
  { id: 'baylor', short_name: 'Baylor', city: 'Waco', state: 'TX', latitude: 31.5489, longitude: -97.1131 },
  { id: 'utah', short_name: 'Utah', city: 'Salt Lake City', state: 'UT', latitude: 40.7649, longitude: -111.8421 },
  { id: 'byu', short_name: 'BYU', city: 'Provo', state: 'UT', latitude: 40.2518, longitude: -111.6493 },
  { id: 'nevada', short_name: 'Nevada', city: 'Reno', state: 'NV', latitude: 39.5438, longitude: -119.8157 },
  { id: 'unlv', short_name: 'UNLV', city: 'Las Vegas', state: 'NV', latitude: 36.1087, longitude: -115.1397 },
  { id: 'new-mexico', short_name: 'New Mexico', city: 'Albuquerque', state: 'NM', latitude: 35.0844, longitude: -106.6199 },
  { id: 'hawaii', short_name: 'Hawaii', city: 'Honolulu', state: 'HI', latitude: 21.2969, longitude: -157.8171 },
];

const UK_UNIVERSITIES = [
  { id: 'imperial', short_name: 'Imperial', city: 'London', latitude: 51.4988, longitude: -0.1749 },
  { id: 'ucl', short_name: 'UCL', city: 'London', latitude: 51.5246, longitude: -0.1340 },
  { id: 'lse', short_name: 'LSE', city: 'London', latitude: 51.5144, longitude: -0.1165 },
  { id: 'kcl', short_name: 'Kings College', city: 'London', latitude: 51.5115, longitude: -0.1160 },
  { id: 'qmul', short_name: 'Queen Mary', city: 'London', latitude: 51.5235, longitude: -0.0405 },
  { id: 'oxford', short_name: 'Oxford', city: 'Oxford', latitude: 51.7548, longitude: -1.2544 },
  { id: 'cambridge', short_name: 'Cambridge', city: 'Cambridge', latitude: 52.2043, longitude: 0.1149 },
  { id: 'manchester', short_name: 'Manchester', city: 'Manchester', latitude: 53.4668, longitude: -2.2339 },
  { id: 'leeds', short_name: 'Leeds', city: 'Leeds', latitude: 53.8067, longitude: -1.5550 },
  { id: 'sheffield', short_name: 'Sheffield', city: 'Sheffield', latitude: 53.3811, longitude: -1.4855 },
  { id: 'newcastle', short_name: 'Newcastle', city: 'Newcastle', latitude: 54.9783, longitude: -1.6178 },
  { id: 'liverpool', short_name: 'Liverpool', city: 'Liverpool', latitude: 53.4084, longitude: -2.9673 },
  { id: 'edinburgh', short_name: 'Edinburgh', city: 'Edinburgh', latitude: 55.9445, longitude: -3.1892 },
  { id: 'glasgow', short_name: 'Glasgow', city: 'Glasgow', latitude: 55.8721, longitude: -4.2882 },
  { id: 'bristol', short_name: 'Bristol', city: 'Bristol', latitude: 51.4584, longitude: -2.6030 },
  { id: 'birmingham', short_name: 'Birmingham', city: 'Birmingham', latitude: 52.4508, longitude: -1.9305 },
  { id: 'warwick', short_name: 'Warwick', city: 'Coventry', latitude: 52.3838, longitude: -1.5618 },
  { id: 'nottingham', short_name: 'Nottingham', city: 'Nottingham', latitude: 52.9388, longitude: -1.1963 },
  { id: 'durham', short_name: 'Durham', city: 'Durham', latitude: 54.7684, longitude: -1.5719 },
  { id: 'exeter', short_name: 'Exeter', city: 'Exeter', latitude: 50.7356, longitude: -3.5345 },
  { id: 'southampton', short_name: 'Southampton', city: 'Southampton', latitude: 50.9346, longitude: -1.3957 },
  { id: 'york', short_name: 'York', city: 'York', latitude: 53.9465, longitude: -1.0534 },
  { id: 'bath', short_name: 'Bath', city: 'Bath', latitude: 51.3806, longitude: -2.3269 },
  { id: 'lancaster', short_name: 'Lancaster', city: 'Lancaster', latitude: 54.0104, longitude: -2.7850 },
  { id: 'leicester', short_name: 'Leicester', city: 'Leicester', latitude: 52.6219, longitude: -1.1254 },
  { id: 'surrey', short_name: 'Surrey', city: 'Guildford', latitude: 51.2432, longitude: -0.5871 },
  { id: 'reading', short_name: 'Reading', city: 'Reading', latitude: 51.4413, longitude: -0.9456 },
  { id: 'cardiff', short_name: 'Cardiff', city: 'Cardiff', latitude: 51.4875, longitude: -3.1783 },
  { id: 'belfast', short_name: 'Queens Belfast', city: 'Belfast', latitude: 54.5853, longitude: -5.9340 },
  { id: 'st-andrews', short_name: 'St Andrews', city: 'St Andrews', latitude: 56.3402, longitude: -2.7950 },
  { id: 'aberdeen', short_name: 'Aberdeen', city: 'Aberdeen', latitude: 57.1645, longitude: -2.1018 },
  { id: 'strathclyde', short_name: 'Strathclyde', city: 'Glasgow', latitude: 55.8615, longitude: -4.2427 },
  { id: 'dundee', short_name: 'Dundee', city: 'Dundee', latitude: 56.4570, longitude: -2.9783 },
  { id: 'heriot-watt', short_name: 'Heriot-Watt', city: 'Edinburgh', latitude: 55.9097, longitude: -3.3222 },
  { id: 'swansea', short_name: 'Swansea', city: 'Swansea', latitude: 51.6101, longitude: -3.9790 },
  { id: 'brunel', short_name: 'Brunel', city: 'London', latitude: 51.5323, longitude: -0.4726 },
  { id: 'essex', short_name: 'Essex', city: 'Colchester', latitude: 51.8781, longitude: 1.0836 },
  { id: 'kent', short_name: 'Kent', city: 'Canterbury', latitude: 51.2996, longitude: 1.0692 },
  { id: 'sussex', short_name: 'Sussex', city: 'Brighton', latitude: 50.8670, longitude: -0.0892 },
  { id: 'uea', short_name: 'UEA', city: 'Norwich', latitude: 52.6214, longitude: 1.2387 },
];

const CA_UNIVERSITIES = [
  { id: 'toronto', short_name: 'Toronto', city: 'Toronto', state: 'ON', latitude: 43.6629, longitude: -79.3957 },
  { id: 'ubc', short_name: 'UBC', city: 'Vancouver', state: 'BC', latitude: 49.2606, longitude: -123.2460 },
  { id: 'mcgill', short_name: 'McGill', city: 'Montreal', state: 'QC', latitude: 45.5048, longitude: -73.5772 },
  { id: 'waterloo', short_name: 'Waterloo', city: 'Waterloo', state: 'ON', latitude: 43.4723, longitude: -80.5449 },
  { id: 'mcmaster', short_name: 'McMaster', city: 'Hamilton', state: 'ON', latitude: 43.2609, longitude: -79.9192 },
  { id: 'queens', short_name: 'Queens', city: 'Kingston', state: 'ON', latitude: 44.2253, longitude: -76.4951 },
  { id: 'western', short_name: 'Western', city: 'London', state: 'ON', latitude: 43.0096, longitude: -81.2737 },
  { id: 'ottawa', short_name: 'Ottawa', city: 'Ottawa', state: 'ON', latitude: 45.4231, longitude: -75.6831 },
  { id: 'calgary', short_name: 'Calgary', city: 'Calgary', state: 'AB', latitude: 51.0776, longitude: -114.1379 },
  { id: 'alberta', short_name: 'Alberta', city: 'Edmonton', state: 'AB', latitude: 53.5232, longitude: -113.5263 },
  { id: 'sfu', short_name: 'SFU', city: 'Burnaby', state: 'BC', latitude: 49.2768, longitude: -122.9180 },
  { id: 'victoria', short_name: 'UVic', city: 'Victoria', state: 'BC', latitude: 48.4634, longitude: -123.3117 },
  { id: 'montreal', short_name: 'Montreal', city: 'Montreal', state: 'QC', latitude: 45.5017, longitude: -73.6153 },
  { id: 'laval', short_name: 'Laval', city: 'Quebec City', state: 'QC', latitude: 46.7831, longitude: -71.2747 },
  { id: 'dalhousie', short_name: 'Dalhousie', city: 'Halifax', state: 'NS', latitude: 44.6373, longitude: -63.5912 },
  { id: 'manitoba', short_name: 'Manitoba', city: 'Winnipeg', state: 'MB', latitude: 49.8075, longitude: -97.1365 },
  { id: 'saskatchewan', short_name: 'Saskatchewan', city: 'Saskatoon', state: 'SK', latitude: 52.1332, longitude: -106.6281 },
  { id: 'york', short_name: 'York', city: 'Toronto', state: 'ON', latitude: 43.7735, longitude: -79.5019 },
  { id: 'carleton', short_name: 'Carleton', city: 'Ottawa', state: 'ON', latitude: 45.3876, longitude: -75.6960 },
  { id: 'guelph', short_name: 'Guelph', city: 'Guelph', state: 'ON', latitude: 43.5327, longitude: -80.2262 },
  { id: 'ryerson', short_name: 'TMU', city: 'Toronto', state: 'ON', latitude: 43.6577, longitude: -79.3788 },
  { id: 'concordia', short_name: 'Concordia', city: 'Montreal', state: 'QC', latitude: 45.4972, longitude: -73.5787 },
  { id: 'windsor', short_name: 'Windsor', city: 'Windsor', state: 'ON', latitude: 42.3052, longitude: -83.0678 },
  { id: 'regina', short_name: 'Regina', city: 'Regina', state: 'SK', latitude: 50.4179, longitude: -104.5857 },
  { id: 'memorial', short_name: 'Memorial', city: 'St. Johns', state: 'NL', latitude: 47.5733, longitude: -52.7326 },
  { id: 'new-brunswick', short_name: 'UNB', city: 'Fredericton', state: 'NB', latitude: 45.9451, longitude: -66.6406 },
  { id: 'brock', short_name: 'Brock', city: 'St. Catharines', state: 'ON', latitude: 43.1176, longitude: -79.2477 },
  { id: 'laurier', short_name: 'Laurier', city: 'Waterloo', state: 'ON', latitude: 43.4738, longitude: -80.5273 },
  { id: 'lakehead', short_name: 'Lakehead', city: 'Thunder Bay', state: 'ON', latitude: 48.4219, longitude: -89.2590 },
  { id: 'trent', short_name: 'Trent', city: 'Peterborough', state: 'ON', latitude: 44.3602, longitude: -78.2891 },
];

// Generate all apartments
const usApartments = generateApartments(US_UNIVERSITIES, 'US');
const ukApartments = generateApartments(UK_UNIVERSITIES, 'UK');
const caApartments = generateApartments(CA_UNIVERSITIES, 'CA');

// Output the file
console.log(`/**
 * COMPREHENSIVE APARTMENTS DATA
 * Auto-generated: ${new Date().toISOString()}
 * US Universities: ${US_UNIVERSITIES.length} (${usApartments.length} apartments)
 * UK Universities: ${UK_UNIVERSITIES.length} (${ukApartments.length} apartments)
 * CA Universities: ${CA_UNIVERSITIES.length} (${caApartments.length} apartments)
 * Total: ${usApartments.length + ukApartments.length + caApartments.length} apartments
 */

import { CampusSide } from '../universityData';

export interface ApartmentData {
  id: string;
  name: string;
  address: string;
  university: string;
  bedrooms: string;
  bathrooms: string;
  price_min: number;
  price_max: number;
  shared_price_min?: number;
  shared_price_max?: number;
  sqft_min: number;
  sqft_max: number;
  walking_minutes: number;
  biking_minutes: number;
  transit_minutes: number;
  driving_minutes: number;
  rating: number;
  review_count: number;
  pet_policy: string;
  campus_side: CampusSide;
  furnished: boolean;
  gym: boolean;
  parking: boolean;
  latitude: number;
  longitude: number;
  images?: string[];
  contact_website?: string;
}

// ============================================================================
// US APARTMENTS (${usApartments.length})
// ============================================================================
export const US_APARTMENTS: ApartmentData[] = ${JSON.stringify(usApartments, null, 2)};

// ============================================================================
// UK APARTMENTS (${ukApartments.length})
// ============================================================================
export const UK_APARTMENTS: ApartmentData[] = ${JSON.stringify(ukApartments, null, 2)};

// ============================================================================
// CANADA APARTMENTS (${caApartments.length})
// ============================================================================
export const CA_APARTMENTS: ApartmentData[] = ${JSON.stringify(caApartments, null, 2)};

// ============================================================================
// ALL APARTMENTS
// ============================================================================
export const ALL_APARTMENTS: ApartmentData[] = [
  ...US_APARTMENTS,
  ...UK_APARTMENTS,
  ...CA_APARTMENTS,
];

/**
 * Get apartments for a specific university
 */
export function getApartmentsForUniversity(university: string): ApartmentData[] {
  const normalizedSearch = university.toLowerCase().trim();
  return ALL_APARTMENTS.filter(apt => {
    const aptUni = apt.university.toLowerCase();
    return aptUni === normalizedSearch ||
           aptUni.includes(normalizedSearch) ||
           normalizedSearch.includes(aptUni);
  });
}
`);
