const path = require('path');
const { loadStoreLocations } = require('../optimizer');
const api = require('../route_15_6_api');

async function test() {
  const storeLocations = loadStoreLocations(path.join(__dirname, '..', 'Winmart Phú Thọ.xlsx'));
  const file = path.join(__dirname, '..', 'GHN. 20260618 Trucking Plan DC Phú Thọ.xlsb.xlsx');
  
  const result = await api.run(file, storeLocations, 2);
  console.log('Number of routes:', result.routes.length);
  const route = result.routes[0];
  console.log('Route 0 vehicleId:', route.vehicleId);
  console.log('Schedule length:', route.schedule.length);
  
  const stop = route.schedule[0];
  console.log('First stop info:', {
    storeName: stop.storeName,
    soList: stop.soList,
    doList: stop.doList
  });
}

test().catch(console.error);
