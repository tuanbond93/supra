const XLSX = require('xlsx');
const path = require('path');
try {
  const wb = XLSX.readFile(path.join(__dirname, 'Kế hoạch xe', '20260615 GHN.xlsb'));
  const wsName = wb.SheetNames[0];
  const ws = wb.Sheets[wsName];
  const data = XLSX.utils.sheet_to_json(ws);
  console.log(`Read ${data.length} rows from 15.6.`);
  console.log('Columns:', Object.keys(data[0] || {}));
  
  // Find any mention of GXT or Viet Tri
  const gxt = data.filter(r => JSON.stringify(r).toLowerCase().includes('gxt') || JSON.stringify(r).toLowerCase().includes('việt trì') || JSON.stringify(r).toLowerCase().includes('viet tri'));
  console.log(`Found ${gxt.length} rows matching GXT/Viet Tri.`);
  if (gxt.length > 0) {
    console.log('Sample matching row:', gxt[0]);
  }
} catch (e) {
  console.error(e);
}
