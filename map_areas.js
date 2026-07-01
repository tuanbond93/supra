const XLSX = require('xlsx');
const fs = require('fs');

const wbAreas = XLSX.readFile('Khu vực đã mở.xlsx');
const wsAreas = wbAreas.Sheets['TỔNG HỢP <<'];
const areasData = XLSX.utils.sheet_to_json(wsAreas);

const phuThoAreas = areasData.filter(r => r['Tỉnh'] === 'Phú Thọ');
const areaDict = {}; // "huyện lâm thao|xã sơn vi": "Đã mở"

// Normalize strings for matching
function norm(str) {
  if (!str) return '';
  return str.toLowerCase()
    .replace(/^(huyện|thành phố|thị xã|quận|xã|phường|thị trấn)\s+/i, '')
    .trim();
}

phuThoAreas.forEach(r => {
  const q = norm(r['Quận']);
  const p = norm(r['Phường']);
  areaDict[`${q}|${p}`] = r['Trạng thái Thực tế'] || 'Chưa mở'; // default if missing
});

// We also need a mapping just by district if ward fails
const districtStatus = {};
phuThoAreas.forEach(r => {
  const q = norm(r['Quận']);
  if (!districtStatus[q]) districtStatus[q] = { 'Đã mở': 0, 'Chưa mở': 0 };
  const s = r['Trạng thái Thực tế'] || 'Chưa mở';
  districtStatus[q][s]++;
});
// Decide district default status based on majority
for (const q in districtStatus) {
  districtStatus[q] = districtStatus[q]['Đã mở'] >= districtStatus[q]['Chưa mở'] ? 'Đã mở' : 'Chưa mở';
}

const wbStores = XLSX.readFile('Winmart Phú Thọ.xlsx');
const storesData = XLSX.utils.sheet_to_json(wbStores.Sheets[wbStores.SheetNames[0]]);

const results = storesData.map(s => {
  const address = (s['Address'] || '').toLowerCase();
  const name = (s['Store'] || '').toLowerCase();
  let status = 'Chưa xác định';
  
  // Try to find the district in the name or address
  let foundDistrict = null;
  let foundWard = null;
  
  for (const q of Object.keys(districtStatus)) {
    if (address.includes(q) || name.includes(q)) {
      foundDistrict = q;
      break;
    }
  }
  
  if (foundDistrict) {
    // Try to find ward in this district
    const wardsInDistrict = Object.keys(areaDict).filter(k => k.startsWith(foundDistrict + '|')).map(k => k.split('|')[1]);
    for (const w of wardsInDistrict) {
      if (address.includes(w) || name.includes(w)) {
        foundWard = w;
        break;
      }
    }
    
    if (foundWard) {
      status = areaDict[`${foundDistrict}|${foundWard}`];
    } else {
      status = districtStatus[foundDistrict]; // fallback to district majority
    }
  } else {
    if (address.includes('việt trì') || name.includes('việt trì') || 
        address.includes('tx. phú thọ') || name.includes('tx. phú thọ') || address.includes('thị xã phú thọ') || name.includes('thị xã phú thọ') || 
        address.includes('tx phu tho') || name.includes('tx phu tho') || address.includes('thi xa phu tho') || name.includes('thi xa phu tho') ||
        address.includes('lâm thao') || name.includes('lâm thao') || address.includes('lam thao') || name.includes('lam thao')) status = 'Đã mở';
    else status = 'Chưa mở';
  }
  
  return {
    storeId: String(s['StoreID']),
    name: s['Store name'] || s['Store'],
    lat: s['Lat'],
    lng: s['Long'],
    address: s['Address'],
    status: status
  };
}).filter(s => s.lat && s.lng);

fs.writeFileSync('mapped_stores.json', JSON.stringify(results, null, 2));

const opened = results.filter(s => s.status === 'Đã mở').length;
const unopened = results.filter(s => s.status === 'Chưa mở').length;
console.log(`Mapped: ${opened} Đã mở, ${unopened} Chưa mở`);
