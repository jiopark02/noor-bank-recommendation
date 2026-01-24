// ============================================================================
// COMPREHENSIVE US UNIVERSITIES DATABASE
// Main index file combining all university data
// ============================================================================

import { University, InstitutionType, CampusType, SearchResult } from './types';
import { BIG_TEN } from './stateUniversities';
import { UT_SYSTEM, TAMU_SYSTEM, TEXAS_OTHER, ALL_TEXAS } from './texasUniversities';
import { CALIFORNIA_CC, OTHER_CC, ALL_COMMUNITY_COLLEGES } from './communityColleges';
import { SUNY_UNIVERSITIES, CUNY_UNIVERSITIES, NY_UNIVERSITIES } from './newYorkUniversities';
import {
  FLORIDA_SUS,
  GEORGIA_USG,
  UNC_SYSTEM,
  VIRGINIA_UNIVERSITIES,
  MASSACHUSETTS_UNIVERSITIES,
  ARIZONA_UNIVERSITIES,
  COLORADO_UNIVERSITIES,
  WASHINGTON_ADDITIONAL,
  ALL_ADDITIONAL_STATE_UNIVERSITIES
} from './additionalStateUniversities';

// Re-export types
export * from './types';

// ============================================================================
// UC SYSTEM (10 Campuses)
// ============================================================================
const UC_SYSTEM: University[] = [
  { id: 'uc-berkeley', name: 'University of California, Berkeley', short_name: 'UC Berkeley', system_name: 'University of California', city: 'Berkeley', state: 'CA', zip_code: '94720', latitude: 37.8719, longitude: -122.2585, type: 'university', campus_type: 'main', enrollment: 45057, international_students: 7850, is_public: true, primary_color: '#003262', secondary_color: '#FDB515', website: 'https://www.berkeley.edu', aliases: ['Cal', 'Berkeley', 'UCB'] },
  { id: 'ucla', name: 'University of California, Los Angeles', short_name: 'UCLA', system_name: 'University of California', city: 'Los Angeles', state: 'CA', zip_code: '90095', latitude: 34.0689, longitude: -118.4452, type: 'university', campus_type: 'main', enrollment: 46116, international_students: 6100, is_public: true, primary_color: '#2774AE', secondary_color: '#FFD100', website: 'https://www.ucla.edu', aliases: ['Bruins'] },
  { id: 'ucsd', name: 'University of California, San Diego', short_name: 'UC San Diego', system_name: 'University of California', city: 'La Jolla', state: 'CA', zip_code: '92093', latitude: 32.8801, longitude: -117.2340, type: 'university', campus_type: 'main', enrollment: 42006, international_students: 9200, is_public: true, primary_color: '#182B49', secondary_color: '#C69214', website: 'https://www.ucsd.edu', aliases: ['UCSD', 'Tritons'] },
  { id: 'uci', name: 'University of California, Irvine', short_name: 'UC Irvine', system_name: 'University of California', city: 'Irvine', state: 'CA', zip_code: '92697', latitude: 33.6405, longitude: -117.8443, type: 'university', campus_type: 'main', enrollment: 36908, international_students: 7300, is_public: true, primary_color: '#0064A4', secondary_color: '#FFD200', website: 'https://www.uci.edu', aliases: ['UCI', 'Anteaters'] },
  { id: 'ucsb', name: 'University of California, Santa Barbara', short_name: 'UC Santa Barbara', system_name: 'University of California', city: 'Santa Barbara', state: 'CA', zip_code: '93106', latitude: 34.4140, longitude: -119.8489, type: 'university', campus_type: 'main', enrollment: 26314, international_students: 3100, is_public: true, primary_color: '#003660', secondary_color: '#FEBC11', website: 'https://www.ucsb.edu', aliases: ['UCSB', 'Gauchos'] },
  { id: 'ucdavis', name: 'University of California, Davis', short_name: 'UC Davis', system_name: 'University of California', city: 'Davis', state: 'CA', zip_code: '95616', latitude: 38.5382, longitude: -121.7617, type: 'university', campus_type: 'main', enrollment: 40031, international_students: 6200, is_public: true, primary_color: '#002855', secondary_color: '#B3A369', website: 'https://www.ucdavis.edu', aliases: ['UCD', 'Aggies'] },
  { id: 'ucsc', name: 'University of California, Santa Cruz', short_name: 'UC Santa Cruz', system_name: 'University of California', city: 'Santa Cruz', state: 'CA', zip_code: '95064', latitude: 36.9916, longitude: -122.0583, type: 'university', campus_type: 'main', enrollment: 19478, international_students: 1850, is_public: true, primary_color: '#003C6C', secondary_color: '#FDC700', website: 'https://www.ucsc.edu', aliases: ['UCSC', 'Banana Slugs'] },
  { id: 'ucr', name: 'University of California, Riverside', short_name: 'UC Riverside', system_name: 'University of California', city: 'Riverside', state: 'CA', zip_code: '92521', latitude: 33.9737, longitude: -117.3281, type: 'university', campus_type: 'main', enrollment: 26809, international_students: 2400, is_public: true, primary_color: '#003DA5', secondary_color: '#FFB81C', website: 'https://www.ucr.edu', aliases: ['UCR', 'Highlanders'] },
  { id: 'ucmerced', name: 'University of California, Merced', short_name: 'UC Merced', system_name: 'University of California', city: 'Merced', state: 'CA', zip_code: '95343', latitude: 37.3660, longitude: -120.4248, type: 'university', campus_type: 'main', enrollment: 9069, international_students: 450, is_public: true, primary_color: '#002856', secondary_color: '#F2A900', website: 'https://www.ucmerced.edu', aliases: ['UCM', 'Bobcats'] },
  { id: 'ucsf', name: 'University of California, San Francisco', short_name: 'UCSF', system_name: 'University of California', city: 'San Francisco', state: 'CA', zip_code: '94143', latitude: 37.7631, longitude: -122.4586, type: 'university', campus_type: 'main', enrollment: 3180, international_students: 480, is_public: true, primary_color: '#052049', secondary_color: '#90BD31', website: 'https://www.ucsf.edu', aliases: [] },
];

// ============================================================================
// CSU SYSTEM (23 Campuses)
// ============================================================================
const CSU_SYSTEM: University[] = [
  { id: 'csu-fullerton', name: 'California State University, Fullerton', short_name: 'CSU Fullerton', system_name: 'California State University', city: 'Fullerton', state: 'CA', zip_code: '92831', latitude: 33.8829, longitude: -117.8869, type: 'university', campus_type: 'main', enrollment: 40235, international_students: 2800, is_public: true, primary_color: '#00274C', secondary_color: '#FF6600', website: 'https://www.fullerton.edu', aliases: ['CSUF', 'Titans'] },
  { id: 'csu-long-beach', name: 'California State University, Long Beach', short_name: 'CSU Long Beach', system_name: 'California State University', city: 'Long Beach', state: 'CA', zip_code: '90840', latitude: 33.7838, longitude: -118.1141, type: 'university', campus_type: 'main', enrollment: 39435, international_students: 3200, is_public: true, primary_color: '#000000', secondary_color: '#F2A900', website: 'https://www.csulb.edu', aliases: ['CSULB', 'Long Beach State', 'The Beach'] },
  { id: 'csu-northridge', name: 'California State University, Northridge', short_name: 'CSU Northridge', system_name: 'California State University', city: 'Northridge', state: 'CA', zip_code: '91330', latitude: 34.2400, longitude: -118.5290, type: 'university', campus_type: 'main', enrollment: 38310, international_students: 2900, is_public: true, primary_color: '#CE1126', secondary_color: '#000000', website: 'https://www.csun.edu', aliases: ['CSUN', 'Matadors'] },
  { id: 'san-diego-state', name: 'San Diego State University', short_name: 'San Diego State', system_name: 'California State University', city: 'San Diego', state: 'CA', zip_code: '92182', latitude: 32.7757, longitude: -117.0719, type: 'university', campus_type: 'main', enrollment: 35978, international_students: 3500, is_public: true, primary_color: '#A6192E', secondary_color: '#000000', website: 'https://www.sdsu.edu', aliases: ['SDSU', 'Aztecs'] },
  { id: 'san-jose-state', name: 'San Jose State University', short_name: 'San Jose State', system_name: 'California State University', city: 'San Jose', state: 'CA', zip_code: '95192', latitude: 37.3352, longitude: -121.8811, type: 'university', campus_type: 'main', enrollment: 36155, international_students: 5200, is_public: true, primary_color: '#0055A2', secondary_color: '#E5A823', website: 'https://www.sjsu.edu', aliases: ['SJSU', 'Spartans'] },
  { id: 'cal-poly-pomona', name: 'California State Polytechnic University, Pomona', short_name: 'Cal Poly Pomona', system_name: 'California State University', city: 'Pomona', state: 'CA', zip_code: '91768', latitude: 34.0565, longitude: -117.8214, type: 'university', campus_type: 'main', enrollment: 29457, international_students: 2400, is_public: true, primary_color: '#1E4D2B', secondary_color: '#CFB53B', website: 'https://www.cpp.edu', aliases: ['CPP', 'Broncos'] },
  { id: 'cal-poly-slo', name: 'California Polytechnic State University, San Luis Obispo', short_name: 'Cal Poly SLO', system_name: 'California State University', city: 'San Luis Obispo', state: 'CA', zip_code: '93407', latitude: 35.3050, longitude: -120.6625, type: 'university', campus_type: 'main', enrollment: 22028, international_students: 650, is_public: true, primary_color: '#154734', secondary_color: '#BD8B13', website: 'https://www.calpoly.edu', aliases: ['Cal Poly', 'Mustangs'] },
  { id: 'csu-fresno', name: 'California State University, Fresno', short_name: 'Fresno State', system_name: 'California State University', city: 'Fresno', state: 'CA', zip_code: '93740', latitude: 36.8134, longitude: -119.7483, type: 'university', campus_type: 'main', enrollment: 24946, international_students: 1200, is_public: true, primary_color: '#DB0032', secondary_color: '#002E6D', website: 'https://www.fresnostate.edu', aliases: ['Fresno', 'Bulldogs'] },
  { id: 'csu-sacramento', name: 'California State University, Sacramento', short_name: 'Sacramento State', system_name: 'California State University', city: 'Sacramento', state: 'CA', zip_code: '95819', latitude: 38.5607, longitude: -121.4236, type: 'university', campus_type: 'main', enrollment: 31131, international_students: 2100, is_public: true, primary_color: '#043927', secondary_color: '#C4B581', website: 'https://www.csus.edu', aliases: ['Sac State', 'Hornets'] },
  { id: 'csu-los-angeles', name: 'California State University, Los Angeles', short_name: 'Cal State LA', system_name: 'California State University', city: 'Los Angeles', state: 'CA', zip_code: '90032', latitude: 34.0669, longitude: -118.1682, type: 'university', campus_type: 'main', enrollment: 26979, international_students: 1800, is_public: true, primary_color: '#FFB81C', secondary_color: '#000000', website: 'https://www.calstatela.edu', aliases: ['CSULA', 'Golden Eagles'] },
  { id: 'csu-east-bay', name: 'California State University, East Bay', short_name: 'Cal State East Bay', system_name: 'California State University', city: 'Hayward', state: 'CA', zip_code: '94542', latitude: 37.6569, longitude: -122.0569, type: 'university', campus_type: 'main', enrollment: 14949, international_students: 1500, is_public: true, primary_color: '#000000', secondary_color: '#CC0000', website: 'https://www.csueastbay.edu', aliases: ['CSUEB', 'Pioneers'] },
  { id: 'san-francisco-state', name: 'San Francisco State University', short_name: 'San Francisco State', system_name: 'California State University', city: 'San Francisco', state: 'CA', zip_code: '94132', latitude: 37.7241, longitude: -122.4783, type: 'university', campus_type: 'main', enrollment: 26829, international_students: 3100, is_public: true, primary_color: '#5E2882', secondary_color: '#C99700', website: 'https://www.sfsu.edu', aliases: ['SFSU', 'Gators'] },
  { id: 'csu-chico', name: 'California State University, Chico', short_name: 'Chico State', system_name: 'California State University', city: 'Chico', state: 'CA', zip_code: '95929', latitude: 39.7285, longitude: -121.8463, type: 'university', campus_type: 'main', enrollment: 15946, international_students: 700, is_public: true, primary_color: '#9D2235', secondary_color: '#FFFFFF', website: 'https://www.csuchico.edu', aliases: ['Chico', 'Wildcats'] },
  { id: 'cal-poly-humboldt', name: 'California State Polytechnic University, Humboldt', short_name: 'Cal Poly Humboldt', system_name: 'California State University', city: 'Arcata', state: 'CA', zip_code: '95521', latitude: 40.8757, longitude: -124.0786, type: 'university', campus_type: 'main', enrollment: 6034, international_students: 180, is_public: true, primary_color: '#046A38', secondary_color: '#FFB81C', website: 'https://www.humboldt.edu', aliases: ['Humboldt', 'Lumberjacks'] },
];

// ============================================================================
// IVY LEAGUE + TOP PRIVATE
// ============================================================================
const IVY_LEAGUE: University[] = [
  { id: 'harvard', name: 'Harvard University', short_name: 'Harvard', city: 'Cambridge', state: 'MA', zip_code: '02138', latitude: 42.3770, longitude: -71.1167, type: 'university', campus_type: 'main', enrollment: 21015, international_students: 5600, is_public: false, primary_color: '#A51C30', secondary_color: '#000000', website: 'https://www.harvard.edu', aliases: ['Crimson'] },
  { id: 'yale', name: 'Yale University', short_name: 'Yale', city: 'New Haven', state: 'CT', zip_code: '06520', latitude: 41.3163, longitude: -72.9223, type: 'university', campus_type: 'main', enrollment: 12060, international_students: 2800, is_public: false, primary_color: '#00356B', secondary_color: '#FFFFFF', website: 'https://www.yale.edu', aliases: ['Bulldogs', 'Elis'] },
  { id: 'princeton', name: 'Princeton University', short_name: 'Princeton', city: 'Princeton', state: 'NJ', zip_code: '08544', latitude: 40.3431, longitude: -74.6551, type: 'university', campus_type: 'main', enrollment: 8478, international_students: 2100, is_public: false, primary_color: '#E77500', secondary_color: '#000000', website: 'https://www.princeton.edu', aliases: ['Tigers'] },
  { id: 'columbia', name: 'Columbia University', short_name: 'Columbia', city: 'New York', state: 'NY', zip_code: '10027', latitude: 40.8075, longitude: -73.9626, type: 'university', campus_type: 'main', enrollment: 30135, international_students: 10200, is_public: false, primary_color: '#004F98', secondary_color: '#FFFFFF', website: 'https://www.columbia.edu', aliases: ['Lions'] },
  { id: 'upenn', name: 'University of Pennsylvania', short_name: 'Penn', city: 'Philadelphia', state: 'PA', zip_code: '19104', latitude: 39.9522, longitude: -75.1932, type: 'university', campus_type: 'main', enrollment: 22432, international_students: 5800, is_public: false, primary_color: '#011F5B', secondary_color: '#990000', website: 'https://www.upenn.edu', aliases: ['Quakers', 'UPenn'] },
  { id: 'brown', name: 'Brown University', short_name: 'Brown', city: 'Providence', state: 'RI', zip_code: '02912', latitude: 41.8268, longitude: -71.4025, type: 'university', campus_type: 'main', enrollment: 10257, international_students: 2400, is_public: false, primary_color: '#4E3629', secondary_color: '#C00404', website: 'https://www.brown.edu', aliases: ['Bears'] },
  { id: 'dartmouth', name: 'Dartmouth College', short_name: 'Dartmouth', city: 'Hanover', state: 'NH', zip_code: '03755', latitude: 43.7044, longitude: -72.2887, type: 'university', campus_type: 'main', enrollment: 6571, international_students: 1100, is_public: false, primary_color: '#00693E', secondary_color: '#FFFFFF', website: 'https://www.dartmouth.edu', aliases: ['Big Green'] },
  { id: 'cornell', name: 'Cornell University', short_name: 'Cornell', city: 'Ithaca', state: 'NY', zip_code: '14853', latitude: 42.4534, longitude: -76.4735, type: 'university', campus_type: 'main', enrollment: 24027, international_students: 6200, is_public: false, primary_color: '#B31B1B', secondary_color: '#222222', website: 'https://www.cornell.edu', aliases: ['Big Red'] },
];

const TOP_PRIVATE: University[] = [
  { id: 'mit', name: 'Massachusetts Institute of Technology', short_name: 'MIT', city: 'Cambridge', state: 'MA', zip_code: '02139', latitude: 42.3601, longitude: -71.0942, type: 'university', campus_type: 'main', enrollment: 11574, international_students: 3800, is_public: false, primary_color: '#8B0000', secondary_color: '#A8A8A8', website: 'https://www.mit.edu', aliases: ['Engineers'] },
  { id: 'stanford', name: 'Stanford University', short_name: 'Stanford', city: 'Stanford', state: 'CA', zip_code: '94305', latitude: 37.4275, longitude: -122.1697, type: 'university', campus_type: 'main', enrollment: 17534, international_students: 4200, is_public: false, primary_color: '#8C1515', secondary_color: '#FFFFFF', website: 'https://www.stanford.edu', aliases: ['Cardinal'] },
  { id: 'caltech', name: 'California Institute of Technology', short_name: 'Caltech', city: 'Pasadena', state: 'CA', zip_code: '91125', latitude: 34.1377, longitude: -118.1253, type: 'university', campus_type: 'main', enrollment: 2240, international_students: 680, is_public: false, primary_color: '#FF6C0C', secondary_color: '#FFFFFF', website: 'https://www.caltech.edu', aliases: ['Beavers'] },
  { id: 'duke', name: 'Duke University', short_name: 'Duke', city: 'Durham', state: 'NC', zip_code: '27708', latitude: 36.0014, longitude: -78.9382, type: 'university', campus_type: 'main', enrollment: 15984, international_students: 3200, is_public: false, primary_color: '#003087', secondary_color: '#FFFFFF', website: 'https://www.duke.edu', aliases: ['Blue Devils'] },
  { id: 'northwestern', name: 'Northwestern University', short_name: 'Northwestern', city: 'Evanston', state: 'IL', zip_code: '60208', latitude: 42.0565, longitude: -87.6753, type: 'university', campus_type: 'main', enrollment: 22127, international_students: 4400, is_public: false, primary_color: '#4E2A84', secondary_color: '#FFFFFF', website: 'https://www.northwestern.edu', aliases: ['Wildcats'] },
  { id: 'uchicago', name: 'University of Chicago', short_name: 'UChicago', city: 'Chicago', state: 'IL', zip_code: '60637', latitude: 41.7886, longitude: -87.5987, type: 'university', campus_type: 'main', enrollment: 18128, international_students: 5200, is_public: false, primary_color: '#800000', secondary_color: '#FFD100', website: 'https://www.uchicago.edu', aliases: ['Maroons'] },
  { id: 'johns-hopkins', name: 'Johns Hopkins University', short_name: 'Johns Hopkins', city: 'Baltimore', state: 'MD', zip_code: '21218', latitude: 39.3299, longitude: -76.6205, type: 'university', campus_type: 'main', enrollment: 26152, international_students: 7200, is_public: false, primary_color: '#002D72', secondary_color: '#FFFFFF', website: 'https://www.jhu.edu', aliases: ['Blue Jays', 'JHU', 'Hopkins'] },
  { id: 'carnegie-mellon', name: 'Carnegie Mellon University', short_name: 'CMU', city: 'Pittsburgh', state: 'PA', zip_code: '15213', latitude: 40.4433, longitude: -79.9436, type: 'university', campus_type: 'main', enrollment: 15818, international_students: 6800, is_public: false, primary_color: '#C41230', secondary_color: '#000000', website: 'https://www.cmu.edu', aliases: ['Tartans'] },
  { id: 'nyu', name: 'New York University', short_name: 'NYU', city: 'New York', state: 'NY', zip_code: '10003', latitude: 40.7295, longitude: -73.9965, type: 'university', campus_type: 'main', enrollment: 51848, international_students: 17200, is_public: false, primary_color: '#57068C', secondary_color: '#FFFFFF', website: 'https://www.nyu.edu', aliases: ['Violets'] },
  { id: 'georgetown', name: 'Georgetown University', short_name: 'Georgetown', city: 'Washington', state: 'DC', zip_code: '20057', latitude: 38.9076, longitude: -77.0723, type: 'university', campus_type: 'main', enrollment: 19204, international_students: 2800, is_public: false, primary_color: '#041E42', secondary_color: '#63666A', website: 'https://www.georgetown.edu', aliases: ['Hoyas'] },
  { id: 'usc', name: 'University of Southern California', short_name: 'USC', city: 'Los Angeles', state: 'CA', zip_code: '90089', latitude: 34.0224, longitude: -118.2851, type: 'university', campus_type: 'main', enrollment: 47310, international_students: 12800, is_public: false, primary_color: '#990000', secondary_color: '#FFC72C', website: 'https://www.usc.edu', aliases: ['Trojans'] },
  { id: 'boston-university', name: 'Boston University', short_name: 'BU', city: 'Boston', state: 'MA', zip_code: '02215', latitude: 42.3505, longitude: -71.1054, type: 'university', campus_type: 'main', enrollment: 36104, international_students: 9200, is_public: false, primary_color: '#CC0000', secondary_color: '#FFFFFF', website: 'https://www.bu.edu', aliases: ['Terriers'] },
  { id: 'northeastern', name: 'Northeastern University', short_name: 'Northeastern', city: 'Boston', state: 'MA', zip_code: '02115', latitude: 42.3398, longitude: -71.0892, type: 'university', campus_type: 'main', enrollment: 22207, international_students: 7600, is_public: false, primary_color: '#D41B2C', secondary_color: '#000000', website: 'https://www.northeastern.edu', aliases: ['Huskies', 'NEU'] },
];

// ============================================================================
// COMBINE ALL UNIVERSITIES
// ============================================================================
export const ALL_UNIVERSITIES: University[] = [
  ...UC_SYSTEM,
  ...CSU_SYSTEM,
  ...IVY_LEAGUE,
  ...TOP_PRIVATE,
  ...BIG_TEN,
  ...ALL_TEXAS,
  ...NY_UNIVERSITIES,
  ...ALL_ADDITIONAL_STATE_UNIVERSITIES,
  ...ALL_COMMUNITY_COLLEGES,
];

// ============================================================================
// SEARCH FUNCTIONS
// ============================================================================

/**
 * Search universities by query string
 * Searches name, short_name, aliases, city, and state
 */
export function searchUniversities(query: string, limit: number = 20): University[] {
  if (!query || query.trim().length < 2) {
    return [];
  }

  const searchQuery = query.toLowerCase().trim();
  const words = searchQuery.split(/\s+/);

  const scored: { university: University; score: number }[] = ALL_UNIVERSITIES.map(uni => {
    let score = 0;
    const name = uni.name.toLowerCase();
    const shortName = uni.short_name.toLowerCase();
    const aliases = (uni.aliases || []).map(a => a.toLowerCase());
    const city = uni.city.toLowerCase();
    const state = uni.state.toLowerCase();
    const systemName = (uni.system_name || '').toLowerCase();

    // Exact matches get highest score
    if (name === searchQuery) score += 100;
    if (shortName === searchQuery) score += 100;
    if (aliases.includes(searchQuery)) score += 90;

    // Starts with query
    if (name.startsWith(searchQuery)) score += 50;
    if (shortName.startsWith(searchQuery)) score += 50;
    if (aliases.some(a => a.startsWith(searchQuery))) score += 40;

    // Contains query
    if (name.includes(searchQuery)) score += 30;
    if (shortName.includes(searchQuery)) score += 30;
    if (aliases.some(a => a.includes(searchQuery))) score += 25;
    if (systemName.includes(searchQuery)) score += 20;

    // Word matches
    words.forEach(word => {
      if (name.includes(word)) score += 10;
      if (shortName.includes(word)) score += 10;
      if (city.includes(word)) score += 5;
      if (state === word || state.includes(word)) score += 5;
    });

    // Boost for universities with more international students
    if (uni.international_students && uni.international_students > 1000) {
      score += 5;
    }

    return { university: uni, score };
  });

  return scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(s => s.university);
}

/**
 * Get university by ID
 */
export function getUniversityById(id: string): University | undefined {
  return ALL_UNIVERSITIES.find(u => u.id === id);
}

/**
 * Get universities by state
 */
export function getUniversitiesByState(state: string): University[] {
  return ALL_UNIVERSITIES.filter(u => u.state.toUpperCase() === state.toUpperCase());
}

/**
 * Get universities by type
 */
export function getUniversitiesByType(type: InstitutionType): University[] {
  return ALL_UNIVERSITIES.filter(u => u.type === type);
}

/**
 * Get universities by system name
 */
export function getUniversitiesBySystem(systemName: string): University[] {
  const query = systemName.toLowerCase();
  return ALL_UNIVERSITIES.filter(u =>
    u.system_name?.toLowerCase().includes(query)
  );
}

/**
 * Get popular universities (high international student count)
 */
export function getPopularForInternationalStudents(limit: number = 20): University[] {
  return [...ALL_UNIVERSITIES]
    .filter(u => u.international_students && u.international_students > 500)
    .sort((a, b) => (b.international_students || 0) - (a.international_students || 0))
    .slice(0, limit);
}

/**
 * Get community colleges
 */
export function getCommunityColleges(): University[] {
  return ALL_UNIVERSITIES.filter(u => u.type === 'community_college');
}

/**
 * Get universities only (not CCs)
 */
export function getUniversitiesOnly(): University[] {
  return ALL_UNIVERSITIES.filter(u => u.type === 'university');
}

// Export individual systems for direct access
export {
  UC_SYSTEM,
  CSU_SYSTEM,
  IVY_LEAGUE,
  TOP_PRIVATE,
  BIG_TEN,
  ALL_TEXAS,
  NY_UNIVERSITIES,
  SUNY_UNIVERSITIES,
  CUNY_UNIVERSITIES,
  FLORIDA_SUS,
  GEORGIA_USG,
  UNC_SYSTEM,
  VIRGINIA_UNIVERSITIES,
  MASSACHUSETTS_UNIVERSITIES,
  ARIZONA_UNIVERSITIES,
  COLORADO_UNIVERSITIES,
  ALL_ADDITIONAL_STATE_UNIVERSITIES,
  ALL_COMMUNITY_COLLEGES
};
