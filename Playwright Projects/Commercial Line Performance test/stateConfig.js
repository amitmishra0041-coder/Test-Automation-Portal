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
  },
  'AL': {
    name: 'Alabama',
    dropdownId: '#ui-id-49',
    zipCodes: ['35203', '36602', '36104', '35801'],
    cities: ['Birmingham', 'Mobile', 'Montgomery', 'Huntsville'],
    addresses: [
      { street: '1 19th St N', city: 'Birmingham', zip: '35203' },
      { street: '200 Government St', city: 'Mobile', zip: '36602' },
      { street: '100 Commerce St', city: 'Montgomery', zip: '36104' }
    ]
  },
  'AK': {
    name: 'Alaska',
    dropdownId: '#ui-id-50',
    zipCodes: ['99501', '99701', '99601', '99801'],
    cities: ['Anchorage', 'Fairbanks', 'Kenai', 'Juneau'],
    addresses: [
      { street: '123 E 4th Ave', city: 'Anchorage', zip: '99501' },
      { street: '1001 Cushman St', city: 'Fairbanks', zip: '99701' },
      { street: '9103 Mendenhall Mall Rd', city: 'Juneau', zip: '99801' }
    ]
  },
  'AR': {
    name: 'Arkansas',
    dropdownId: '#ui-id-51',
    zipCodes: ['72201', '72701', '72002', '71601'],
    cities: ['Little Rock', 'Fayetteville', 'Conway', 'Pine Bluff'],
    addresses: [
      { street: '1 Capitol Ave', city: 'Little Rock', zip: '72201' },
      { street: '310 W Dickson St', city: 'Fayetteville', zip: '72701' },
      { street: '1000 West Main St', city: 'Pine Bluff', zip: '71601' }
    ]
  },
  'CA': {
    name: 'California',
    dropdownId: '#ui-id-52',
    zipCodes: ['90012', '94103', '95814', '92101'],
    cities: ['Los Angeles', 'San Francisco', 'Sacramento', 'San Diego'],
    addresses: [
      { street: '200 N Spring St', city: 'Los Angeles', zip: '90012' },
      { street: '1 Dr Carlton B Goodlett Pl', city: 'San Francisco', zip: '94102' },
      { street: '1200 3rd Ave', city: 'San Diego', zip: '92101' }
    ]
  },
  'CT': {
    name: 'Connecticut',
    dropdownId: '#ui-id-53',
    zipCodes: ['06103', '06510', '06604', '06106'],
    cities: ['Hartford', 'New Haven', 'Bridgeport', 'Middletown'],
    addresses: [
      { street: '300 Capitol Ave', city: 'Hartford', zip: '06103' },
      { street: '165 Church St', city: 'New Haven', zip: '06510' },
      { street: '915 Main St', city: 'Bridgeport', zip: '06604' }
    ]
  },
  'FL': {
    name: 'Florida',
    dropdownId: '#ui-id-54',
    zipCodes: ['33130', '32801', '32202', '33602'],
    cities: ['Miami', 'Orlando', 'Jacksonville', 'Tampa'],
    addresses: [
      { street: '200 S Biscayne Blvd', city: 'Miami', zip: '33130' },
      { street: '100 W Livingston St', city: 'Orlando', zip: '32801' },
      { street: '100 N Laura St', city: 'Jacksonville', zip: '32202' }
    ]
  },
  'GA': {
    name: 'Georgia',
    dropdownId: '#ui-id-55',
    zipCodes: ['30303', '31401', '31901', '30901'],
    cities: ['Atlanta', 'Savannah', 'Columbus', 'Augusta'],
    addresses: [
      { street: '55 Trinity Ave SW', city: 'Atlanta', zip: '30303' },
      { street: '2 E Bay St', city: 'Savannah', zip: '31401' },
      { street: '601 11th St', city: 'Columbus', zip: '31901' }
    ]
  },
  'HI': {
    name: 'Hawaii',
    dropdownId: '#ui-id-56',
    zipCodes: ['96813', '96720', '96740', '96793'],
    cities: ['Honolulu', 'Hilo', 'Kailua Kona', 'Wailuku'],
    addresses: [
      { street: '1000 Bishop St', city: 'Honolulu', zip: '96813' },
      { street: '111 E Puainako St', city: 'Hilo', zip: '96720' },
      { street: '75-5706 Kuakini Hwy', city: 'Kailua Kona', zip: '96740' }
    ]
  },
  'ID': {
    name: 'Idaho',
    dropdownId: '#ui-id-57',
    zipCodes: ['83702', '83402', '83201', '83642'],
    cities: ['Boise', 'Idaho Falls', 'Pocatello', 'Meridian'],
    addresses: [
      { street: '700 W Jefferson St', city: 'Boise', zip: '83702' },
      { street: '200 S Woodruff Ave', city: 'Idaho Falls', zip: '83402' },
      { street: '911 N Main St', city: 'Pocatello', zip: '83201' }
    ]
  },
  'KS': {
    name: 'Kansas',
    dropdownId: '#ui-id-58',
    zipCodes: ['66101', '67202', '66603', '66502'],
    cities: ['Kansas City', 'Wichita', 'Topeka', 'Manhattan'],
    addresses: [
      { street: '1 SW Jackson St', city: 'Topeka', zip: '66603' },
      { street: '100 N Main St', city: 'Wichita', zip: '67202' },
      { street: '701 N 7th St', city: 'Kansas City', zip: '66101' }
    ]
  },
  'KY': {
    name: 'Kentucky',
    dropdownId: '#ui-id-59',
    zipCodes: ['40202', '40507', '41011', '42101'],
    cities: ['Louisville', 'Lexington', 'Covington', 'Bowling Green'],
    addresses: [
      { street: '444 W Muhammad Ali Blvd', city: 'Louisville', zip: '40202' },
      { street: '300 W Vine St', city: 'Lexington', zip: '40507' },
      { street: '1001 Vandalay Dr', city: 'Bowling Green', zip: '42101' }
    ]
  },
  'LA': {
    name: 'Louisiana',
    dropdownId: '#ui-id-60',
    zipCodes: ['70112', '70801', '71101', '70501'],
    cities: ['New Orleans', 'Baton Rouge', 'Shreveport', 'Lafayette'],
    addresses: [
      { street: '1300 Perdido St', city: 'New Orleans', zip: '70112' },
      { street: '900 North 3rd St', city: 'Baton Rouge', zip: '70802' },
      { street: '400 Travis St', city: 'Shreveport', zip: '71101' }
    ]
  },
  'ME': {
    name: 'Maine',
    dropdownId: '#ui-id-61',
    zipCodes: ['04101', '04401', '03901', '04609'],
    cities: ['Portland', 'Bangor', 'Portsmouth', 'Ellsworth'],
    addresses: [
      { street: '389 Congress St', city: 'Portland', zip: '04101' },
      { street: '73 Harlow St', city: 'Bangor', zip: '04401' },
      { street: '1 State St', city: 'Portland', zip: '04101' }
    ]
  },
  'MD': {
    name: 'Maryland',
    dropdownId: '#ui-id-62',
    zipCodes: ['21201', '21401', '21701', '21044'],
    cities: ['Baltimore', 'Annapolis', 'Frederick', 'Columbia'],
    addresses: [
      { street: '100 N Calvert St', city: 'Baltimore', zip: '21201' },
      { street: '160 Duke of Gloucester St', city: 'Annapolis', zip: '21401' },
      { street: '101 N Court St', city: 'Frederick', zip: '21701' }
    ]
  },
  'MA': {
    name: 'Massachusetts',
    dropdownId: '#ui-id-63',
    zipCodes: ['02108', '01608', '01103', '02451'],
    cities: ['Boston', 'Worcester', 'Springfield', 'Waltham'],
    addresses: [
      { street: '1 City Hall Sq', city: 'Boston', zip: '02108' },
      { street: '44 Front St', city: 'Worcester', zip: '01608' },
      { street: '36 Court St', city: 'Springfield', zip: '01103' }
    ]
  },
  'MN': {
    name: 'Minnesota',
    dropdownId: '#ui-id-64',
    zipCodes: ['55401', '55101', '55802', '55901'],
    cities: ['Minneapolis', 'Saint Paul', 'Duluth', 'Rochester'],
    addresses: [
      { street: '350 S 5th St', city: 'Minneapolis', zip: '55401' },
      { street: '75 Rev Dr Martin Luther King Jr Blvd', city: 'Saint Paul', zip: '55101' },
      { street: '411 W First St', city: 'Duluth', zip: '55802' }
    ]
  },
  'MS': {
    name: 'Mississippi',
    dropdownId: '#ui-id-65',
    zipCodes: ['39201', '39530', '39301', '38801'],
    cities: ['Jackson', 'Biloxi', 'Meridian', 'Tupelo'],
    addresses: [
      { street: '300 E Capitol St', city: 'Jackson', zip: '39201' },
      { street: '1641 Beach Blvd', city: 'Biloxi', zip: '39530' },
      { street: '221 N Front St', city: 'Tupelo', zip: '38801' }
    ]
  },
  'MO': {
    name: 'Missouri',
    dropdownId: '#ui-id-66',
    zipCodes: ['63101', '64106', '65806', '65101'],
    cities: ['St. Louis', 'Kansas City', 'Springfield', 'Jefferson City'],
    addresses: [
      { street: '1 Metropolitan Sq', city: 'St. Louis', zip: '63101' },
      { street: '414 E 12th St', city: 'Kansas City', zip: '64106' },
      { street: '201 W Capitol Ave', city: 'Jefferson City', zip: '65101' }
    ]
  },
  'MT': {
    name: 'Montana',
    dropdownId: '#ui-id-67',
    zipCodes: ['59101', '59601', '59715', '59801'],
    cities: ['Billings', 'Helena', 'Bozeman', 'Missoula'],
    addresses: [
      { street: '123 N 27th St', city: 'Billings', zip: '59101' },
      { street: '1301 E 6th Ave', city: 'Helena', zip: '59601' },
      { street: '435 Ryman St', city: 'Bozeman', zip: '59715' }
    ]
  },
  'NV': {
    name: 'Nevada',
    dropdownId: '#ui-id-68',
    zipCodes: ['89101', '89501', '89030', '89431'],
    cities: ['Las Vegas', 'Reno', 'North Las Vegas', 'Sparks'],
    addresses: [
      { street: '495 S Main St', city: 'Las Vegas', zip: '89101' },
      { street: '1 E 1st St', city: 'Reno', zip: '89501' },
      { street: '2250 Las Vegas Blvd N', city: 'North Las Vegas', zip: '89030' }
    ]
  },
  'NH': {
    name: 'New Hampshire',
    dropdownId: '#ui-id-69',
    zipCodes: ['03301', '03101', '03801', '03755'],
    cities: ['Concord', 'Manchester', 'Portsmouth', 'Hanover'],
    addresses: [
      { street: '1 Eagle Sq', city: 'Concord', zip: '03301' },
      { street: '1 City Hall Plaza', city: 'Manchester', zip: '03101' },
      { street: '1 Junkins Ave', city: 'Portsmouth', zip: '03801' }
    ]
  },
  'NJ': {
    name: 'New Jersey',
    dropdownId: '#ui-id-70',
    zipCodes: ['07102', '08608', '07302', '08401'],
    cities: ['Newark', 'Trenton', 'Jersey City', 'Atlantic City'],
    addresses: [
      { street: '920 Broad St', city: 'Newark', zip: '07102' },
      { street: '31 Market St', city: 'Trenton', zip: '08608' },
      { street: '1 Jackson Sq', city: 'Jersey City', zip: '07302' }
    ]
  },
  'NY': {
    name: 'New York',
    dropdownId: '#ui-id-71',
    zipCodes: ['10001', '12207', '14202', '13202'],
    cities: ['New York', 'Albany', 'Buffalo', 'Syracuse'],
    addresses: [
      { street: '1 Centre St', city: 'New York', zip: '10001' },
      { street: '155 Washington Ave', city: 'Albany', zip: '12210' },
      { street: '65 Niagara Sq', city: 'Buffalo', zip: '14202' }
    ]
  },
  'ND': {
    name: 'North Dakota',
    dropdownId: '#ui-id-72',
    zipCodes: ['58102', '58501', '58201', '58601'],
    cities: ['Fargo', 'Bismarck', 'Grand Forks', 'Dickinson'],
    addresses: [
      { street: '200 N 3rd St', city: 'Fargo', zip: '58102' },
      { street: '221 N 5th St', city: 'Bismarck', zip: '58501' },
      { street: '425 N 4th St', city: 'Grand Forks', zip: '58201' }
    ]
  },
  'OK': {
    name: 'Oklahoma',
    dropdownId: '#ui-id-73',
    zipCodes: ['73102', '74103', '74012', '73069'],
    cities: ['Oklahoma City', 'Tulsa', 'Bixby', 'Norman'],
    addresses: [
      { street: '200 N Walker Ave', city: 'Oklahoma City', zip: '73102' },
      { street: '200 Civic Center', city: 'Tulsa', zip: '74103' },
      { street: '201 S Howard Ave', city: 'Bixby', zip: '74008' }
    ]
  },
  'OR': {
    name: 'Oregon',
    dropdownId: '#ui-id-74',
    zipCodes: ['97204', '97401', '97301', '97701'],
    cities: ['Portland', 'Eugene', 'Salem', 'Bend'],
    addresses: [
      { street: '1221 SW 4th Ave', city: 'Portland', zip: '97204' },
      { street: '101 W 10th Ave', city: 'Eugene', zip: '97401' },
      { street: '555 Liberty St SE', city: 'Salem', zip: '97301' }
    ]
  },
  'RI': {
    name: 'Rhode Island',
    dropdownId: '#ui-id-75',
    zipCodes: ['02903', '02840', '02886', '02895'],
    cities: ['Providence', 'Newport', 'Warwick', 'Woonsocket'],
    addresses: [
      { street: '1 Dorrance St', city: 'Providence', zip: '02903' },
      { street: '43 Broadway', city: 'Newport', zip: '02840' },
      { street: '3275 Post Rd', city: 'Warwick', zip: '02886' }
    ]
  },
  'WI': {
    name: 'Wisconsin',
    dropdownId: '#ui-id-32',
    zipCodes: ['53202', '53211', '53703', '54301', '53188', '53140', '53233'],
    cities: ['Milwaukee', 'Madison', 'Green Bay', 'Kenosha', 'Racine', 'Appleton', 'Waukesha', 'Eau Claire'],
    addresses: [
      { street: '100 Water St', city: 'Milwaukee', zip: '53202' },
      { street: '200 King St', city: 'Madison', zip: '53703' },
      { street: '150 Broadway', city: 'Green Bay', zip: '54301' }
    ]
  },
  'WY': {
    name: 'Wyoming',
    dropdownId: '#ui-id-76',
    zipCodes: ['82001', '82601', '82401', '82716'],
    cities: ['Cheyenne', 'Casper', 'Cody', 'Gillette'],
    addresses: [
      { street: '200 W 24th St', city: 'Cheyenne', zip: '82001' },
      { street: '1 N Center St', city: 'Casper', zip: '82601' },
      { street: '130 W 4th St', city: 'Cody', zip: '82414' }
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
  TARGET_STATES: ['AL', 'AK', 'AR', 'AZ', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IA', 'IL', 'IN', 'KS', 'KY', 'LA', 'MA', 'MD', 'ME', 'MI', 'MN', 'MO', 'MS', 'MT', 'NC', 'ND', 'NE', 'NH', 'NJ', 'NM', 'NV', 'NY', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VA', 'WI', 'WY']
};
