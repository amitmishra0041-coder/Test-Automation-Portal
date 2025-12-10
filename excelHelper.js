// excelHelper.js
const XLSX = require('xlsx');

function readExcel(filePath, sheetName) {
    const workbook = XLSX.readFile(filePath);
    const sheet = workbook.Sheets[sheetName];
    return XLSX.utils.sheet_to_json(sheet);
}

module.exports = { readExcel };