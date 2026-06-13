const XLSX = require('xlsx');
const wb = XLSX.readFile('Khu vực đã mở.xlsx');
console.log('All sheets:', wb.SheetNames);

// Check all sheets for Phú Thọ data
wb.SheetNames.forEach(name => {
  const ws = wb.Sheets[name];
  const data = XLSX.utils.sheet_to_json(ws);
  // Look for Phú Thọ province
  const phuTho = data.filter(r => {
    const allVals = Object.values(r).join(' ');
    return allVals.includes('Phú Thọ') || allVals.includes('phú thọ');
  });
  if (phuTho.length > 0) {
    console.log(`\n=== Sheet: ${name} — ${phuTho.length} Phú Thọ rows ===`);
    console.log('Sample:', JSON.stringify(phuTho[0]));
    // Unique districts
    const districts = [...new Set(phuTho.map(r => r['Quận'] || r['Quận giao'] || 'N/A'))];
    console.log('Districts:', districts);
    // Status
    const statuses = [...new Set(phuTho.map(r => r['Trạng thái'] || r['Trạng thái_1'] || 'N/A'))];
    console.log('Statuses:', statuses);
    console.log('Total rows:', phuTho.length);
  }
});

// Also check Miền Bắc sheet for all available data
const bac = XLSX.utils.sheet_to_json(wb.Sheets['Miền_Bắc'] || wb.Sheets[wb.SheetNames.find(s => s.includes('Bắc'))]);
if (bac) {
  console.log('\n=== Miền Bắc full analysis ===');
  console.log('Total rows:', bac.length);
  const headers = Object.keys(bac[0] || {});
  console.log('Headers:', headers);
  // Sample
  console.log('Sample:', JSON.stringify(bac[0]));
  console.log('Sample 2:', JSON.stringify(bac[1]));
}
