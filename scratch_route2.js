const { loadStoreLocations, CONFIG } = require('./optimizer');
const path = require('path');

async function run() {
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
    "WM+ 130 Lê Quý Đôn",
    "WM VCP PTO Việt Trì",
    "WM+ PTO 439 Tiên Dung",
    "WM+ PTO 1343 Hùng Vương",
    "WM+ PTO 1250 Hùng Vương",
    "WM+ PTO Tổ 26A Hai Bà Trưng",
    "WM+ PTO Thành Công, Việt Trì",
    "WM+ PTO 107 Bạch Hạc",
    "WM+ PTO Băng 1, Nguyễn Tất Thành"
  ];

  const stops = [];
  for (const name of targetStores) {
    let match = null;
    for (const [key, loc] of Object.entries(locations)) {
      if (key.toLowerCase().includes(name.toLowerCase()) || name.toLowerCase().includes(key.toLowerCase())) {
        match = { name: name, lat: loc.lat, lng: loc.lng };
        break;
      }
    }
    if (match) stops.push(match);
  }

  const allPoints = [CONFIG.DEPOT, ...stops];
  const coords = allPoints.map(p => `${p.lng},${p.lat}`).join(';');
  const url = `https://router.project-osrm.org/trip/v1/driving/${coords}?source=first&roundtrip=true&geometries=geojson`;
  
  const res = await fetch(url);
  const data = await res.json();
  
  if (data.code === 'Ok') {
    const orderedStops = [];
    data.waypoints.forEach((wp, idx) => {
      orderedStops.push({
        seq: wp.waypoint_index,
        name: allPoints[idx].name || 'Kho Supra'
      });
    });
    orderedStops.sort((a, b) => a.seq - b.seq);
    let out = orderedStops.map(wp => {
      return `${wp.seq === 0 ? 'Bắt đầu' : 'Điểm ' + wp.seq}: ${wp.name}`;
    });
    console.log(out.join('\n'));
    console.log(`\nTổng quãng đường: ${(data.trips[0].distance / 1000).toFixed(2)} km`);
    console.log(`Tổng thời gian di chuyển: ${(data.trips[0].duration / 60).toFixed(0)} phút`);
  } else {
    console.log("Error from OSRM", data);
  }
}

run();
