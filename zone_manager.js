const XLSX = require('xlsx');
const fs = require('fs');
const { buildOSRMDistanceMatrix, getOSRMRoute, nearestNeighborTSP, twoOptImprove, calculateSchedule } = require('./geo_optimizer');

let zoneCache = null;

function loadZones(staffFilePath, storeLocations) {
  if (zoneCache) return zoneCache;
  const wbStaff = XLSX.readFile(staffFilePath);
  const sheets = ['tuyến 1 ', 'Tuyến 2', 'Tuyến 3', 'tuyến 4'];
  const zones = [];
  
  // Mapping store names to zone index
  const storeToZone = {};
  
  for (let i = 0; i < sheets.length; i++) {
    const sheet = sheets[i];
    if (!wbStaff.Sheets[sheet]) continue;
    const rows = XLSX.utils.sheet_to_json(wbStaff.Sheets[sheet], { header: 1 });
    const stores = [];
    rows.forEach(r => {
      if (r[0] && r[0].toString().toLowerCase().includes('wm')) {
        const sName = r[0].toString().trim();
        stores.push(sName);
        // Find matching storeId or full name
        const loc = findStoreLocation(sName, storeLocations);
        if (loc) {
          storeToZone[loc.storeId] = i + 1; // Zone 1, 2, 3, 4
        }
      }
    });
    zones.push({ id: i + 1, name: `Tuyến ${i + 1}`, originalStores: stores });
  }
  
  zoneCache = { zones, storeToZone };
  return zoneCache;
}

function findStoreLocation(storeName, locations) {
  const norm = storeName.toLowerCase();
  for (const [key, loc] of Object.entries(locations)) {
    if (key.toLowerCase().includes(norm) || norm.includes(key.toLowerCase())) return { storeId: loc.storeId || key, ...loc };
  }
  return null;
}

// Generate the static baseline schedule for the 4 zones
async function generateBaselineSchedules(staffFilePath, storeLocations) {
  const { zones } = loadZones(staffFilePath, storeLocations);
  
  for (const zone of zones) {
    const validPoints = [];
    zone.originalStores.forEach(sName => {
      const loc = findStoreLocation(sName, storeLocations);
      if (loc) {
        validPoints.push({
          storeId: loc.storeId, name: sName, address: loc.address, lat: loc.lat, lng: loc.lng
        });
      }
    });
    
    if (validPoints.length === 0) continue;
    
    // Simulate routing
    const { distMatrix, durationMatrix, allPoints } = await buildOSRMDistanceMatrix(validPoints);
    const nn = nearestNeighborTSP(validPoints, distMatrix, allPoints);
    const opt = twoOptImprove(nn.route, distMatrix);
    const sched = calculateSchedule(opt.route, allPoints, distMatrix, durationMatrix);
    
    const routePts = [allPoints[0], ...opt.route.map(idx => allPoints[idx]), allPoints[0]];
    const osrm = await getOSRMRoute(routePts);
    
    zone.schedule = sched.schedule;
    zone.numStops = validPoints.length;
    zone.totalDistance = osrm ? Math.round(osrm.distance * 100) / 100 : Math.round(opt.totalDistance * 100) / 100;
    zone.returnTime = sched.returnTime;
    zone.totalWorkHours = Math.round(sched.totalWorkMinutes / 60 * 100) / 100;
    zone.departureTime = '13:00';
    zone.routeGeometry = osrm ? osrm.geometry : null;
  }
  
  return zones;
}

module.exports = { loadZones, generateBaselineSchedules };
