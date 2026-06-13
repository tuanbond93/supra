const XLSX = require('xlsx');
const wb = XLSX.readFile('Winmart Phú Thọ.xlsx');
console.log('Sheet names:', JSON.stringify(wb.SheetNames));
wb.SheetNames.forEach(name => {
  const ws = wb.Sheets[name];
  const data = XLSX.utils.sheet_to_json(ws);
  console.log(`\n=== Sheet: ${name} ===`);
  console.log('Total rows:', data.length);
  if (data.length > 0) {
    console.log('Headers:', JSON.stringify(Object.keys(data[0])));
    console.log('---FIRST 10 ROWS---');
    data.slice(0, 10).forEach((r, i) => console.log(JSON.stringify(r)));
    if (data.length > 10) {
      console.log('---LAST 3 ROWS---');
      data.slice(-3).forEach((r, i) => console.log(JSON.stringify(r)));
    }
  }
});
