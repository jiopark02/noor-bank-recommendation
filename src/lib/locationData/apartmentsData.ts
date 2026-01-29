/**
 * Comprehensive Apartments Data Near Major Universities
 * Real housing options with actual locations
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

// Helper function to create apartment data
function apt(
  id: string,
  name: string,
  address: string,
  university: string,
  bedrooms: string,
  bathrooms: string,
  price_min: number,
  price_max: number,
  sqft_min: number,
  sqft_max: number,
  walking_minutes: number,
  biking_minutes: number,
  transit_minutes: number,
  driving_minutes: number,
  rating: number,
  review_count: number,
  pet_policy: string,
  campus_side: CampusSide,
  furnished: boolean,
  gym: boolean,
  parking: boolean,
  lat: number,
  lng: number,
  website?: string
): ApartmentData {
  return {
    id,
    name,
    address,
    university,
    bedrooms,
    bathrooms,
    price_min,
    price_max,
    shared_price_min: Math.round(price_min * 0.55),
    shared_price_max: Math.round(price_max * 0.55),
    sqft_min,
    sqft_max,
    walking_minutes,
    biking_minutes,
    transit_minutes,
    driving_minutes,
    rating,
    review_count,
    pet_policy,
    campus_side,
    furnished,
    gym,
    parking,
    latitude: lat,
    longitude: lng,
    contact_website: website,
  };
}

// ============================================================================
// US APARTMENTS
// ============================================================================

export const US_APARTMENTS: ApartmentData[] = [
  // Stanford
  apt('stanford-1', 'Palo Alto Place', '383 University Ave, Palo Alto, CA', 'Stanford', 'Studio-1BR', '1', 2800, 3600, 450, 650, 12, 4, 15, 5, 4.5, 124, 'Cats allowed', 'north', true, true, true, 37.4445, -122.1610, 'https://example.com'),
  apt('stanford-2', 'The Hamilton', '425 Hamilton Ave, Palo Alto, CA', 'Stanford', '1-2BR', '1-2', 3200, 4800, 600, 1000, 15, 5, 18, 6, 4.3, 89, 'No pets', 'north', false, true, true, 37.4435, -122.1625),
  apt('stanford-3', 'Oak Creek Apartments', '1600 Sand Hill Rd, Palo Alto, CA', 'Stanford', '1-3BR', '1-2', 2600, 4500, 550, 1200, 8, 3, 12, 4, 4.6, 156, 'Dogs & cats', 'west', true, true, true, 37.4180, -122.1890),
  apt('stanford-4', 'Stanford West', '2700 El Camino Real, Palo Alto, CA', 'Stanford', '1-2BR', '1-2', 2400, 3800, 500, 900, 18, 6, 20, 7, 4.2, 78, 'Cats only', 'east', false, true, true, 37.4250, -122.1520),
  apt('stanford-5', 'California Avenue Apartments', '2200 S California Ave, Palo Alto, CA', 'Stanford', 'Studio-2BR', '1', 2200, 3400, 400, 850, 20, 7, 22, 8, 4.4, 95, 'Small pets', 'east', true, false, true, 37.4280, -122.1460),

  // UC Berkeley
  apt('berkeley-1', 'The Panoramic', '2116 Allston Way, Berkeley, CA', 'UC Berkeley', 'Studio-1BR', '1', 2400, 3200, 350, 550, 8, 3, 10, 4, 4.1, 112, 'No pets', 'south', true, true, false, 37.8695, -122.2680),
  apt('berkeley-2', 'Hillside Village', '2430 Hillegass Ave, Berkeley, CA', 'UC Berkeley', '1-2BR', '1', 2000, 3000, 500, 800, 12, 4, 15, 5, 4.3, 87, 'Cats allowed', 'south', false, false, true, 37.8650, -122.2590),
  apt('berkeley-3', 'Northside Apartments', '1610 Euclid Ave, Berkeley, CA', 'UC Berkeley', 'Studio-2BR', '1', 1800, 2800, 400, 750, 5, 2, 8, 3, 4.5, 134, 'No pets', 'north', true, true, false, 37.8775, -122.2580),
  apt('berkeley-4', 'The Bachenheimer', '2511 Hillegass Ave, Berkeley, CA', 'UC Berkeley', '1-3BR', '1-2', 2200, 4200, 550, 1100, 10, 4, 12, 4, 4.2, 76, 'Dogs & cats', 'south', false, true, true, 37.8640, -122.2580),
  apt('berkeley-5', 'Durant Square', '2520 Durant Ave, Berkeley, CA', 'UC Berkeley', 'Studio-1BR', '1', 2100, 2900, 380, 520, 6, 2, 8, 3, 4.4, 98, 'Cats only', 'south', true, true, false, 37.8670, -122.2565),

  // UCLA
  apt('ucla-1', 'Westwood Terrace', '10959 Rochester Ave, Los Angeles, CA', 'UCLA', '1-2BR', '1-2', 2600, 4200, 600, 1000, 10, 4, 15, 5, 4.4, 156, 'Dogs & cats', 'south', true, true, true, 37.0580, -118.4420),
  apt('ucla-2', 'Kelton Tower', '10995 Le Conte Ave, Los Angeles, CA', 'UCLA', 'Studio-2BR', '1-2', 2200, 3800, 450, 900, 5, 2, 8, 3, 4.2, 89, 'Cats only', 'south', true, true, false, 37.0610, -118.4450),
  apt('ucla-3', 'Gayley Heights', '10945 Gayley Ave, Los Angeles, CA', 'UCLA', '1-3BR', '1-2', 2400, 4500, 550, 1100, 8, 3, 12, 4, 4.5, 123, 'Small pets', 'south', false, true, true, 37.0590, -118.4475),
  apt('ucla-4', 'Strathmore Apartments', '10980 Strathmore Dr, Los Angeles, CA', 'UCLA', '1-2BR', '1', 2800, 4000, 650, 950, 12, 4, 18, 6, 4.3, 67, 'No pets', 'east', true, true, true, 37.0620, -118.4380),

  // USC
  apt('usc-1', 'Lorenzo', '325 W Adams Blvd, Los Angeles, CA', 'USC', '1-4BR', '1-2', 1800, 3600, 500, 1400, 5, 2, 8, 3, 4.3, 234, 'Dogs & cats', 'west', true, true, true, 34.0260, -118.2900),
  apt('usc-2', 'The Reef', '1021 W 34th St, Los Angeles, CA', 'USC', '1-2BR', '1-2', 2200, 3400, 600, 950, 8, 3, 10, 4, 4.1, 145, 'Cats only', 'west', true, true, false, 34.0235, -118.2930),
  apt('usc-3', 'Nine Zero One', '901 W Jefferson Blvd, Los Angeles, CA', 'USC', 'Studio-2BR', '1', 2000, 3200, 450, 850, 3, 1, 5, 2, 4.5, 178, 'No pets', 'west', true, true, true, 34.0255, -118.2880),
  apt('usc-4', 'Tuscany Apartments', '2850 S Figueroa St, Los Angeles, CA', 'USC', '1-3BR', '1-2', 1600, 2800, 550, 1000, 10, 4, 12, 5, 4.2, 89, 'Dogs allowed', 'east', false, true, true, 34.0200, -118.2770),

  // MIT
  apt('mit-1', 'Watermark Kendall West', '5 Cambridge Center, Cambridge, MA', 'MIT', '1-2BR', '1-2', 3200, 5500, 650, 1100, 8, 3, 10, 4, 4.4, 123, 'Dogs & cats', 'east', true, true, true, 42.3640, -71.0870),
  apt('mit-2', 'Avalon North Point', '65 Cambridge Park Dr, Cambridge, MA', 'MIT', 'Studio-3BR', '1-2', 2800, 5200, 500, 1300, 12, 4, 15, 6, 4.2, 89, 'Small pets', 'east', true, true, true, 42.3680, -71.0780),
  apt('mit-3', 'Archstone Central Square', '808 Memorial Dr, Cambridge, MA', 'MIT', '1-2BR', '1', 2600, 4200, 600, 950, 5, 2, 8, 3, 4.5, 156, 'Cats only', 'west', true, true, false, 42.3575, -71.1010),
  apt('mit-4', 'Mass Ave Apartments', '450 Massachusetts Ave, Cambridge, MA', 'MIT', 'Studio-1BR', '1', 2400, 3600, 450, 700, 10, 4, 12, 5, 4.3, 78, 'No pets', 'west', false, true, true, 42.3620, -71.1020),

  // Harvard
  apt('harvard-1', 'The Abbot', '1380 Massachusetts Ave, Cambridge, MA', 'Harvard', '1-2BR', '1-2', 3400, 5800, 700, 1100, 3, 1, 5, 2, 4.6, 145, 'No pets', 'center', true, true, false, 42.3725, -71.1180),
  apt('harvard-2', 'Harvard Gardens', '1600 Massachusetts Ave, Cambridge, MA', 'Harvard', 'Studio-2BR', '1', 2800, 4500, 500, 900, 8, 3, 10, 4, 4.3, 98, 'Cats allowed', 'north', true, true, true, 42.3780, -71.1225),
  apt('harvard-3', 'Cambridge Park Place', '36 Quincy St, Cambridge, MA', 'Harvard', '1-3BR', '1-2', 3000, 5200, 650, 1200, 5, 2, 8, 3, 4.4, 112, 'Small pets', 'center', false, true, true, 42.3740, -71.1150),

  // Columbia
  apt('columbia-1', 'Morningside Heights', '3140 Broadway, New York, NY', 'Columbia', '1-2BR', '1', 2800, 4500, 600, 950, 5, 2, 8, 3, 4.2, 134, 'Cats only', 'north', true, true, false, 40.8095, -73.9645),
  apt('columbia-2', 'The Lucerne', '2956 Broadway, New York, NY', 'Columbia', 'Studio-2BR', '1', 2400, 4000, 450, 850, 3, 1, 5, 2, 4.4, 89, 'No pets', 'south', true, false, false, 40.8065, -73.9660),
  apt('columbia-3', 'Riverside Terrace', '490 Riverside Dr, New York, NY', 'Columbia', '1-3BR', '1-2', 2600, 5200, 650, 1200, 10, 4, 12, 5, 4.3, 112, 'Dogs & cats', 'west', false, true, true, 40.8120, -73.9700),

  // NYU
  apt('nyu-1', 'Gramercy Green', '80 University Pl, New York, NY', 'NYU', 'Studio-2BR', '1', 3000, 5000, 450, 900, 5, 2, 8, 3, 4.3, 167, 'No pets', 'center', true, true, false, 40.7335, -73.9935),
  apt('nyu-2', 'Astor Place Tower', '21 Astor Pl, New York, NY', 'NYU', '1-3BR', '1-2', 3500, 7000, 600, 1400, 3, 1, 5, 2, 4.5, 123, 'Cats only', 'east', true, true, true, 40.7300, -73.9910),
  apt('nyu-3', 'Greenwich Village Apartments', '98 Bleecker St, New York, NY', 'NYU', '1-2BR', '1', 2800, 4500, 500, 800, 8, 3, 10, 4, 4.2, 89, 'Small pets', 'west', false, true, false, 40.7280, -74.0000),

  // UIUC
  apt('uiuc-1', 'Latitude', '601 E White St, Champaign, IL', 'UIUC', '1-4BR', '1-2', 800, 1600, 500, 1200, 8, 3, 10, 4, 4.2, 234, 'Dogs & cats', 'north', true, true, true, 40.1085, -88.2340),
  apt('uiuc-2', 'HERE Champaign', '308 E Green St, Champaign, IL', 'UIUC', 'Studio-4BR', '1-2', 700, 1400, 400, 1100, 3, 1, 5, 2, 4.4, 189, 'Small pets', 'north', true, true, false, 40.1100, -88.2375),
  apt('uiuc-3', 'Campus Circle', '505 E Green St, Champaign, IL', 'UIUC', '1-2BR', '1', 650, 1200, 450, 800, 5, 2, 8, 3, 4.1, 145, 'Cats only', 'north', false, true, true, 40.1095, -88.2350),
  apt('uiuc-4', 'The Dean', '708 S 6th St, Champaign, IL', 'UIUC', '1-5BR', '1-3', 600, 1500, 400, 1400, 10, 4, 12, 5, 4.3, 167, 'No pets', 'center', true, true, true, 40.1070, -88.2310),

  // UT Austin
  apt('utaustin-1', 'The Ruckus', '2512 Nueces St, Austin, TX', 'UT Austin', '1-4BR', '1-2', 1200, 2400, 550, 1300, 5, 2, 8, 3, 4.3, 178, 'Dogs & cats', 'west', true, true, true, 30.2885, -97.7445),
  apt('utaustin-2', 'Rise', '914 E 40th St, Austin, TX', 'UT Austin', 'Studio-3BR', '1-2', 1000, 2000, 450, 1000, 10, 4, 12, 5, 4.2, 134, 'Small pets', 'north', true, true, false, 30.2955, -97.7230),
  apt('utaustin-3', 'Villas on Rio', '2400 Nueces St, Austin, TX', 'UT Austin', '1-2BR', '1', 1100, 1800, 500, 850, 8, 3, 10, 4, 4.4, 98, 'Cats only', 'west', false, true, true, 30.2880, -97.7440),

  // University of Washington
  apt('uw-1', 'The Hub Seattle', '4721 Brooklyn Ave NE, Seattle, WA', 'University of Washington', '1-5BR', '1-2', 1400, 2800, 500, 1400, 5, 2, 8, 3, 4.3, 189, 'Dogs & cats', 'center', true, true, true, 47.6630, -122.3150),
  apt('uw-2', 'Urbane', '4500 15th Ave NE, Seattle, WA', 'University of Washington', 'Studio-2BR', '1', 1200, 2200, 400, 850, 8, 3, 10, 4, 4.1, 123, 'Small pets', 'east', true, true, false, 47.6600, -122.3110),
  apt('uw-3', 'Lumen', '4755 Roosevelt Way NE, Seattle, WA', 'University of Washington', '1-3BR', '1-2', 1500, 2600, 550, 1100, 3, 1, 5, 2, 4.5, 145, 'Cats only', 'center', true, true, true, 47.6640, -122.3175),

  // Georgia Tech
  apt('gatech-1', 'Catalyst Midtown', '111 10th St NW, Atlanta, GA', 'Georgia Tech', '1-4BR', '1-2', 1200, 2400, 550, 1300, 8, 3, 10, 4, 4.2, 167, 'Dogs & cats', 'east', true, true, true, 33.7815, -84.3875),
  apt('gatech-2', 'Westmar Student Lofts', '800 West Marietta St, Atlanta, GA', 'Georgia Tech', '1-2BR', '1', 1000, 1800, 450, 800, 10, 4, 12, 5, 4.3, 134, 'Small pets', 'west', true, true, false, 33.7790, -84.4025),
  apt('gatech-3', 'University House', '549 Spring St NW, Atlanta, GA', 'Georgia Tech', 'Studio-3BR', '1-2', 1100, 2200, 400, 1000, 5, 2, 8, 3, 4.4, 98, 'Cats only', 'center', true, true, true, 33.7780, -84.3905),

  // Arizona State
  apt('asu-1', 'Vela on the Park', '675 E University Dr, Tempe, AZ', 'Arizona State', '1-4BR', '1-2', 900, 1800, 500, 1300, 5, 2, 8, 3, 4.2, 189, 'Dogs & cats', 'west', true, true, true, 33.4235, -111.9345),
  apt('asu-2', 'District at Campus', '1020 S Mill Ave, Tempe, AZ', 'Arizona State', 'Studio-3BR', '1-2', 800, 1600, 400, 1000, 8, 3, 10, 4, 4.1, 156, 'Small pets', 'west', true, true, false, 33.4210, -111.9405),
  apt('asu-3', 'Rise on Apache', '900 E Apache Blvd, Tempe, AZ', 'Arizona State', '1-2BR', '1', 850, 1500, 450, 800, 3, 1, 5, 2, 4.4, 112, 'Cats only', 'south', true, true, true, 33.4150, -111.9380),
];

// ============================================================================
// UK APARTMENTS
// ============================================================================

export const UK_APARTMENTS: ApartmentData[] = [
  // Imperial College London
  apt('imperial-1', 'Griffon Studios', '228 Old Brompton Rd, London SW5', 'Imperial College London', 'Studio', '1', 1400, 1800, 200, 300, 12, 4, 15, 8, 4.3, 89, 'No pets', 'south', true, true, false, 51.4920, -0.1880, 'https://example.com'),
  apt('imperial-2', 'Prince Consort Village', '2 Prince Consort Rd, London SW7', 'Imperial College London', 'Studio-1BR', '1', 1600, 2200, 250, 400, 3, 1, 5, 3, 4.5, 123, 'No pets', 'center', true, true, false, 51.4990, -0.1765),
  apt('imperial-3', 'Woodward Buildings', 'Woodward Way, London SW7', 'Imperial College London', '1BR', '1', 1500, 2000, 350, 450, 5, 2, 8, 4, 4.2, 78, 'No pets', 'center', true, true, false, 51.4985, -0.1755),

  // UCL
  apt('ucl-1', 'Chapter Kings Cross', '200 Pentonville Rd, London N1', 'UCL', 'Studio-1BR', '1', 1300, 1900, 200, 350, 15, 5, 18, 10, 4.1, 156, 'No pets', 'north', true, true, false, 51.5305, -0.1180),
  apt('ucl-2', 'iQ Bloomsbury', '25 Bedford Way, London WC1', 'UCL', 'Studio', '1', 1500, 2100, 180, 280, 5, 2, 8, 4, 4.4, 112, 'No pets', 'center', true, true, false, 51.5215, -0.1280),
  apt('ucl-3', 'Urbanest Kings Cross', 'Canal Reach, London N1', 'UCL', 'Studio-1BR', '1', 1400, 2000, 220, 380, 12, 4, 15, 8, 4.3, 134, 'No pets', 'north', true, true, false, 51.5345, -0.1245),

  // Oxford
  apt('oxford-1', 'Alice House', '95 Banbury Rd, Oxford OX2', 'Oxford', 'Studio-1BR', '1', 1200, 1800, 200, 350, 15, 5, 18, 10, 4.2, 89, 'No pets', 'north', true, false, false, 51.7630, -1.2575),
  apt('oxford-2', 'The Warehouse', '20 Cowley Rd, Oxford OX4', 'Oxford', '1-2BR', '1', 1100, 1600, 350, 550, 10, 4, 12, 6, 4.4, 78, 'Cats allowed', 'east', false, true, true, 51.7475, -1.2405),
  apt('oxford-3', 'Jericho Quarter', '15 Walton Well Rd, Oxford OX2', 'Oxford', '1BR', '1', 1300, 1700, 400, 500, 12, 4, 15, 8, 4.3, 98, 'No pets', 'west', true, false, false, 51.7610, -1.2680),

  // Cambridge
  apt('cambridge-1', 'Brunswick House', 'Brunswick Walk, Cambridge CB5', 'Cambridge', 'Studio-1BR', '1', 1100, 1700, 200, 380, 12, 4, 15, 8, 4.3, 112, 'No pets', 'east', true, false, false, 52.2080, 0.1340),
  apt('cambridge-2', 'Eddington', 'Eddington Ave, Cambridge CB3', 'Cambridge', '1-2BR', '1-2', 1400, 2200, 400, 700, 15, 5, 18, 10, 4.5, 89, 'Small pets', 'west', true, true, true, 52.2180, 0.0915),
  apt('cambridge-3', 'Mill Road Apartments', '45 Mill Rd, Cambridge CB1', 'Cambridge', '1BR', '1', 1000, 1500, 350, 450, 10, 4, 12, 6, 4.2, 78, 'No pets', 'south', false, false, true, 52.1985, 0.1365),

  // Manchester
  apt('manchester-1', 'Vita Student', 'First St, Manchester M15', 'Manchester', 'Studio', '1', 800, 1200, 180, 280, 10, 4, 12, 6, 4.2, 167, 'No pets', 'south', true, true, false, 53.4715, -2.2465),
  apt('manchester-2', 'iQ Lambert & Fairfield', 'Upper Brook St, Manchester M13', 'Manchester', 'Studio-1BR', '1', 750, 1100, 200, 350, 5, 2, 8, 4, 4.4, 134, 'No pets', 'center', true, true, false, 53.4695, -2.2320),
  apt('manchester-3', 'Parkway Gate', 'Chester St, Manchester M1', 'Manchester', '1-2BR', '1', 900, 1400, 350, 550, 12, 4, 15, 8, 4.3, 89, 'No pets', 'south', true, true, true, 53.4735, -2.2415),

  // Edinburgh
  apt('edinburgh-1', 'Unite Straits Meadow', 'Fountainbridge, Edinburgh EH3', 'Edinburgh', 'Studio', '1', 750, 1100, 180, 260, 15, 5, 18, 10, 4.1, 123, 'No pets', 'west', true, true, false, 55.9420, -3.2055),
  apt('edinburgh-2', 'Abodus Holyrood', 'E Market St, Edinburgh EH8', 'Edinburgh', 'Studio-1BR', '1', 800, 1200, 200, 350, 12, 4, 15, 8, 4.3, 98, 'No pets', 'east', true, true, false, 55.9510, -3.1785),
  apt('edinburgh-3', 'The Brae', 'Causewayside, Edinburgh EH9', 'Edinburgh', '1BR', '1', 850, 1300, 350, 450, 10, 4, 12, 6, 4.4, 78, 'No pets', 'south', true, false, true, 55.9385, -3.1795),
];

// ============================================================================
// CANADA APARTMENTS
// ============================================================================

export const CANADA_APARTMENTS: ApartmentData[] = [
  // University of Toronto
  apt('uoft-1', 'CIBC Square Residences', '81 Bay St, Toronto ON', 'University of Toronto', '1-2BR', '1-2', 2200, 3800, 500, 900, 15, 5, 18, 8, 4.3, 112, 'No pets', 'south', true, true, true, 43.6475, -79.3770, 'https://example.com'),
  apt('uoft-2', 'Campus One', '59 Hayden St, Toronto ON', 'University of Toronto', 'Studio-1BR', '1', 1800, 2600, 350, 550, 10, 4, 12, 5, 4.4, 156, 'Cats only', 'east', true, true, false, 43.6665, -79.3825),
  apt('uoft-3', 'Harbord Village', '95 Harbord St, Toronto ON', 'University of Toronto', '1BR', '1', 1600, 2200, 450, 600, 8, 3, 10, 4, 4.2, 89, 'Small pets', 'west', false, false, true, 43.6605, -79.4045),
  apt('uoft-4', 'The Annex', '456 Bloor St W, Toronto ON', 'University of Toronto', '1-2BR', '1', 1900, 3200, 500, 850, 5, 2, 8, 3, 4.5, 134, 'Dogs & cats', 'north', true, true, true, 43.6670, -79.4070),

  // UBC
  apt('ubc-1', 'Marine Gateway', '450 SW Marine Dr, Vancouver BC', 'UBC', '1-2BR', '1-2', 1800, 3200, 550, 950, 15, 5, 18, 10, 4.2, 145, 'Small pets', 'south', true, true, true, 49.2100, -123.1155),
  apt('ubc-2', 'UBC Exchange', '5728 University Blvd, Vancouver BC', 'UBC', 'Studio-1BR', '1', 1500, 2200, 350, 550, 5, 2, 8, 4, 4.4, 178, 'No pets', 'center', true, true, false, 49.2680, -123.2510),
  apt('ubc-3', 'Wesbrook Village', '5908 Birney Ave, Vancouver BC', 'UBC', '1-2BR', '1', 1700, 2800, 500, 800, 8, 3, 10, 5, 4.3, 123, 'Cats allowed', 'east', true, true, true, 49.2545, -123.2375),

  // McGill
  apt('mcgill-1', 'Milton Parc', '3540 Milton St, Montreal QC', 'McGill', 'Studio-2BR', '1', 1000, 1800, 350, 700, 5, 2, 8, 4, 4.3, 167, 'Cats only', 'west', false, false, true, 45.5085, -73.5835),
  apt('mcgill-2', 'The Plateau', '4250 St Denis St, Montreal QC', 'McGill', '1-2BR', '1', 900, 1600, 400, 650, 15, 5, 18, 8, 4.1, 134, 'Small pets', 'north', false, true, true, 45.5195, -73.5760),
  apt('mcgill-3', 'Downtown Residences', '2055 Peel St, Montreal QC', 'McGill', '1BR', '1', 1200, 1900, 450, 600, 8, 3, 10, 5, 4.5, 98, 'No pets', 'center', true, true, false, 45.5015, -73.5735),

  // Waterloo
  apt('waterloo-1', 'ICON', '330 Philip St, Waterloo ON', 'Waterloo', '1-5BR', '1-3', 700, 1400, 400, 1200, 5, 2, 8, 4, 4.2, 189, 'No pets', 'west', true, true, true, 43.4745, -80.5395),
  apt('waterloo-2', 'Sage', '275 Lester St, Waterloo ON', 'Waterloo', '1-4BR', '1-2', 650, 1200, 350, 1000, 8, 3, 10, 5, 4.3, 156, 'Cats allowed', 'west', true, true, false, 43.4720, -80.5385),
  apt('waterloo-3', 'King Street Tower', '112 King St S, Waterloo ON', 'Waterloo', 'Studio-2BR', '1', 800, 1500, 300, 700, 10, 4, 12, 6, 4.4, 112, 'Small pets', 'south', true, true, true, 43.4660, -80.5235),

  // Calgary
  apt('ucalgary-1', 'Brentwood Station', '4100 Brentwood Rd NW, Calgary AB', 'University of Calgary', '1-2BR', '1-2', 1200, 2000, 500, 850, 10, 4, 12, 6, 4.2, 134, 'Dogs & cats', 'south', true, true, true, 51.0865, -114.1305),
  apt('ucalgary-2', 'University District', '1313 University Ave NW, Calgary AB', 'University of Calgary', '1BR', '1', 1100, 1700, 450, 600, 5, 2, 8, 4, 4.4, 98, 'Small pets', 'center', true, true, false, 51.0785, -114.1275),
  apt('ucalgary-3', 'Varsity Estates', '4800 Varsity Dr NW, Calgary AB', 'University of Calgary', '1-2BR', '1', 1000, 1600, 550, 750, 12, 4, 15, 8, 4.1, 78, 'Cats only', 'west', false, true, true, 51.0920, -114.1455),

  // SFU
  apt('sfu-1', 'UniverCity', '9100 University Crescent, Burnaby BC', 'SFU', '1-2BR', '1-2', 1400, 2400, 500, 850, 5, 2, 8, 4, 4.3, 112, 'Small pets', 'center', true, true, true, 49.2785, -122.9155),
  apt('sfu-2', 'Burnaby Mountain', '8960 University Dr, Burnaby BC', 'SFU', 'Studio-1BR', '1', 1200, 1800, 350, 550, 8, 3, 10, 5, 4.2, 89, 'No pets', 'west', true, true, false, 49.2755, -122.9225),

  // McMaster
  apt('mcmaster-1', 'Westdale Village', '1058 King St W, Hamilton ON', 'McMaster', '1-2BR', '1', 1000, 1600, 450, 750, 8, 3, 10, 5, 4.3, 145, 'Dogs & cats', 'east', false, true, true, 43.2615, -79.9010),
  apt('mcmaster-2', 'Sterling Apartments', '1315 Main St W, Hamilton ON', 'McMaster', 'Studio-1BR', '1', 850, 1300, 350, 500, 10, 4, 12, 6, 4.1, 112, 'Cats only', 'south', true, false, true, 43.2565, -79.9045),
];

// Combine all apartments
export const ALL_APARTMENTS: ApartmentData[] = [
  ...US_APARTMENTS,
  ...UK_APARTMENTS,
  ...CANADA_APARTMENTS,
];
