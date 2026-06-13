const fs = require('fs');
const XLSX = require('xlsx');
const path = require('path');
const { CONFIG } = require('./optimizer');

const CAPACITY_KG = 1900;
const CAPACITY_CBM = 12;
const SUPRA_DEPOT = { lat: 21.3882412, lng: 105.1797647, name: 'Kho Supra' };
const GXT_DEPOT = { lat: 21.3043611, lng: 105.4293889, name: 'Kho GXT Việt Trì' };

function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function parseTime(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
}
function formatTime(min) { 
  let m = Math.round(min); 
  let h = Math.floor(m / 60); 
  m = m % 60; 
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`; 
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

async function run(filePath, storeLocations, numInternal) {
  const wb = XLSX.readFile(filePath);
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
      byStore[key] = { storeId: storeCode, name: storeName, address: loc.address, lat: loc.lat, lng: loc.lng, weight: 0, cbm: 0 };
    }
    byStore[key].weight += parseFloat(r['Weight'] || r['Trọng lượng'] || 0) || 0;
    byStore[key].cbm += parseFloat(r['Volume'] || r['Thể tích'] || 0) || 0;
  }

  const allStops = Object.values(byStore).filter(s => s.weight > 0 || s.cbm > 0);
  
  const vietTriStops = [];
  const lamThaoStops = [];
  const otherStops = [];
  for (const s of allStops) {
      const txt = (s.name + ' ' + s.address).toLowerCase();
      if (txt.includes('việt trì') || txt.includes('viet tri')) {
          vietTriStops.push(s);
      } else if (txt.includes('lâm thao') || txt.includes('lam thao')) {
          lamThaoStops.push(s);
      } else {
          otherStops.push(s);
      }
  }

  let finalRoutes = [];

  async function buildTrips(stops, depot, prefix, forceSingle = false) {
      if (stops.length === 0) return;
      let trips = [];
      
      if (forceSingle) {
          trips.push([...stops]);
      } else {
          let currentTrip = [];
          let currentW = 0, currentC = 0;
          let unassigned = [...stops];
          
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
                  trips.push(currentTrip);
                  currentTrip = []; currentW = 0; currentC = 0;
              }
          }
          if (currentTrip.length > 0) trips.push(currentTrip);
      }

      for (let i = 0; i < trips.length; i++) {
          const tripStops = trips[i];
          const allPoints = [depot, ...tripStops];
          let distMatrix, durationMatrix;
          
          if (allPoints.length <= 80) {
              try {
                  const res = await fetchOSRMTable(allPoints);
                  distMatrix = res.distMatrix;
                  durationMatrix = res.durationMatrix;
              } catch(e) {
                  console.log("OSRM Error, fallback to haversine", e.message);
              }
          }
          
          if (!distMatrix) {
              distMatrix = Array.from({ length: allPoints.length }, () => Array(allPoints.length).fill(0));
              durationMatrix = Array.from({ length: allPoints.length }, () => Array(allPoints.length).fill(0));
              for(let a=0; a<allPoints.length; a++) {
                  for(let b=a+1; b<allPoints.length; b++) {
                      const d = haversineDistance(allPoints[a].lat, allPoints[a].lng, allPoints[b].lat, allPoints[b].lng) * 1.4;
                      distMatrix[a][b] = d; distMatrix[b][a] = d;
                      const dur = (d / 35) * 60;
                      durationMatrix[a][b] = dur; durationMatrix[b][a] = dur;
                  }
              }
          }
          
          const nn = require('./geo_optimizer').nearestNeighborTSP(tripStops, distMatrix, allPoints);
          const opt = require('./geo_optimizer').twoOptImprove(nn.route, distMatrix);
          
          const schedData = []; const start = parseTime(CONFIG.START_TIME);
          let cur = start, prev = 0;
          for (let sIdx = 0; sIdx < opt.route.length; sIdx++) {
            const idx = opt.route[sIdx]; const pt = allPoints[idx];
            const travel = durationMatrix[prev][idx];
            cur += travel;
            schedData.push({ order: sIdx + 1, storeId: pt.storeId, storeName: pt.name, address: pt.address, lat: pt.lat, lng: pt.lng, distance: Math.round(distMatrix[prev][idx]*100)/100, travelMinutes: Math.round(travel*10)/10, arrivalTime: formatTime(cur), weight: pt.weight, cbm: pt.cbm });
            cur += CONFIG.SERVICE_TIME_MINUTES;
            prev = idx;
          }
          cur += durationMatrix[prev][0]; // return
          const returnTime = formatTime(cur);
          
          const routePts = [depot, ...opt.route.map(idx => allPoints[idx]), depot];
          const osrm = await require('./geo_optimizer').getOSRMRoute(routePts);
          const finalDist = osrm ? osrm.distance : opt.totalDistance;
          
          const w = tripStops.reduce((sum, s) => sum + s.weight, 0);
          const c = tripStops.reduce((sum, s) => sum + s.cbm, 0);
          
          let vid = prefix;
          if (trips.length > 1) {
              vid = `${prefix} ${i+1}`;
          }
          
          finalRoutes.push({
            vehicleId: vid, 
            zoneId: 'Tự động',
            numStops: tripStops.length,
            totalDistance: Math.round(finalDist * 100) / 100,
            totalWeight: Math.round(w * 100) / 100, totalCbm: Math.round(c * 100) / 100,
            weightFillPercent: Math.round((w / CAPACITY_KG) * 1000) / 10,
            cbmFillPercent: Math.round((c / CAPACITY_CBM) * 1000) / 10,
            schedule: schedData, returnTime: returnTime,
            totalWorkHours: Math.round((cur - start) / 60 * 100) / 100,
            departureTime: CONFIG.START_TIME,
            routeGeometry: osrm ? osrm.geometry : null,
            _depot: depot
          });
      }
  }

  await buildTrips(vietTriStops, GXT_DEPOT, 'GXT Việt Trì');
  await buildTrips(lamThaoStops, SUPRA_DEPOT, 'Xe nhà 1 (Lâm Thao)', true);
  await buildTrips(otherStops, SUPRA_DEPOT, 'Thuê ngoài');

  let totalW = allStops.reduce((s, p) => s + p.weight, 0);
  let totalC = allStops.reduce((s, p) => s + p.cbm, 0);

  const maxRet = parseTime(CONFIG.MAX_RETURN_TIME);
  let warnings = [];
  finalRoutes.forEach(r => {
    if (parseTime(r.returnTime) > maxRet) warnings.push(`Xe ${r.vehicleId}: Về kho ${r.returnTime} (quá ${CONFIG.MAX_RETURN_TIME})`);
    if (r.weightFillPercent > 100) warnings.push(`Xe ${r.vehicleId}: VƯỢT TẢI KG (${r.weightFillPercent}%)`);
    if (r.cbmFillPercent > 100) warnings.push(`Xe ${r.vehicleId}: VƯỢT TẢI CBM (${r.cbmFillPercent}%)`);
  });

  return {
    config: CONFIG, depot: SUPRA_DEPOT,
    totalStops: allStops.length, totalVehiclesUsed: finalRoutes.length,
    suggestedVehicles: finalRoutes.length, additionalVehiclesNeeded: 0,
    totalDistance: Math.round(finalRoutes.reduce((s, r) => s + r.totalDistance, 0) * 100) / 100,
    totalWeight: Math.round(totalW * 100) / 100, totalCbm: Math.round(totalC * 100) / 100,
    routes: finalRoutes, warnings,
  };
}

module.exports = { run };
