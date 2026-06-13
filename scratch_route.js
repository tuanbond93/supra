const { loadStoreLocations, CONFIG } = require('./optimizer');
const path = require('path');

const mainFile = path.join(__dirname, 'Winmart Phú Thọ.xlsx');
const locations = loadStoreLocations(mainFile);

const targetStores = [
  "WM+ PTO 545 Trần Phú",
  "WM+ PTO 12 Tổ 5 Trần Phú",
  "WM+ PTO Khu Tân An, Tân Dân",
  "WM+ PTO 192-194 Trần Phú, Việt Trì",
  "WM+ PTO 66 Hàn Thuyên",
  "WM+ PTO 35 Hà Chương",
  "WM+ PTO 476 Châu Phong",
  "WM+ PTO Đồng Gia, Việt Trì",
  "WM+ 130 Lê Quý Đôn, Việt Trì, PT",
  "WM VCP PTO Việt Trì",
  "WM+ PTO 439 Tiên Dung",
  "WM+ PTO 1343 Hùng Vương",
  "WM+ PTO 1250 Hùng Vương",
  "WM+ PTO 965 Hùng Vương",
  "WM+ PTO Tổ 26A Hai Bà Trưng",
  "WM+ PTO Thành Công, Việt Trì",
  "WM+ PTO 107 Bạch Hạc",
  "WM+ PTO Băng 1, Nguyễn Tất Thành"
];

const found = [];
const notFound = [];

for (const name of targetStores) {
  // Simple search
  let match = null;
  for (const [key, loc] of Object.entries(locations)) {
    if (key.toLowerCase().includes(name.toLowerCase()) || name.toLowerCase().includes(key.toLowerCase())) {
      match = { name: key, ...loc };
      break;
    }
  }
  if (match) {
    found.push(match);
  } else {
    notFound.push(name);
  }
}

console.log(JSON.stringify({ found, notFound }, null, 2));
