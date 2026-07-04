const path = require('path');
const XLSX = require('xlsx');

const filePath = path.join(__dirname, 'GHN. 20260618 Trucking Plan DC Phú Thọ.xlsb.xlsx');
const wb = XLSX.readFile(filePath);
const wsName = wb.SheetNames.find(n => n.includes('Total') || n.includes('DO')) || wb.SheetNames[0];
const ws = wb.Sheets[wsName];
const raw = XLSX.utils.sheet_to_json(ws);

const firstRowKeys = Object.keys(raw[0]);
const regionColumn = firstRowKeys.find(k => k.toLowerCase().includes('quận') || k.toLowerCase().includes('khu vực')) || 'Quận';
console.log("Region column found as:", regionColumn);

let found965 = false;
for (const r of raw) {
    const storeName = r['Tên siêu thị'] || r['Tên Cửa Hàng'] || r['Store Name'] || r['Tên cửa hàng'];
    if (storeName && storeName.includes('965')) {
        console.log("Row for 965:");
        console.log("Name:", storeName);
        console.log("Region extracted:", r[regionColumn] || r['Quận'] || r['Khu vực']);
        console.log("Weight:", r['Weight'] || r['Trọng lượng']);
        console.log("Volume:", r['Volume'] || r['Thể tích']);
        console.log("Row Data:", r);
        found965 = true;
    }
}
if (!found965) console.log("965 NOT in Excel file.");
