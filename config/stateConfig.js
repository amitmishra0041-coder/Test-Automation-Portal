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
