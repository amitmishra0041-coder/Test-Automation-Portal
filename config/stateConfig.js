// State configuration for test data generation
const STATE_CONFIG = {
  'DE': {
    name: 'Delaware',
    dropdownId: '#ui-id-30',
    zipCodes: ['19709', '19701', '19702', '19703', '19804', '19806', '19901', '19958'],
    cities: ['Newark', 'Bear', 'Wilmington', 'Dover', 'Middletown', 'Smyrna', 'Georgetown', 'Milford']
  },
  'PA': {
    name: 'Pennsylvania',
    dropdownId: '#ui-id-31',
    zipCodes: ['17101', '17104', '19101', '15219', '18015', '16501', '17602', '19380'],
    cities: ['Harrisburg', 'Philadelphia', 'Pittsburgh', 'Allentown', 'Erie', 'Lancaster', 'West Chester', 'Reading']
  },
  'WI': {
    name: 'Wisconsin',
    dropdownId: '#ui-id-32',
    zipCodes: ['53202', '53211', '53703', '53212', '54301', '53188', '53140', '53233'],
    cities: ['Milwaukee', 'Madison', 'Green Bay', 'Kenosha', 'Racine', 'Appleton', 'Waukesha', 'Eau Claire']
  },
  'OH': {
    name: 'Ohio',
    dropdownId: '#ui-id-33',
    zipCodes: ['43215', '44114', '45202', '44303', '43604', '45419', '44240', '43081'],
    cities: ['Columbus', 'Cleveland', 'Cincinnati', 'Akron', 'Toledo', 'Dayton', 'Kent', 'Westerville']
  },
  'MI': {
    name: 'Michigan',
    dropdownId: '#ui-id-34',
    zipCodes: ['48201', '49503', '48823', '48507', '49008', '48858', '49684', '48640'],
    cities: ['Detroit', 'Grand Rapids', 'Lansing', 'Flint', 'Kalamazoo', 'East Lansing', 'Traverse City', 'Midland']
  },
  'AZ': {
    name: 'Arizona',
    dropdownId: '#ui-id-35',
    zipCodes: ['85001', '85201', '85701', '85281', '85224', '85364', '86001', '85027'],
    cities: ['Phoenix', 'Mesa', 'Tucson', 'Tempe', 'Chandler', 'Yuma', 'Flagstaff', 'Peoria']
  },
  'CO': {
    name: 'Colorado',
    dropdownId: '#ui-id-36',
    zipCodes: ['80202', '80014', '80918', '80401', '80538', '80906', '80303', '80524'],
    cities: ['Denver', 'Aurora', 'Colorado Springs', 'Golden', 'Fort Collins', 'Boulder', 'Loveland', 'Pueblo']
  },
  'IL': {
    name: 'Illinois',
    dropdownId: '#ui-id-37',
    zipCodes: ['60601', '60614', '62701', '61801', '60201', '60540', '61101', '60174'],
    cities: ['Chicago', 'Springfield', 'Champaign', 'Evanston', 'Naperville', 'Rockford', 'Romeoville', 'Peoria']
  },
  'IA': {
    name: 'Iowa',
    dropdownId: '#ui-id-38',
    zipCodes: ['50309', '52401', '52240', '50010', '51501', '52001', '50613', '50702'],
    cities: ['Des Moines', 'Cedar Rapids', 'Iowa City', 'Ames', 'Council Bluffs', 'Dubuque', 'Waterloo', 'Cedar Falls']
  },
  'NC': {
    name: 'North Carolina',
    dropdownId: '#ui-id-39',
    zipCodes: ['28202', '27601', '27514', '27103', '28801', '27403', '28540', '28401'],
    cities: ['Charlotte', 'Raleigh', 'Chapel Hill', 'Winston-Salem', 'Asheville', 'Greensboro', 'Jacksonville', 'Wilmington']
  },
  'SC': {
    name: 'South Carolina',
    dropdownId: '#ui-id-40',
    zipCodes: ['29201', '29401', '29303', '29464', '29577', '29483', '29550', '29651'],
    cities: ['Columbia', 'Charleston', 'Spartanburg', 'Mount Pleasant', 'Myrtle Beach', 'Summerville', 'Florence', 'Greenville']
  },
  'NE': {
    name: 'Nebraska',
    dropdownId: '#ui-id-41',
    zipCodes: ['68102', '68501', '68847', '68776', '68025', '69361', '68701', '68310'],
    cities: ['Omaha', 'Lincoln', 'Kearney', 'Norfolk', 'Fremont', 'North Platte', 'Grand Island', 'Bellevue']
  },
  'NM': {
    name: 'New Mexico',
    dropdownId: '#ui-id-42',
    zipCodes: ['87102', '87501', '88001', '88310', '87401', '87144', '88220', '87801'],
    cities: ['Albuquerque', 'Santa Fe', 'Las Cruces', 'Alamogordo', 'Farmington', 'Rio Rancho', 'Carlsbad', 'Socorro']
  },
  'SD': {
    name: 'South Dakota',
    dropdownId: '#ui-id-43',
    zipCodes: ['57104', '57701', '57401', '57501', '57078', '57103', '57769', '57301'],
    cities: ['Sioux Falls', 'Rapid City', 'Aberdeen', 'Pierre', 'Watertown', 'Brandon', 'Spearfish', 'Mitchell']
  },
  'TX': {
    name: 'Texas',
    dropdownId: '#ui-id-44',
    zipCodes: ['75201', '77002', '78701', '78201', '76102', '79901', '79764', '75002'],
    cities: ['Dallas', 'Houston', 'Austin', 'San Antonio', 'Fort Worth', 'El Paso', 'Odessa', 'Allen']
  },
  'UT': {
    name: 'Utah',
    dropdownId: '#ui-id-45',
    zipCodes: ['84101', '84604', '84321', '84770', '84010', '84037', '84041', '84401'],
    cities: ['Salt Lake City', 'Provo', 'Logan', 'St. George', 'Bountiful', 'Kaysville', 'Layton', 'Ogden']
  },
  'IN': {
    name: 'Indiana',
    dropdownId: '#ui-id-46',
    zipCodes: ['46201', '46802', '47401', '47906', '46160', '47630', '46311', '47330'],
    cities: ['Indianapolis', 'Fort Wayne', 'Bloomington', 'Lafayette', 'Greenwood', 'Evansville', 'Hammond', 'Muncie']
  },
  'TN': {
    name: 'Tennessee',
    dropdownId: '#ui-id-47',
    zipCodes: ['37201', '38103', '37901', '37040', '37922', '37130', '38305', '37604'],
    cities: ['Nashville', 'Memphis', 'Knoxville', 'Clarksville', 'Murfreesboro', 'Franklin', 'Jackson', 'Johnson City']
  },
  'VA': {
    name: 'Virginia',
    dropdownId: '#ui-id-48',
    zipCodes: ['23219', '23451', '22201', '23220', '22902', '23116', '24019', '22003'],
    cities: ['Richmond', 'Virginia Beach', 'Arlington', 'Charlottesville', 'Mechanicsville', 'Roanoke', 'Annandale', 'Norfolk']
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

module.exports = {
  STATE_CONFIG,
  getStateConfig,
  randCityForState,
  randZipForState
};
