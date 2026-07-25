const XLSX = require('xlsx');
const path = require('path');

const file = path.join(__dirname, '..', 'GHN. 20260618 Trucking Plan DC Phú Thọ.xlsb.xlsx');
const wb = XLSX.readFile(file);
const ws = wb.Sheets[wb.SheetNames[0]];
const raw = XLSX.utils.sheet_to_json(ws, { range: 0 });
const firstRowKeys = Object.keys(raw[0]);

console.log('firstRowKeys:', firstRowKeys);

const soColumn = firstRowKeys.find(k => {
    const norm = k.normalize('NFC').toLowerCase();
    return norm.includes('số so') || norm === 'so';
}) || firstRowKeys[2] || 'Số SO';

const doColumn = firstRowKeys.find(k => {
    const norm = k.normalize('NFC').toLowerCase();
    return norm.includes('số do') || norm === 'do';
});

console.log('soColumn found:', soColumn);
console.log('doColumn found:', doColumn);

const row = raw[0];
console.log('Row 0 SO value:', row[soColumn]);
console.log('Row 0 DO value:', row[doColumn]);
