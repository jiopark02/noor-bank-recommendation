/**
 * UK Bank Branches Near Major Universities
 * Real locations for Barclays, HSBC, Lloyds, NatWest, Santander, etc.
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
// LONDON UNIVERSITIES
// ============================================================================

export const LONDON_BRANCHES: Record<string, BankBranch[]> = {
  'Imperial College London': [
    branch('imperial-barclays-1', 'Barclays', 'South Kensington', '35 Thurloe St, London SW7', 51.4960, -0.1730, 'south', '0345 734 5345'),
    branch('imperial-hsbc-1', 'HSBC', 'South Kensington', '1 Exhibition Rd, London SW7', 51.4985, -0.1745, 'center', '0345 740 4404'),
    branch('imperial-lloyds-1', 'Lloyds', 'Gloucester Road', '129 Gloucester Rd, London SW7', 51.4945, -0.1835, 'west', '0345 300 0000'),
    branch('imperial-natwest-1', 'NatWest', 'South Kensington', '176 Cromwell Rd, London SW5', 51.4940, -0.1890, 'west', '0345 788 8444'),
    branch('imperial-santander-1', 'Santander', 'Kensington High St', '154 Kensington High St, London W8', 51.5005, -0.1935, 'north', '0800 389 7000'),
  ],
  'UCL': [
    branch('ucl-barclays-1', 'Barclays', 'Tottenham Court Road', '165 Tottenham Court Rd, London W1', 51.5205, -0.1360, 'south', '0345 734 5345'),
    branch('ucl-hsbc-1', 'HSBC', 'Gower Street', '67-69 Gower St, London WC1', 51.5225, -0.1310, 'center', '0345 740 4404'),
    branch('ucl-lloyds-1', 'Lloyds', 'Euston', '124 Euston Rd, London NW1', 51.5265, -0.1285, 'north', '0345 300 0000'),
    branch('ucl-natwest-1', 'NatWest', 'Tottenham Court Road', '175 Tottenham Court Rd, London W1', 51.5210, -0.1355, 'south', '0345 788 8444'),
    branch('ucl-santander-1', 'Santander', 'Goodge Street', '58-60 Goodge St, London W1', 51.5195, -0.1355, 'south', '0800 389 7000'),
  ],
  'LSE': [
    branch('lse-barclays-1', 'Barclays', 'Fleet Street', '27 Fleet St, London EC4', 51.5140, -0.1090, 'east', '0345 734 5345'),
    branch('lse-hsbc-1', 'HSBC', 'Kingsway', '31 Kingsway, London WC2', 51.5155, -0.1175, 'center', '0345 740 4404'),
    branch('lse-lloyds-1', 'Lloyds', 'Aldwych', '99 Kingsway, London WC2', 51.5125, -0.1180, 'south', '0345 300 0000'),
    branch('lse-natwest-1', 'NatWest', 'Holborn', '332 High Holborn, London WC1', 51.5170, -0.1195, 'north', '0345 788 8444'),
  ],
  'Kings College London': [
    branch('kcl-barclays-1', 'Barclays', 'Strand', '111 Strand, London WC2', 51.5110, -0.1155, 'center', '0345 734 5345'),
    branch('kcl-hsbc-1', 'HSBC', 'Waterloo', '125 Waterloo Rd, London SE1', 51.5035, -0.1130, 'south', '0345 740 4404'),
    branch('kcl-lloyds-1', 'Lloyds', 'Strand', '222 Strand, London WC2', 51.5105, -0.1195, 'west', '0345 300 0000'),
    branch('kcl-natwest-1', 'NatWest', 'Surrey Street', '63 Surrey St, London WC2', 51.5130, -0.1170, 'center', '0345 788 8444'),
  ],
  'Queen Mary University': [
    branch('qmul-barclays-1', 'Barclays', 'Mile End', '276 Mile End Rd, London E1', 51.5250, -0.0365, 'center', '0345 734 5345'),
    branch('qmul-hsbc-1', 'HSBC', 'Bethnal Green', '409 Bethnal Green Rd, London E2', 51.5275, -0.0585, 'west', '0345 740 4404'),
    branch('qmul-lloyds-1', 'Lloyds', 'Whitechapel', '85 Whitechapel High St, London E1', 51.5150, -0.0705, 'west', '0345 300 0000'),
    branch('qmul-natwest-1', 'NatWest', 'Mile End', '310 Mile End Rd, London E1', 51.5255, -0.0340, 'east', '0345 788 8444'),
  ],
  'SOAS': [
    branch('soas-barclays-1', 'Barclays', 'Russell Square', '135 Southampton Row, London WC1', 51.5215, -0.1235, 'east', '0345 734 5345'),
    branch('soas-hsbc-1', 'HSBC', 'Bloomsbury', '67-69 Gower St, London WC1', 51.5225, -0.1310, 'west', '0345 740 4404'),
    branch('soas-lloyds-1', 'Lloyds', 'Euston', '124 Euston Rd, London NW1', 51.5265, -0.1285, 'north', '0345 300 0000'),
  ],
  'City University London': [
    branch('city-barclays-1', 'Barclays', 'Angel', '228 Upper St, London N1', 51.5405, -0.1025, 'north', '0345 734 5345'),
    branch('city-hsbc-1', 'HSBC', 'City Road', '10 City Rd, London EC1', 51.5240, -0.0875, 'south', '0345 740 4404'),
    branch('city-lloyds-1', 'Lloyds', 'Old Street', '120-126 Old St, London EC1', 51.5255, -0.0905, 'south', '0345 300 0000'),
  ],
  'Royal Holloway': [
    branch('rhul-barclays-1', 'Barclays', 'Egham', '167 High St, Egham TW20', 51.4320, -0.5445, 'south', '0345 734 5345'),
    branch('rhul-hsbc-1', 'HSBC', 'Egham', '113 High St, Egham TW20', 51.4315, -0.5450, 'south', '0345 740 4404'),
    branch('rhul-natwest-1', 'NatWest', 'Staines', '96 High St, Staines TW18', 51.4330, -0.5090, 'east', '0345 788 8444'),
  ],
};

// ============================================================================
// OXBRIDGE
// ============================================================================

export const OXBRIDGE_BRANCHES: Record<string, BankBranch[]> = {
  'Oxford': [
    branch('oxford-barclays-1', 'Barclays', 'High Street', '54 Cornmarket St, Oxford OX1', 51.7530, -1.2575, 'center', '0345 734 5345'),
    branch('oxford-hsbc-1', 'HSBC', 'Carfax', '65 Cornmarket St, Oxford OX1', 51.7525, -1.2570, 'center', '0345 740 4404'),
    branch('oxford-lloyds-1', 'Lloyds', 'Oxford', '1-5 High St, Oxford OX1', 51.7520, -1.2530, 'east', '0345 300 0000'),
    branch('oxford-natwest-1', 'NatWest', 'High Street', '121 High St, Oxford OX1', 51.7515, -1.2500, 'east', '0345 788 8444'),
    branch('oxford-santander-1', 'Santander', 'Queen Street', '23-25 Queen St, Oxford OX1', 51.7520, -1.2585, 'west', '0800 389 7000'),
  ],
  'Cambridge': [
    branch('cambridge-barclays-1', 'Barclays', "St Andrew's Street", '9-11 St Andrews St, Cambridge CB2', 52.2045, 0.1195, 'center', '0345 734 5345'),
    branch('cambridge-hsbc-1', 'HSBC', 'Sidney Street', '77-78 Sidney St, Cambridge CB2', 52.2060, 0.1220, 'east', '0345 740 4404'),
    branch('cambridge-lloyds-1', 'Lloyds', 'Cambridge', '3 Sidney St, Cambridge CB2', 52.2050, 0.1215, 'east', '0345 300 0000'),
    branch('cambridge-natwest-1', 'NatWest', 'Market Square', '23-24 Market Hill, Cambridge CB2', 52.2055, 0.1185, 'center', '0345 788 8444'),
    branch('cambridge-santander-1', 'Santander', 'Petty Cury', '9-12 Petty Cury, Cambridge CB2', 52.2050, 0.1195, 'center', '0800 389 7000'),
  ],
};

// ============================================================================
// NORTHERN ENGLAND UNIVERSITIES
// ============================================================================

export const NORTHERN_ENGLAND_BRANCHES: Record<string, BankBranch[]> = {
  'Manchester': [
    branch('manchester-barclays-1', 'Barclays', 'Oxford Road', '51 Oxford St, Manchester M1', 53.4745, -2.2405, 'north', '0345 734 5345'),
    branch('manchester-hsbc-1', 'HSBC', 'Oxford Road', '67 Oxford St, Manchester M1', 53.4740, -2.2400, 'north', '0345 740 4404'),
    branch('manchester-lloyds-1', 'Lloyds', 'Piccadilly', '63 Piccadilly, Manchester M1', 53.4805, -2.2360, 'north', '0345 300 0000'),
    branch('manchester-natwest-1', 'NatWest', 'Oxford Road', '91 Oxford Rd, Manchester M1', 53.4700, -2.2365, 'center', '0345 788 8444'),
    branch('manchester-santander-1', 'Santander', 'Deansgate', '80 Deansgate, Manchester M3', 53.4820, -2.2495, 'west', '0800 389 7000'),
  ],
  'Leeds': [
    branch('leeds-barclays-1', 'Barclays', 'Briggate', '52-54 Briggate, Leeds LS1', 53.7975, -1.5415, 'center', '0345 734 5345'),
    branch('leeds-hsbc-1', 'HSBC', 'Park Row', '14 Park Row, Leeds LS1', 53.7990, -1.5485, 'west', '0345 740 4404'),
    branch('leeds-lloyds-1', 'Lloyds', 'Leeds', '70-72 Briggate, Leeds LS1', 53.7970, -1.5410, 'center', '0345 300 0000'),
    branch('leeds-natwest-1', 'NatWest', 'Headrow', '24 The Headrow, Leeds LS1', 53.7985, -1.5455, 'center', '0345 788 8444'),
  ],
  'Sheffield': [
    branch('sheffield-barclays-1', 'Barclays', 'Fargate', '34-36 Fargate, Sheffield S1', 53.3820, -1.4695, 'center', '0345 734 5345'),
    branch('sheffield-hsbc-1', 'HSBC', 'High Street', '62-64 High St, Sheffield S1', 53.3825, -1.4675, 'east', '0345 740 4404'),
    branch('sheffield-lloyds-1', 'Lloyds', 'Sheffield', '3-5 Pinstone St, Sheffield S1', 53.3810, -1.4710, 'west', '0345 300 0000'),
    branch('sheffield-natwest-1', 'NatWest', 'Division Street', '38 Division St, Sheffield S1', 53.3800, -1.4735, 'west', '0345 788 8444'),
  ],
  'Newcastle': [
    branch('newcastle-barclays-1', 'Barclays', 'Northumberland St', '105 Northumberland St, Newcastle NE1', 54.9745, -1.6125, 'center', '0345 734 5345'),
    branch('newcastle-hsbc-1', 'HSBC', 'Grey Street', '102 Grey St, Newcastle NE1', 54.9715, -1.6130, 'south', '0345 740 4404'),
    branch('newcastle-lloyds-1', 'Lloyds', 'Newcastle', '33 Grey St, Newcastle NE1', 54.9725, -1.6135, 'south', '0345 300 0000'),
    branch('newcastle-natwest-1', 'NatWest', 'Northumberland St', '63 Northumberland St, Newcastle NE1', 54.9740, -1.6120, 'center', '0345 788 8444'),
  ],
  'Liverpool': [
    branch('liverpool-barclays-1', 'Barclays', 'Bold Street', '45-47 Bold St, Liverpool L1', 53.4045, -2.9795, 'center', '0345 734 5345'),
    branch('liverpool-hsbc-1', 'HSBC', 'Church Street', '99-101 Church St, Liverpool L1', 53.4075, -2.9870, 'west', '0345 740 4404'),
    branch('liverpool-lloyds-1', 'Lloyds', 'Liverpool', '48 Lord St, Liverpool L2', 53.4080, -2.9895, 'west', '0345 300 0000'),
    branch('liverpool-natwest-1', 'NatWest', 'Lord Street', '20 Lord St, Liverpool L2', 53.4085, -2.9885, 'west', '0345 788 8444'),
  ],
  'York': [
    branch('york-barclays-1', 'Barclays', 'Parliament Street', '10 Parliament St, York YO1', 53.9585, -1.0815, 'center', '0345 734 5345'),
    branch('york-hsbc-1', 'HSBC', 'Coney Street', '13 Coney St, York YO1', 53.9595, -1.0830, 'west', '0345 740 4404'),
    branch('york-lloyds-1', 'Lloyds', 'York', '7-9 Coney St, York YO1', 53.9590, -1.0825, 'west', '0345 300 0000'),
    branch('york-natwest-1', 'NatWest', 'Davygate', '4-6 Davygate, York YO1', 53.9580, -1.0810, 'center', '0345 788 8444'),
  ],
  'Durham': [
    branch('durham-barclays-1', 'Barclays', 'Market Place', '36 Market Pl, Durham DH1', 54.7755, -1.5760, 'center', '0345 734 5345'),
    branch('durham-hsbc-1', 'HSBC', 'North Road', '1 North Rd, Durham DH1', 54.7780, -1.5755, 'north', '0345 740 4404'),
    branch('durham-lloyds-1', 'Lloyds', 'Durham', '2 Silver St, Durham DH1', 54.7750, -1.5750, 'center', '0345 300 0000'),
    branch('durham-natwest-1', 'NatWest', 'Saddler Street', '49 Saddler St, Durham DH1', 54.7745, -1.5730, 'east', '0345 788 8444'),
  ],
  'Warwick': [
    branch('warwick-barclays-1', 'Barclays', 'Coventry', '20 High St, Coventry CV1', 52.4080, -1.5105, 'west', '0345 734 5345'),
    branch('warwick-hsbc-1', 'HSBC', 'Coventry', '2 High St, Coventry CV1', 52.4085, -1.5100, 'west', '0345 740 4404'),
    branch('warwick-lloyds-1', 'Lloyds', 'Leamington Spa', '86 The Parade, Leamington Spa CV32', 52.2920, -1.5365, 'south', '0345 300 0000'),
    branch('warwick-natwest-1', 'NatWest', 'Leamington Spa', '108 The Parade, Leamington Spa CV32', 52.2915, -1.5370, 'south', '0345 788 8444'),
  ],
  'Birmingham': [
    branch('birmingham-barclays-1', 'Barclays', 'New Street', '63 New St, Birmingham B2', 52.4780, -1.8955, 'center', '0345 734 5345'),
    branch('birmingham-hsbc-1', 'HSBC', 'New Street', '130 New St, Birmingham B2', 52.4785, -1.8965, 'center', '0345 740 4404'),
    branch('birmingham-lloyds-1', 'Lloyds', 'Birmingham', '125 New St, Birmingham B2', 52.4782, -1.8970, 'center', '0345 300 0000'),
    branch('birmingham-natwest-1', 'NatWest', 'Colmore Row', '103 Colmore Row, Birmingham B3', 52.4820, -1.8995, 'north', '0345 788 8444'),
  ],
  'Nottingham': [
    branch('nottingham-barclays-1', 'Barclays', 'Old Market Square', '8 Old Market Square, Nottingham NG1', 52.9540, -1.1475, 'center', '0345 734 5345'),
    branch('nottingham-hsbc-1', 'HSBC', 'Market Street', '5-7 Market St, Nottingham NG1', 52.9545, -1.1470, 'center', '0345 740 4404'),
    branch('nottingham-lloyds-1', 'Lloyds', 'Nottingham', '5 Smithy Row, Nottingham NG1', 52.9535, -1.1465, 'center', '0345 300 0000'),
    branch('nottingham-natwest-1', 'NatWest', 'High Street', '2 High St, Nottingham NG1', 52.9530, -1.1450, 'east', '0345 788 8444'),
  ],
};

// ============================================================================
// SCOTLAND UNIVERSITIES
// ============================================================================

export const SCOTLAND_BRANCHES: Record<string, BankBranch[]> = {
  'Edinburgh': [
    branch('edinburgh-barclays-1', 'Barclays', 'Princes Street', '119 Princes St, Edinburgh EH2', 55.9525, -3.1925, 'center', '0345 734 5345'),
    branch('edinburgh-rbs-1', 'Royal Bank of Scotland', 'George Street', '36 St Andrew Square, Edinburgh EH2', 55.9540, -3.1910, 'east', '0345 724 2424'),
    branch('edinburgh-lloyds-1', 'Lloyds', 'Edinburgh', '113 George St, Edinburgh EH2', 55.9535, -3.2000, 'west', '0345 300 0000'),
    branch('edinburgh-natwest-1', 'NatWest', 'Princes Street', '83 Princes St, Edinburgh EH2', 55.9530, -3.1980, 'center', '0345 788 8444'),
    branch('edinburgh-bos-1', 'Bank of Scotland', 'The Mound', 'Bank St, Edinburgh EH1', 55.9495, -3.1945, 'south', '0345 721 3141'),
  ],
  'Glasgow': [
    branch('glasgow-barclays-1', 'Barclays', 'Sauchiehall Street', '200 Sauchiehall St, Glasgow G2', 55.8650, -4.2565, 'center', '0345 734 5345'),
    branch('glasgow-rbs-1', 'Royal Bank of Scotland', 'Buchanan Street', '10 Gordon St, Glasgow G1', 55.8595, -4.2555, 'south', '0345 724 2424'),
    branch('glasgow-lloyds-1', 'Lloyds', 'Glasgow', '110 Buchanan St, Glasgow G1', 55.8620, -4.2530, 'center', '0345 300 0000'),
    branch('glasgow-natwest-1', 'NatWest', 'Buchanan Street', '77 Buchanan St, Glasgow G1', 55.8610, -4.2535, 'center', '0345 788 8444'),
    branch('glasgow-bos-1', 'Bank of Scotland', 'St Vincent Street', '110 St Vincent St, Glasgow G2', 55.8605, -4.2605, 'west', '0345 721 3141'),
  ],
  "St Andrews": [
    branch('standrews-barclays-1', 'Barclays', 'St Andrews', '100 Market St, St Andrews KY16', 56.3395, -2.7945, 'center', '0345 734 5345'),
    branch('standrews-rbs-1', 'Royal Bank of Scotland', 'St Andrews', '113 South St, St Andrews KY16', 56.3385, -2.7970, 'south', '0345 724 2424'),
    branch('standrews-bos-1', 'Bank of Scotland', 'St Andrews', '81 South St, St Andrews KY16', 56.3388, -2.7955, 'south', '0345 721 3141'),
  ],
  'Aberdeen': [
    branch('aberdeen-barclays-1', 'Barclays', 'Union Street', '177 Union St, Aberdeen AB11', 57.1455, -2.0995, 'center', '0345 734 5345'),
    branch('aberdeen-rbs-1', 'Royal Bank of Scotland', 'Union Street', '201 Union St, Aberdeen AB11', 57.1450, -2.1005, 'west', '0345 724 2424'),
    branch('aberdeen-lloyds-1', 'Lloyds', 'Aberdeen', '235 Union St, Aberdeen AB11', 57.1445, -2.1020, 'west', '0345 300 0000'),
  ],
};

// ============================================================================
// WALES UNIVERSITIES
// ============================================================================

export const WALES_BRANCHES: Record<string, BankBranch[]> = {
  'Cardiff': [
    branch('cardiff-barclays-1', 'Barclays', 'Queen Street', '74-76 Queen St, Cardiff CF10', 51.4815, -3.1755, 'center', '0345 734 5345'),
    branch('cardiff-hsbc-1', 'HSBC', 'Queen Street', '81-83 Queen St, Cardiff CF10', 51.4810, -3.1750, 'center', '0345 740 4404'),
    branch('cardiff-lloyds-1', 'Lloyds', 'Cardiff', '31-37 Queen St, Cardiff CF10', 51.4820, -3.1770, 'west', '0345 300 0000'),
    branch('cardiff-natwest-1', 'NatWest', 'St Mary Street', '4-8 St Mary St, Cardiff CF10', 51.4795, -3.1785, 'south', '0345 788 8444'),
  ],
  'Swansea': [
    branch('swansea-barclays-1', 'Barclays', 'Oxford Street', '74 Oxford St, Swansea SA1', 51.6215, -3.9415, 'center', '0345 734 5345'),
    branch('swansea-hsbc-1', 'HSBC', 'High Street', '1 High St, Swansea SA1', 51.6205, -3.9405, 'east', '0345 740 4404'),
    branch('swansea-lloyds-1', 'Lloyds', 'Swansea', '52 The Kingsway, Swansea SA1', 51.6195, -3.9440, 'west', '0345 300 0000'),
  ],
};

// ============================================================================
// SOUTH ENGLAND UNIVERSITIES
// ============================================================================

export const SOUTH_ENGLAND_BRANCHES: Record<string, BankBranch[]> = {
  'Bristol': [
    branch('bristol-barclays-1', 'Barclays', 'Broadmead', '50 Broadmead, Bristol BS1', 51.4575, -2.5895, 'east', '0345 734 5345'),
    branch('bristol-hsbc-1', 'HSBC', 'Corn Street', '57-59 Corn St, Bristol BS1', 51.4545, -2.5930, 'center', '0345 740 4404'),
    branch('bristol-lloyds-1', 'Lloyds', 'Bristol', '35 Corn St, Bristol BS1', 51.4550, -2.5925, 'center', '0345 300 0000'),
    branch('bristol-natwest-1', 'NatWest', 'Broadmead', '41 Broadmead, Bristol BS1', 51.4570, -2.5890, 'east', '0345 788 8444'),
  ],
  'Bath': [
    branch('bath-barclays-1', 'Barclays', 'Milsom Street', '37 Milsom St, Bath BA1', 51.3845, -2.3605, 'center', '0345 734 5345'),
    branch('bath-hsbc-1', 'HSBC', 'High Street', '12 High St, Bath BA1', 51.3820, -2.3575, 'east', '0345 740 4404'),
    branch('bath-lloyds-1', 'Lloyds', 'Bath', '18 Milsom St, Bath BA1', 51.3840, -2.3610, 'center', '0345 300 0000'),
    branch('bath-natwest-1', 'NatWest', 'Milsom Street', '33 Milsom St, Bath BA1', 51.3843, -2.3608, 'center', '0345 788 8444'),
  ],
  'Southampton': [
    branch('southampton-barclays-1', 'Barclays', 'Above Bar', '104 Above Bar St, Southampton SO14', 50.9090, -1.4035, 'center', '0345 734 5345'),
    branch('southampton-hsbc-1', 'HSBC', 'Above Bar', '170 Above Bar St, Southampton SO14', 50.9100, -1.4045, 'north', '0345 740 4404'),
    branch('southampton-lloyds-1', 'Lloyds', 'Southampton', '155 Above Bar St, Southampton SO14', 50.9095, -1.4040, 'north', '0345 300 0000'),
    branch('southampton-natwest-1', 'NatWest', 'Above Bar', '195 Above Bar St, Southampton SO14', 50.9105, -1.4050, 'north', '0345 788 8444'),
  ],
  'Exeter': [
    branch('exeter-barclays-1', 'Barclays', 'High Street', '201 High St, Exeter EX4', 50.7240, -3.5290, 'center', '0345 734 5345'),
    branch('exeter-hsbc-1', 'HSBC', 'High Street', '234 High St, Exeter EX4', 50.7235, -3.5295, 'center', '0345 740 4404'),
    branch('exeter-lloyds-1', 'Lloyds', 'Exeter', '59 High St, Exeter EX4', 50.7245, -3.5270, 'east', '0345 300 0000'),
    branch('exeter-natwest-1', 'NatWest', 'High Street', '54 High St, Exeter EX4', 50.7248, -3.5268, 'east', '0345 788 8444'),
  ],
  'Brighton': [
    branch('brighton-barclays-1', 'Barclays', 'North Street', '139-142 North St, Brighton BN1', 50.8225, -0.1400, 'center', '0345 734 5345'),
    branch('brighton-hsbc-1', 'HSBC', 'North Street', '154-155 North St, Brighton BN1', 50.8220, -0.1405, 'center', '0345 740 4404'),
    branch('brighton-lloyds-1', 'Lloyds', 'Brighton', '106-108 North St, Brighton BN1', 50.8230, -0.1390, 'east', '0345 300 0000'),
    branch('brighton-natwest-1', 'NatWest', 'Churchill Square', '5-9 Western Rd, Brighton BN1', 50.8215, -0.1425, 'west', '0345 788 8444'),
  ],
  'Reading': [
    branch('reading-barclays-1', 'Barclays', 'Broad Street', '10 Broad St, Reading RG1', 51.4555, -0.9720, 'center', '0345 734 5345'),
    branch('reading-hsbc-1', 'HSBC', 'Broad Street', '32-34 Broad St, Reading RG1', 51.4550, -0.9725, 'center', '0345 740 4404'),
    branch('reading-lloyds-1', 'Lloyds', 'Reading', '121-125 Broad St, Reading RG1', 51.4545, -0.9740, 'west', '0345 300 0000'),
  ],
  'Surrey': [
    branch('surrey-barclays-1', 'Barclays', 'Guildford', '170 High St, Guildford GU1', 51.2375, -0.5735, 'center', '0345 734 5345'),
    branch('surrey-hsbc-1', 'HSBC', 'Guildford', '150 High St, Guildford GU1', 51.2380, -0.5740, 'center', '0345 740 4404'),
    branch('surrey-lloyds-1', 'Lloyds', 'Guildford', '75 High St, Guildford GU1', 51.2390, -0.5725, 'north', '0345 300 0000'),
    branch('surrey-natwest-1', 'NatWest', 'High Street', '147 High St, Guildford GU1', 51.2378, -0.5738, 'center', '0345 788 8444'),
  ],
  'Sussex': [
    branch('sussex-barclays-1', 'Barclays', 'Brighton', '139-142 North St, Brighton BN1', 50.8225, -0.1400, 'south', '0345 734 5345'),
    branch('sussex-hsbc-1', 'HSBC', 'Brighton', '154-155 North St, Brighton BN1', 50.8220, -0.1405, 'south', '0345 740 4404'),
    branch('sussex-lloyds-1', 'Lloyds', 'Brighton', '106-108 North St, Brighton BN1', 50.8230, -0.1390, 'south', '0345 300 0000'),
  ],
};

// Combine all UK branches
export const ALL_UK_BANK_BRANCHES: Record<string, BankBranch[]> = {
  ...LONDON_BRANCHES,
  ...OXBRIDGE_BRANCHES,
  ...NORTHERN_ENGLAND_BRANCHES,
  ...SCOTLAND_BRANCHES,
  ...WALES_BRANCHES,
  ...SOUTH_ENGLAND_BRANCHES,
};
