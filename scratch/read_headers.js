const XLSX = require('xlsx');
const path = require('path');

const file = path.join(__dirname, '..', 'GHN. 20260618 Trucking Plan DC Phú Thọ.xlsb.xlsx');
console.log('Reading:', file);
const wb = XLSX.readFile(file);
console.log('Sheets:', wb.SheetNames);
for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    const raw2d = XLSX.utils.sheet_to_json(ws, { header: 1 });
    console.log(`Sheet: ${name}, Rows: ${raw2d.length}`);
    if (raw2d.length > 0) {
        for (let i = 0; i < Math.min(raw2d.length, 10); i++) {
            console.log(`Row ${i}:`, raw2d[i]);
        }
    }
}
