const fs = require('fs');
const XLSX = require('xlsx');
const path = require('path');
const { loadStoreLocations, CONFIG } = require('./optimizer');

// Constants
const CAPACITY_KG = 1900;
const CAPACITY_CBM = 12;
const SUPRA_DEPOT = { lat: 21.3882412, lng: 105.1797647, name: 'Kho Supra' };
// Using a representative coordinate for GXT Viet Tri (e.g., average of Viet Tri stores)
const GXT_DEPOT = { lat: 21.328, lng: 105.396, name: 'Kho GXT Việt Trì' };

function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function fetchOSRMTable(points) {
  const coords = points.map(p => `${p.lng},${p.lat}`).join(';');
  const url = `https://router.project-osrm.org/table/v1/driving/${coords}?annotations=distance,duration`;
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
  const url = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    if (data.code === 'Ok' && data.routes[0]) {
      return { distance: data.routes[0].distance / 1000, duration: data.routes[0].duration / 60 };
    }
  } catch (e) {}
  return null;
}

function nearestNeighborTSP(stops, distMatrix, allPoints) {
  const n = allPoints.length;
  const vis = new Set([0]);
  const route = [];
  let cur = 0;
  let totalDist = 0;

  while (vis.size < n) {
    let best = -1, minDist = Infinity;
    for (let i = 1; i < n; i++) {
      if (!vis.has(i) && distMatrix[cur][i] < minDist) {
        minDist = distMatrix[cur][i]; best = i;
      }
    }
    vis.add(best);
    route.push(best);
    totalDist += minDist;
    cur = best;
  }
  totalDist += distMatrix[cur][0];
  return { route, totalDistance: totalDist };
}

function twoOptImprove(route, distMatrix) {
  let improved = true;
  let bestDist = calculateRouteDist(route, distMatrix);
  while (improved) {
    improved = false;
    for (let i = 0; i < route.length - 1; i++) {
      for (let j = i + 1; j < route.length; j++) {
        const newRoute = [...route.slice(0, i), ...route.slice(i, j + 1).reverse(), ...route.slice(j + 1)];
        const newDist = calculateRouteDist(newRoute, distMatrix);
        if (newDist < bestDist - 0.001) {
          route = newRoute;
          bestDist = newDist;
          improved = true;
        }
      }
    }
  }
  return { route, totalDistance: bestDist };
}

function calculateRouteDist(route, distMatrix) {
  if (route.length === 0) return 0;
  let d = distMatrix[0][route[0]];
  for (let i = 0; i < route.length - 1; i++) d += distMatrix[route[i]][route[i + 1]];
  d += distMatrix[route[route.length - 1]][0];
  return d;
}

async function run15_6() {
  const mainFile = path.join(__dirname, 'Winmart Phú Thọ.xlsx');
  const storeLocations = loadStoreLocations(mainFile);

  const planFile = path.join(__dirname, 'Kế hoạch xe', '20260615 GHN.xlsb');
  const wb = XLSX.readFile(planFile);
  const wsName = wb.SheetNames.find(n => n.includes('Total')) || wb.SheetNames[0];
  const ws = wb.Sheets[wsName];
  const raw = XLSX.utils.sheet_to_json(ws);

  const byStore = {};
  for (const r of raw) {
    const storeName = r['Tên siêu thị'] || r['Tên Cửa Hàng'] || r['Store Name'];
    const storeCode = String(r['Mã siêu thị '] || r['Mã siêu thị'] || '').trim();
    const key = storeName || storeCode;
    
    if (!key || key === 'undefined') continue;

    if (!byStore[key]) {
      let loc = null;
      if (storeCode && storeLocations[storeCode]) loc = storeLocations[storeCode];
      else {
          for (let [k, v] of Object.entries(storeLocations)) {
              if (k.toLowerCase().includes(key.toLowerCase()) || key.toLowerCase().includes(k.toLowerCase())) {
                  loc = v; break;
              }
          }
      }
      
      if (!loc) loc = { address: 'Không rõ', lat: 21.35, lng: 105.25 };
      
      byStore[key] = {
         storeId: storeCode, name: storeName, address: loc.address, lat: loc.lat, lng: loc.lng,
         weight: 0, cbm: 0
      };
    }
    byStore[key].weight += parseFloat(r['Weight'] || r['Trọng lượng'] || 0) || 0;
    byStore[key].cbm += parseFloat(r['Volume'] || r['Thể tích'] || 0) || 0;
  }

  const allStops = Object.values(byStore).filter(s => s.weight > 0 || s.cbm > 0);
  
  const vietTriStops = [];
  const otherStops = [];
  
  // Custom grouping: if address or name contains Viet Tri
  for (const s of allStops) {
      const txt = (s.name + ' ' + s.address).toLowerCase();
      if (txt.includes('việt trì') || txt.includes('viet tri') || txt.includes('tx. phú thọ') || txt.includes('thị xã phú thọ') || txt.includes('tx phu tho') || txt.includes('thi xa phu tho')) {
          vietTriStops.push(s);
      } else {
          otherStops.push(s);
      }
  }

  console.log(`\n===========================================`);
  console.log(`KẾ HOẠCH XE NGÀY 15.6`);
  console.log(`Cụm Việt Trì (Kho GXT Việt Trì): ${vietTriStops.length} điểm`);
  console.log(`Cụm Khác (Kho Supra): ${otherStops.length} điểm`);
  console.log(`===========================================\n`);

  async function optimizeCluster(stops, depot, prefix) {
      if (stops.length === 0) return;
      
      let trips = [];
      let currentTrip = [];
      let currentW = 0, currentC = 0;
      let unassigned = [...stops];
      
      // Simple Nearest Neighbor clustering by capacity
      while (unassigned.length > 0) {
          let currLoc = currentTrip.length === 0 ? depot : currentTrip[currentTrip.length - 1];
          let bestIdx = -1, bestScore = -1;
          
          for (let i = 0; i < unassigned.length; i++) {
              const candidate = unassigned[i];
              if (currentW + candidate.weight <= CAPACITY_KG && currentC + candidate.cbm <= CAPACITY_CBM) {
                  const dist = haversineDistance(currLoc.lat, currLoc.lng, candidate.lat, candidate.lng);
                  const score = 1 / (dist + 0.1); 
                  if (score > bestScore) { bestScore = score; bestIdx = i; }
              }
          }
          
          if (bestIdx !== -1) {
              const bestStop = unassigned[bestIdx];
              currentTrip.push(bestStop);
              currentW += bestStop.weight;
              currentC += bestStop.cbm;
              unassigned.splice(bestIdx, 1);
          } else {
              if (currentTrip.length === 0) {
                  currentTrip.push(unassigned[0]);
                  unassigned.splice(0, 1);
              }
              trips.push(currentTrip);
              currentTrip = []; currentW = 0; currentC = 0;
          }
      }
      if (currentTrip.length > 0) trips.push(currentTrip);

      for (let i = 0; i < trips.length; i++) {
          const tripStops = trips[i];
          const allPoints = [depot, ...tripStops];
          let distMatrix, durationMatrix;
          
          if (allPoints.length <= 80) {
              const res = await fetchOSRMTable(allPoints);
              distMatrix = res.distMatrix;
          } else {
              distMatrix = Array.from({ length: allPoints.length }, () => Array(allPoints.length).fill(0));
              for(let a=0; a<allPoints.length; a++) {
                  for(let b=a+1; b<allPoints.length; b++) {
                      const d = haversineDistance(allPoints[a].lat, allPoints[a].lng, allPoints[b].lat, allPoints[b].lng) * 1.4;
                      distMatrix[a][b] = d; distMatrix[b][a] = d;
                  }
              }
          }
          
          const nn = nearestNeighborTSP(tripStops, distMatrix, allPoints);
          const opt = twoOptImprove(nn.route, distMatrix);
          
          const routePts = [depot, ...opt.route.map(idx => allPoints[idx]), depot];
          const osrm = await getOSRMRoute(routePts);
          const finalDist = osrm ? osrm.distance : opt.totalDistance;
          
          const w = tripStops.reduce((sum, s) => sum + s.weight, 0);
          const c = tripStops.reduce((sum, s) => sum + s.cbm, 0);
          
          console.log(`=> Xe ${prefix}-${i+1}:`);
          console.log(`   - Số điểm: ${tripStops.length}`);
          console.log(`   - Tải trọng: ${w.toFixed(1)}kg | ${c.toFixed(1)}m3`);
          console.log(`   - Quãng đường tối ưu: ${finalDist.toFixed(1)} km`);
          const pathNames = ['Bắt đầu (' + depot.name + ')', ...opt.route.map(idx => tripStops[idx-1].name)];
          console.log(`   - Lộ trình: ${pathNames.join(' -> ')} -> Về kho\n`);
      }
  }

  console.log(`--- XỬ LÝ CỤM VIỆT TRÌ ---`);
  await optimizeCluster(vietTriStops, GXT_DEPOT, 'GXT_VT');
  
  console.log(`--- XỬ LÝ CỤM CÒN LẠI ---`);
  await optimizeCluster(otherStops, SUPRA_DEPOT, 'SUPRA');
}

run15_6();
