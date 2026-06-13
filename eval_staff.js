const XLSX = require('xlsx');
const fs = require('fs');

const CONFIG = {
  DEPOT: { lat: 21.3043611, lng: 105.4293889, name: 'Kho Supra - Phú Thọ' },
  START_TIME: 13 * 60, // 13:00 in minutes
  MAX_WORK_MINUTES: 6 * 60,
  SERVICE_TIME_MINUTES: 15,
  VEHICLE_CAPACITY_KG: 1900,
  VEHICLE_CAPACITY_CBM: 12,
  OSRM_BASE: 'https://router.project-osrm.org',
};

async function fetchOSRMTable(points) {
  const coords = points.map(p => `${p.lng},${p.lat}`).join(';');
  const url = `${CONFIG.OSRM_BASE}/table/v1/driving/${coords}?annotations=distance,duration`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.code !== 'Ok') throw new Error(`OSRM Table API: ${data.code}`);
  return {
    distMatrix: data.distances.map(row => row.map(d => d / 1000)),
    durationMatrix: data.durations.map(row => row.map(d => d / 60)),
  };
}

function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// 1. Read Master Store Data
const wbStores = XLSX.readFile('Winmart Phú Thọ.xlsx');
const storeMaster = XLSX.utils.sheet_to_json(wbStores.Sheets[wbStores.SheetNames[0]]);
const storeDict = {};
storeMaster.forEach(s => {
  storeDict[s['Store'].trim().toLowerCase()] = {
    lat: s['Lat'], lng: s['Long'], address: s['Address']
  };
  const parts = s['Store'].split('-');
  if (parts.length > 1) {
    storeDict[parts[1].trim().toLowerCase()] = {
      lat: s['Lat'], lng: s['Long'], address: s['Address']
    };
  }
});

function findStore(name) {
  name = name.trim().toLowerCase();
  if (storeDict[name]) return storeDict[name];
  // fuzzy match
  for (const k of Object.keys(storeDict)) {
    if (k.includes(name) || name.includes(k)) return storeDict[k];
  }
  return null;
}

// 2. Read April History for Load Check
const wbHist = XLSX.readFile('Data tháng 4.xlsx');
const histData = XLSX.utils.sheet_to_json(wbHist.Sheets[wbHist.SheetNames[0]]);
const storeLoads = {};
histData.forEach(r => {
  const store = (r['Cửa hàng'] || '').trim().toLowerCase();
  if (!storeLoads[store]) storeLoads[store] = { weight: 0, cbm: 0, days: new Set() };
  storeLoads[store].weight += r['Trọng lượng(kg)'] || 0;
  storeLoads[store].cbm += r['Thể tích SO(m3)'] || 0;
  storeLoads[store].days.add(r['Ngày tạo']);
});
const avgLoads = {};
for (const [store, data] of Object.entries(storeLoads)) {
  const numDays = data.days.size || 1;
  avgLoads[store] = {
    avgWeight: data.weight / numDays,
    avgCbm: data.cbm / numDays
  };
}
function getAvgLoad(name) {
  name = name.trim().toLowerCase();
  if (avgLoads[name]) return avgLoads[name];
  for (const k of Object.keys(avgLoads)) {
    if (k.includes(name) || name.includes(k)) return avgLoads[k];
  }
  return { avgWeight: 0, avgCbm: 0 };
}

// 3. Read Staff Routes
const wbStaff = XLSX.readFile('Danh sách Winmart - NV chia tuyến.xlsx');
const routes = [];
const sheets = ['tuyến 1 ', 'Tuyến 2', 'Tuyến 3', 'tuyến 4'];

for (const sheet of sheets) {
  if (!wbStaff.Sheets[sheet]) continue;
  const rows = XLSX.utils.sheet_to_json(wbStaff.Sheets[sheet], { header: 1 });
  const stores = [];
  rows.forEach(r => {
    if (r[0] && r[0].toString().toLowerCase().includes('wm')) {
      stores.push(r[0].toString());
    }
  });
  routes.push({ name: sheet.trim(), stores });
}

// 4. Evaluate Routes
async function evaluate() {
  const results = [];
  
  for (const r of routes) {
    console.log(`\nEvaluating ${r.name}...`);
    const validPoints = [CONFIG.DEPOT];
    let routeWeight = 0;
    let routeCbm = 0;
    
    r.stores.forEach(sName => {
      const loc = findStore(sName);
      if (loc) {
        validPoints.push(loc);
        const loads = getAvgLoad(sName);
        routeWeight += loads.avgWeight;
        routeCbm += loads.avgCbm;
      } else {
        console.log(`⚠️ Cannot find coords for ${sName}`);
      }
    });
    
    if (validPoints.length <= 1) continue;
    
    // TSP is already decided by their order? Let's assume they drive in the order they listed.
    // If not, we do TSP to give them the benefit of the doubt.
    // The user just grouped them, let's calculate optimal TSP for their group.
    let distMatrix, durMatrix;
    if (validPoints.length <= 80) {
      const res = await fetchOSRMTable(validPoints);
      distMatrix = res.distMatrix;
      durMatrix = res.durationMatrix;
    } else {
      console.log('Too many points, skipping OSRM...');
      continue;
    }
    
    // TSP for this group
    const vis = new Set();
    const routeIdx = [];
    let cur = 0;
    let totalDist = 0;
    let driveTime = 0;
    
    vis.add(0);
    while (vis.size < validPoints.length) {
      let bn = -1, bd = Infinity;
      for (let i = 1; i < validPoints.length; i++) {
        if (!vis.has(i) && distMatrix[cur][i] < bd) {
          bd = distMatrix[cur][i]; bn = i;
        }
      }
      vis.add(bn); routeIdx.push(bn); 
      totalDist += bd; 
      driveTime += durMatrix[cur][bn];
      cur = bn;
    }
    totalDist += distMatrix[cur][0];
    driveTime += durMatrix[cur][0];
    
    const serviceTime = (validPoints.length - 1) * CONFIG.SERVICE_TIME_MINUTES;
    const totalTime = driveTime + serviceTime;
    
    results.push({
      name: r.name,
      numStops: validPoints.length - 1,
      totalDist: totalDist.toFixed(1),
      driveTime: Math.round(driveTime),
      serviceTime: serviceTime,
      totalTime: Math.round(totalTime),
      returnTime: formatTime(CONFIG.START_TIME + totalTime),
      isOverTime: totalTime > CONFIG.MAX_WORK_MINUTES,
      avgWeight: routeWeight.toFixed(0),
      avgCbm: routeCbm.toFixed(1),
      isOverWeight: routeWeight > CONFIG.VEHICLE_CAPACITY_KG,
      isOverCbm: routeCbm > CONFIG.VEHICLE_CAPACITY_CBM,
      weightPercent: ((routeWeight / CONFIG.VEHICLE_CAPACITY_KG)*100).toFixed(1),
      cbmPercent: ((routeCbm / CONFIG.VEHICLE_CAPACITY_CBM)*100).toFixed(1)
    });
  }
  
  fs.writeFileSync('staff_evaluation.json', JSON.stringify(results, null, 2));
  console.log('\n✅ Evaluation completed.');
}

function formatTime(min) { 
  let m = Math.round(min); 
  let h = Math.floor(m / 60); 
  m = m % 60; 
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`; 
}

evaluate();
