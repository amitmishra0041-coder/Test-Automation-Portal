// Generate a valid-looking 17-character VIN with proper check digit
// Reference: ISO 3779 transliteration and weights

const VIN_CHARS = 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789'; // Excludes I, O, Q
const LETTER_VALUES = {
  A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8,
  J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9,
  S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9
};
const WEIGHTS = [8,7,6,5,4,3,2,10,0,9,8,7,6,5,4,3,2];
const YEAR_CODES = ['M','N','P','R','S','T','V','W','X','Y','1','2','3','4','5','6','7','8','9','A','B','C','D','E','F','G','H','J','K','L']; // 2021+
const WMIS = ['1HG','1FA','1G1','2HG','3VW','1C4','5YJ','1N4'];

function randChar() {
  return VIN_CHARS[Math.floor(Math.random() * VIN_CHARS.length)];
}

function transliterate(ch) {
  if (/[0-9]/.test(ch)) return parseInt(ch, 10);
  return LETTER_VALUES[ch] || 0;
}

function generateVIN() {
  const wmi = WMIS[Math.floor(Math.random() * WMIS.length)];
  let vinArr = Array(17).fill('');
  vinArr[0] = wmi[0];
  vinArr[1] = wmi[1];
  vinArr[2] = wmi[2];
  // VDS 4-8
  for (let i = 3; i <= 7; i++) vinArr[i] = randChar();
  // Placeholder for check digit at pos 9 (index 8)
  vinArr[8] = '0';
  // Year code at pos 10 (index 9)
  vinArr[9] = YEAR_CODES[Math.floor(Math.random() * YEAR_CODES.length)];
  // Plant code at pos 11 (index 10)
  vinArr[10] = randChar();
  // Sequential number 12-17 (numeric)
  const seq = String(Math.floor(100000 + Math.random() * 900000));
  for (let i = 11; i < 17; i++) vinArr[i] = seq[i - 11];
  // Compute check digit
  const sum = vinArr.reduce((acc, ch, idx) => acc + transliterate(ch) * WEIGHTS[idx], 0);
  const remainder = sum % 11;
  vinArr[8] = remainder === 10 ? 'X' : String(remainder);
  return vinArr.join('');
}

module.exports = { generateVIN };
