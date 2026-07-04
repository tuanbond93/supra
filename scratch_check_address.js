const { loadStoreLocations } = require('./optimizer');
const path = require('path');
const storeLocations = loadStoreLocations(path.join(__dirname, 'Winmart Phú Thọ.xlsx'));
for (const [code, loc] of Object.entries(storeLocations)) {
  if (loc.name && loc.name.includes('965 Hùng Vương')) {
    console.log(code, loc);
  }
}
