const XLSX = require('xlsx');
const path = require('path');
const wb = XLSX.readFile(path.join(__dirname, 'Winmart Phú Thọ.xlsx'));
const ws = wb.Sheets[wb.SheetNames[0]];
const data = XLSX.utils.sheet_to_json(ws);
const matches = data.filter(r => 
  (r['Store'] && r['Store'].toLowerCase().includes('gxt')) || 
  (r['Address'] && r['Address'].toLowerCase().includes('gxt')) ||
  (r['Store'] && r['Store'].toLowerCase().includes('việt trì'))
);
console.log('Matches for GXT or Việt Trì:');
matches.forEach(m => console.log(m['Store'], m['Lat'], m['Long']));
