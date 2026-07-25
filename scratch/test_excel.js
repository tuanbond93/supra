const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const { loadStoreLocations } = require('../optimizer');
const api = require('../route_15_6_api');

// Copy function from server.js to test
function getProvinceAbbreviation(prov) {
  if (!prov) return 'PTO';
  const low = prov.toLowerCase();
  if (low.includes('phú thọ') || low.includes('phu tho')) return 'PTO';
  if (low.includes('sơn la') || low.includes('son la')) return 'SLA';
  
  const norm = prov.normalize('NFD').replace(/[\u0300-\u036f]/g, "").toUpperCase();
  const parts = norm.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'PTO';
  if (parts.length >= 3) {
    return parts.map(p => p[0]).join('').slice(0, 3);
  } else if (parts.length === 2) {
    return parts[0][0] + parts[1][0] + (parts[1][1] || 'A');
  } else {
    return parts[0].slice(0, 3);
  }
}

function generateExcelBuffer(data) {
  const wb = XLSX.utils.book_new();
  
  const routesByProvince = {};
  data.routes.forEach(r => {
    const prov = r.province || 'Phú Thọ';
    if (!routesByProvince[prov]) routesByProvince[prov] = [];
    routesByProvince[prov].push(r);
  });
  
  Object.keys(routesByProvince).forEach(prov => {
    const provinceRoutes = routesByProvince[prov];
    const rows = [];
    
    provinceRoutes.forEach(r => {
      const depot = r._depot || data.depot;
      rows.push({
        'Biển số / Loại xe': r.vehicleId,
        'Thứ tự': 'Bắt đầu',
        'Mã CH': '',
        'Tên Cửa Hàng': depot.name,
        'Địa chỉ': 'Kho xuất phát',
        'Khoảng cách (km)': 0,
        'Thời gian đến': r.departureTime,
        'Trọng lượng (kg)': '',
        'Thể tích (m3)': ''
      });
      
      r.schedule.forEach(s => {
        rows.push({
          'Biển số / Loại xe': r.vehicleId,
          'Thứ tự': s.order,
          'Mã CH': s.storeId,
          'Tên Cửa Hàng': s.storeName,
          'Địa chỉ': s.address,
          'Khoảng cách (km)': s.distance,
          'Thời gian đến': s.arrivalTime,
          'Trọng lượng (kg)': s.weight,
          'Thể tích (m3)': s.cbm
        });
      });
      
      rows.push({
        'Biển số / Loại xe': r.vehicleId,
        'Thứ tự': 'Kết thúc',
        'Mã CH': '',
        'Tên Cửa Hàng': depot.name,
        'Địa chỉ': 'Về kho',
        'Khoảng cách (km)': '',
        'Thời gian đến': r.returnTime,
        'Trọng lượng (kg)': '',
        'Thể tích (m3)': ''
      });
      rows.push({}); // Empty row for separation
    });
    
    const ws = XLSX.utils.json_to_sheet(rows);
    const sheetName = `Lộ trình - ${prov}`.slice(0, 31);
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  });
  
  const doGanRows = [];
  data.routes.forEach(r => {
      const prov = r.province || 'Phú Thọ';
      const abbr = getProvinceAbbreviation(prov);
      r.schedule.forEach(s => {
          if (s.soList && s.soList.length > 0) {
              s.soList.forEach(so => {
                  doGanRows.push({
                      'Tỉnh': prov,
                      'Tên cửa hàng': s.storeName,
                      [`SO_GXT_${abbr}`]: `${so}_GXT_${abbr}`
                  });
              });
          }
      });
  });
  
  console.log(`doGanRows count: ${doGanRows.length}`);
  if (doGanRows.length > 0) {
      console.log('Sample row of doGanRows:', doGanRows[0]);
      const wsDoGan = XLSX.utils.json_to_sheet(doGanRows);
      XLSX.utils.book_append_sheet(wb, wsDoGan, "DO Gán");
  } else {
      console.log('No DO Gán sheet created!');
  }

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

async function test() {
  const storeLocations = loadStoreLocations(path.join(__dirname, '..', 'Winmart Phú Thọ.xlsx'));
  const file = path.join(__dirname, '..', 'GHN. 20260618 Trucking Plan DC Phú Thọ.xlsb.xlsx');
  
  const result = await api.run(file, storeLocations, 2);
  const buffer = generateExcelBuffer(result);
  
  fs.writeFileSync(path.join(__dirname, 'output.xlsx'), buffer);
  console.log('Saved output.xlsx');
}

test().catch(console.error);
