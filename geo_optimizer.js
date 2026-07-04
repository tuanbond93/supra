const XLSX = require('xlsx');
const fs = require('fs');

const CONFIG = {
  DEPOT: { lat: 21.326576980287744, lng: 105.32489178650769, name: 'Kho Xuất Phát' },
  START_TIME: '13:00',
  MAX_RETURN_TIME: '19:00', // 6 hours
  MAX_WORK_MINUTES: 6 * 60,
  SERVICE_TIME_MINUTES: 15,
  OSRM_BASE: 'https://router.project-osrm.org',
};

// ... copy necessary helper functions (haversineDistance, OSRM functions) from the main optimizer ...
async function buildOSRMDistanceMatrix(stops) {
  const allPoints = [CONFIG.DEPOT, ...stops];
  const n = allPoints.length;
  if (n <= 80) return await fetchOSRMTable(allPoints);
  
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
  const res = await fetch(url);
  const data = await res.json();
  if (data.code !== 'Ok') throw new Error(`OSRM Table API: ${data.code}`);
  return {
    distMatrix: data.distances.map(row => row.map(d => d / 1000)),
    durationMatrix: data.durations.map(row => row.map(d => d / 60)),
    allPoints: points,
  };
}

async function getOSRMRoute(points) {
  if(points.length < 2) return null;
  const coords = points.map(p => `${p.lng},${p.lat}`).join(';');
  const url = `${CONFIG.OSRM_BASE}/route/v1/driving/${coords}?overview=full&geometries=geojson`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    if (data.code === 'Ok' && data.routes[0]) {
      return { geometry: data.routes[0].geometry, distance: data.routes[0].distance / 1000, duration: data.routes[0].duration / 60 };
    }
  } catch (e) {}
  return null;
}

function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Map stores to Opened / Unopened
function mapStoreStatuses(mainFilePath, areasFilePath) {
  const wbAreas = XLSX.readFile(areasFilePath);
  const wsAreas = wbAreas.Sheets['TỔNG HỢP <<'];
  const areasData = XLSX.utils.sheet_to_json(wsAreas);

  const phuThoAreas = areasData.filter(r => r['Tỉnh'] === 'Phú Thọ');
  const areaDict = {};
  const norm = (str) => (str || '').toLowerCase().replace(/^(huyện|thành phố|thị xã|quận|xã|phường|thị trấn)\s+/i, '').trim();

  phuThoAreas.forEach(r => {
    areaDict[`${norm(r['Quận'])}|${norm(r['Phường'])}`] = r['Trạng thái Thực tế'] || 'Chưa mở';
  });

  const districtStatus = {};
  phuThoAreas.forEach(r => {
    const q = norm(r['Quận']);
    if (!districtStatus[q]) districtStatus[q] = { 'Đã mở': 0, 'Chưa mở': 0 };
    districtStatus[q][r['Trạng thái Thực tế'] || 'Chưa mở']++;
  });
  for (const q in districtStatus) {
    districtStatus[q] = districtStatus[q]['Đã mở'] >= districtStatus[q]['Chưa mở'] ? 'Đã mở' : 'Chưa mở';
  }

  const wbStores = XLSX.readFile(mainFilePath);
  const storesData = XLSX.utils.sheet_to_json(wbStores.Sheets[wbStores.SheetNames[0]]);

  const results = storesData.map(s => {
    const address = (s['Address'] || '').toLowerCase();
    const name = (s['Store'] || '').toLowerCase();
    let status = 'Chưa xác định';
    
    let foundDistrict = null;
    let foundWard = null;
    for (const q of Object.keys(districtStatus)) {
      if (address.includes(q) || name.includes(q)) { foundDistrict = q; break; }
    }
    
    if (foundDistrict) {
      const wardsInDistrict = Object.keys(areaDict).filter(k => k.startsWith(foundDistrict + '|')).map(k => k.split('|')[1]);
      for (const w of wardsInDistrict) {
        if (address.includes(w) || name.includes(w)) { foundWard = w; break; }
      }
      status = foundWard ? areaDict[`${foundDistrict}|${foundWard}`] : districtStatus[foundDistrict];
    } else {
      status = (address.includes('việt trì') || name.includes('việt trì') || 
                address.includes('tx. phú thọ') || name.includes('tx. phú thọ') || address.includes('thị xã phú thọ') || name.includes('thị xã phú thọ') || 
                address.includes('tx phu tho') || name.includes('tx phu tho') || address.includes('thi xa phu tho') || name.includes('thi xa phu tho') ||
                address.includes('lâm thao') || name.includes('lâm thao') || address.includes('lam thao') || name.includes('lam thao') ||
                address.includes('tam nông') || name.includes('tam nông') || address.includes('tam nong') || name.includes('tam nong') ||
                address.includes('phù ninh') || name.includes('phù ninh') || address.includes('phu ninh') || name.includes('phu ninh')) ? 'Đã mở' : 'Chưa mở';
    }
    
    return {
      storeId: String(s['StoreID']),
      name: s['Store name'] || s['Store'],
      lat: s['Lat'], lng: s['Long'],
      address: s['Address'],
      status: status
    };
  }).filter(s => s.lat && s.lng);

  return results;
}

// ============================================================
// TIME-CONSTRAINED CLUSTERING & ROUTING
// ============================================================
// We need to group points such that total travel time + service time <= 6 hours
// Since distance matrices are expensive, we can use a Sweep or K-Means algorithm, 
// then evaluate the TSP length. If it exceeds 6h, split it.
function kMeans(stops, k) {
  if (stops.length <= k) return stops.map(s => [s]);
  const centroids = [{ lat: stops[0].lat, lng: stops[0].lng }];
  for (let c = 1; c < k; c++) {
    const dists = stops.map(s => Math.min(...centroids.map(ce => haversineDistance(s.lat, s.lng, ce.lat, ce.lng))) ** 2);
    let r = Math.random() * dists.reduce((a, b) => a + b, 0);
    for (let i = 0; i < stops.length; i++) { r -= dists[i]; if (r <= 0) { centroids.push({ lat: stops[i].lat, lng: stops[i].lng }); break; } }
    if (centroids.length <= c) centroids.push({ lat: stops[c % stops.length].lat, lng: stops[c % stops.length].lng });
  }
  let assign = new Array(stops.length).fill(0);
  for (let iter = 0; iter < 100; iter++) {
    const na = stops.map(s => { let md = Infinity, b = 0; for (let c = 0; c < k; c++) { const d = haversineDistance(s.lat, s.lng, centroids[c].lat, centroids[c].lng); if (d < md) { md = d; b = c; } } return b; });
    if (JSON.stringify(na) === JSON.stringify(assign)) break;
    assign = na;
    for (let c = 0; c < k; c++) { const m = stops.filter((_, i) => assign[i] === c); if (m.length) centroids[c] = { lat: m.reduce((s, p) => s + p.lat, 0) / m.length, lng: m.reduce((s, p) => s + p.lng, 0) / m.length }; }
  }
  const clusters = Array.from({ length: k }, () => []);
  stops.forEach((s, i) => clusters[assign[i]].push(s));
  return clusters.filter(c => c.length > 0);
}

// Simple nearest neighbor heuristic for TSP using haversine to estimate time
function estimateRouteTime(cluster) {
  const pts = [CONFIG.DEPOT, ...cluster];
  let time = 0;
  let vis = new Set();
  let curr = 0;
  vis.add(0);
  
  while (vis.size < pts.length) {
    let best = -1, minD = Infinity;
    for (let i = 1; i < pts.length; i++) {
      if (!vis.has(i)) {
        const d = haversineDistance(pts[curr].lat, pts[curr].lng, pts[i].lat, pts[i].lng) * 1.4;
        if (d < minD) { minD = d; best = i; }
      }
    }
    time += (minD / 35) * 60; // driving time
    time += CONFIG.SERVICE_TIME_MINUTES; // service time
    vis.add(best);
    curr = best;
  }
  time += (haversineDistance(pts[curr].lat, pts[curr].lng, CONFIG.DEPOT.lat, CONFIG.DEPOT.lng) * 1.4 / 35) * 60;
  return time;
}

function timeConstrainedClustering(stops, maxMinutes) {
  let k = 1;
  let clusters = [stops];
  let valid = false;
  
  while (!valid && k <= stops.length) {
    clusters = kMeans(stops, k);
    valid = true;
    for (const c of clusters) {
      if (estimateRouteTime(c) > maxMinutes) {
        valid = false;
        break;
      }
    }
    if (!valid) k++;
  }
  return clusters;
}

function nearestNeighborTSP(stops, dm, allPts) {
  if (!stops.length) return { route: [], totalDistance: 0 };
  const idx = stops.map(s => allPts.findIndex(p => p.storeId === s.storeId && p.lat === s.lat));
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
  const sched = []; const start = 13 * 60; // 13:00
  let cur = start, prev = 0;
  for (let i = 0; i < route.length; i++) {
    const idx = route[i], pt = allPts[idx];
    const dist = dm[prev][idx], travel = durM[prev][idx];
    cur += travel;
    sched.push({ order: i + 1, storeId: pt.storeId, storeName: pt.name, address: pt.address, lat: pt.lat, lng: pt.lng, distance: Math.round(dist * 100) / 100, travelMinutes: Math.round(travel * 10) / 10, arrivalTime: formatTime(cur) });
    cur += CONFIG.SERVICE_TIME_MINUTES; prev = idx;
  }
  cur += durM[prev][0];
  return { schedule: sched, returnTime: formatTime(cur), totalWorkMinutes: cur - start };
}

function formatTime(min) { let m = Math.round(min); let h = Math.floor(m / 60); m = m % 60; return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`; }

async function optimizeGeographic(mainFilePath, areasFilePath) {
  console.log('📦 Đang phân loại khu vực Đã mở / Chưa mở...');
  const stores = mapStoreStatuses(mainFilePath, areasFilePath);
  const openedStops = stores.filter(s => s.status === 'Đã mở');
  const unopenedStops = stores.filter(s => s.status !== 'Đã mở'); // Group "Không mở", "Chưa mở", etc.
  
  console.log(`   ✅ Phân loại: ${openedStops.length} điểm Đã mở, ${unopenedStops.length} điểm Chưa mở`);
  
  async function processGroup(groupStops, groupName) {
    if(groupStops.length === 0) return [];
    console.log(`\n🧮 Gom cụm nhóm ${groupName} (max 6h/chuyến)...`);
    const clusters = timeConstrainedClustering(groupStops, CONFIG.MAX_WORK_MINUTES);
    console.log(`   → Đã chia thành ${clusters.length} tuyến cho nhóm ${groupName}`);
    
    console.log(`   ⚙️  Tính khoảng cách OSRM cho ${groupName}...`);
    const { distMatrix, durationMatrix, allPoints } = await buildOSRMDistanceMatrix(groupStops);
    
    const routes = [];
    for (let v = 0; v < clusters.length; v++) {
      const cl = clusters[v];
      const nn = nearestNeighborTSP(cl, distMatrix, allPoints);
      const opt = twoOptImprove(nn.route, distMatrix);
      const sched = calculateSchedule(opt.route, allPoints, distMatrix, durationMatrix);
      
      const routePts = [CONFIG.DEPOT, ...opt.route.map(i => allPoints[i]), CONFIG.DEPOT];
      const osrm = await getOSRMRoute(routePts);
      
      routes.push({
        vehicleId: `${groupName === 'Đã mở' ? 'M' : 'C'}${v + 1}`,
        group: groupName,
        numStops: cl.length,
        totalDistance: osrm ? Math.round(osrm.distance * 100) / 100 : Math.round(opt.totalDistance * 100) / 100,
        schedule: sched.schedule,
        returnTime: sched.returnTime,
        totalWorkHours: Math.round(sched.totalWorkMinutes / 60 * 100) / 100,
        departureTime: CONFIG.START_TIME,
        routeGeometry: osrm ? osrm.geometry : null,
        isOverTime: sched.totalWorkMinutes > CONFIG.MAX_WORK_MINUTES
      });
    }
    return routes;
  }
  
  const openedRoutes = await processGroup(openedStops, 'Đã mở');
  const unopenedRoutes = await processGroup(unopenedStops, 'Chưa mở');
  const allRoutes = [...openedRoutes, ...unopenedRoutes];
  
  return {
    config: CONFIG,
    depot: CONFIG.DEPOT,
    summary: {
      totalOpenedStops: openedStops.length,
      totalUnopenedStops: unopenedStops.length,
      openedVehiclesNeeded: openedRoutes.length,
      unopenedVehiclesNeeded: unopenedRoutes.length,
    },
    routes: allRoutes
  };
}

module.exports = { 
  optimizeGeographic, 
  mapStoreStatuses,
  buildOSRMDistanceMatrix,
  getOSRMRoute,
  nearestNeighborTSP,
  twoOptImprove,
  calculateSchedule
};
