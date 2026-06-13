const fs = require('fs');
const XLSX = require('xlsx');
const path = require('path');

function searchFile(file) {
  try {
    const wb = XLSX.readFile(file);
    wb.SheetNames.forEach(sn => {
      const ws = wb.Sheets[sn];
      const data = XLSX.utils.sheet_to_json(ws);
      data.forEach(r => {
        const str = JSON.stringify(r).toLowerCase();
        if (str.includes('gxt')) {
          console.log(`Found GXT in ${file} [Sheet: ${sn}]:`, r);
        }
      });
    });
  } catch(e) {}
}

const files = fs.readdirSync(__dirname);
files.forEach(f => {
  if (f.endsWith('.xlsx') || f.endsWith('.xlsb')) {
    searchFile(path.join(__dirname, f));
  }
});
const planDir = path.join(__dirname, 'Kế hoạch xe');
fs.readdirSync(planDir).forEach(f => {
  if (f.endsWith('.xlsx') || f.endsWith('.xlsb')) {
    searchFile(path.join(planDir, f));
  }
});
