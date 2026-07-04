const path = require('path');
const { loadStoreLocations } = require('./optimizer');
const api = require('./route_15_6_api');

async function test() {
    const storeLocations = loadStoreLocations(path.join(__dirname, 'Winmart Phú Thọ.xlsx'));
    const file = path.join(__dirname, 'GHN. 20260618 Trucking Plan DC Phú Thọ.xlsb.xlsx');
    
    const result = await api.run(file, storeLocations, 2);
    console.log("Total stops:", result.totalStops);
    console.log("Total weight:", result.totalWeight);
    console.log("Routes:");
    result.routes.forEach(r => {
        console.log(`- ${r.vehicleId}: ${r.numStops} stops, weight: ${r.totalWeight}kg`);
        r.schedule.forEach(s => {
            console.log(`  * ${s.storeName} (${s.address})`);
        });
    });
}
test().catch(console.error);
