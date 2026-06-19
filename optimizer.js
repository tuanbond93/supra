/**
 * VRP Route Optimizer Engine v3 for Winmart-Supra Logistics
 * 
 * Strategy: Use April history data for real per-day routing.
 * The main Excel provides store LOCATIONS (lat/lng).
 * The April data provides actual daily order weights/volumes.
 * User picks a date → system routes that day's orders.
 */

const XLSX = require('xlsx');
const fs = require('fs');

// ============================================================
// CONFIGURATION
// ============================================================
const CONFIG = {
  DEPOT: { lat: 21.326576980287744, lng: 105.32489178650769, name: 'Kho Xuất Phát' },
  NUM_VEHICLES: 7,
  VEHICLE_CAPACITY_KG: 1900,
  VEHICLE_CAPACITY_CBM: 12,
  SERVICE_TIME_MINUTES: 20,
  START_TIME: '08:00',
  MAX_RETURN_TIME: '22:00',
  MAX_DRIVING_HOURS: 8,
  REST_AFTER_HOURS: 4,
  REST_DURATION_MINUTES: 15,
  OSRM_BASE: 'https://router.project-osrm.org',
};

// ============================================================
// STORE LOCATION INDEX (from Winmart Phú Thọ.xlsx)
// ============================================================
let storeLocationCache = null;
function loadStoreLocations(mainFilePath) {
  if (storeLocationCache) return storeLocationCache;
  const wb = XLSX.readFile(mainFilePath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws);
  const index = {};
  for (const r of rows) {
    const storeKey = r['Store']; // e.g. "2BVB - WM+ PTO Khu 9, Tam Nông"
    if (r['Lat'] && r['Long']) {
      const sid = String(r['StoreID'] || storeKey.split(' - ')[0]).trim();
      index[storeKey] = { storeId: sid, lat: r['Lat'], lng: r['Long'], address: r['Address'] || '' };
      // Also index by storeId
      index[sid] = { storeId: sid, lat: r['Lat'], lng: r['Long'], address: r['Address'] || '' };
      // And by partial name (the part after " - ")
      const parts = storeKey.split(' - ');
      if (parts.length > 1) index[parts.slice(1).join(' - ')] = { storeId: sid, lat: r['Lat'], lng: r['Long'], address: r['Address'] || '' };
    }
  }
  storeLocationCache = index;
  return index;
}

// ============================================================
// LOAD DAILY ORDERS (from Data tháng 4.xlsx)
// ============================================================
function loadDailyOrders(historyFilePath) {
  const wb = XLSX.readFile(historyFilePath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json(ws);

  const orders = raw.map(r => {
    let dateVal = r['Ngày tạo'];
    let date;
    if (typeof dateVal === 'number') {
      date = new Date((dateVal - 25569) * 86400 * 1000);
    } else {
      date = new Date(dateVal);
    }
    return {
      soCode: r['Mã SO'],
      date: date.toISOString().split('T')[0],
      store: r['Cửa hàng'],
      weightKg: r['Trọng lượng(kg)'] || 0,
      cbm: r['Thể tích SO(m3)'] || 0,
      pieces: r['Tổng SL (pcs)'] || 0,
      packages: r['Total Package\r\n (Kiện)'] || r['Total Package (Kiện)'] || 0,
    };
  });

  // Group by date
  const byDate = {};
  for (const o of orders) {
    if (!byDate[o.date]) byDate[o.date] = [];
    byDate[o.date].push(o);
  }
  return { orders, byDate, dates: Object.keys(byDate).sort() };
}

// Build stops for a specific date by aggregating orders per store
function buildDayStops(dayOrders, storeLocations) {
  // Aggregate orders by store
  const byStore = {};
  for (const o of dayOrders) {
    if (!byStore[o.store]) byStore[o.store] = { store: o.store, weightKg: 0, cbm: 0, orders: 0, pieces: 0 };
    byStore[o.store].weightKg += o.weightKg;
    byStore[o.store].cbm += o.cbm;
    byStore[o.store].orders += 1;
    byStore[o.store].pieces += o.pieces;
  }

  const stops = [];
  const unmatched = [];
  for (const [storeName, agg] of Object.entries(byStore)) {
    const loc = findStoreLocation(storeName, storeLocations);
    if (loc) {
      let remW = agg.weightKg;
      let remC = agg.cbm;
      let chunkIdx = 1;
      while (remW > 0 || remC > 0) {
        let chunkW = Math.min(remW, CONFIG.VEHICLE_CAPACITY_KG);
        let chunkC = Math.min(remC, CONFIG.VEHICLE_CAPACITY_CBM);
        if (chunkW / CONFIG.VEHICLE_CAPACITY_KG > 1) chunkW = CONFIG.VEHICLE_CAPACITY_KG;
        if (chunkC / CONFIG.VEHICLE_CAPACITY_CBM > 1) chunkC = CONFIG.VEHICLE_CAPACITY_CBM;

        stops.push({
          storeId: storeName.split(' - ')[0].trim(),
          name: (storeName.split(' - ').slice(1).join(' - ').trim() || storeName) + (chunkIdx > 1 ? ` (Phần ${chunkIdx})` : ''),
          fullName: storeName,
          address: loc.address,
          lat: loc.lat, lng: loc.lng,
          weight: Math.round(chunkW * 100) / 100,
          cbm: Math.round(chunkC * 100) / 100,
          orders: chunkIdx === 1 ? agg.orders : 0,
          pieces: chunkIdx === 1 ? agg.pieces : 0,
        });
        remW -= chunkW;
        remC -= chunkC;
        chunkIdx++;
        if (chunkW <= 0 && chunkC <= 0) break;
      }
    } else {
      unmatched.push(storeName);
    }
  }
  return { stops, unmatched };
}

function findStoreLocation(storeName, locations) {
  if (locations[storeName]) return locations[storeName];
  // Try by storeId
  const sid = storeName.split(' - ')[0].trim();
  if (locations[sid]) return locations[sid];
  // Try partial match
  const namePart = storeName.split(' - ').slice(1).join(' - ').trim();
  if (locations[namePart]) return locations[namePart];
  return null;
}

// ============================================================
// OSRM
// ============================================================
async function buildOSRMDistanceMatrix(stops) {
  const allPoints = [CONFIG.DEPOT, ...stops];
  const n = allPoints.length;
  const CHUNK_SIZE = 80;

  if (n <= CHUNK_SIZE) {
    try {
      return await fetchOSRMTable(allPoints);
    } catch (e) {
      console.log(`   ⚠️ OSRM Table API Error: ${e.message}, fallback to Haversine...`);
    }
  }

  // Fallback for large sets: haversine * road factor
  console.log(`   ℹ️  ${n} điểm > ${CHUNK_SIZE}, dùng haversine x1.4 thay OSRM Table...`);
  const distMatrix = Array.from({ length: n }, () => Array(n).fill(0));
  const durationMatrix = Array.from({ length: n }, () => Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = haversineDistance(allPoints[i].lat, allPoints[i].lng, allPoints[j].lat, allPoints[j].lng) * 1.4;
      distMatrix[i][j] = d; distMatrix[j][i] = d;
      const dur = (d / 35) * 60;
      durationMatrix[i][j] = dur; durationMatrix[j][i] = dur;
    }
  }
  return { distMatrix, durationMatrix, allPoints };
}

async function fetchOSRMTable(points) {
  const coords = points.map(p => `${p.lng},${p.lat}`).join(';');
  const url = `${CONFIG.OSRM_BASE}/table/v1/driving/${coords}?annotations=distance,duration`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 4000);
  const res = await fetch(url, { signal: controller.signal });
  clearTimeout(timeoutId);
  const data = await res.json();
  if (data.code !== 'Ok') throw new Error(`OSRM Table API: ${data.code}`);

  return {
    distMatrix: data.distances.map(row => row.map(d => d / 1000)),
    durationMatrix: data.durations.map(row => row.map(d => d / 60)),
    allPoints: points,
  };
}

async function getOSRMRoute(points) {
  const coords = points.map(p => `${p.lng},${p.lat}`).join(';');
  const url = `${CONFIG.OSRM_BASE}/route/v1/driving/${coords}?overview=full&geometries=geojson`;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000); // 4 seconds timeout
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    const data = await res.json();
    if (data.code === 'Ok' && data.routes[0]) {
      return { geometry: data.routes[0].geometry, distance: data.routes[0].distance / 1000, duration: data.routes[0].duration / 60 };
    }
  } catch (e) {
    console.log(`   ⚠️ OSRM Route API Timeout/Error: ${e.message}`);
  }
  return null;
}

function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ============================================================
// CLUSTERING + TSP (unchanged from v2)
// ============================================================
function kMeansClustering(stops, k, maxIter = 100) {
  if (stops.length <= k) return stops.map(s => [s]);
  const centroids = [{ lat: stops[0].lat, lng: stops[0].lng }];
  for (let c = 1; c < k; c++) {
    const dists = stops.map(s => { const minD = Math.min(...centroids.map(ce => haversineDistance(s.lat, s.lng, ce.lat, ce.lng))); return minD * minD; });
    const total = dists.reduce((a, b) => a + b, 0);
    let r = Math.random() * total;
    for (let i = 0; i < stops.length; i++) { r -= dists[i]; if (r <= 0) { centroids.push({ lat: stops[i].lat, lng: stops[i].lng }); break; } }
    if (centroids.length <= c) centroids.push({ lat: stops[c % stops.length].lat, lng: stops[c % stops.length].lng });
  }
  let assign = new Array(stops.length).fill(0);
  for (let iter = 0; iter < maxIter; iter++) {
    const na = stops.map(s => { let md = Infinity, b = 0; for (let c = 0; c < k; c++) { const d = haversineDistance(s.lat, s.lng, centroids[c].lat, centroids[c].lng); if (d < md) { md = d; b = c; } } return b; });
    if (JSON.stringify(na) === JSON.stringify(assign)) break;
    assign = na;
    for (let c = 0; c < k; c++) { const m = stops.filter((_, i) => assign[i] === c); if (m.length) centroids[c] = { lat: m.reduce((s, p) => s + p.lat, 0) / m.length, lng: m.reduce((s, p) => s + p.lng, 0) / m.length }; }
  }
  const clusters = Array.from({ length: k }, () => []);
  stops.forEach((s, i) => clusters[assign[i]].push(s));
  return clusters.filter(c => c.length > 0);
}

function capacityAwareClustering(stops, numVehicles, capKg, capCbm) {
  let clusters = kMeansClustering(stops, numVehicles);
  let final = [];
  for (const cl of clusters) {
    const tw = cl.reduce((s, p) => s + p.weight, 0), tc = cl.reduce((s, p) => s + p.cbm, 0);
    const need = Math.max(Math.ceil(tw / capKg), Math.ceil(tc / capCbm));
    if (need > 1) final.push(...kMeansClustering(cl, need));
    else final.push(cl);
  }
  // Merge small clusters
  while (final.length > numVehicles) {
    let bi = -1, bj = -1, bd = Infinity;
    for (let i = 0; i < final.length; i++) {
      for (let j = i + 1; j < final.length; j++) {
        const cw = final[i].reduce((s, p) => s + p.weight, 0) + final[j].reduce((s, p) => s + p.weight, 0);
        const cc = final[i].reduce((s, p) => s + p.cbm, 0) + final[j].reduce((s, p) => s + p.cbm, 0);
        if (cw <= capKg && cc <= capCbm) {
          const ci = centroid(final[i]), cj = centroid(final[j]);
          const d = haversineDistance(ci.lat, ci.lng, cj.lat, cj.lng);
          if (d < bd) { bd = d; bi = i; bj = j; }
        }
      }
    }
    if (bi === -1) break;
    final[bi] = [...final[bi], ...final[bj]];
    final.splice(bj, 1);
  }
  return final;
}

function centroid(pts) { return { lat: pts.reduce((s, p) => s + p.lat, 0) / pts.length, lng: pts.reduce((s, p) => s + p.lng, 0) / pts.length }; }

function nearestNeighborTSP(stops, dm, all) {
  if (!stops.length) return { route: [], totalDistance: 0 };
  const idx = stops.map(s => all.findIndex(p => p.storeId === s.storeId && p.lat === s.lat));
  const vis = new Set(); const route = []; let cur = 0, td = 0;
  while (vis.size < idx.length) {
    let bn = -1, bd = Infinity;
    for (const i of idx) { if (!vis.has(i) && dm[cur][i] < bd) { bd = dm[cur][i]; bn = i; } }
    if (bn === -1) break;
    vis.add(bn); route.push(bn); td += bd; cur = bn;
  }
  td += dm[cur][0];
  return { route, totalDistance: td };
}

function twoOptImprove(route, dm) {
  let improved = true, best = [...route], bestD = calcDist(best, dm);
  while (improved) {
    improved = false;
    for (let i = 0; i < best.length - 1; i++) {
      for (let j = i + 1; j < best.length; j++) {
        const nr = [...best]; nr.splice(i, j - i + 1, ...nr.slice(i, j + 1).reverse());
        const nd = calcDist(nr, dm);
        if (nd < bestD) { best = nr; bestD = nd; improved = true; }
      }
    }
  }
  return { route: best, totalDistance: bestD };
}

function calcDist(route, dm) {
  if (!route.length) return 0;
  let d = dm[0][route[0]];
  for (let i = 0; i < route.length - 1; i++) d += dm[route[i]][route[i + 1]];
  d += dm[route[route.length - 1]][0];
  return d;
}

function calculateSchedule(route, allPts, dm, durM) {
  const sched = []; const start = parseTime(CONFIG.START_TIME);
  let cur = start, drv = 0, prev = 0;
  for (let i = 0; i < route.length; i++) {
    const idx = route[i], pt = allPts[idx];
    const dist = dm[prev][idx], travel = durM[prev][idx];
    drv += travel;
    if (drv >= CONFIG.REST_AFTER_HOURS * 60) { cur += CONFIG.REST_DURATION_MINUTES; drv = 0; }
    cur += travel;
    sched.push({ order: i + 1, storeId: pt.storeId, storeName: pt.name, address: pt.address, lat: pt.lat, lng: pt.lng, distance: Math.round(dist * 100) / 100, travelMinutes: Math.round(travel * 10) / 10, arrivalTime: formatTime(cur), weight: pt.weight, cbm: pt.cbm, soList: pt.soList || [] });
    cur += CONFIG.SERVICE_TIME_MINUTES; prev = idx;
  }
  cur += durM[prev][0];
  return { schedule: sched, returnTime: formatTime(cur), totalWorkMinutes: cur - start };
}

function parseTime(t) { const [h, m] = t.split(':').map(Number); return h * 60 + m; }
function formatTime(min) { let m = Math.round(min); let h = Math.floor(m / 60); m = m % 60; return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`; }

// ============================================================
// MAIN OPTIMIZER — routes a specific day
// ============================================================
async function optimizeDay(stops, zoneMapping = {}) {
  console.log(`   📦 ${stops.length} điểm giao`);
  const totalW = stops.reduce((s, p) => s + p.weight, 0);
  const totalC = stops.reduce((s, p) => s + p.cbm, 0);
  console.log(`   📊 Tổng: ${totalW.toFixed(0)} kg | ${totalC.toFixed(1)} m³`);

  const vByW = Math.ceil(totalW / CONFIG.VEHICLE_CAPACITY_KG);
  const vByC = Math.ceil(totalC / CONFIG.VEHICLE_CAPACITY_CBM);
  const vByP = Math.ceil(stops.length / 15);
  const suggested = Math.max(vByW, vByC, vByP, CONFIG.NUM_VEHICLES);

  const zones = {};
  for (const stop of stops) {
    const zId = zoneMapping[stop.storeId] || 'Khác';
    if (!zones[zId]) zones[zId] = [];
    zones[zId].push(stop);
  }

  const routes = [];
  let warnings = [];
  
  for (const [zId, zStops] of Object.entries(zones)) {
    if (!zStops.length) continue;
    console.log(`   📍 Tuyến/Khu vực ${zId}: ${zStops.length} điểm`);
    
    const zW = zStops.reduce((s, p) => s + p.weight, 0);
    const zC = zStops.reduce((s, p) => s + p.cbm, 0);
    const zV = Math.max(Math.ceil(zW / CONFIG.VEHICLE_CAPACITY_KG), Math.ceil(zC / CONFIG.VEHICLE_CAPACITY_CBM), Math.ceil(zStops.length / 15));
    
    const { distMatrix, durationMatrix, allPoints } = await buildOSRMDistanceMatrix(zStops);
    const clusters = capacityAwareClustering(zStops, zV, CONFIG.VEHICLE_CAPACITY_KG, CONFIG.VEHICLE_CAPACITY_CBM);
    
    for (let v = 0; v < clusters.length; v++) {
      const cl = clusters[v]; if (!cl.length) continue;
      const nn = nearestNeighborTSP(cl, distMatrix, allPoints);
      const opt = twoOptImprove(nn.route, distMatrix);
      const sched = calculateSchedule(opt.route, allPoints, distMatrix, durationMatrix);
      const cW = cl.reduce((s, p) => s + p.weight, 0), cC = cl.reduce((s, p) => s + p.cbm, 0);

      const routePts = [CONFIG.DEPOT, ...opt.route.map(i => allPoints[i]), CONFIG.DEPOT];
      const osrm = await getOSRMRoute(routePts);

      let vId = 'Thuê ngoài';
      if (zId !== 'Khác') {
        vId = v === 0 ? `NV (Tuyến ${zId})` : `Thuê ngoài (Tuyến ${zId})`;
      } else {
        vId = `Thuê ngoài (Khác - Xe ${v + 1})`;
      }

      routes.push({
        vehicleId: vId, 
        zoneId: zId,
        numStops: cl.length,
        totalDistance: osrm ? Math.round(osrm.distance * 100) / 100 : Math.round(opt.totalDistance * 100) / 100,
        totalWeight: Math.round(cW * 100) / 100, totalCbm: Math.round(cC * 100) / 100,
        weightFillPercent: Math.round((cW / CONFIG.VEHICLE_CAPACITY_KG) * 1000) / 10,
        cbmFillPercent: Math.round((cC / CONFIG.VEHICLE_CAPACITY_CBM) * 1000) / 10,
        schedule: sched.schedule, returnTime: sched.returnTime,
        totalWorkHours: Math.round(sched.totalWorkMinutes / 60 * 100) / 100,
        departureTime: CONFIG.START_TIME,
        routeGeometry: osrm ? osrm.geometry : null,
      });
    }
  }

  const maxRet = parseTime(CONFIG.MAX_RETURN_TIME);
  routes.forEach(r => {
    if (parseTime(r.returnTime) > maxRet) warnings.push(`Xe ${r.vehicleId}: Về kho ${r.returnTime} (quá ${CONFIG.MAX_RETURN_TIME})`);
    if (r.weightFillPercent > 100) warnings.push(`Xe ${r.vehicleId}: VƯỢT TẢI KG (${r.weightFillPercent}%)`);
    if (r.cbmFillPercent > 100) warnings.push(`Xe ${r.vehicleId}: VƯỢT TẢI CBM (${r.cbmFillPercent}%)`);
  });

  return {
    config: CONFIG, depot: CONFIG.DEPOT,
    totalStops: stops.length, totalVehiclesUsed: routes.length,
    suggestedVehicles: suggested, additionalVehiclesNeeded: Math.max(0, suggested - CONFIG.NUM_VEHICLES),
    totalDistance: Math.round(routes.reduce((s, r) => s + r.totalDistance, 0) * 100) / 100,
    totalWeight: Math.round(totalW * 100) / 100, totalCbm: Math.round(totalC * 100) / 100,
    routes, warnings,
  };
}

// ============================================================
// HISTORY ANALYSIS
// ============================================================
function analyzeHistory(historyData, storeLocations = {}, zoneMapping = {}) {
  const { byDate } = historyData;
  const dailySummary = Object.keys(byDate).sort().map(date => {
    const dayOrders = byDate[date];
    const totalWeight = dayOrders.reduce((s, o) => s + o.weightKg, 0);
    const totalCbm = dayOrders.reduce((s, o) => s + o.cbm, 0);
    const uniqueStores = [...new Set(dayOrders.map(o => o.store))].length;

    // Group orders by store to simulate stops
    const byStore = {};
    for (const o of dayOrders) {
      if (!byStore[o.store]) {
        let sid = o.store.split(' - ')[0].trim();
        let zone = zoneMapping[sid] || 'Khác';
        if (zone === 'Khác') {
          // fuzzy match
          const sNameNorm = o.store.toLowerCase();
          for (const [key, loc] of Object.entries(storeLocations)) {
            if (key.toLowerCase().includes(sNameNorm) || sNameNorm.includes(key.toLowerCase())) {
              zone = zoneMapping[loc.storeId || key] || 'Khác';
              break;
            }
          }
        }
        byStore[o.store] = { store: o.store, zone, weightKg: 0, cbm: 0, orders: 0 };
      }
      byStore[o.store].weightKg += o.weightKg;
      byStore[o.store].cbm += o.cbm;
      byStore[o.store].orders += 1;
    }

    // Split stops if they exceed capacity
    const stops = [];
    for (const s of Object.values(byStore)) {
      let remW = s.weightKg;
      let remC = s.cbm;
      let chunkIdx = 1;
      while (remW > 0 || remC > 0) {
        let chunkW = Math.min(remW, CONFIG.VEHICLE_CAPACITY_KG);
        let chunkC = Math.min(remC, CONFIG.VEHICLE_CAPACITY_CBM);
        if (chunkW / CONFIG.VEHICLE_CAPACITY_KG > 1) chunkW = CONFIG.VEHICLE_CAPACITY_KG;
        if (chunkC / CONFIG.VEHICLE_CAPACITY_CBM > 1) chunkC = CONFIG.VEHICLE_CAPACITY_CBM;

        stops.push({
          store: s.store + (chunkIdx > 1 ? ` (Phần ${chunkIdx})` : ''),
          zone: s.zone,
          weightKg: chunkW,
          cbm: chunkC,
          orders: chunkIdx === 1 ? s.orders : 0
        });
        remW -= chunkW;
        remC -= chunkC;
        chunkIdx++;
        if (chunkW <= 0 && chunkC <= 0) break;
      }
    }

    stops.sort((a, b) => b.weightKg - a.weightKg);

    // Track NV vehicles per zone. 1 NV vehicle per zone (1, 2, 3, 4)
    const nvVehicles = { 1: false, 2: false, 3: false, 4: false };
    const vehicles = [];
    
    for (const stop of stops) {
      let placed = false;
      for (const v of vehicles) {
        if (v.zone === stop.zone || v.zone === 'Khác' || stop.zone === 'Khác') {
          if (v.weight + stop.weightKg <= CONFIG.VEHICLE_CAPACITY_KG && v.cbm + stop.cbm <= CONFIG.VEHICLE_CAPACITY_CBM) {
            if (v.stops >= 15) continue; // Realistically 15 stops max per 5-hour shift
            v.weight += stop.weightKg;
            v.cbm += stop.cbm;
            v.orders += stop.orders;
            v.stops += 1;
            placed = true;
            break;
          }
        }
      }
      if (!placed) {
        let vType = 'Thuê ngoài';
        let vZone = stop.zone !== 'Khác' ? stop.zone : 'Khác';
        if (vZone !== 'Khác' && nvVehicles[vZone] === false) {
          vType = `NV (Tuyến ${vZone})`;
          nvVehicles[vZone] = true;
        } else {
          vType = vZone !== 'Khác' ? `Thuê ngoài (Tuyến ${vZone})` : `Thuê ngoài (Khác)`;
        }

        vehicles.push({
          id: vehicles.length + 1,
          type: vType,
          zone: vZone,
          weight: stop.weightKg,
          cbm: stop.cbm,
          orders: stop.orders,
          stops: 1
        });
      }
    }

    const vehiclesNeeded = vehicles.length;
    const avgWF = (totalWeight / (vehiclesNeeded * CONFIG.VEHICLE_CAPACITY_KG)) * 100;
    const avgCF = (totalCbm / (vehiclesNeeded * CONFIG.VEHICLE_CAPACITY_CBM)) * 100;

    return {
      date, totalOrders: dayOrders.length, uniqueStores,
      totalWeight: Math.round(totalWeight * 100) / 100, totalCbm: Math.round(totalCbm * 100) / 100,
      vehiclesNeeded,
      weightFillPercent: Math.round(avgWF * 10) / 10,
      cbmFillPercent: Math.round(avgCF * 10) / 10,
      constrainedBy: totalCbm / (vehiclesNeeded * CONFIG.VEHICLE_CAPACITY_CBM) > totalWeight / (vehiclesNeeded * CONFIG.VEHICLE_CAPACITY_KG) ? 'CBM' : 'Weight',
      vehicles: vehicles.map(v => ({
        ...v,
        weight: Math.round(v.weight * 100) / 100,
        cbm: Math.round(v.cbm * 100) / 100,
        weightPercent: Math.round((v.weight / CONFIG.VEHICLE_CAPACITY_KG) * 100),
        cbmPercent: Math.round((v.cbm / CONFIG.VEHICLE_CAPACITY_CBM) * 100)
      }))
    };
  });

  const n = dailySummary.length;
  return {
    totalOrders: Object.values(byDate).flat().length,
    totalDays: n,
    daysOverCapacity: dailySummary.filter(d => d.vehiclesNeeded > CONFIG.NUM_VEHICLES).length,
    avgVehiclesPerDay: Math.round(dailySummary.reduce((s, d) => s + d.vehiclesNeeded, 0) / n * 10) / 10,
    avgWeightFillPercent: Math.round(dailySummary.reduce((s, d) => s + d.weightFillPercent, 0) / n * 10) / 10,
    avgCbmFillPercent: Math.round(dailySummary.reduce((s, d) => s + d.cbmFillPercent, 0) / n * 10) / 10,
    dailySummary,
  };
}

// ============================================================
// VEHICLE PLAN PROCESSING
// ============================================================
async function optimizeVehiclePlan(filePath, storeLocations, numInternal = 2) {
  const wb = XLSX.readFile(filePath);
  let wsName = wb.SheetNames.find(n => n.includes('Total')) || wb.SheetNames[0];
  const ws = wb.Sheets[wsName];
  const raw = XLSX.utils.sheet_to_json(ws);
  if (raw.length === 0) return { routes: [], depot: storeLocations['Kho Supra - Phú Thọ'] || { lat: 21.326576980287744, lng: 105.32489178650769, name: 'Kho' }, totalStops: 0, totalVehiclesUsed: 0, totalWeight: 0, totalCbm: 0, totalDistance: 0 };

  const firstRowKeys = Object.keys(raw[0]);
  const soColumn = firstRowKeys.find(k => k.toLowerCase().includes('số so') || k === 'SO') || firstRowKeys[2] || 'Số SO';
  const regionColumn = firstRowKeys.find(k => {
      const norm = k.normalize('NFC').toLowerCase();
      return norm.includes('quận') || norm.includes('khu vực');
  }) || firstRowKeys[12] || 'Quận';

  // 1. Parse Excel and aggregate by Store
  const byStore = {};
  for (const r of raw) {
    if (regionColumn) {
        const region = String(r[regionColumn] || r['Quận'] || r['Khu vực'] || '').normalize('NFC').trim().toLowerCase();
        if (!region.includes('việt trì') && !region.includes('viet tri')) continue;
    }

    const storeName = r['Tên siêu thị'] || r['Tên Cửa Hàng'] || r['Store Name'];
    const storeCode = String(r['Mã siêu thị '] || r['Mã siêu thị'] || '').trim();
    const key = storeName || storeCode;
    
    if (!key || key === 'undefined') continue;

    if (!byStore[key]) {
      let loc = null;
      if (storeCode) loc = findStoreLocation(storeCode, storeLocations);
      if (!loc && storeName) loc = findStoreLocation(storeName, storeLocations);
      // Fallback location if not found in master list
      if (!loc) {
         loc = { address: 'Không rõ', lat: 21.3 + Math.random()*0.1, lng: 105.4 + Math.random()*0.1 };
      }
      if (loc) {
        byStore[key] = {
           storeId: storeCode,
           name: storeName,
           address: loc.address,
           lat: loc.lat, lng: loc.lng,
           weight: 0,
           cbm: 0,
           orders: 0,
           pieces: 0,
           soList: []
        };
      }
    }
    if (byStore[key]) {
      byStore[key].weight += parseFloat(r['Weight'] || r['Trọng lượng'] || 0) || 0;
      byStore[key].cbm += parseFloat(r['Volume'] || r['Thể tích'] || 0) || 0;
      byStore[key].orders += 1;
      byStore[key].pieces += parseInt(r['Qty'] || 0) || 0;
      
      if (soColumn && r[soColumn]) {
        const soNum = String(r[soColumn]).trim();
        if (soNum && !byStore[key].soList.includes(soNum)) {
            byStore[key].soList.push(soNum);
        }
      }
    }
  }

  let unassignedStops = Object.values(byStore).map(s => {
      s.weight = Math.round(s.weight * 100) / 100;
      s.cbm = Math.round(s.cbm * 100) / 100;
      return s;
  }).filter(s => s.weight > 0 || s.cbm > 0);

  // 2. Build Internal Trips
  const internalTrips = [];
  for (let i = 1; i <= numInternal; i++) {
     if (unassignedStops.length === 0) break;
     
     let currentTrip = [];
     let currentW = 0;
     let currentC = 0;
     let currLoc = CONFIG.DEPOT;
     
     while (unassignedStops.length > 0) {
        let bestIdx = -1;
        let bestScore = -1;
        
        for (let j = 0; j < unassignedStops.length; j++) {
           const candidate = unassignedStops[j];
           if (currentW + candidate.weight <= CONFIG.VEHICLE_CAPACITY_KG && currentC + candidate.cbm <= CONFIG.VEHICLE_CAPACITY_CBM) {
              const dist = haversineDistance(currLoc.lat, currLoc.lng, candidate.lat, candidate.lng);
              const sizeScore = (candidate.weight / CONFIG.VEHICLE_CAPACITY_KG) + (candidate.cbm / CONFIG.VEHICLE_CAPACITY_CBM);
              // Score favors large drops that are close
              const score = sizeScore / (dist + 1); 
              if (score > bestScore) {
                 bestScore = score;
                 bestIdx = j;
               }
           }
        }
        
        if (bestIdx !== -1) {
           const bestStop = unassignedStops[bestIdx];
           currentTrip.push(bestStop);
           currentW += bestStop.weight;
           currentC += bestStop.cbm;
           currLoc = bestStop;
           unassignedStops.splice(bestIdx, 1);
        } else {
           break; // No more stops fit
        }
     }
     
     if (currentTrip.length > 0) {
        internalTrips.push({
           vehicleName: `Xe nhà ${i}`,
           stops: currentTrip,
           totalWeight: currentW,
           totalCbm: currentC
        });
     }
  }

  // 3. Build Remaining Trips (Outsourced)
  const remainingTrips = [];
  if (unassignedStops.length > 0) {
      const remW = unassignedStops.reduce((s, p) => s + p.weight, 0);
      const remC = unassignedStops.reduce((s, p) => s + p.cbm, 0);
      const v = Math.max(Math.ceil(remW / CONFIG.VEHICLE_CAPACITY_KG), Math.ceil(remC / CONFIG.VEHICLE_CAPACITY_CBM), Math.ceil(unassignedStops.length / 15));
      
      const clusters = capacityAwareClustering(unassignedStops, v, CONFIG.VEHICLE_CAPACITY_KG, CONFIG.VEHICLE_CAPACITY_CBM);
      clusters.forEach((cl, idx) => {
          if (cl.length > 0) {
             remainingTrips.push({
                 vehicleName: `Xe nhà ${numInternal + idx + 1}`,
                 stops: cl,
                 totalWeight: cl.reduce((s, p) => s + p.weight, 0),
                 totalCbm: cl.reduce((s, p) => s + p.cbm, 0)
             });
          }
      });
  }

  // 4. Optimize Routes (TSP + OSRM)
  const allTripsToProcess = [...internalTrips, ...remainingTrips].filter(t => t.stops.length > 0);
  let totalStops = 0;
  let totalW = 0;
  let totalC = 0;

  allTripsToProcess.forEach(trip => {
      totalW += trip.totalWeight;
      totalC += trip.totalCbm;
      totalStops += trip.stops.length;
  });

  const routes = await Promise.all(allTripsToProcess.map(async trip => {
      const { distMatrix, durationMatrix, allPoints } = await buildOSRMDistanceMatrix(trip.stops);
      const nn = nearestNeighborTSP(trip.stops, distMatrix, allPoints);
      const opt = twoOptImprove(nn.route, distMatrix);
      const sched = calculateSchedule(opt.route, allPoints, distMatrix, durationMatrix);
      
      const routePts = [CONFIG.DEPOT, ...opt.route.map(i => allPoints[i]), CONFIG.DEPOT];
      const osrm = await getOSRMRoute(routePts);
      
      const wFill = Math.round((trip.totalWeight / CONFIG.VEHICLE_CAPACITY_KG) * 1000) / 10;
      const cFill = Math.round((trip.totalCbm / CONFIG.VEHICLE_CAPACITY_CBM) * 1000) / 10;
      
      return {
        vehicleId: trip.vehicleName, 
        zoneId: 'Tự động',
        numStops: trip.stops.length,
        totalDistance: osrm ? Math.round(osrm.distance * 100) / 100 : Math.round(opt.totalDistance * 100) / 100,
        totalWeight: Math.round(trip.totalWeight * 100) / 100, totalCbm: Math.round(trip.totalCbm * 100) / 100,
        weightFillPercent: wFill,
        cbmFillPercent: cFill,
        schedule: sched.schedule, returnTime: sched.returnTime,
        totalWorkHours: Math.round(sched.totalWorkMinutes / 60 * 100) / 100,
        departureTime: CONFIG.START_TIME,
        routeGeometry: osrm ? osrm.geometry : null,
      };
  }));
  
  const maxRet = parseTime(CONFIG.MAX_RETURN_TIME);
  let warnings = [];
  routes.forEach(r => {
    if (parseTime(r.returnTime) > maxRet) warnings.push(`Xe ${r.vehicleId}: Về kho ${r.returnTime} (quá ${CONFIG.MAX_RETURN_TIME})`);
    if (r.weightFillPercent > 100) warnings.push(`Xe ${r.vehicleId}: VƯỢT TẢI KG (${r.weightFillPercent}%)`);
    if (r.cbmFillPercent > 100) warnings.push(`Xe ${r.vehicleId}: VƯỢT TẢI CBM (${r.cbmFillPercent}%)`);
  });

  return {
    config: CONFIG, depot: CONFIG.DEPOT,
    totalStops: totalStops, totalVehiclesUsed: routes.length,
    suggestedVehicles: routes.length, additionalVehiclesNeeded: 0,
    totalDistance: Math.round(routes.reduce((s, r) => s + r.totalDistance, 0) * 100) / 100,
    totalWeight: Math.round(totalW * 100) / 100, totalCbm: Math.round(totalC * 100) / 100,
    routes, warnings,
  };
}

// ============================================================
// EXPORTS
// ============================================================
module.exports = { CONFIG, loadStoreLocations, loadDailyOrders, buildDayStops, optimizeDay, analyzeHistory, getOSRMRoute, optimizeVehiclePlan };
