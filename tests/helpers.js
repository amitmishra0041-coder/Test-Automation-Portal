// Reusable test data generators using @faker-js/faker for realistic data.
const { faker } = require('@faker-js/faker');

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
  // Generate a random 9-digit SSN (format: ###-##-####, but as plain number)
  return faker.string.numeric(9);
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
  randSSN
};
