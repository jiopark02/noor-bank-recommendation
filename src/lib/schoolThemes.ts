// School Theme Data - Colors and Logos for 50+ Universities
// Used for customizing Noor UI with school branding

export interface SchoolTheme {
  id: string;
  name: string;
  short_name: string;
  primary_color: string;
  secondary_color: string;
  accent_color?: string;
  logo_url: string;
  mascot?: string;
  text_on_primary: 'white' | 'black';
}

// Default Noor theme (Loro Piana inspired minimal)
export const DEFAULT_THEME: SchoolTheme = {
  id: 'default',
  name: 'Noor',
  short_name: 'NOOR',
  primary_color: '#000000',
  secondary_color: '#FFFFFF',
  accent_color: '#6B6B6B',
  logo_url: '',
  text_on_primary: 'white',
};

// School themes organized by state/type
export const SCHOOL_THEMES: Record<string, SchoolTheme> = {
  // UC System
  'ucb': {
    id: 'ucb',
    name: 'UC Berkeley',
    short_name: 'Cal',
    primary_color: '#003262',
    secondary_color: '#FDB515',
    logo_url: 'https://upload.wikimedia.org/wikipedia/commons/a/a1/Seal_of_University_of_California%2C_Berkeley.svg',
    mascot: 'Golden Bears',
    text_on_primary: 'white',
  },
  'ucla': {
    id: 'ucla',
    name: 'UCLA',
    short_name: 'UCLA',
    primary_color: '#2774AE',
    secondary_color: '#FFD100',
    logo_url: 'https://upload.wikimedia.org/wikipedia/commons/0/0d/The_University_of_California_UCLA.svg',
    mascot: 'Bruins',
    text_on_primary: 'white',
  },
  'uci': {
    id: 'uci',
    name: 'UC Irvine',
    short_name: 'UCI',
    primary_color: '#0064A4',
    secondary_color: '#FFD200',
    logo_url: 'https://upload.wikimedia.org/wikipedia/en/0/0e/University_of_California%2C_Irvine_seal.svg',
    mascot: 'Anteaters',
    text_on_primary: 'white',
  },
  'ucsd': {
    id: 'ucsd',
    name: 'UC San Diego',
    short_name: 'UCSD',
    primary_color: '#182B49',
    secondary_color: '#C69214',
    logo_url: 'https://upload.wikimedia.org/wikipedia/en/4/44/University_of_California%2C_San_Diego_seal.svg',
    mascot: 'Tritons',
    text_on_primary: 'white',
  },
  'ucsb': {
    id: 'ucsb',
    name: 'UC Santa Barbara',
    short_name: 'UCSB',
    primary_color: '#003660',
    secondary_color: '#FEBC11',
    logo_url: 'https://upload.wikimedia.org/wikipedia/en/b/b5/University_of_California%2C_Santa_Barbara_seal.svg',
    mascot: 'Gauchos',
    text_on_primary: 'white',
  },
  'ucd': {
    id: 'ucd',
    name: 'UC Davis',
    short_name: 'UCD',
    primary_color: '#022851',
    secondary_color: '#FFBF00',
    logo_url: 'https://upload.wikimedia.org/wikipedia/commons/6/68/UC_Davis_Wordmark_Navy_RGB.png',
    mascot: 'Aggies',
    text_on_primary: 'white',
  },
  'ucsc': {
    id: 'ucsc',
    name: 'UC Santa Cruz',
    short_name: 'UCSC',
    primary_color: '#003C6C',
    secondary_color: '#FDC700',
    logo_url: 'https://upload.wikimedia.org/wikipedia/en/a/a2/University_of_California%2C_Santa_Cruz_logo.svg',
    mascot: 'Banana Slugs',
    text_on_primary: 'white',
  },
  'ucr': {
    id: 'ucr',
    name: 'UC Riverside',
    short_name: 'UCR',
    primary_color: '#2D6CC0',
    secondary_color: '#F1AB00',
    logo_url: 'https://upload.wikimedia.org/wikipedia/en/3/36/UCRiversideSeal.svg',
    mascot: 'Highlanders',
    text_on_primary: 'white',
  },
  'ucm': {
    id: 'ucm',
    name: 'UC Merced',
    short_name: 'UCM',
    primary_color: '#002856',
    secondary_color: '#F2A900',
    logo_url: 'https://upload.wikimedia.org/wikipedia/en/8/86/University_of_California%2C_Merced_seal.svg',
    mascot: 'Bobcats',
    text_on_primary: 'white',
  },

  // Private California
  'stanford': {
    id: 'stanford',
    name: 'Stanford University',
    short_name: 'Stanford',
    primary_color: '#8C1515',
    secondary_color: '#FFFFFF',
    accent_color: '#4D4F53',
    logo_url: 'https://upload.wikimedia.org/wikipedia/en/b/b7/Stanford_University_seal_2003.svg',
    mascot: 'Cardinal',
    text_on_primary: 'white',
  },
  'usc': {
    id: 'usc',
    name: 'USC',
    short_name: 'USC',
    primary_color: '#990000',
    secondary_color: '#FFCC00',
    logo_url: 'https://upload.wikimedia.org/wikipedia/commons/9/94/USC_Trojans_logo.svg',
    mascot: 'Trojans',
    text_on_primary: 'white',
  },
  'caltech': {
    id: 'caltech',
    name: 'Caltech',
    short_name: 'Caltech',
    primary_color: '#FF6C0C',
    secondary_color: '#FFFFFF',
    logo_url: 'https://upload.wikimedia.org/wikipedia/en/a/a4/Seal_of_the_California_Institute_of_Technology.svg',
    mascot: 'Beavers',
    text_on_primary: 'white',
  },

  // Ivy League
  'columbia': {
    id: 'columbia',
    name: 'Columbia University',
    short_name: 'Columbia',
    primary_color: '#B9D9EB',
    secondary_color: '#FFFFFF',
    accent_color: '#1D4F91',
    logo_url: 'https://upload.wikimedia.org/wikipedia/commons/f/f1/Columbia_University_shield.svg',
    mascot: 'Lions',
    text_on_primary: 'black',
  },
  'cornell': {
    id: 'cornell',
    name: 'Cornell University',
    short_name: 'Cornell',
    primary_color: '#B31B1B',
    secondary_color: '#FFFFFF',
    logo_url: 'https://upload.wikimedia.org/wikipedia/commons/4/47/Cornell_University_seal.svg',
    mascot: 'Big Red',
    text_on_primary: 'white',
  },
  'upenn': {
    id: 'upenn',
    name: 'University of Pennsylvania',
    short_name: 'Penn',
    primary_color: '#011F5B',
    secondary_color: '#990000',
    logo_url: 'https://upload.wikimedia.org/wikipedia/commons/9/92/UPenn_shield_with_banner.svg',
    mascot: 'Quakers',
    text_on_primary: 'white',
  },
  'harvard': {
    id: 'harvard',
    name: 'Harvard University',
    short_name: 'Harvard',
    primary_color: '#A51C30',
    secondary_color: '#000000',
    logo_url: 'https://upload.wikimedia.org/wikipedia/commons/7/70/Harvard_University_logo.svg',
    mascot: 'Crimson',
    text_on_primary: 'white',
  },
  'yale': {
    id: 'yale',
    name: 'Yale University',
    short_name: 'Yale',
    primary_color: '#00356B',
    secondary_color: '#FFFFFF',
    logo_url: 'https://upload.wikimedia.org/wikipedia/commons/0/07/Yale_University_Shield_1.svg',
    mascot: 'Bulldogs',
    text_on_primary: 'white',
  },
  'princeton': {
    id: 'princeton',
    name: 'Princeton University',
    short_name: 'Princeton',
    primary_color: '#E77500',
    secondary_color: '#000000',
    logo_url: 'https://upload.wikimedia.org/wikipedia/commons/d/d0/Princeton_seal.svg',
    mascot: 'Tigers',
    text_on_primary: 'white',
  },
  'brown': {
    id: 'brown',
    name: 'Brown University',
    short_name: 'Brown',
    primary_color: '#4E3629',
    secondary_color: '#ED1C24',
    logo_url: 'https://upload.wikimedia.org/wikipedia/en/3/31/Brown_University_coat_of_arms.svg',
    mascot: 'Bears',
    text_on_primary: 'white',
  },
  'dartmouth': {
    id: 'dartmouth',
    name: 'Dartmouth College',
    short_name: 'Dartmouth',
    primary_color: '#00693E',
    secondary_color: '#FFFFFF',
    logo_url: 'https://upload.wikimedia.org/wikipedia/en/c/cc/Dartmouth_College_shield.svg',
    mascot: 'Big Green',
    text_on_primary: 'white',
  },

  // Other Top Private
  'mit': {
    id: 'mit',
    name: 'MIT',
    short_name: 'MIT',
    primary_color: '#A31F34',
    secondary_color: '#8A8B8C',
    logo_url: 'https://upload.wikimedia.org/wikipedia/commons/0/0c/MIT_logo.svg',
    mascot: 'Engineers',
    text_on_primary: 'white',
  },
  'nyu': {
    id: 'nyu',
    name: 'New York University',
    short_name: 'NYU',
    primary_color: '#57068C',
    secondary_color: '#FFFFFF',
    logo_url: 'https://upload.wikimedia.org/wikipedia/commons/6/6a/New_York_University_Seal.svg',
    mascot: 'Violets',
    text_on_primary: 'white',
  },
  'northeastern': {
    id: 'northeastern',
    name: 'Northeastern University',
    short_name: 'NEU',
    primary_color: '#D41B2C',
    secondary_color: '#000000',
    logo_url: 'https://upload.wikimedia.org/wikipedia/commons/6/6f/Northeastern_Huskies_logo.svg',
    mascot: 'Huskies',
    text_on_primary: 'white',
  },
  'bu': {
    id: 'bu',
    name: 'Boston University',
    short_name: 'BU',
    primary_color: '#CC0000',
    secondary_color: '#FFFFFF',
    logo_url: 'https://upload.wikimedia.org/wikipedia/en/1/15/Boston_University_Terriers_logo.svg',
    mascot: 'Terriers',
    text_on_primary: 'white',
  },
  'cmu': {
    id: 'cmu',
    name: 'Carnegie Mellon University',
    short_name: 'CMU',
    primary_color: '#C41230',
    secondary_color: '#000000',
    logo_url: 'https://upload.wikimedia.org/wikipedia/en/b/bb/Carnegie_Mellon_University_seal.svg',
    mascot: 'Tartans',
    text_on_primary: 'white',
  },
  'duke': {
    id: 'duke',
    name: 'Duke University',
    short_name: 'Duke',
    primary_color: '#003087',
    secondary_color: '#FFFFFF',
    logo_url: 'https://upload.wikimedia.org/wikipedia/commons/0/04/Duke_Blue_Devils_logo.svg',
    mascot: 'Blue Devils',
    text_on_primary: 'white',
  },
  'northwestern': {
    id: 'northwestern',
    name: 'Northwestern University',
    short_name: 'Northwestern',
    primary_color: '#4E2A84',
    secondary_color: '#FFFFFF',
    logo_url: 'https://upload.wikimedia.org/wikipedia/commons/1/10/Northwestern_N.svg',
    mascot: 'Wildcats',
    text_on_primary: 'white',
  },
  'georgetown': {
    id: 'georgetown',
    name: 'Georgetown University',
    short_name: 'Georgetown',
    primary_color: '#041E42',
    secondary_color: '#63666A',
    logo_url: 'https://upload.wikimedia.org/wikipedia/commons/d/d5/Georgetown_University_Seal.svg',
    mascot: 'Hoyas',
    text_on_primary: 'white',
  },

  // Big Ten
  'uiuc': {
    id: 'uiuc',
    name: 'UIUC',
    short_name: 'Illinois',
    primary_color: '#E84A27',
    secondary_color: '#13294B',
    logo_url: 'https://upload.wikimedia.org/wikipedia/commons/a/af/Illinois_Fighting_Illini_logo.svg',
    mascot: 'Fighting Illini',
    text_on_primary: 'white',
  },
  'umich': {
    id: 'umich',
    name: 'University of Michigan',
    short_name: 'Michigan',
    primary_color: '#00274C',
    secondary_color: '#FFCB05',
    logo_url: 'https://upload.wikimedia.org/wikipedia/commons/f/fb/Michigan_Wolverines_logo.svg',
    mascot: 'Wolverines',
    text_on_primary: 'white',
  },
  'osu': {
    id: 'osu',
    name: 'Ohio State University',
    short_name: 'Ohio State',
    primary_color: '#BB0000',
    secondary_color: '#666666',
    logo_url: 'https://upload.wikimedia.org/wikipedia/commons/c/c1/Ohio_State_Buckeyes_logo.svg',
    mascot: 'Buckeyes',
    text_on_primary: 'white',
  },
  'psu': {
    id: 'psu',
    name: 'Penn State',
    short_name: 'Penn State',
    primary_color: '#041E42',
    secondary_color: '#FFFFFF',
    logo_url: 'https://upload.wikimedia.org/wikipedia/en/3/3a/Penn_State_Nittany_Lions_logo.svg',
    mascot: 'Nittany Lions',
    text_on_primary: 'white',
  },
  'uw-madison': {
    id: 'uw-madison',
    name: 'UW-Madison',
    short_name: 'Wisconsin',
    primary_color: '#C5050C',
    secondary_color: '#FFFFFF',
    logo_url: 'https://upload.wikimedia.org/wikipedia/commons/e/e5/Wisconsin_Badgers_logo.svg',
    mascot: 'Badgers',
    text_on_primary: 'white',
  },
  'purdue': {
    id: 'purdue',
    name: 'Purdue University',
    short_name: 'Purdue',
    primary_color: '#CEB888',
    secondary_color: '#000000',
    logo_url: 'https://upload.wikimedia.org/wikipedia/commons/3/35/Purdue_Boilermakers_logo.svg',
    mascot: 'Boilermakers',
    text_on_primary: 'black',
  },
  'iu': {
    id: 'iu',
    name: 'Indiana University',
    short_name: 'Indiana',
    primary_color: '#990000',
    secondary_color: '#FFFFFF',
    logo_url: 'https://upload.wikimedia.org/wikipedia/commons/4/47/Indiana_Hoosiers_logo.svg',
    mascot: 'Hoosiers',
    text_on_primary: 'white',
  },
  'umn': {
    id: 'umn',
    name: 'University of Minnesota',
    short_name: 'Minnesota',
    primary_color: '#7A0019',
    secondary_color: '#FFCC33',
    logo_url: 'https://upload.wikimedia.org/wikipedia/commons/6/6a/Minnesota_Golden_Gophers_logo.svg',
    mascot: 'Golden Gophers',
    text_on_primary: 'white',
  },

  // Pacific Northwest
  'uw': {
    id: 'uw',
    name: 'University of Washington',
    short_name: 'UW',
    primary_color: '#4B2E83',
    secondary_color: '#B7A57A',
    logo_url: 'https://upload.wikimedia.org/wikipedia/en/5/58/University_of_Washington_seal.svg',
    mascot: 'Huskies',
    text_on_primary: 'white',
  },
  'oregon': {
    id: 'oregon',
    name: 'University of Oregon',
    short_name: 'Oregon',
    primary_color: '#154733',
    secondary_color: '#FEE123',
    logo_url: 'https://upload.wikimedia.org/wikipedia/commons/f/f8/Oregon_Ducks_logo.svg',
    mascot: 'Ducks',
    text_on_primary: 'white',
  },
  'oregon-state': {
    id: 'oregon-state',
    name: 'Oregon State University',
    short_name: 'Oregon State',
    primary_color: '#DC4405',
    secondary_color: '#000000',
    logo_url: 'https://upload.wikimedia.org/wikipedia/commons/4/4d/Oregon_State_Beavers_logo.svg',
    mascot: 'Beavers',
    text_on_primary: 'white',
  },

  // Texas
  'ut-austin': {
    id: 'ut-austin',
    name: 'UT Austin',
    short_name: 'Texas',
    primary_color: '#BF5700',
    secondary_color: '#FFFFFF',
    logo_url: 'https://upload.wikimedia.org/wikipedia/commons/8/8d/Texas_Longhorns_logo.svg',
    mascot: 'Longhorns',
    text_on_primary: 'white',
  },
  'tamu': {
    id: 'tamu',
    name: 'Texas A&M',
    short_name: 'Texas A&M',
    primary_color: '#500000',
    secondary_color: '#FFFFFF',
    logo_url: 'https://upload.wikimedia.org/wikipedia/commons/e/ee/Texas_A%26M_University_logo.svg',
    mascot: 'Aggies',
    text_on_primary: 'white',
  },
  'rice': {
    id: 'rice',
    name: 'Rice University',
    short_name: 'Rice',
    primary_color: '#00205B',
    secondary_color: '#C1C6C8',
    logo_url: 'https://upload.wikimedia.org/wikipedia/commons/b/bc/Rice_Owls_logo.svg',
    mascot: 'Owls',
    text_on_primary: 'white',
  },
  'smu': {
    id: 'smu',
    name: 'SMU',
    short_name: 'SMU',
    primary_color: '#CC0035',
    secondary_color: '#0033A0',
    logo_url: 'https://upload.wikimedia.org/wikipedia/commons/d/d6/SMU_Mustangs_logo.svg',
    mascot: 'Mustangs',
    text_on_primary: 'white',
  },

  // Southeast
  'gatech': {
    id: 'gatech',
    name: 'Georgia Tech',
    short_name: 'Georgia Tech',
    primary_color: '#B3A369',
    secondary_color: '#003057',
    logo_url: 'https://upload.wikimedia.org/wikipedia/commons/6/6c/Georgia_Tech_Yellow_Jackets_logo.svg',
    mascot: 'Yellow Jackets',
    text_on_primary: 'black',
  },
  'uga': {
    id: 'uga',
    name: 'University of Georgia',
    short_name: 'Georgia',
    primary_color: '#BA0C2F',
    secondary_color: '#000000',
    logo_url: 'https://upload.wikimedia.org/wikipedia/commons/8/80/Georgia_Bulldogs_logo.svg',
    mascot: 'Bulldogs',
    text_on_primary: 'white',
  },
  'vanderbilt': {
    id: 'vanderbilt',
    name: 'Vanderbilt University',
    short_name: 'Vanderbilt',
    primary_color: '#866D4B',
    secondary_color: '#000000',
    logo_url: 'https://upload.wikimedia.org/wikipedia/commons/0/04/Vanderbilt_Commodores_logo.svg',
    mascot: 'Commodores',
    text_on_primary: 'white',
  },
  'ufl': {
    id: 'ufl',
    name: 'University of Florida',
    short_name: 'Florida',
    primary_color: '#0021A5',
    secondary_color: '#FA4616',
    logo_url: 'https://upload.wikimedia.org/wikipedia/en/1/14/Florida_Gators_gator_logo.svg',
    mascot: 'Gators',
    text_on_primary: 'white',
  },
  'unc': {
    id: 'unc',
    name: 'UNC Chapel Hill',
    short_name: 'UNC',
    primary_color: '#7BAFD4',
    secondary_color: '#FFFFFF',
    logo_url: 'https://upload.wikimedia.org/wikipedia/commons/d/d7/North_Carolina_Tar_Heels_logo.svg',
    mascot: 'Tar Heels',
    text_on_primary: 'black',
  },
  'uva': {
    id: 'uva',
    name: 'University of Virginia',
    short_name: 'UVA',
    primary_color: '#232D4B',
    secondary_color: '#F84C1E',
    logo_url: 'https://upload.wikimedia.org/wikipedia/en/7/7a/Virginia_Cavaliers_logo.svg',
    mascot: 'Cavaliers',
    text_on_primary: 'white',
  },

  // California Community Colleges
  'de-anza': {
    id: 'de-anza',
    name: 'De Anza College',
    short_name: 'De Anza',
    primary_color: '#006341',
    secondary_color: '#FFFFFF',
    logo_url: '/logos/de-anza.svg',
    mascot: 'Mountain Lions',
    text_on_primary: 'white',
  },
  'foothill': {
    id: 'foothill',
    name: 'Foothill College',
    short_name: 'Foothill',
    primary_color: '#003366',
    secondary_color: '#CC0000',
    logo_url: '/logos/foothill.svg',
    mascot: 'Owls',
    text_on_primary: 'white',
  },
  'santa-monica': {
    id: 'santa-monica',
    name: 'Santa Monica College',
    short_name: 'SMC',
    primary_color: '#003B5C',
    secondary_color: '#00A3E0',
    logo_url: '/logos/smc.svg',
    mascot: 'Corsairs',
    text_on_primary: 'white',
  },
  'pasadena-cc': {
    id: 'pasadena-cc',
    name: 'Pasadena City College',
    short_name: 'PCC',
    primary_color: '#C8102E',
    secondary_color: '#000000',
    logo_url: '/logos/pcc.svg',
    mascot: 'Lancers',
    text_on_primary: 'white',
  },
  'diablo-valley': {
    id: 'diablo-valley',
    name: 'Diablo Valley College',
    short_name: 'DVC',
    primary_color: '#003366',
    secondary_color: '#FFD100',
    logo_url: '/logos/dvc.svg',
    mascot: 'Vikings',
    text_on_primary: 'white',
  },
  'orange-coast': {
    id: 'orange-coast',
    name: 'Orange Coast College',
    short_name: 'OCC',
    primary_color: '#002855',
    secondary_color: '#FF6600',
    logo_url: '/logos/occ.svg',
    mascot: 'Pirates',
    text_on_primary: 'white',
  },
  'irvine-valley': {
    id: 'irvine-valley',
    name: 'Irvine Valley College',
    short_name: 'IVC',
    primary_color: '#003366',
    secondary_color: '#009CDE',
    logo_url: '/logos/ivc.svg',
    mascot: 'Lasers',
    text_on_primary: 'white',
  },
  'city-college-sf': {
    id: 'city-college-sf',
    name: 'City College of SF',
    short_name: 'CCSF',
    primary_color: '#002855',
    secondary_color: '#F2A900',
    logo_url: '/logos/ccsf.svg',
    mascot: 'Rams',
    text_on_primary: 'white',
  },
  'mt-sac': {
    id: 'mt-sac',
    name: 'Mt. SAC',
    short_name: 'Mt. SAC',
    primary_color: '#002855',
    secondary_color: '#C8102E',
    logo_url: '/logos/mt-sac.svg',
    mascot: 'Mounties',
    text_on_primary: 'white',
  },
  'el-camino': {
    id: 'el-camino',
    name: 'El Camino College',
    short_name: 'El Camino',
    primary_color: '#003366',
    secondary_color: '#FFD100',
    logo_url: '/logos/el-camino.svg',
    mascot: 'Warriors',
    text_on_primary: 'white',
  },
};

// ID aliases to map new university IDs to theme IDs
const ID_ALIASES: Record<string, string> = {
  // UC System
  'uc-berkeley': 'ucb',
  'ucsd': 'ucsd',
  'uci': 'uci',
  'ucsb': 'ucsb',
  'ucdavis': 'ucd',
  'ucsc': 'ucsc',
  'ucr': 'ucr',
  'ucmerced': 'ucm',
  // Ivy League
  'upenn': 'upenn',
  // Big Ten
  'michigan': 'umich',
  'ohio-state': 'osu',
  'penn-state': 'psu',
  'uw-madison': 'uw-madison',
  'purdue-west-lafayette': 'purdue',
  'indiana-bloomington': 'iu',
  'minnesota': 'umn',
  'illinois-uc': 'uiuc',
  // Texas
  'ut-austin': 'ut-austin',
  'texas-am': 'tamu',
  // Washington
  'uw-seattle': 'uw',
  'oregon': 'oregon',
  'oregon-state': 'oregon-state',
  // Southeast
  'gatech': 'gatech',
  'uga': 'uga',
  'unc-chapel-hill': 'unc',
  'uva': 'uva',
  'uf': 'ufl',
  // Community Colleges
  'de-anza': 'de-anza',
  'foothill': 'foothill',
  'santa-monica': 'santa-monica',
  'pasadena-cc': 'pasadena-cc',
  'diablo-valley': 'diablo-valley',
  'orange-coast': 'orange-coast',
  'irvine-valley': 'irvine-valley',
  'ccsf': 'city-college-sf',
  'mt-sac': 'mt-sac',
  'el-camino': 'el-camino',
  // Boston area
  'boston-university': 'bu',
  // Others
  'carnegie-mellon': 'cmu',
  'johns-hopkins': 'duke', // fallback
};

// Helper functions
export function getSchoolTheme(institutionId: string): SchoolTheme {
  // First try direct lookup
  if (SCHOOL_THEMES[institutionId]) {
    return SCHOOL_THEMES[institutionId];
  }
  // Try alias lookup
  const aliasId = ID_ALIASES[institutionId];
  if (aliasId && SCHOOL_THEMES[aliasId]) {
    return SCHOOL_THEMES[aliasId];
  }
  return DEFAULT_THEME;
}

export function hasCustomTheme(institutionId: string): boolean {
  if (institutionId in SCHOOL_THEMES) {
    return true;
  }
  const aliasId = ID_ALIASES[institutionId];
  return aliasId ? (aliasId in SCHOOL_THEMES) : false;
}

// Storage keys
const STORAGE_KEY_USE_THEME = 'noor_use_school_theme';
const STORAGE_KEY_THEME_ID = 'noor_school_theme_id';

export function getUseSchoolTheme(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem(STORAGE_KEY_USE_THEME) === 'true';
  } catch {
    return false;
  }
}

export function setUseSchoolTheme(use: boolean): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY_USE_THEME, use ? 'true' : 'false');
}

export function getSavedThemeId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(STORAGE_KEY_THEME_ID);
  } catch {
    return null;
  }
}

export function setSavedThemeId(themeId: string): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY_THEME_ID, themeId);
}

// Get current active theme
export function getCurrentTheme(): SchoolTheme {
  const useTheme = getUseSchoolTheme();
  if (!useTheme) return DEFAULT_THEME;

  const themeId = getSavedThemeId();
  if (!themeId) return DEFAULT_THEME;

  return getSchoolTheme(themeId);
}

// Generate CSS variables for a theme
export function getThemeCSSVariables(theme: SchoolTheme): Record<string, string> {
  return {
    '--theme-primary': theme.primary_color,
    '--theme-secondary': theme.secondary_color,
    '--theme-accent': theme.accent_color || theme.secondary_color,
    '--theme-text-on-primary': theme.text_on_primary === 'white' ? '#FFFFFF' : '#000000',
  };
}
