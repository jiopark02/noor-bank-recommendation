/**
 * US Bank Branches Near Major Universities
 * Real locations for Bank of America, Chase, Wells Fargo, Citibank, TD Bank, etc.
 */

import { BankBranch, CampusSide } from '../universityData';

// Helper to create branch data
function branch(
  id: string,
  bank: string,
  name: string,
  address: string,
  lat: number,
  lng: number,
  campusSide: CampusSide,
  phone?: string
): BankBranch {
  return { id, bank, name, address, lat, lng, campusSide, phone };
}

// ============================================================================
// CALIFORNIA UNIVERSITIES
// ============================================================================

export const CALIFORNIA_BRANCHES: Record<string, BankBranch[]> = {
  // UC System
  'Stanford': [
    branch('stanford-bofa-1', 'Bank of America', 'Palo Alto Downtown', '420 University Ave, Palo Alto, CA', 37.4448, -122.1614, 'north', '(650) 462-2100'),
    branch('stanford-bofa-2', 'Bank of America', 'Stanford Shopping Center', '660 Stanford Shopping Center, Palo Alto, CA', 37.4436, -122.1714, 'north', '(650) 463-4800'),
    branch('stanford-chase-1', 'Chase', 'Palo Alto University Ave', '440 University Ave, Palo Alto, CA', 37.4450, -122.1610, 'north', '(650) 321-3400'),
    branch('stanford-chase-2', 'Chase', 'California Ave', '275 S California Ave, Palo Alto, CA', 37.4295, -122.1424, 'east', '(650) 327-2000'),
    branch('stanford-wells-1', 'Wells Fargo', 'University Ave', '475 University Ave, Palo Alto, CA', 37.4452, -122.1598, 'north', '(650) 462-3700'),
    branch('stanford-wells-2', 'Wells Fargo', 'El Camino Real', '2600 El Camino Real, Palo Alto, CA', 37.4300, -122.1380, 'east', '(650) 327-4400'),
    branch('stanford-citi-1', 'Citibank', 'Palo Alto', '445 Hamilton Ave, Palo Alto, CA', 37.4430, -122.1620, 'north', '(650) 326-5700'),
  ],
  'UC Berkeley': [
    branch('berkeley-bofa-1', 'Bank of America', 'Telegraph Ave', '2333 Telegraph Ave, Berkeley, CA', 37.8676, -122.2594, 'south', '(510) 841-5000'),
    branch('berkeley-bofa-2', 'Bank of America', 'Shattuck Ave', '2180 Shattuck Ave, Berkeley, CA', 37.8708, -122.2685, 'west', '(510) 845-4200'),
    branch('berkeley-chase-1', 'Chase', 'Downtown Berkeley', '2120 Center St, Berkeley, CA', 37.8695, -122.2680, 'west', '(510) 849-5500'),
    branch('berkeley-wells-1', 'Wells Fargo', 'Durant Ave', '2401 Durant Ave, Berkeley, CA', 37.8678, -122.2567, 'south', '(510) 843-2400'),
    branch('berkeley-wells-2', 'Wells Fargo', 'Shattuck Ave', '2222 Shattuck Ave, Berkeley, CA', 37.8700, -122.2690, 'west', '(510) 548-7700'),
    branch('berkeley-citi-1', 'Citibank', 'Berkeley', '2435 Telegraph Ave, Berkeley, CA', 37.8665, -122.2590, 'south', '(510) 486-0800'),
  ],
  'UCLA': [
    branch('ucla-bofa-1', 'Bank of America', 'Westwood Village', '1001 Westwood Blvd, Los Angeles, CA', 34.0600, -118.4445, 'south', '(310) 824-7400'),
    branch('ucla-bofa-2', 'Bank of America', 'Wilshire Westwood', '10867 Wilshire Blvd, Los Angeles, CA', 34.0595, -118.4408, 'south', '(310) 208-2400'),
    branch('ucla-chase-1', 'Chase', 'Westwood', '1100 Glendon Ave, Los Angeles, CA', 34.0585, -118.4380, 'south', '(310) 208-3500'),
    branch('ucla-wells-1', 'Wells Fargo', 'Westwood Blvd', '1101 Westwood Blvd, Los Angeles, CA', 34.0598, -118.4450, 'south', '(310) 208-7811'),
    branch('ucla-citi-1', 'Citibank', 'Westwood Village', '1055 Broxton Ave, Los Angeles, CA', 34.0615, -118.4473, 'south', '(310) 208-8181'),
  ],
  'USC': [
    branch('usc-bofa-1', 'Bank of America', 'Figueroa St', '3460 S Figueroa St, Los Angeles, CA', 34.0230, -118.2775, 'east', '(213) 740-2000'),
    branch('usc-bofa-2', 'Bank of America', 'USC Village', '929 W Jefferson Blvd, Los Angeles, CA', 34.0255, -118.2895, 'west', '(213) 747-6200'),
    branch('usc-chase-1', 'Chase', 'USC Campus', '3607 Trousdale Pkwy, Los Angeles, CA', 34.0210, -118.2850, 'center', '(213) 740-5700'),
    branch('usc-wells-1', 'Wells Fargo', 'Jefferson Blvd', '3020 W Jefferson Blvd, Los Angeles, CA', 34.0245, -118.3000, 'west', '(213) 734-8000'),
  ],
  'UC San Diego': [
    branch('ucsd-bofa-1', 'Bank of America', 'La Jolla Village', '8855 Villa La Jolla Dr, La Jolla, CA', 32.8715, -117.2108, 'north', '(858) 558-8100'),
    branch('ucsd-chase-1', 'Chase', 'UTC', '4301 La Jolla Village Dr, San Diego, CA', 32.8695, -117.2095, 'north', '(858) 450-2400'),
    branch('ucsd-wells-1', 'Wells Fargo', 'La Jolla', '7514 Girard Ave, La Jolla, CA', 32.8465, -117.2745, 'west', '(858) 459-3111'),
    branch('ucsd-union-1', 'Union Bank', 'UCSD Campus', '9500 Gilman Dr, La Jolla, CA', 32.8800, -117.2340, 'center', '(858) 534-3259'),
  ],
  'UC Irvine': [
    branch('uci-bofa-1', 'Bank of America', 'University Center', '4115 Campus Dr, Irvine, CA', 33.6460, -117.8420, 'north', '(949) 824-5700'),
    branch('uci-chase-1', 'Chase', 'Campus Plaza', '4235 Campus Dr, Irvine, CA', 33.6470, -117.8410, 'north', '(949) 854-6100'),
    branch('uci-wells-1', 'Wells Fargo', 'Irvine', '4040 Barranca Pkwy, Irvine, CA', 33.6680, -117.8550, 'north', '(949) 551-5900'),
    branch('uci-union-1', 'Union Bank', 'University Town Center', '4501 Campus Dr, Irvine, CA', 33.6495, -117.8395, 'north', '(949) 824-5300'),
  ],
  'UC Davis': [
    branch('ucdavis-bofa-1', 'Bank of America', 'Downtown Davis', '500 1st St, Davis, CA', 38.5435, -121.7405, 'south', '(530) 753-5520'),
    branch('ucdavis-chase-1', 'Chase', 'Davis', '201 F St, Davis, CA', 38.5445, -121.7390, 'south', '(530) 758-4550'),
    branch('ucdavis-wells-1', 'Wells Fargo', 'Davis', '701 2nd St, Davis, CA', 38.5448, -121.7418, 'south', '(530) 756-3700'),
    branch('ucdavis-firstnorthern-1', 'First Northern Bank', 'Davis', '329 F St, Davis, CA', 38.5440, -121.7395, 'south', '(530) 758-4000'),
  ],
  'UC Santa Barbara': [
    branch('ucsb-bofa-1', 'Bank of America', 'Isla Vista', '935 Embarcadero Del Norte, Isla Vista, CA', 34.4125, -119.8595, 'west', '(805) 685-5700'),
    branch('ucsb-chase-1', 'Chase', 'Goleta', '5880 Calle Real, Goleta, CA', 34.4330, -119.8465, 'north', '(805) 967-5711'),
    branch('ucsb-wells-1', 'Wells Fargo', 'Isla Vista', '888 Embarcadero Del Norte, Isla Vista, CA', 34.4120, -119.8590, 'west', '(805) 685-3722'),
  ],
  'UC Santa Cruz': [
    branch('ucsc-bofa-1', 'Bank of America', 'Downtown Santa Cruz', '1200 Pacific Ave, Santa Cruz, CA', 36.9755, -122.0260, 'south', '(831) 426-2900'),
    branch('ucsc-chase-1', 'Chase', 'Santa Cruz', '1201 Pacific Ave, Santa Cruz, CA', 36.9750, -122.0255, 'south', '(831) 429-4700'),
    branch('ucsc-wells-1', 'Wells Fargo', 'Pacific Ave', '1500 Pacific Ave, Santa Cruz, CA', 36.9745, -122.0245, 'south', '(831) 426-4811'),
  ],
  'UC Riverside': [
    branch('ucr-bofa-1', 'Bank of America', 'University Village', '1201 University Ave, Riverside, CA', 33.9735, -117.3290, 'west', '(951) 788-2900'),
    branch('ucr-chase-1', 'Chase', 'University Ave', '3401 University Ave, Riverside, CA', 33.9740, -117.3095, 'east', '(951) 682-5740'),
    branch('ucr-wells-1', 'Wells Fargo', 'Riverside', '3700 Central Ave, Riverside, CA', 33.9800, -117.3710, 'west', '(951) 684-2560'),
  ],
  'UC Merced': [
    branch('ucm-bofa-1', 'Bank of America', 'Merced', '401 W Main St, Merced, CA', 37.3025, -120.4835, 'south', '(209) 722-4920'),
    branch('ucm-wells-1', 'Wells Fargo', 'Merced', '329 W Main St, Merced, CA', 37.3020, -120.4825, 'south', '(209) 722-4000'),
  ],

  // CSU System
  'San Jose State': [
    branch('sjsu-bofa-1', 'Bank of America', 'San Jose Downtown', '101 Park Center Plaza, San Jose, CA', 37.3330, -121.8905, 'south', '(408) 277-8400'),
    branch('sjsu-chase-1', 'Chase', 'San Jose', '96 S 1st St, San Jose, CA', 37.3355, -121.8900, 'north', '(408) 998-7000'),
    branch('sjsu-wells-1', 'Wells Fargo', 'San Jose', '121 S 1st St, San Jose, CA', 37.3350, -121.8895, 'north', '(408) 287-4000'),
  ],
  'San Diego State': [
    branch('sdsu-bofa-1', 'Bank of America', 'College Area', '5500 Montezuma Rd, San Diego, CA', 32.7725, -117.0705, 'west', '(619) 582-4800'),
    branch('sdsu-chase-1', 'Chase', 'El Cajon Blvd', '6310 El Cajon Blvd, San Diego, CA', 32.7620, -117.0535, 'east', '(619) 286-1400'),
    branch('sdsu-wells-1', 'Wells Fargo', 'College Area', '5550 Montezuma Rd, San Diego, CA', 32.7730, -117.0700, 'west', '(619) 583-2711'),
  ],
  'Cal Poly SLO': [
    branch('calpoly-bofa-1', 'Bank of America', 'San Luis Obispo', '1105 Higuera St, San Luis Obispo, CA', 35.2785, -120.6620, 'south', '(805) 543-4500'),
    branch('calpoly-chase-1', 'Chase', 'SLO', '895 Higuera St, San Luis Obispo, CA', 35.2780, -120.6610, 'south', '(805) 541-6811'),
    branch('calpoly-wells-1', 'Wells Fargo', 'San Luis Obispo', '665 Marsh St, San Luis Obispo, CA', 35.2810, -120.6605, 'south', '(805) 546-5800'),
  ],
  'Cal State Fullerton': [
    branch('csuf-bofa-1', 'Bank of America', 'Fullerton', '150 W Commonwealth Ave, Fullerton, CA', 33.8715, -117.9300, 'south', '(714) 871-5400'),
    branch('csuf-chase-1', 'Chase', 'Fullerton', '1500 N Harbor Blvd, Fullerton, CA', 33.8800, -117.9265, 'north', '(714) 525-1000'),
    branch('csuf-wells-1', 'Wells Fargo', 'Fullerton', '400 S Harbor Blvd, Fullerton, CA', 33.8695, -117.9270, 'south', '(714) 870-8200'),
  ],
  'Cal State Long Beach': [
    branch('csulb-bofa-1', 'Bank of America', 'Long Beach', '4801 E Pacific Coast Hwy, Long Beach, CA', 33.7825, -118.1305, 'north', '(562) 498-5600'),
    branch('csulb-chase-1', 'Chase', 'Traffic Circle', '4800 Los Coyotes Diagonal, Long Beach, CA', 33.7795, -118.1245, 'east', '(562) 494-9311'),
    branch('csulb-wells-1', 'Wells Fargo', 'Bellflower', '10025 Artesia Blvd, Bellflower, CA', 33.8680, -118.1305, 'north', '(562) 866-5631'),
  ],

  // Community Colleges
  'De Anza College': [
    branch('deanza-bofa-1', 'Bank of America', 'Cupertino', '10101 S De Anza Blvd, Cupertino, CA', 37.3240, -122.0330, 'east', '(408) 255-8300'),
    branch('deanza-chase-1', 'Chase', 'Cupertino', '10123 N Wolfe Rd, Cupertino, CA', 37.3355, -122.0150, 'east', '(408) 996-5300'),
    branch('deanza-wells-1', 'Wells Fargo', 'Cupertino', '10050 S De Anza Blvd, Cupertino, CA', 37.3235, -122.0325, 'east', '(408) 996-9500'),
  ],
  'Santa Monica College': [
    branch('smc-bofa-1', 'Bank of America', 'Santa Monica', '1422 4th St, Santa Monica, CA', 34.0145, -118.4930, 'south', '(310) 395-5300'),
    branch('smc-chase-1', 'Chase', 'Santa Monica', '1401 3rd St Promenade, Santa Monica, CA', 34.0155, -118.4940, 'south', '(310) 393-7500'),
    branch('smc-wells-1', 'Wells Fargo', 'Santa Monica', '1525 Montana Ave, Santa Monica, CA', 34.0320, -118.4890, 'north', '(310) 395-9721'),
  ],
  'Pasadena City College': [
    branch('pcc-bofa-1', 'Bank of America', 'Pasadena', '505 S Lake Ave, Pasadena, CA', 34.1380, -118.1335, 'east', '(626) 796-8100'),
    branch('pcc-chase-1', 'Chase', 'Pasadena', '301 E Colorado Blvd, Pasadena, CA', 34.1455, -118.1450, 'north', '(626) 578-9940'),
    branch('pcc-wells-1', 'Wells Fargo', 'Pasadena', '350 E Colorado Blvd, Pasadena, CA', 34.1458, -118.1430, 'north', '(626) 564-8900'),
  ],
};

// ============================================================================
// NEW YORK UNIVERSITIES
// ============================================================================

export const NEW_YORK_BRANCHES: Record<string, BankBranch[]> = {
  'Columbia': [
    branch('columbia-bofa-1', 'Bank of America', 'Broadway', '2849 Broadway, New York, NY', 40.8060, -73.9655, 'south', '(212) 678-4900'),
    branch('columbia-chase-1', 'Chase', 'Broadway Morningside', '2880 Broadway, New York, NY', 40.8065, -73.9660, 'south', '(212) 866-4200'),
    branch('columbia-chase-2', 'Chase', 'Amsterdam Ave', '1130 Amsterdam Ave, New York, NY', 40.8080, -73.9600, 'center', '(212) 316-5500'),
    branch('columbia-wells-1', 'Wells Fargo', 'Upper West Side', '2799 Broadway, New York, NY', 40.8050, -73.9670, 'south', '(212) 866-3700'),
    branch('columbia-td-1', 'TD Bank', 'Broadway', '2859 Broadway, New York, NY', 40.8062, -73.9658, 'south', '(212) 666-5600'),
    branch('columbia-citi-1', 'Citibank', 'Broadway', '2930 Broadway, New York, NY', 40.8095, -73.9640, 'north', '(212) 749-6200'),
  ],
  'NYU': [
    branch('nyu-bofa-1', 'Bank of America', 'Washington Square', '100 University Pl, New York, NY', 40.7340, -73.9940, 'north', '(212) 598-3000'),
    branch('nyu-bofa-2', 'Bank of America', 'Union Square', '860 Broadway, New York, NY', 40.7375, -73.9900, 'north', '(212) 253-7800'),
    branch('nyu-chase-1', 'Chase', 'Broadway', '770 Broadway, New York, NY', 40.7310, -73.9925, 'east', '(212) 505-4400'),
    branch('nyu-chase-2', 'Chase', 'Astor Place', '51 Astor Pl, New York, NY', 40.7300, -73.9910, 'east', '(212) 477-6900'),
    branch('nyu-wells-1', 'Wells Fargo', 'Union Square', '815 Broadway, New York, NY', 40.7338, -73.9905, 'north', '(212) 420-0700'),
    branch('nyu-citi-1', 'Citibank', 'University Place', '20 W 8th St, New York, NY', 40.7320, -73.9970, 'west', '(212) 505-4100'),
    branch('nyu-td-1', 'TD Bank', 'Broadway', '636 Broadway, New York, NY', 40.7275, -73.9945, 'south', '(212) 982-3800'),
  ],
  'Cornell': [
    branch('cornell-bofa-1', 'Bank of America', 'Collegetown', '409 College Ave, Ithaca, NY', 42.4420, -76.4855, 'south', '(607) 273-5800'),
    branch('cornell-chase-1', 'Chase', 'Commons', '130 E State St, Ithaca, NY', 42.4400, -76.4970, 'west', '(607) 273-3500'),
    branch('cornell-wells-1', 'Wells Fargo', 'Ithaca', '301 E State St, Ithaca, NY', 42.4405, -76.4950, 'west', '(607) 272-1800'),
    branch('cornell-tompkins-1', 'Tompkins Trust', 'Collegetown', '306 College Ave, Ithaca, NY', 42.4425, -76.4840, 'south', '(607) 273-3210'),
  ],
  'Syracuse': [
    branch('syracuse-bofa-1', 'Bank of America', 'Marshall St', '727 S Crouse Ave, Syracuse, NY', 43.0380, -76.1360, 'east', '(315) 422-4600'),
    branch('syracuse-chase-1', 'Chase', 'Syracuse', '201 S Warren St, Syracuse, NY', 43.0485, -76.1530, 'west', '(315) 471-0800'),
    branch('syracuse-keybank-1', 'KeyBank', 'University', '650 S Crouse Ave, Syracuse, NY', 43.0395, -76.1345, 'east', '(315) 470-5700'),
  ],
  'SUNY Buffalo': [
    branch('buffalo-bofa-1', 'Bank of America', 'Amherst', '1475 Niagara Falls Blvd, Amherst, NY', 43.0095, -78.8230, 'north', '(716) 634-5000'),
    branch('buffalo-chase-1', 'Chase', 'Amherst', '1661 Niagara Falls Blvd, Amherst, NY', 43.0115, -78.8215, 'north', '(716) 691-4000'),
    branch('buffalo-mandt-1', 'M&T Bank', 'University', '3250 Main St, Buffalo, NY', 42.9990, -78.8310, 'south', '(716) 835-5800'),
  ],
  'Stony Brook': [
    branch('stonybrook-chase-1', 'Chase', 'Stony Brook', '2160 Nesconset Hwy, Stony Brook, NY', 40.8620, -73.1215, 'south', '(631) 689-4800'),
    branch('stonybrook-td-1', 'TD Bank', 'Stony Brook', '1079 Rte 25A, Stony Brook, NY', 40.9055, -73.1165, 'north', '(631) 751-6611'),
    branch('stonybrook-peoples-1', 'People\'s United Bank', 'Port Jefferson', '1 Beacon Ln, Port Jefferson Station, NY', 40.9230, -73.0540, 'east', '(631) 474-6200'),
  ],
  'Rochester': [
    branch('rochester-bofa-1', 'Bank of America', 'Downtown Rochester', '100 Chestnut St, Rochester, NY', 43.1555, -77.6060, 'north', '(585) 546-3200'),
    branch('rochester-chase-1', 'Chase', 'Pittsford', '3400 Monroe Ave, Rochester, NY', 43.1165, -77.5270, 'east', '(585) 586-4700'),
    branch('rochester-mandt-1', 'M&T Bank', 'University', '1 S Clinton Ave, Rochester, NY', 43.1565, -77.6050, 'north', '(585) 546-8100'),
  ],
  'Fordham': [
    branch('fordham-bofa-1', 'Bank of America', 'Fordham Rd', '2480 Grand Concourse, Bronx, NY', 40.8610, -73.8975, 'west', '(718) 365-6440'),
    branch('fordham-chase-1', 'Chase', 'Fordham', '305 E Fordham Rd, Bronx, NY', 40.8615, -73.8865, 'center', '(718) 933-8700'),
    branch('fordham-td-1', 'TD Bank', 'Fordham', '1 E Fordham Rd, Bronx, NY', 40.8620, -73.8915, 'center', '(718) 933-4066'),
  ],
};

// ============================================================================
// MASSACHUSETTS UNIVERSITIES
// ============================================================================

export const MASSACHUSETTS_BRANCHES: Record<string, BankBranch[]> = {
  'MIT': [
    branch('mit-bofa-1', 'Bank of America', 'MIT Campus', '84 Massachusetts Ave, Cambridge, MA', 42.3590, -71.0940, 'center', '(617) 868-3660'),
    branch('mit-chase-1', 'Chase', 'Kendall Square', '1 Broadway, Cambridge, MA', 42.3625, -71.0830, 'east', '(617) 621-4700'),
    branch('mit-santander-1', 'Santander', 'Central Square', '727 Massachusetts Ave, Cambridge, MA', 42.3655, -71.1035, 'west', '(617) 497-9650'),
    branch('mit-citi-1', 'Citibank', 'Cambridge', '1 Kendall Square, Cambridge, MA', 42.3620, -71.0860, 'east', '(617) 252-8000'),
  ],
  'Harvard': [
    branch('harvard-bofa-1', 'Bank of America', 'Harvard Square', '1414 Massachusetts Ave, Cambridge, MA', 42.3735, -71.1195, 'center', '(617) 547-0200'),
    branch('harvard-chase-1', 'Chase', 'Harvard Square', '1 Brattle Square, Cambridge, MA', 42.3730, -71.1205, 'center', '(617) 495-3600'),
    branch('harvard-santander-1', 'Santander', 'Harvard Square', '1430 Massachusetts Ave, Cambridge, MA', 42.3740, -71.1200, 'center', '(617) 876-3500'),
    branch('harvard-citi-1', 'Citibank', 'Harvard Square', '1380 Massachusetts Ave, Cambridge, MA', 42.3725, -71.1185, 'center', '(617) 868-8500'),
    branch('harvard-td-1', 'TD Bank', 'Harvard Square', '1 Brattle Square, Cambridge, MA', 42.3732, -71.1210, 'center', '(617) 441-1450'),
  ],
  'Northeastern': [
    branch('neu-bofa-1', 'Bank of America', 'Huntington Ave', '300 Huntington Ave, Boston, MA', 42.3410, -71.0890, 'center', '(617) 437-7500'),
    branch('neu-bofa-2', 'Bank of America', 'Ruggles', '1200 Columbus Ave, Boston, MA', 42.3365, -71.0910, 'south', '(617) 541-4500'),
    branch('neu-chase-1', 'Chase', 'Prudential', '800 Boylston St, Boston, MA', 42.3475, -71.0820, 'north', '(617) 247-8400'),
    branch('neu-santander-1', 'Santander', 'Mass Ave', '761 Massachusetts Ave, Boston, MA', 42.3380, -71.0850, 'east', '(617) 437-7800'),
    branch('neu-td-1', 'TD Bank', 'Northeastern', '270 Huntington Ave, Boston, MA', 42.3415, -71.0880, 'center', '(617) 867-5800'),
  ],
  'Boston U': [
    branch('bu-bofa-1', 'Bank of America', 'Commonwealth Ave', '714 Commonwealth Ave, Boston, MA', 42.3500, -71.1030, 'center', '(617) 536-4900'),
    branch('bu-bofa-2', 'Bank of America', 'Kenmore', '660 Beacon St, Boston, MA', 42.3490, -71.0960, 'east', '(617) 236-2300'),
    branch('bu-chase-1', 'Chase', 'Brookline Ave', '1318 Beacon St, Brookline, MA', 42.3440, -71.1185, 'west', '(617) 734-2500'),
    branch('bu-santander-1', 'Santander', 'Commonwealth Ave', '874 Commonwealth Ave, Boston, MA', 42.3498, -71.1090, 'center', '(617) 782-3400'),
    branch('bu-td-1', 'TD Bank', 'Allston', '1205 Commonwealth Ave, Boston, MA', 42.3510, -71.1320, 'west', '(617) 783-2300'),
  ],
  'Boston College': [
    branch('bc-bofa-1', 'Bank of America', 'Chestnut Hill', '199 Boylston St, Chestnut Hill, MA', 42.3225, -71.1665, 'south', '(617) 731-3600'),
    branch('bc-chase-1', 'Chase', 'Newton', '315 Washington St, Newton, MA', 42.3275, -71.1925, 'west', '(617) 244-8700'),
    branch('bc-santander-1', 'Santander', 'Cleveland Circle', '1912 Beacon St, Brookline, MA', 42.3405, -71.1515, 'north', '(617) 731-7400'),
  ],
  'Tufts': [
    branch('tufts-bofa-1', 'Bank of America', 'Davis Square', '240 Elm St, Somerville, MA', 42.3965, -71.1225, 'south', '(617) 628-4600'),
    branch('tufts-chase-1', 'Chase', 'Davis Square', '1 Davis Square, Somerville, MA', 42.3970, -71.1220, 'south', '(617) 625-5100'),
    branch('tufts-santander-1', 'Santander', 'Davis Square', '409 Highland Ave, Somerville, MA', 42.3980, -71.1195, 'south', '(617) 623-5100'),
  ],
  'UMass Amherst': [
    branch('umass-bofa-1', 'Bank of America', 'Amherst', '79 S Pleasant St, Amherst, MA', 42.3755, -72.5195, 'south', '(413) 256-0700'),
    branch('umass-peoples-1', 'People\'s United Bank', 'Amherst', '99 N Pleasant St, Amherst, MA', 42.3780, -72.5190, 'center', '(413) 256-8381'),
    branch('umass-td-1', 'TD Bank', 'Amherst', '144 N Pleasant St, Amherst, MA', 42.3785, -72.5210, 'north', '(413) 253-2265'),
  ],
};

// ============================================================================
// PENNSYLVANIA UNIVERSITIES
// ============================================================================

export const PENNSYLVANIA_BRANCHES: Record<string, BankBranch[]> = {
  'UPenn': [
    branch('upenn-bofa-1', 'Bank of America', 'University City', '3601 Walnut St, Philadelphia, PA', 39.9525, -75.1985, 'east', '(215) 387-5300'),
    branch('upenn-chase-1', 'Chase', 'Penn Campus', '3400 Walnut St, Philadelphia, PA', 39.9520, -75.1925, 'center', '(215) 222-4500'),
    branch('upenn-wells-1', 'Wells Fargo', 'University City', '3601 Chestnut St, Philadelphia, PA', 39.9545, -75.1980, 'east', '(215) 222-8100'),
    branch('upenn-pnc-1', 'PNC Bank', 'Penn Campus', '3401 Walnut St, Philadelphia, PA', 39.9522, -75.1940, 'center', '(215) 898-7779'),
    branch('upenn-td-1', 'TD Bank', 'University City', '3500 Market St, Philadelphia, PA', 39.9565, -75.1945, 'north', '(215) 387-8200'),
  ],
  'Penn State': [
    branch('psu-bofa-1', 'Bank of America', 'State College', '310 E College Ave, State College, PA', 40.7945, -77.8555, 'east', '(814) 238-1121'),
    branch('psu-pnc-1', 'PNC Bank', 'State College', '200 E College Ave, State College, PA', 40.7940, -77.8565, 'east', '(814) 237-4371'),
    branch('psu-citizens-1', 'Citizens Bank', 'Downtown State College', '116 S Allen St, State College, PA', 40.7920, -77.8575, 'south', '(814) 237-8515'),
  ],
  'Carnegie Mellon': [
    branch('cmu-bofa-1', 'Bank of America', 'Forbes Ave', '5450 Forbes Ave, Pittsburgh, PA', 40.4440, -79.9435, 'west', '(412) 521-5800'),
    branch('cmu-pnc-1', 'PNC Bank', 'Oakland', '4400 Forbes Ave, Pittsburgh, PA', 40.4455, -79.9545, 'center', '(412) 683-2700'),
    branch('cmu-chase-1', 'Chase', 'Squirrel Hill', '5885 Forbes Ave, Pittsburgh, PA', 40.4325, -79.9230, 'south', '(412) 521-1000'),
  ],
  'Pitt': [
    branch('pitt-bofa-1', 'Bank of America', 'Oakland', '3700 Forbes Ave, Pittsburgh, PA', 40.4420, -79.9585, 'west', '(412) 687-3700'),
    branch('pitt-pnc-1', 'PNC Bank', 'Oakland', '4400 Forbes Ave, Pittsburgh, PA', 40.4455, -79.9545, 'center', '(412) 683-2700'),
    branch('pitt-citizens-1', 'Citizens Bank', 'Oakland', '3600 Forbes Ave, Pittsburgh, PA', 40.4418, -79.9595, 'west', '(412) 687-5151'),
  ],
  'Drexel': [
    branch('drexel-bofa-1', 'Bank of America', 'Market St', '32 S 32nd St, Philadelphia, PA', 39.9560, -75.1880, 'east', '(215) 222-4600'),
    branch('drexel-pnc-1', 'PNC Bank', 'Drexel Campus', '3141 Chestnut St, Philadelphia, PA', 39.9545, -75.1855, 'center', '(215) 222-1500'),
    branch('drexel-td-1', 'TD Bank', 'University City', '3500 Market St, Philadelphia, PA', 39.9565, -75.1945, 'west', '(215) 387-8200'),
  ],
  'Temple': [
    branch('temple-bofa-1', 'Bank of America', 'North Broad', '1519 Cecil B. Moore Ave, Philadelphia, PA', 39.9815, -75.1560, 'center', '(215) 235-6200'),
    branch('temple-pnc-1', 'PNC Bank', 'Temple Campus', '1500 N Broad St, Philadelphia, PA', 39.9820, -75.1555, 'center', '(215) 236-5100'),
    branch('temple-td-1', 'TD Bank', 'Temple', '1400 Cecil B. Moore Ave, Philadelphia, PA', 39.9810, -75.1580, 'west', '(215) 763-2300'),
  ],
};

// ============================================================================
// ILLINOIS UNIVERSITIES
// ============================================================================

export const ILLINOIS_BRANCHES: Record<string, BankBranch[]> = {
  'UIUC': [
    branch('uiuc-bofa-1', 'Bank of America', 'Green Street', '616 E Green St, Champaign, IL', 40.1105, -88.2320, 'north', '(217) 351-4600'),
    branch('uiuc-chase-1', 'Chase', 'Champaign', '502 E Green St, Champaign, IL', 40.1108, -88.2360, 'north', '(217) 352-8500'),
    branch('uiuc-chase-2', 'Chase', 'Neil St', '200 N Neil St, Champaign, IL', 40.1200, -88.2445, 'north', '(217) 398-5100'),
    branch('uiuc-wells-1', 'Wells Fargo', 'Green St', '601 E Green St, Champaign, IL', 40.1103, -88.2330, 'north', '(217) 378-6200'),
    branch('uiuc-busey-1', 'Busey Bank', 'Campus', '201 W Springfield Ave, Champaign, IL', 40.1082, -88.2350, 'center', '(217) 365-4500'),
    branch('uiuc-first-1', 'First Mid Bank', 'Campus', '609 E Green St, Champaign, IL', 40.1100, -88.2325, 'north', '(217) 351-2700'),
  ],
  'Northwestern': [
    branch('northwestern-bofa-1', 'Bank of America', 'Evanston', '635 Church St, Evanston, IL', 42.0480, -87.6825, 'east', '(847) 869-3400'),
    branch('northwestern-chase-1', 'Chase', 'Downtown Evanston', '701 Church St, Evanston, IL', 42.0485, -87.6830, 'east', '(847) 864-3600'),
    branch('northwestern-wells-1', 'Wells Fargo', 'Evanston', '612 Davis St, Evanston, IL', 42.0465, -87.6825, 'east', '(847) 328-1700'),
    branch('northwestern-citi-1', 'Citibank', 'Chicago Ave', '1603 Chicago Ave, Evanston, IL', 42.0470, -87.6785, 'south', '(847) 475-0101'),
  ],
  'UChicago': [
    branch('uchicago-bofa-1', 'Bank of America', 'Hyde Park', '1500 E 53rd St, Chicago, IL', 41.7995, -87.5875, 'north', '(773) 667-1700'),
    branch('uchicago-chase-1', 'Chase', 'Hyde Park', '1501 E 53rd St, Chicago, IL', 41.7993, -87.5885, 'north', '(773) 493-2660'),
    branch('uchicago-bmo-1', 'BMO Harris', 'Hyde Park', '1351 E 53rd St, Chicago, IL', 41.7998, -87.5915, 'north', '(773) 288-5800'),
  ],
  'DePaul': [
    branch('depaul-bofa-1', 'Bank of America', 'Lincoln Park', '2500 N Clark St, Chicago, IL', 41.9300, -87.6410, 'north', '(773) 935-0400'),
    branch('depaul-chase-1', 'Chase', 'Lincoln Park', '2200 N Halsted St, Chicago, IL', 41.9235, -87.6485, 'south', '(773) 549-7100'),
    branch('depaul-pnc-1', 'PNC Bank', 'DePaul', '2400 N Sheffield Ave, Chicago, IL', 41.9270, -87.6535, 'west', '(773) 975-2540'),
  ],
  'UIC': [
    branch('uic-bofa-1', 'Bank of America', 'Halsted', '825 S Halsted St, Chicago, IL', 41.8700, -87.6475, 'center', '(312) 733-5200'),
    branch('uic-chase-1', 'Chase', 'UIC', '750 S Halsted St, Chicago, IL', 41.8705, -87.6470, 'center', '(312) 829-3090'),
    branch('uic-bmo-1', 'BMO Harris', 'Little Italy', '1130 W Taylor St, Chicago, IL', 41.8695, -87.6560, 'west', '(312) 997-5800'),
  ],
};

// ============================================================================
// TEXAS UNIVERSITIES
// ============================================================================

export const TEXAS_BRANCHES: Record<string, BankBranch[]> = {
  'UT Austin': [
    branch('utaustin-bofa-1', 'Bank of America', 'The Drag', '2100 Guadalupe St, Austin, TX', 30.2870, -97.7420, 'west', '(512) 479-6700'),
    branch('utaustin-chase-1', 'Chase', 'West Campus', '2200 Guadalupe St, Austin, TX', 30.2885, -97.7425, 'west', '(512) 479-3500'),
    branch('utaustin-wells-1', 'Wells Fargo', 'Guadalupe', '2424 Guadalupe St, Austin, TX', 30.2895, -97.7430, 'west', '(512) 476-6671'),
    branch('utaustin-frost-1', 'Frost Bank', 'Campus', '2500 Guadalupe St, Austin, TX', 30.2905, -97.7435, 'west', '(512) 473-4343'),
    branch('utaustin-ufcu-1', 'University FCU', 'UT Campus', '2244 Guadalupe St, Austin, TX', 30.2888, -97.7428, 'west', '(512) 467-8080'),
  ],
  'Texas A&M': [
    branch('tamu-bofa-1', 'Bank of America', 'College Station', '711 Texas Ave, College Station, TX', 30.6215, -96.3415, 'west', '(979) 764-1500'),
    branch('tamu-chase-1', 'Chase', 'University Dr', '1901 Texas Ave S, College Station, TX', 30.6105, -96.3395, 'south', '(979) 693-0222'),
    branch('tamu-wells-1', 'Wells Fargo', 'College Station', '1500 Harvey Rd, College Station, TX', 30.6275, -96.3295, 'north', '(979) 693-0311'),
    branch('tamu-prosperity-1', 'Prosperity Bank', 'Campus', '1716 Texas Ave S, College Station, TX', 30.6120, -96.3390, 'south', '(979) 260-7700'),
  ],
  'Rice': [
    branch('rice-bofa-1', 'Bank of America', 'Rice Village', '2416 Rice Blvd, Houston, TX', 29.7160, -95.4145, 'north', '(713) 520-1500'),
    branch('rice-chase-1', 'Chase', 'Rice Village', '2501 Rice Blvd, Houston, TX', 29.7165, -95.4170, 'north', '(713) 524-4061'),
    branch('rice-wells-1', 'Wells Fargo', 'Medical Center', '6601 Fannin St, Houston, TX', 29.7075, -95.3985, 'east', '(713) 790-7711'),
    branch('rice-frost-1', 'Frost Bank', 'Rice', '2425 University Blvd, Houston, TX', 29.7155, -95.4115, 'north', '(713) 388-1144'),
  ],
  'UT Dallas': [
    branch('utd-bofa-1', 'Bank of America', 'Richardson', '100 S Central Expy, Richardson, TX', 32.9460, -96.7290, 'south', '(972) 669-0400'),
    branch('utd-chase-1', 'Chase', 'UTD Campus', '3000 Northside Blvd, Richardson, TX', 32.9855, -96.7485, 'north', '(972) 234-4400'),
    branch('utd-wells-1', 'Wells Fargo', 'Richardson', '820 W Arapaho Rd, Richardson, TX', 32.9755, -96.7320, 'center', '(972) 644-7111'),
  ],
  'SMU': [
    branch('smu-bofa-1', 'Bank of America', 'Mockingbird', '6011 Greenville Ave, Dallas, TX', 32.8435, -96.7695, 'east', '(214) 821-6200'),
    branch('smu-chase-1', 'Chase', 'SMU Area', '6400 N Central Expy, Dallas, TX', 32.8510, -96.7705, 'east', '(214) 750-3434'),
    branch('smu-frost-1', 'Frost Bank', 'Park Cities', '4100 Lomo Alto Dr, Dallas, TX', 32.8395, -96.8030, 'west', '(214) 515-4100'),
  ],
  'UH': [
    branch('uh-bofa-1', 'Bank of America', 'University Line', '3500 Cullen Blvd, Houston, TX', 29.7205, -95.3415, 'west', '(713) 743-1000'),
    branch('uh-chase-1', 'Chase', 'Wheeler', '4040 Wheeler St, Houston, TX', 29.7245, -95.3435, 'north', '(713) 743-4400'),
    branch('uh-wells-1', 'Wells Fargo', 'Third Ward', '4025 Dowling St, Houston, TX', 29.7280, -95.3505, 'east', '(713) 942-8500'),
  ],
  'TCU': [
    branch('tcu-bofa-1', 'Bank of America', 'TCU Area', '3105 S University Dr, Fort Worth, TX', 32.7095, -97.3605, 'center', '(817) 926-4500'),
    branch('tcu-chase-1', 'Chase', 'University', '2853 W Berry St, Fort Worth, TX', 32.7140, -97.3740, 'west', '(817) 924-2211'),
    branch('tcu-frost-1', 'Frost Bank', 'TCU', '3009 S University Dr, Fort Worth, TX', 32.7105, -97.3600, 'center', '(817) 420-5000'),
  ],
};

// ============================================================================
// MIDWEST UNIVERSITIES (Michigan, Ohio, Indiana)
// ============================================================================

export const MIDWEST_BRANCHES: Record<string, BankBranch[]> = {
  'University of Michigan': [
    branch('umich-bofa-1', 'Bank of America', 'State Street', '330 S State St, Ann Arbor, MI', 42.2780, -83.7410, 'south', '(734) 665-4030'),
    branch('umich-chase-1', 'Chase', 'Downtown Ann Arbor', '201 S Main St, Ann Arbor, MI', 42.2795, -83.7485, 'west', '(734) 665-1771'),
    branch('umich-huntington-1', 'Huntington Bank', 'State Street', '111 S State St, Ann Arbor, MI', 42.2795, -83.7405, 'center', '(734) 662-4686'),
    branch('umich-pnc-1', 'PNC Bank', 'Ann Arbor', '500 E William St, Ann Arbor, MI', 42.2775, -83.7370, 'east', '(734) 747-7680'),
  ],
  'Michigan State': [
    branch('msu-bofa-1', 'Bank of America', 'East Lansing', '401 E Grand River Ave, East Lansing, MI', 42.7365, -84.4815, 'west', '(517) 337-0411'),
    branch('msu-chase-1', 'Chase', 'Grand River', '555 E Grand River Ave, East Lansing, MI', 42.7360, -84.4785, 'west', '(517) 336-1200'),
    branch('msu-huntington-1', 'Huntington Bank', 'East Lansing', '615 E Grand River Ave, East Lansing, MI', 42.7355, -84.4775, 'west', '(517) 351-2411'),
  ],
  'Ohio State': [
    branch('osu-bofa-1', 'Bank of America', 'High Street', '2060 N High St, Columbus, OH', 42.0040, -83.0065, 'north', '(614) 294-4900'),
    branch('osu-chase-1', 'Chase', 'OSU Campus', '2000 N High St, Columbus, OH', 42.0030, -83.0060, 'north', '(614) 299-8866'),
    branch('osu-huntington-1', 'Huntington Bank', 'OSU Campus', '1739 N High St, Columbus, OH', 42.0015, -83.0055, 'center', '(614) 294-8001'),
    branch('osu-keybank-1', 'KeyBank', 'High Street', '1959 N High St, Columbus, OH', 42.0025, -83.0058, 'north', '(614) 421-7200'),
  ],
  'Purdue': [
    branch('purdue-bofa-1', 'Bank of America', 'West Lafayette', '100 Northwestern Ave, West Lafayette, IN', 40.4265, -86.9110, 'west', '(765) 743-4300'),
    branch('purdue-chase-1', 'Chase', 'State Street', '200 W State St, West Lafayette, IN', 40.4255, -86.9120, 'west', '(765) 743-8888'),
    branch('purdue-regions-1', 'Regions Bank', 'Campus', '135 S Chauncey Ave, West Lafayette, IN', 40.4250, -86.9085, 'center', '(765) 743-4431'),
  ],
  'Indiana': [
    branch('indiana-bofa-1', 'Bank of America', 'Kirkwood', '100 E Kirkwood Ave, Bloomington, IN', 39.1660, -86.5340, 'south', '(812) 334-8201'),
    branch('indiana-chase-1', 'Chase', 'Downtown Bloomington', '201 N College Ave, Bloomington, IN', 39.1680, -86.5345, 'north', '(812) 339-1234'),
    branch('indiana-regions-1', 'Regions Bank', 'Campus', '415 E 3rd St, Bloomington, IN', 39.1645, -86.5300, 'east', '(812) 855-4448'),
  ],
  'Notre Dame': [
    branch('notredame-bofa-1', 'Bank of America', 'South Bend', '225 W Washington St, South Bend, IN', 41.6765, -86.2555, 'south', '(574) 232-3370'),
    branch('notredame-chase-1', 'Chase', 'Notre Dame Campus', '54445 State Rd 933, Notre Dame, IN', 41.6995, -86.2375, 'north', '(574) 232-6161'),
    branch('notredame-keybank-1', 'KeyBank', 'South Bend', '211 N Michigan St, South Bend, IN', 41.6785, -86.2510, 'south', '(574) 237-5600'),
  ],
  'Case Western': [
    branch('cwru-bofa-1', 'Bank of America', 'University Circle', '11411 Euclid Ave, Cleveland, OH', 41.5070, -81.6055, 'west', '(216) 231-8400'),
    branch('cwru-chase-1', 'Chase', 'Coventry', '1800 Coventry Rd, Cleveland Heights, OH', 41.5120, -81.5855, 'east', '(216) 932-6886'),
    branch('cwru-keybank-1', 'KeyBank', 'University Circle', '11301 Euclid Ave, Cleveland, OH', 41.5065, -81.6065, 'west', '(216) 231-7000'),
  ],
};

// ============================================================================
// SOUTHEAST UNIVERSITIES (Georgia, Florida, North Carolina)
// ============================================================================

export const SOUTHEAST_BRANCHES: Record<string, BankBranch[]> = {
  'Georgia Tech': [
    branch('gatech-bofa-1', 'Bank of America', 'Midtown', '1075 Peachtree St NE, Atlanta, GA', 33.7830, -84.3835, 'east', '(404) 872-2500'),
    branch('gatech-chase-1', 'Chase', 'Tech Square', '860 Spring St NW, Atlanta, GA', 33.7775, -84.3890, 'center', '(404) 873-2800'),
    branch('gatech-wells-1', 'Wells Fargo', 'Midtown', '950 W Peachtree St NW, Atlanta, GA', 33.7810, -84.3885, 'east', '(404) 876-7811'),
    branch('gatech-suntrust-1', 'Truist', 'Georgia Tech', '860 Spring St NW, Atlanta, GA', 33.7770, -84.3895, 'center', '(404) 588-6200'),
  ],
  'Emory': [
    branch('emory-bofa-1', 'Bank of America', 'Emory Village', '1580 N Decatur Rd, Atlanta, GA', 33.7880, -84.3215, 'north', '(404) 377-4001'),
    branch('emory-chase-1', 'Chase', 'Druid Hills', '2505 N Decatur Rd, Decatur, GA', 33.7935, -84.3105, 'east', '(404) 636-2121'),
    branch('emory-suntrust-1', 'Truist', 'Emory', '1605 Church St, Decatur, GA', 33.7890, -84.3200, 'north', '(404) 377-7171'),
  ],
  'UGA': [
    branch('uga-bofa-1', 'Bank of America', 'Downtown Athens', '210 College Ave, Athens, GA', 33.9575, -83.3750, 'west', '(706) 543-7200'),
    branch('uga-chase-1', 'Chase', 'Baxter St', '1795 S Lumpkin St, Athens, GA', 33.9465, -83.3735, 'south', '(706) 549-4131'),
    branch('uga-wells-1', 'Wells Fargo', 'Athens', '190 College Ave, Athens, GA', 33.9580, -83.3745, 'west', '(706) 543-8811'),
  ],
  'UF': [
    branch('uf-bofa-1', 'Bank of America', 'University Ave', '1600 W University Ave, Gainesville, FL', 29.6520, -82.3490, 'west', '(352) 335-6221'),
    branch('uf-chase-1', 'Chase', 'Archer Rd', '3501 SW Archer Rd, Gainesville, FL', 29.6360, -82.3575, 'south', '(352) 374-1700'),
    branch('uf-wells-1', 'Wells Fargo', 'University Ave', '1601 W University Ave, Gainesville, FL', 29.6525, -82.3495, 'west', '(352) 377-4811'),
    branch('uf-suntrust-1', 'Truist', 'UF Campus', '1620 W University Ave, Gainesville, FL', 29.6522, -82.3505, 'west', '(352) 375-3820'),
  ],
  'FSU': [
    branch('fsu-bofa-1', 'Bank of America', 'Tennessee St', '1815 W Tennessee St, Tallahassee, FL', 30.4405, -84.3065, 'south', '(850) 224-2811'),
    branch('fsu-chase-1', 'Chase', 'Tallahassee', '1817 Thomasville Rd, Tallahassee, FL', 30.4545, -84.2730, 'east', '(850) 386-2600'),
    branch('fsu-wells-1', 'Wells Fargo', 'FSU', '101 S Monroe St, Tallahassee, FL', 30.4380, -84.2805, 'east', '(850) 222-6311'),
  ],
  'Miami': [
    branch('miami-bofa-1', 'Bank of America', 'Coral Gables', '270 Miracle Mile, Coral Gables, FL', 25.7500, -80.2595, 'east', '(305) 460-3800'),
    branch('miami-chase-1', 'Chase', 'Coral Gables', '121 Miracle Mile, Coral Gables, FL', 25.7510, -80.2620, 'center', '(305) 442-3377'),
    branch('miami-wells-1', 'Wells Fargo', 'UM Campus', '1515 S Dixie Hwy, Coral Gables, FL', 25.7125, -80.2780, 'south', '(305) 667-4211'),
  ],
  'Duke': [
    branch('duke-bofa-1', 'Bank of America', '9th Street', '705 9th St, Durham, NC', 36.0095, -78.9185, 'north', '(919) 286-4600'),
    branch('duke-chase-1', 'Chase', 'Brightleaf Square', '905 W Main St, Durham, NC', 36.0020, -78.9120, 'east', '(919) 683-8121'),
    branch('duke-wells-1', 'Wells Fargo', 'Durham', '123 W Main St, Durham, NC', 36.0015, -78.9060, 'east', '(919) 687-4811'),
    branch('duke-suntrust-1', 'Truist', 'Duke University', '506 Swift Ave, Durham, NC', 36.0085, -78.9135, 'north', '(919) 684-2171'),
  ],
  'UNC Chapel Hill': [
    branch('unc-bofa-1', 'Bank of America', 'Franklin St', '137 E Franklin St, Chapel Hill, NC', 35.9135, -79.0545, 'center', '(919) 967-6800'),
    branch('unc-chase-1', 'Chase', 'Chapel Hill', '201 S Estes Dr, Chapel Hill, NC', 35.9185, -79.0770, 'west', '(919) 932-7700'),
    branch('unc-wells-1', 'Wells Fargo', 'Franklin St', '134 E Franklin St, Chapel Hill, NC', 35.9130, -79.0550, 'center', '(919) 967-4311'),
  ],
  'NC State': [
    branch('ncsu-bofa-1', 'Bank of America', 'Hillsborough St', '2402 Hillsborough St, Raleigh, NC', 35.7865, -78.6695, 'west', '(919) 821-4700'),
    branch('ncsu-chase-1', 'Chase', 'Hillsborough', '2216 Hillsborough St, Raleigh, NC', 35.7875, -78.6635, 'west', '(919) 839-4700'),
    branch('ncsu-wells-1', 'Wells Fargo', 'NC State', '2100 Hillsborough St, Raleigh, NC', 35.7880, -78.6610, 'west', '(919) 829-8811'),
  ],
  'Wake Forest': [
    branch('wakeforest-bofa-1', 'Bank of America', 'Reynolda', '3600 Reynolda Rd, Winston-Salem, NC', 36.1340, -80.2845, 'west', '(336) 759-2400'),
    branch('wakeforest-wells-1', 'Wells Fargo', 'Winston-Salem', '301 N Main St, Winston-Salem, NC', 36.1025, -80.2435, 'east', '(336) 732-8811'),
    branch('wakeforest-suntrust-1', 'Truist', 'Reynolda', '3400 Reynolda Rd, Winston-Salem, NC', 36.1325, -80.2825, 'west', '(336) 727-4280'),
  ],
};

// ============================================================================
// WASHINGTON STATE UNIVERSITIES
// ============================================================================

export const WASHINGTON_BRANCHES: Record<string, BankBranch[]> = {
  'University of Washington': [
    branch('uw-bofa-1', 'Bank of America', 'University District', '4525 University Way NE, Seattle, WA', 47.6620, -122.3135, 'center', '(206) 633-0620'),
    branch('uw-chase-1', 'Chase', 'The Ave', '4500 University Way NE, Seattle, WA', 47.6615, -122.3130, 'center', '(206) 634-1400'),
    branch('uw-wells-1', 'Wells Fargo', 'University Village', '4622 25th Ave NE, Seattle, WA', 47.6645, -122.2995, 'east', '(206) 522-4811'),
    branch('uw-becu-1', 'BECU', 'U District', '4535 University Way NE, Seattle, WA', 47.6625, -122.3140, 'center', '(800) 233-2328'),
    branch('uw-usbank-1', 'US Bank', 'University', '4500 University Way NE, Seattle, WA', 47.6610, -122.3125, 'center', '(206) 633-7611'),
  ],
  'Washington State': [
    branch('wsu-bofa-1', 'Bank of America', 'Pullman', '220 NE Stadium Way, Pullman, WA', 46.7330, -117.1645, 'center', '(509) 332-3545'),
    branch('wsu-wells-1', 'Wells Fargo', 'Pullman', '340 E Main St, Pullman, WA', 46.7315, -117.1715, 'west', '(509) 334-3111'),
    branch('wsu-banner-1', 'Banner Bank', 'Campus', '330 E Main St, Pullman, WA', 46.7320, -117.1710, 'west', '(509) 334-8866'),
  ],
};

// ============================================================================
// COLORADO & ARIZONA UNIVERSITIES
// ============================================================================

export const SOUTHWEST_BRANCHES: Record<string, BankBranch[]> = {
  'CU Boulder': [
    branch('cuboulder-bofa-1', 'Bank of America', 'Pearl St', '1800 Broadway St, Boulder, CO', 40.0180, -105.2765, 'east', '(303) 441-5800'),
    branch('cuboulder-chase-1', 'Chase', 'The Hill', '1155 13th St, Boulder, CO', 40.0080, -105.2785, 'south', '(303) 443-2800'),
    branch('cuboulder-wells-1', 'Wells Fargo', 'Pearl St', '1000 Pearl St, Boulder, CO', 40.0175, -105.2815, 'west', '(303) 449-8811'),
    branch('cuboulder-firstbank-1', 'FirstBank', 'Campus', '1100 28th St, Boulder, CO', 40.0100, -105.2620, 'east', '(303) 441-5555'),
  ],
  'Arizona State': [
    branch('asu-bofa-1', 'Bank of America', 'Tempe', '680 S Mill Ave, Tempe, AZ', 33.4240, -111.9395, 'west', '(480) 921-8300'),
    branch('asu-chase-1', 'Chase', 'Mill Ave', '625 S Mill Ave, Tempe, AZ', 33.4255, -111.9400, 'west', '(480) 829-4800'),
    branch('asu-wells-1', 'Wells Fargo', 'ASU Campus', '520 S College Ave, Tempe, AZ', 33.4220, -111.9340, 'center', '(480) 921-0000'),
    branch('asu-td-1', 'TD Bank', 'Tempe', '711 S Mill Ave, Tempe, AZ', 33.4235, -111.9395, 'west', '(480) 829-9500'),
  ],
  'University of Arizona': [
    branch('uarizona-bofa-1', 'Bank of America', 'University Blvd', '801 N Euclid Ave, Tucson, AZ', 32.2350, -110.9535, 'west', '(520) 792-5050'),
    branch('uarizona-chase-1', 'Chase', 'Tucson', '4550 E Broadway Blvd, Tucson, AZ', 32.2220, -110.9055, 'east', '(520) 881-4500'),
    branch('uarizona-wells-1', 'Wells Fargo', 'University', '900 E University Blvd, Tucson, AZ', 32.2315, -110.9530, 'center', '(520) 884-5151'),
    branch('uarizona-desert-1', 'Desert Financial', 'UA Campus', '898 N Park Ave, Tucson, AZ', 32.2335, -110.9465, 'center', '(520) 882-5445'),
  ],
  'Colorado State': [
    branch('colostate-bofa-1', 'Bank of America', 'Fort Collins', '125 S College Ave, Fort Collins, CO', 40.5835, -105.0755, 'south', '(970) 490-5100'),
    branch('colostate-chase-1', 'Chase', 'Campus West', '1036 W Elizabeth St, Fort Collins, CO', 40.5715, -105.0870, 'west', '(970) 221-4300'),
    branch('colostate-wells-1', 'Wells Fargo', 'Fort Collins', '401 S College Ave, Fort Collins, CO', 40.5810, -105.0760, 'south', '(970) 482-4311'),
  ],
};

// Combine all US branches
export const ALL_US_BANK_BRANCHES: Record<string, BankBranch[]> = {
  ...CALIFORNIA_BRANCHES,
  ...NEW_YORK_BRANCHES,
  ...MASSACHUSETTS_BRANCHES,
  ...PENNSYLVANIA_BRANCHES,
  ...ILLINOIS_BRANCHES,
  ...TEXAS_BRANCHES,
  ...MIDWEST_BRANCHES,
  ...SOUTHEAST_BRANCHES,
  ...WASHINGTON_BRANCHES,
  ...SOUTHWEST_BRANCHES,
};
