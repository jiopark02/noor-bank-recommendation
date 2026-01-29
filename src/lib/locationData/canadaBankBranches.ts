/**
 * Canada Bank Branches Near Major Universities
 * Real locations for TD Canada Trust, RBC, BMO, Scotiabank, CIBC, etc.
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
// ONTARIO UNIVERSITIES
// ============================================================================

export const ONTARIO_BRANCHES: Record<string, BankBranch[]> = {
  'University of Toronto': [
    branch('uoft-td-1', 'TD Canada Trust', 'Bloor & St George', '180 Bloor St W, Toronto ON', 43.6680, -79.3990, 'north', '(416) 982-8420'),
    branch('uoft-td-2', 'TD Canada Trust', 'College & Spadina', '370 College St, Toronto ON', 43.6575, -79.4010, 'west', '(416) 307-1510'),
    branch('uoft-rbc-1', 'RBC Royal Bank', 'Bloor & Bedford', '130 Bloor St W, Toronto ON', 43.6685, -79.3960, 'north', '(416) 974-2861'),
    branch('uoft-bmo-1', 'BMO', 'Bloor & St George', '160 Bloor St W, Toronto ON', 43.6682, -79.3985, 'north', '(416) 867-6640'),
    branch('uoft-scotia-1', 'Scotiabank', 'College Street', '480 College St, Toronto ON', 43.6565, -79.4075, 'west', '(416) 866-3755'),
    branch('uoft-cibc-1', 'CIBC', 'Bloor & Spadina', '310 Bloor St W, Toronto ON', 43.6670, -79.4045, 'west', '(416) 980-3022'),
  ],
  'York University': [
    branch('york-td-1', 'TD Canada Trust', 'York Lanes', '4700 Keele St, Toronto ON', 43.7740, -79.5030, 'center', '(416) 736-2100'),
    branch('york-rbc-1', 'RBC Royal Bank', 'York University', '4700 Keele St, Toronto ON', 43.7742, -79.5025, 'center', '(416) 974-3750'),
    branch('york-scotia-1', 'Scotiabank', 'Finch & Keele', '2700 Finch Ave W, Toronto ON', 43.7630, -79.5090, 'south', '(416) 645-7700'),
    branch('york-bmo-1', 'BMO', 'Jane & Finch', '3737 Keele St, Toronto ON', 43.7555, -79.4960, 'south', '(416) 636-0550'),
  ],
  'Toronto Metropolitan University': [
    branch('tmu-td-1', 'TD Canada Trust', 'Yonge & Dundas', '220 Yonge St, Toronto ON', 43.6545, -79.3805, 'south', '(416) 307-1580'),
    branch('tmu-rbc-1', 'RBC Royal Bank', 'Yonge & Dundas', '180 Dundas St W, Toronto ON', 43.6565, -79.3825, 'center', '(416) 974-7800'),
    branch('tmu-bmo-1', 'BMO', 'Dundas & Victoria', '245 Dundas St E, Toronto ON', 43.6560, -79.3760, 'east', '(416) 867-4255'),
    branch('tmu-scotia-1', 'Scotiabank', 'Yonge & Gerrard', '415 Yonge St, Toronto ON', 43.6590, -79.3830, 'north', '(416) 866-6656'),
  ],
  'Waterloo': [
    branch('waterloo-td-1', 'TD Canada Trust', 'University Plaza', '170 University Ave W, Waterloo ON', 43.4720, -80.5350, 'west', '(519) 888-4567'),
    branch('waterloo-rbc-1', 'RBC Royal Bank', 'King & University', '170 King St S, Waterloo ON', 43.4655, -80.5230, 'south', '(519) 885-1740'),
    branch('waterloo-bmo-1', 'BMO', 'University Plaza', '160 University Ave W, Waterloo ON', 43.4725, -80.5345, 'west', '(519) 884-0060'),
    branch('waterloo-scotia-1', 'Scotiabank', 'King Street', '52 King St S, Waterloo ON', 43.4680, -80.5225, 'south', '(519) 747-2660'),
    branch('waterloo-cibc-1', 'CIBC', 'Weber Street', '65 Weber St N, Waterloo ON', 43.4765, -80.5215, 'east', '(519) 886-7640'),
  ],
  'McMaster': [
    branch('mcmaster-td-1', 'TD Canada Trust', 'Westdale', '1012 King St W, Hamilton ON', 43.2605, -79.8990, 'east', '(905) 525-4424'),
    branch('mcmaster-rbc-1', 'RBC Royal Bank', 'Main & Emerson', '987 Main St W, Hamilton ON', 43.2575, -79.8990, 'south', '(905) 525-4471'),
    branch('mcmaster-bmo-1', 'BMO', 'Westdale Village', '1036 King St W, Hamilton ON', 43.2610, -79.9005, 'east', '(905) 528-0750'),
    branch('mcmaster-scotia-1', 'Scotiabank', 'Westdale', '1054 King St W, Hamilton ON', 43.2615, -79.9015, 'east', '(905) 528-4471'),
  ],
  'Western': [
    branch('western-td-1', 'TD Canada Trust', 'Richmond Row', '565 Richmond St, London ON', 43.0080, -81.2555, 'east', '(519) 663-5430'),
    branch('western-rbc-1', 'RBC Royal Bank', 'Masonville', '1680 Richmond St, London ON', 43.0315, -81.2775, 'north', '(519) 661-2240'),
    branch('western-bmo-1', 'BMO', 'Richmond Row', '390 Richmond St, London ON', 43.0055, -81.2505, 'east', '(519) 675-4020'),
    branch('western-scotia-1', 'Scotiabank', 'Oxford & Richmond', '295 Oxford St W, London ON', 42.9960, -81.2660, 'south', '(519) 438-9200'),
  ],
  "Queen's": [
    branch('queens-td-1', 'TD Canada Trust', 'Princess Street', '156 Princess St, Kingston ON', 44.2310, -76.4830, 'south', '(613) 544-0800'),
    branch('queens-rbc-1', 'RBC Royal Bank', 'Princess Street', '260 Princess St, Kingston ON', 44.2315, -76.4780, 'east', '(613) 544-2770'),
    branch('queens-bmo-1', 'BMO', 'Princess Street', '214 Princess St, Kingston ON', 44.2312, -76.4805, 'center', '(613) 544-4400'),
    branch('queens-scotia-1', 'Scotiabank', 'Princess Street', '240 Princess St, Kingston ON', 44.2313, -76.4790, 'east', '(613) 546-1440'),
  ],
  'Ottawa': [
    branch('uottawa-td-1', 'TD Canada Trust', 'Rideau Centre', '50 Rideau St, Ottawa ON', 45.4265, -75.6920, 'center', '(613) 783-4450'),
    branch('uottawa-rbc-1', 'RBC Royal Bank', 'Rideau Street', '90 Sparks St, Ottawa ON', 45.4230, -75.6970, 'west', '(613) 564-6060'),
    branch('uottawa-bmo-1', 'BMO', 'Bank Street', '400 Laurier Ave W, Ottawa ON', 45.4195, -75.7035, 'west', '(613) 232-8800'),
    branch('uottawa-scotia-1', 'Scotiabank', 'Laurier Avenue', '141 Laurier Ave W, Ottawa ON', 45.4215, -75.6935, 'center', '(613) 564-3750'),
  ],
  'Carleton': [
    branch('carleton-td-1', 'TD Canada Trust', 'Bank & Sunnyside', '1066 Bank St, Ottawa ON', 45.3985, -75.6845, 'east', '(613) 731-5750'),
    branch('carleton-rbc-1', 'RBC Royal Bank', 'Billings Bridge', '2269 Riverside Dr, Ottawa ON', 45.3890, -75.6855, 'east', '(613) 731-7760'),
    branch('carleton-bmo-1', 'BMO', 'Bank Street', '1200 Bank St, Ottawa ON', 45.3920, -75.6830, 'east', '(613) 523-1200'),
    branch('carleton-scotia-1', 'Scotiabank', 'Bank Street', '1309 Bank St, Ottawa ON', 45.3875, -75.6810, 'east', '(613) 730-4830'),
  ],
  'Guelph': [
    branch('guelph-td-1', 'TD Canada Trust', 'Stone Road', '435 Stone Rd W, Guelph ON', 43.5275, -80.2440, 'west', '(519) 836-8700'),
    branch('guelph-rbc-1', 'RBC Royal Bank', 'Downtown Guelph', '1 Quebec St, Guelph ON', 43.5440, -80.2480, 'north', '(519) 824-9640'),
    branch('guelph-bmo-1', 'BMO', 'Stone Road', '420 Stone Rd W, Guelph ON', 43.5280, -80.2435, 'west', '(519) 836-9660'),
    branch('guelph-scotia-1', 'Scotiabank', 'Gordon Street', '118 Gordon St, Guelph ON', 43.5410, -80.2505, 'north', '(519) 824-5010'),
  ],
};

// ============================================================================
// BRITISH COLUMBIA UNIVERSITIES
// ============================================================================

export const BC_BRANCHES: Record<string, BankBranch[]> = {
  'UBC': [
    branch('ubc-td-1', 'TD Canada Trust', 'University Village', '5728 University Blvd, Vancouver BC', 49.2685, -123.2505, 'east', '(604) 654-3650'),
    branch('ubc-rbc-1', 'RBC Royal Bank', 'Wesbrook Village', '5950 University Blvd, Vancouver BC', 49.2655, -123.2405, 'east', '(604) 665-5450'),
    branch('ubc-bmo-1', 'BMO', 'UBC Campus', '5728 University Blvd, Vancouver BC', 49.2680, -123.2510, 'east', '(604) 665-7100'),
    branch('ubc-scotia-1', 'Scotiabank', 'West 10th', '4255 W 10th Ave, Vancouver BC', 49.2620, -123.2060, 'south', '(604) 668-2335'),
    branch('ubc-cibc-1', 'CIBC', 'Dunbar', '4429 W 10th Ave, Vancouver BC', 49.2620, -123.2105, 'south', '(604) 228-8040'),
  ],
  'SFU': [
    branch('sfu-td-1', 'TD Canada Trust', 'Metrotown', '4700 Kingsway, Burnaby BC', 49.2270, -123.0035, 'south', '(604) 654-3620'),
    branch('sfu-rbc-1', 'RBC Royal Bank', 'Lougheed', '9855 Austin Ave, Burnaby BC', 49.2535, -122.8945, 'east', '(604) 665-4765'),
    branch('sfu-bmo-1', 'BMO', 'Burnaby', '4545 Kingsway, Burnaby BC', 49.2285, -123.0080, 'south', '(604) 665-6020'),
    branch('sfu-scotia-1', 'Scotiabank', 'Lougheed Mall', '9855 Austin Rd, Burnaby BC', 49.2530, -122.8950, 'east', '(604) 668-2180'),
  ],
  'UVic': [
    branch('uvic-td-1', 'TD Canada Trust', 'Shelbourne', '1950 Foul Bay Rd, Victoria BC', 48.4505, -123.3290, 'south', '(250) 356-4500'),
    branch('uvic-rbc-1', 'RBC Royal Bank', 'Hillside Centre', '1644 Hillside Ave, Victoria BC', 48.4425, -123.3405, 'west', '(250) 356-5250'),
    branch('uvic-bmo-1', 'BMO', 'Shelbourne Plaza', '3550 Shelbourne St, Victoria BC', 48.4555, -123.3415, 'west', '(250) 356-4420'),
    branch('uvic-scotia-1', 'Scotiabank', 'Oak Bay', '2187 Oak Bay Ave, Victoria BC', 48.4345, -123.3200, 'south', '(250) 953-5200'),
  ],
  'BCIT': [
    branch('bcit-td-1', 'TD Canada Trust', 'Willingdon', '4565 Lougheed Hwy, Burnaby BC', 49.2505, -123.0020, 'west', '(604) 654-3680'),
    branch('bcit-rbc-1', 'RBC Royal Bank', 'Brentwood', '4567 Lougheed Hwy, Burnaby BC', 49.2665, -123.0005, 'north', '(604) 665-5620'),
    branch('bcit-bmo-1', 'BMO', 'Brentwood', '1899 Rosser Ave, Burnaby BC', 49.2660, -122.9985, 'north', '(604) 665-6850'),
  ],
  'Langara': [
    branch('langara-td-1', 'TD Canada Trust', 'Oakridge', '650 W 41st Ave, Vancouver BC', 49.2270, -123.1175, 'east', '(604) 654-3560'),
    branch('langara-rbc-1', 'RBC Royal Bank', 'Cambie & 49th', '488 SW Marine Dr, Vancouver BC', 49.2185, -123.1145, 'south', '(604) 665-5770'),
    branch('langara-bmo-1', 'BMO', 'Main Street', '5661 Main St, Vancouver BC', 49.2260, -123.1010, 'east', '(604) 665-6770'),
    branch('langara-scotia-1', 'Scotiabank', 'Oakridge', '5780 Cambie St, Vancouver BC', 49.2290, -123.1165, 'north', '(604) 668-2140'),
  ],
  'Douglas College': [
    branch('douglas-td-1', 'TD Canada Trust', 'New Westminster', '800 Carnarvon St, New Westminster BC', 49.2035, -122.9115, 'center', '(604) 654-3730'),
    branch('douglas-rbc-1', 'RBC Royal Bank', 'New Westminster', '601 Columbia St, New Westminster BC', 49.2055, -122.9075, 'east', '(604) 665-4980'),
    branch('douglas-bmo-1', 'BMO', 'Royal City Centre', '610 6th St, New Westminster BC', 49.2050, -122.9105, 'center', '(604) 665-6010'),
  ],
};

// ============================================================================
// QUEBEC UNIVERSITIES
// ============================================================================

export const QUEBEC_BRANCHES: Record<string, BankBranch[]> = {
  'McGill': [
    branch('mcgill-td-1', 'TD Canada Trust', 'McGill College', '1350 René-Lévesque Blvd W, Montreal QC', 45.4995, -73.5755, 'south', '(514) 289-0700'),
    branch('mcgill-rbc-1', 'RBC Royal Bank', 'Sherbrooke', '1 Place Ville Marie, Montreal QC', 45.5020, -73.5695, 'east', '(514) 874-2311'),
    branch('mcgill-bmo-1', 'BMO', 'McGill College', '1501 McGill College Ave, Montreal QC', 45.5025, -73.5720, 'center', '(514) 877-8020'),
    branch('mcgill-scotia-1', 'Scotiabank', 'Sherbrooke', '1002 Sherbrooke St W, Montreal QC', 45.5030, -73.5800, 'west', '(514) 499-9600'),
    branch('mcgill-desjardins-1', 'Desjardins', 'McGill Metro', '2075 University St, Montreal QC', 45.5010, -73.5725, 'center', '(514) 522-6631'),
    branch('mcgill-bnc-1', 'National Bank', 'Downtown', '1155 Metcalfe St, Montreal QC', 45.4985, -73.5760, 'south', '(514) 394-5555'),
  ],
  'Concordia': [
    branch('concordia-td-1', 'TD Canada Trust', 'Guy-Concordia', '1350 René-Lévesque Blvd W, Montreal QC', 45.4995, -73.5755, 'east', '(514) 289-0700'),
    branch('concordia-rbc-1', 'RBC Royal Bank', 'Atwater', '1200 Atwater Ave, Montreal QC', 45.4885, -73.5850, 'south', '(514) 874-7760'),
    branch('concordia-bmo-1', 'BMO', 'Atwater', '1240 Atwater Ave, Montreal QC', 45.4880, -73.5855, 'south', '(514) 877-8570'),
    branch('concordia-desjardins-1', 'Desjardins', 'Guy Street', '1610 St Catherine St W, Montreal QC', 45.4945, -73.5810, 'center', '(514) 522-9730'),
  ],
  'Université de Montréal': [
    branch('udem-td-1', 'TD Canada Trust', 'Côte-des-Neiges', '5111 Côte-des-Neiges Rd, Montreal QC', 45.4985, -73.6165, 'east', '(514) 289-1250'),
    branch('udem-rbc-1', 'RBC Royal Bank', 'Côte-des-Neiges', '5120 Côte-des-Neiges Rd, Montreal QC', 45.4990, -73.6170, 'east', '(514) 874-5610'),
    branch('udem-desjardins-1', 'Desjardins', 'Campus UdeM', '2900 Édouard-Montpetit Blvd, Montreal QC', 45.5025, -73.6155, 'center', '(514) 522-6631'),
    branch('udem-bnc-1', 'National Bank', 'Côte-des-Neiges', '5190 Côte-des-Neiges Rd, Montreal QC', 45.4980, -73.6175, 'east', '(514) 394-6820'),
  ],
  'Laval': [
    branch('laval-td-1', 'TD Canada Trust', 'Sainte-Foy', '2450 Laurier Blvd, Quebec City QC', 46.7805, -71.2785, 'center', '(418) 654-8770'),
    branch('laval-rbc-1', 'RBC Royal Bank', 'Place Laurier', '2700 Laurier Blvd, Quebec City QC', 46.7790, -71.2870, 'west', '(418) 654-6060'),
    branch('laval-bmo-1', 'BMO', 'Sainte-Foy', '2825 Laurier Blvd, Quebec City QC', 46.7800, -71.2920, 'west', '(418) 654-3420'),
    branch('laval-desjardins-1', 'Desjardins', 'Pavillon Desjardins', '2325 Rue de lUniversité, Quebec City QC', 46.7815, -71.2750, 'east', '(418) 835-8444'),
  ],
  'UQAM': [
    branch('uqam-td-1', 'TD Canada Trust', 'Berri', '1100 Rue Sainte-Catherine E, Montreal QC', 45.5140, -73.5595, 'east', '(514) 289-0920'),
    branch('uqam-rbc-1', 'RBC Royal Bank', 'Place des Arts', '175 Sainte-Catherine St W, Montreal QC', 45.5085, -73.5665, 'west', '(514) 874-7050'),
    branch('uqam-desjardins-1', 'Desjardins', 'Quartier Latin', '425 Rue de Maisonneuve E, Montreal QC', 45.5155, -73.5630, 'north', '(514) 522-6631'),
  ],
};

// ============================================================================
// ALBERTA UNIVERSITIES
// ============================================================================

export const ALBERTA_BRANCHES: Record<string, BankBranch[]> = {
  'University of Alberta': [
    branch('ualberta-td-1', 'TD Canada Trust', 'HUB Mall', '9004 112 St NW, Edmonton AB', 43.5220, -113.5245, 'center', '(780) 448-8340'),
    branch('ualberta-rbc-1', 'RBC Royal Bank', 'Whyte Ave', '10508 82 Ave NW, Edmonton AB', 53.5175, -113.5030, 'east', '(780) 448-7760'),
    branch('ualberta-bmo-1', 'BMO', 'Campus', '8623 112 St NW, Edmonton AB', 53.5265, -113.5240, 'north', '(780) 448-8770'),
    branch('ualberta-scotia-1', 'Scotiabank', 'Whyte Avenue', '10210 82 Ave NW, Edmonton AB', 53.5180, -113.5080, 'east', '(780) 448-8050'),
    branch('ualberta-atb-1', 'ATB Financial', 'Campus', '8920 112 St NW, Edmonton AB', 53.5235, -113.5250, 'center', '(780) 408-5200'),
  ],
  'University of Calgary': [
    branch('ucalgary-td-1', 'TD Canada Trust', 'Brentwood', '3630 Brentwood Rd NW, Calgary AB', 51.0860, -114.1295, 'south', '(403) 292-8620'),
    branch('ucalgary-rbc-1', 'RBC Royal Bank', 'University District', '3545 32 Ave NE, Calgary AB', 51.0780, -114.0590, 'east', '(403) 292-7060'),
    branch('ucalgary-bmo-1', 'BMO', 'Brentwood', '3550 Brentwood Rd NW, Calgary AB', 51.0855, -114.1290, 'south', '(403) 292-8240'),
    branch('ucalgary-scotia-1', 'Scotiabank', 'Market Mall', '3625 Shaganappi Trail NW, Calgary AB', 51.0905, -114.1420, 'west', '(403) 292-8550'),
    branch('ucalgary-atb-1', 'ATB Financial', 'University', '2500 University Dr NW, Calgary AB', 51.0770, -114.1280, 'center', '(403) 974-5050'),
  ],
  'MacEwan': [
    branch('macewan-td-1', 'TD Canada Trust', 'City Centre', '10180 101 St NW, Edmonton AB', 53.5445, -113.4900, 'east', '(780) 448-8260'),
    branch('macewan-rbc-1', 'RBC Royal Bank', 'Downtown', '10111 104 Ave NW, Edmonton AB', 53.5455, -113.4985, 'north', '(780) 448-7880'),
    branch('macewan-bmo-1', 'BMO', 'Jasper Ave', '10117 Jasper Ave NW, Edmonton AB', 53.5430, -113.4980, 'south', '(780) 448-8350'),
  ],
  'Mount Royal': [
    branch('mru-td-1', 'TD Canada Trust', 'Lincoln Park', '6455 Macleod Trail SW, Calgary AB', 50.9875, -114.0725, 'south', '(403) 292-8770'),
    branch('mru-rbc-1', 'RBC Royal Bank', 'Chinook', '6455 Macleod Trail SW, Calgary AB', 50.9985, -114.0725, 'north', '(403) 292-7220'),
    branch('mru-bmo-1', 'BMO', 'Lincoln Park', '4307 130 Ave SE, Calgary AB', 50.9845, -113.9735, 'east', '(403) 292-8140'),
  ],
  'NAIT': [
    branch('nait-td-1', 'TD Canada Trust', 'Kingsway', '11762 Kingsway NW, Edmonton AB', 53.5705, -113.4985, 'west', '(780) 448-8520'),
    branch('nait-rbc-1', 'RBC Royal Bank', 'Kingsway', '12227 118 Ave NW, Edmonton AB', 53.5695, -113.5125, 'west', '(780) 448-7540'),
    branch('nait-atb-1', 'ATB Financial', 'NAIT Campus', '11762 106 St NW, Edmonton AB', 53.5685, -113.5120, 'center', '(780) 408-5100'),
  ],
  'SAIT': [
    branch('sait-td-1', 'TD Canada Trust', 'North Hill', '1632 14 Ave NW, Calgary AB', 51.0675, -114.0880, 'west', '(403) 292-8350'),
    branch('sait-rbc-1', 'RBC Royal Bank', 'North Hill', '1616 14 Ave NW, Calgary AB', 51.0680, -114.0875, 'west', '(403) 292-7140'),
    branch('sait-bmo-1', 'BMO', 'Kensington', '1175 Kensington Crescent NW, Calgary AB', 51.0540, -114.0935, 'south', '(403) 292-8020'),
  ],
};

// ============================================================================
// PRAIRIE PROVINCES
// ============================================================================

export const PRAIRIE_BRANCHES: Record<string, BankBranch[]> = {
  'University of Manitoba': [
    branch('umanitoba-td-1', 'TD Canada Trust', 'University Centre', '65 Chancellors Circle, Winnipeg MB', 49.8095, -97.1355, 'center', '(204) 988-2420'),
    branch('umanitoba-rbc-1', 'RBC Royal Bank', 'Pembina', '2855 Pembina Hwy, Winnipeg MB', 49.8195, -97.1510, 'west', '(204) 988-4780'),
    branch('umanitoba-bmo-1', 'BMO', 'Pembina', '2640 Pembina Hwy, Winnipeg MB', 49.8225, -97.1475, 'west', '(204) 988-8440'),
    branch('umanitoba-scotia-1', 'Scotiabank', 'Pembina', '2727 Pembina Hwy, Winnipeg MB', 49.8210, -97.1490, 'west', '(204) 988-3530'),
  ],
  'University of Saskatchewan': [
    branch('usask-td-1', 'TD Canada Trust', 'Campus', '117 Science Place, Saskatoon SK', 52.1325, -106.6305, 'center', '(306) 975-8650'),
    branch('usask-rbc-1', 'RBC Royal Bank', '8th Street', '3012 8th St E, Saskatoon SK', 52.1175, -106.6040, 'south', '(306) 975-5740'),
    branch('usask-bmo-1', 'BMO', 'Broadway', '601 Broadway Ave, Saskatoon SK', 52.1230, -106.6610, 'west', '(306) 975-8220'),
    branch('usask-scotia-1', 'Scotiabank', 'Broadway', '810 Broadway Ave, Saskatoon SK', 52.1215, -106.6545, 'west', '(306) 975-3560'),
  ],
  'University of Regina': [
    branch('uregina-td-1', 'TD Canada Trust', 'Campus', '3737 Wascana Pkwy, Regina SK', 50.4205, -104.5850, 'center', '(306) 781-6850'),
    branch('uregina-rbc-1', 'RBC Royal Bank', 'Victoria Ave', '2060 Victoria Ave E, Regina SK', 50.4420, -104.5675, 'north', '(306) 781-5690'),
    branch('uregina-bmo-1', 'BMO', 'Albert Street', '1874 Scarth St, Regina SK', 50.4515, -104.6075, 'north', '(306) 781-8130'),
  ],
  'Red River College': [
    branch('rrc-td-1', 'TD Canada Trust', 'Exchange District', '444 Main St, Winnipeg MB', 49.8985, -97.1375, 'center', '(204) 988-2570'),
    branch('rrc-rbc-1', 'RBC Royal Bank', 'Portage & Main', '200 Portage Ave, Winnipeg MB', 49.8925, -97.1395, 'south', '(204) 988-4640'),
    branch('rrc-bmo-1', 'BMO', 'Main Street', '352 Main St, Winnipeg MB', 49.8960, -97.1380, 'center', '(204) 988-8320'),
  ],
};

// ============================================================================
// ATLANTIC PROVINCES
// ============================================================================

export const ATLANTIC_BRANCHES: Record<string, BankBranch[]> = {
  'Dalhousie': [
    branch('dal-td-1', 'TD Canada Trust', 'Spring Garden', '5523 Spring Garden Rd, Halifax NS', 44.6425, -63.5810, 'south', '(902) 420-4350'),
    branch('dal-rbc-1', 'RBC Royal Bank', 'South End', '5151 George St, Halifax NS', 44.6485, -63.5765, 'north', '(902) 420-4770'),
    branch('dal-bmo-1', 'BMO', 'Spring Garden', '5640 Spring Garden Rd, Halifax NS', 44.6415, -63.5835, 'south', '(902) 420-8460'),
    branch('dal-scotia-1', 'Scotiabank', 'Spring Garden', '5201 Duke St, Halifax NS', 44.6455, -63.5825, 'south', '(902) 420-3820'),
  ],
  'Memorial': [
    branch('mun-td-1', 'TD Canada Trust', 'Avalon Mall', '48 Kenmount Rd, St. Johns NL', 47.5625, -52.7505, 'west', '(709) 758-8420'),
    branch('mun-rbc-1', 'RBC Royal Bank', 'Elizabeth Ave', '100 Elizabeth Ave, St. Johns NL', 47.5695, -52.7325, 'east', '(709) 758-4740'),
    branch('mun-bmo-1', 'BMO', 'Elizabeth Ave', '195 Elizabeth Ave, St. Johns NL', 47.5700, -52.7355, 'east', '(709) 758-8050'),
    branch('mun-scotia-1', 'Scotiabank', 'Water Street', '245 Water St, St. Johns NL', 47.5665, -52.7085, 'south', '(709) 758-3650'),
  ],
  'UNB': [
    branch('unb-td-1', 'TD Canada Trust', 'Fredericton', '349 King St, Fredericton NB', 45.9625, -66.6425, 'south', '(506) 452-8520'),
    branch('unb-rbc-1', 'RBC Royal Bank', 'Regent Street', '476 Queen St, Fredericton NB', 45.9590, -66.6430, 'south', '(506) 452-4620'),
    branch('unb-bmo-1', 'BMO', 'King Street', '520 King St, Fredericton NB', 45.9610, -66.6405, 'south', '(506) 452-8030'),
    branch('unb-scotia-1', 'Scotiabank', 'Fredericton', '77 Westmorland St, Fredericton NB', 45.9635, -66.6410, 'center', '(506) 452-3720'),
  ],
  'UPEI': [
    branch('upei-td-1', 'TD Canada Trust', 'Charlottetown', '134 Kent St, Charlottetown PE', 46.2365, -63.1305, 'south', '(902) 629-8620'),
    branch('upei-rbc-1', 'RBC Royal Bank', 'Charlottetown', '119 Kent St, Charlottetown PE', 46.2360, -63.1300, 'south', '(902) 629-4850'),
    branch('upei-bmo-1', 'BMO', 'University Ave', '173 University Ave, Charlottetown PE', 46.2385, -63.1295, 'center', '(902) 629-8140'),
  ],
  'Acadia': [
    branch('acadia-td-1', 'TD Canada Trust', 'Wolfville', '390 Main St, Wolfville NS', 45.0885, -64.3625, 'center', '(902) 542-8620'),
    branch('acadia-rbc-1', 'RBC Royal Bank', 'Wolfville', '402 Main St, Wolfville NS', 45.0880, -64.3630, 'center', '(902) 542-4820'),
    branch('acadia-scotia-1', 'Scotiabank', 'Wolfville', '360 Main St, Wolfville NS', 45.0890, -64.3615, 'east', '(902) 542-3750'),
  ],
};

// Combine all Canada branches
export const ALL_CANADA_BANK_BRANCHES: Record<string, BankBranch[]> = {
  ...ONTARIO_BRANCHES,
  ...BC_BRANCHES,
  ...QUEBEC_BRANCHES,
  ...ALBERTA_BRANCHES,
  ...PRAIRIE_BRANCHES,
  ...ATLANTIC_BRANCHES,
};
