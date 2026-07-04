const { loadStoreLocations } = require('./optimizer');
const path = require('path');
const storeLocations = loadStoreLocations(path.join(__dirname, 'Winmart Phú Thọ.xlsx'));
console.log("Checking 965 Hung Vuong...");
for (const [key, loc] of Object.entries(storeLocations)) {
  if (key.includes('965')) {
    console.log("Found key:", key);
    console.log("Data:", loc);
  }
}
