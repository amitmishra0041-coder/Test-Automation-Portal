// State configuration for test data generation
const STATE_CONFIG = {
  'DE': {
    name: 'Delaware',
    dropdownId: '#ui-id-30',
    zipCodes: ['19709', '19701', '19702', '19703', '19804', '19806', '19901', '19958'],
    cities: ['Newark', 'Bear', 'Wilmington', 'Dover', 'Middletown', 'Smyrna', 'Georgetown', 'Milford'],
    addresses: [
      { street: '1 S Main St', city: 'Newark', zip: '19711' },
      { street: '250 Court St', city: 'Dover', zip: '19901' },
      { street: '500 Market St', city: 'Wilmington', zip: '19801' }
    ]
  },
  'PA': {
    name: 'Pennsylvania',
    dropdownId: '#ui-id-31',
    zipCodes: ['17101', '17104', '19101', '15219', '18015', '16501', '17602', '19380'],
    cities: ['Harrisburg', 'Philadelphia', 'Pittsburgh', 'Allentown', 'Erie', 'Lancaster', 'West Chester', 'Reading'],
    addresses: [
      { street: '123 Arch St', city: 'Philadelphia', zip: '19101' },
      { street: '456 Penn Ave', city: 'Pittsburgh', zip: '15219' },
      { street: '789 State St', city: 'Harrisburg', zip: '17101' }
    ]
  },
  'WI': {
    name: 'Wisconsin',
    dropdownId: '#ui-id-32',
    zipCodes: ['53202', '53211', '53703', '53212', '54301', '53188', '53140', '53233'],
    cities: ['Milwaukee', 'Madison', 'Green Bay', 'Kenosha', 'Racine', 'Appleton', 'Waukesha', 'Eau Claire'],
    addresses: [
      { street: '100 Water St', city: 'Milwaukee', zip: '53202' },
      { street: '200 King St', city: 'Madison', zip: '53703' },
      { street: '150 Broadway', city: 'Green Bay', zip: '54301' }
    ]
  },
  'OH': {
    name: 'Ohio',
    dropdownId: '#ui-id-33',
    zipCodes: ['43215', '44114', '45202', '44303', '43604', '45419', '44240', '43081'],
    cities: ['Columbus', 'Cleveland', 'Cincinnati', 'Akron', 'Toledo', 'Dayton', 'Kent', 'Westerville'],
    addresses: [
      { street: '100 High St', city: 'Columbus', zip: '43215' },
      { street: '200 Public Sq', city: 'Cleveland', zip: '44114' },
      { street: '300 Vine St', city: 'Cincinnati', zip: '45202' }
    ]
  },
  'MI': {
    name: 'Michigan',
    dropdownId: '#ui-id-34',
    zipCodes: ['48201', '49503', '48823', '48507', '49008', '48858', '49684', '48640'],
    cities: ['Detroit', 'Grand Rapids', 'Lansing', 'Flint', 'Kalamazoo', 'East Lansing', 'Traverse City', 'Midland'],
    addresses: [
      { street: '100 Woodward Ave', city: 'Detroit', zip: '48201' },
      { street: '200 Monroe NW', city: 'Grand Rapids', zip: '49503' },
      { street: '300 Capitol Ave', city: 'Lansing', zip: '48823' }
    ]
  },
  'AZ': {
    name: 'Arizona',
    dropdownId: '#ui-id-35',
    zipCodes: ['85001', '85201', '85701', '85281', '85224', '85364', '86001', '85027'],
    cities: ['Phoenix', 'Mesa', 'Tucson', 'Tempe', 'Chandler', 'Yuma', 'Flagstaff', 'Peoria'],
    addresses: [
      { street: '100 Washington St', city: 'Phoenix', zip: '85001' },
      { street: '200 Main St', city: 'Mesa', zip: '85201' },
      { street: '300 Arizona Ave', city: 'Tucson', zip: '85701' }
    ]
  },
  'CO': {
    name: 'Colorado',
    dropdownId: '#ui-id-36',
    zipCodes: ['80202', '80014', '80918', '80401', '80538', '80906', '80303', '80524'],
    cities: ['Denver', 'Aurora', 'Colorado Springs', 'Golden', 'Fort Collins', 'Boulder', 'Loveland', 'Pueblo'],
    addresses: [
      { street: '100 16th St', city: 'Denver', zip: '80202' },
      { street: '1200 E Colfax Ave', city: 'Denver', zip: '80218' },
      { street: '300 South Nevada', city: 'Colorado Springs', zip: '80903' }
    ]
  },
  'IL': {
    name: 'Illinois',
    dropdownId: '#ui-id-37',
    zipCodes: ['60601', '60614', '62701', '61801', '60201', '60540', '61101', '60174'],
    cities: ['Chicago', 'Springfield', 'Champaign', 'Evanston', 'Naperville', 'Rockford', 'Romeoville', 'Peoria'],
    addresses: [
      { street: '100 State St', city: 'Chicago', zip: '60601' },
      { street: '200 Capitol Ave', city: 'Springfield', zip: '62701' },
      { street: '300 Main St', city: 'Champaign', zip: '61801' }
    ]
  },
  'IA': {
    name: 'Iowa',
    dropdownId: '#ui-id-38',
    zipCodes: ['50309', '52401', '52240', '50010', '51501', '52001', '50613', '50702'],
    cities: ['Des Moines', 'Cedar Rapids', 'Iowa City', 'Ames', 'Council Bluffs', 'Dubuque', 'Waterloo', 'Cedar Falls'],
    addresses: [
      { street: '100 Walnut St', city: 'Des Moines', zip: '50309' },
      { street: '200 First Ave', city: 'Cedar Rapids', zip: '52401' },
      { street: '300 Clinton St', city: 'Iowa City', zip: '52240' }
    ]
  },
  'NC': {
    name: 'North Carolina',
    dropdownId: '#ui-id-39',
    zipCodes: ['28202', '27601', '27514', '27103', '28801', '27403', '28540', '28401'],
    cities: ['Charlotte', 'Raleigh', 'Chapel Hill', 'Winston-Salem', 'Asheville', 'Greensboro', 'Jacksonville', 'Wilmington'],
    addresses: [
      { street: '100 Tryon St', city: 'Charlotte', zip: '28202' },
      { street: '200 Fayetteville St', city: 'Raleigh', zip: '27601' },
      { street: '300 West Franklin', city: 'Chapel Hill', zip: '27514' }
    ]
  },
  'SC': {
    name: 'South Carolina',
    dropdownId: '#ui-id-40',
    zipCodes: ['29201', '29401', '29303', '29464', '29577', '29483', '29550', '29651'],
    cities: ['Columbia', 'Charleston', 'Spartanburg', 'Mount Pleasant', 'Myrtle Beach', 'Summerville', 'Florence', 'Greenville'],
    addresses: [
      { street: '100 Main St', city: 'Columbia', zip: '29201' },
      { street: '200 King St', city: 'Charleston', zip: '29401' },
      { street: '300 Main St', city: 'Spartanburg', zip: '29303' }
    ]
  },
  'NE': {
    name: 'Nebraska',
    dropdownId: '#ui-id-41',
    zipCodes: ['68102', '68501', '68847', '68776', '68025', '69361', '68701', '68310'],
    cities: ['Omaha', 'Lincoln', 'Kearney', 'Norfolk', 'Fremont', 'North Platte', 'Grand Island', 'Bellevue'],
    addresses: [
      { street: '100 Dodge St', city: 'Omaha', zip: '68102' },
      { street: '200 North 9th', city: 'Lincoln', zip: '68508' },
      { street: '300 Main St', city: 'Kearney', zip: '68847' }
    ]
  },
  'NM': {
    name: 'New Mexico',
    dropdownId: '#ui-id-42',
    zipCodes: ['87102', '87501', '88001', '88310', '87401', '87144', '88220', '87801'],
    cities: ['Albuquerque', 'Santa Fe', 'Las Cruces', 'Alamogordo', 'Farmington', 'Rio Rancho', 'Carlsbad', 'Socorro'],
    addresses: [
      { street: '100 Gold Ave', city: 'Albuquerque', zip: '87102' },
      { street: '200 Palace Ave', city: 'Santa Fe', zip: '87501' },
      { street: '300 Main St', city: 'Las Cruces', zip: '88001' }
    ]
  },
  'SD': {
    name: 'South Dakota',
    dropdownId: '#ui-id-43',
    zipCodes: ['57104', '57701', '57401', '57501', '57078', '57103', '57769', '57301'],
    cities: ['Sioux Falls', 'Rapid City', 'Aberdeen', 'Pierre', 'Watertown', 'Brandon', 'Spearfish', 'Mitchell'],
    addresses: [
      { street: '100 Main St', city: 'Sioux Falls', zip: '57104' },
      { street: '200 Main St', city: 'Rapid City', zip: '57701' },
      { street: '300 Main St', city: 'Aberdeen', zip: '57401' }
    ]
  },
  'TX': {
    name: 'Texas',
    dropdownId: '#ui-id-44',
    zipCodes: ['75201', '77002', '78701', '78201', '76102', '79901', '79764', '75002'],
    cities: ['Dallas', 'Houston', 'Austin', 'San Antonio', 'Fort Worth', 'El Paso', 'Odessa', 'Allen'],
    addresses: [
      { street: '100 Main St', city: 'Dallas', zip: '75201' },
      { street: '200 Main St', city: 'Houston', zip: '77002' },
      { street: '300 Congress Ave', city: 'Austin', zip: '78701' }
    ]
  },
  'UT': {
    name: 'Utah',
    dropdownId: '#ui-id-45',
    zipCodes: ['84101', '84604', '84321', '84770', '84010', '84037', '84041', '84401'],
    cities: ['Salt Lake City', 'Provo', 'Logan', 'St. George', 'Bountiful', 'Kaysville', 'Layton', 'Ogden'],
    addresses: [
      { street: '100 South Temple', city: 'Salt Lake City', zip: '84101' },
      { street: '200 North University', city: 'Provo', zip: '84604' },
      { street: '300 North Main', city: 'Logan', zip: '84321' }
    ]
  },
  'IN': {
    name: 'Indiana',
    dropdownId: '#ui-id-46',
    zipCodes: ['46201', '46802', '47401', '47906', '46160', '47630', '46311', '47330'],
    cities: ['Indianapolis', 'Fort Wayne', 'Bloomington', 'Lafayette', 'Greenwood', 'Evansville', 'Hammond', 'Muncie'],
    addresses: [
      { street: '100 Market St', city: 'Indianapolis', zip: '46204' },
      { street: '200 Main St', city: 'Fort Wayne', zip: '46802' },
      { street: '300 Kirkwood Ave', city: 'Bloomington', zip: '47401' }
    ]
  },
  'TN': {
    name: 'Tennessee',
    dropdownId: '#ui-id-47',
    zipCodes: ['37201', '38103', '37901', '37040', '37922', '37130', '38305', '37604'],
    cities: ['Nashville', 'Memphis', 'Knoxville', 'Clarksville', 'Murfreesboro', 'Franklin', 'Jackson', 'Johnson City'],
    addresses: [
      { street: '100 Broadway', city: 'Nashville', zip: '37201' },
      { street: '200 Main St', city: 'Memphis', zip: '38103' },
      { street: '300 Main Ave', city: 'Knoxville', zip: '37902' }
    ]
  },
  'VA': {
    name: 'Virginia',
    dropdownId: '#ui-id-48',
    zipCodes: ['23219', '23451', '22201', '23220', '22902', '23116', '24019', '22003'],
    cities: ['Richmond', 'Virginia Beach', 'Arlington', 'Charlottesville', 'Mechanicsville', 'Roanoke', 'Annandale', 'Norfolk'],
    addresses: [
      { street: '100 Main St', city: 'Richmond', zip: '23219' },
      { street: '200 Atlantic Ave', city: 'Virginia Beach', zip: '23451' },
      { street: '300 North Glebe Rd', city: 'Arlington', zip: '22201' }
    ]
  }
};

// Get configuration for a specific state
function getStateConfig(stateCode) {
  const state = stateCode?.toUpperCase() || 'DE';
  return STATE_CONFIG[state] || STATE_CONFIG['DE']; // Default to DE if invalid
}

// Get random city for a state
function randCityForState(stateCode) {
  const config = getStateConfig(stateCode);
  return config.cities[Math.floor(Math.random() * config.cities.length)];
}

// Get random zip code for a state
function randZipForState(stateCode) {
  const config = getStateConfig(stateCode);
  return config.zipCodes[Math.floor(Math.random() * config.zipCodes.length)];
}

// Get a valid real address for a state
function randAddressForState(stateCode) {
  const config = getStateConfig(stateCode);
  return config.addresses[Math.floor(Math.random() * config.addresses.length)];
}

module.exports = {
  STATE_CONFIG,
  getStateConfig,
  randCityForState,
  randZipForState,
  randAddressForState,
  // Target states list used across suites
  TARGET_STATES: ['DE', 'PA', 'WI', 'OH', 'MI', 'AZ', 'CO', 'IL', 'IA', 'NC', 'SC', 'NE', 'NM', 'SD', 'TX', 'UT', 'IN', 'TN', 'VA']
};
