const XLSX = require('xlsx');
const wb = XLSX.readFile('Data tháng 4.xlsx');
console.log('Sheet names:', JSON.stringify(wb.SheetNames));
wb.SheetNames.forEach(name => {
  const ws = wb.Sheets[name];
  const data = XLSX.utils.sheet_to_json(ws);
  console.log(`\n=== Sheet: ${name} ===`);
  console.log('Total rows:', data.length);
  if (data.length > 0) {
    console.log('Headers:', JSON.stringify(Object.keys(data[0])));
    console.log('---FIRST 5 ROWS---');
    data.slice(0, 5).forEach((r) => console.log(JSON.stringify(r)));
    console.log('---LAST 2 ROWS---');
    data.slice(-2).forEach((r) => console.log(JSON.stringify(r)));
  }
});
