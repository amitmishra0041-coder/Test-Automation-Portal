// Reusable test data generators using @faker-js/faker for realistic data.
const { faker } = require('@faker-js/faker');

// Counter for generating unique SSNs
let ssnCounter = 0;

function randAlphaNum(len = 8) {
  return Math.random().toString(36).slice(2, 2 + len);
}

function randEmail() {
  return faker.internet.email();
}

function randCompany() {
  return faker.company.name();
}

function randPhone() {
  return faker.phone.number('##########'); // 10 digits
}

function randFirstName() {
  return faker.person.firstName();
}

function randLastName() {
  return faker.person.lastName();
}

function randAddress() {
  // Ensure house number precedes street name (e.g., "742 Evergreen Terrace")
  return `${faker.location.buildingNumber()} ${faker.location.street()}`;
}

function randCity() {
  return faker.location.city();
}

function randState() {
  // Return a US state abbreviation (DE, CA, TX, etc.)
  const states = ['AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY'];
  return states[Math.floor(Math.random() * states.length)];
}

function randZipCode() {
  return faker.location.zipCode('#####');
}

function randSSN() {
  // Generate a valid 9-digit SSN following SSA rules:
  // - Area number (first 3 digits): 001-899, excluding 666
  // - Group number (middle 2 digits): 01-99
  // - Serial number (last 4 digits): 0001-9999
  
  // Generate area number (001-899, but not 666)
  let area;
  do {
    area = Math.floor(Math.random() * 899) + 1; // 1-899
  } while (area === 666);
  
  // Generate group number (01-99)
  const group = Math.floor(Math.random() * 99) + 1;
  
  // Generate serial number (0001-9999) with counter for uniqueness
  const serial = ((Math.floor(Math.random() * 9000) + 1000) + ssnCounter++) % 10000;
  
  // Format as 9-digit string with leading zeros
  const ssn = String(area).padStart(3, '0') + 
              String(group).padStart(2, '0') + 
              String(serial === 0 ? 1 : serial).padStart(4, '0');
  
  return ssn;
}

function randStreetLine1() {
  // Generate a realistic street address line 1 (e.g., "742 Evergreen Terrace")
  return `${faker.location.buildingNumber()} ${faker.location.street()}`;
}

function randDriverLicense(state = 'DE') {
  // Generate state-specific driver's license numbers with valid formatting
  // Based on actual state DMV requirements - includes alphanumeric formats
  state = state.toUpperCase();
  
  const randLetter = () => String.fromCharCode(65 + Math.floor(Math.random() * 26)); // A-Z
  const randDigit = () => Math.floor(Math.random() * 10);
  const randNum = (len) => faker.string.numeric(len);
  
  const dlFormats = {
    // Alphanumeric formats
    'AZ': () => {
      // Arizona: 1 letter + 8 digits OR 9 digits
      return Math.random() > 0.5 ? randLetter() + randNum(8) : randNum(9);
    },
    'CO': () => {
      // Colorado: 9 digits OR 1-2 letters + 3-6 digits OR 2 letters + 2-5 digits
      const formats = [
        () => randNum(9),
        () => randLetter() + randNum(6),
        () => randLetter() + randLetter() + randNum(5)
      ];
      return formats[Math.floor(Math.random() * formats.length)]();
    },
    'DE': () => randNum(7), // Delaware: 7 digits
    'IL': () => randLetter() + randNum(11), // Illinois: 1 letter + 11 digits
    'IN': () => {
      // Indiana: 10 digits OR 1 letter + 9 digits
      return Math.random() > 0.5 ? randNum(10) : randLetter() + randNum(9);
    },
    'IA': () => {
      // Iowa: 3 digits + 2 letters + 4 digits OR 9 digits
      return Math.random() > 0.5 
        ? randNum(3) + randLetter() + randLetter() + randNum(4)
        : randNum(9);
    },
    'MI': () => randLetter() + randNum(12), // Michigan: 1 letter + 12 digits
    'NC': () => randNum(12), // North Carolina: 1-12 digits (using 12)
    'NE': () => randLetter() + randNum(8), // Nebraska: 1 letter + 8 digits
    'NM': () => randNum(9), // New Mexico: 9 digits
    'OH': () => {
      // Ohio: 2 letters + 6 digits OR 8 digits
      return Math.random() > 0.5 
        ? randLetter() + randLetter() + randNum(6)
        : randNum(8);
    },
    'PA': () => randNum(8), // Pennsylvania: 8 digits
    'SC': () => randNum(11), // South Carolina: 11 digits
    'SD': () => {
      // South Dakota: 8 digits OR 9 digits OR 6-10 digits
      return randNum(9);
    },
    'TN': () => randNum(9), // Tennessee: 7-9 digits (using 9)
    'TX': () => randNum(8), // Texas: 8 digits
    'UT': () => randNum(10), // Utah: 4-10 digits (using 10)
    'VA': () => {
      // Virginia: 1 letter + 8 digits OR 9 digits
      return Math.random() > 0.5 ? randLetter() + randNum(8) : randNum(9);
    },
    'WI': () => {
      // Wisconsin: 1 letter + 13 digits (e.g., H5501798306408)
      return randLetter() + randNum(13);
    },
    // Default for any other state
    'DEFAULT': () => randNum(9)
  };
  
  const generator = dlFormats[state] || dlFormats['DEFAULT'];
  return generator();
}

module.exports = {
  randAlphaNum,
  randEmail,
  randCompany,
  randPhone,
  randFirstName,
  randLastName,
  randAddress,
  randCity,
  randState,
  randZipCode,
  randSSN,
  randStreetLine1,
  randDriverLicense
};
