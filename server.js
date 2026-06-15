const express = require('express');
const path = require('path');
const fs = require('fs');
const { CONFIG, loadStoreLocations, loadDailyOrders, buildDayStops, optimizeDay, analyzeHistory, optimizeVehiclePlan } = require('./optimizer');

const app = express();
const PORT = 3000;
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Pre-load data
const mainFile = path.join(__dirname, 'Winmart Phú Thọ.xlsx');
const histFile = path.join(__dirname, 'Data tháng 4.xlsx');
let storeLocations, historyData;

try {
  storeLocations = loadStoreLocations(mainFile);
  console.log(`📍 Loaded ${Object.keys(storeLocations).length} store location entries`);
} catch (e) { console.error('Cannot load store locations:', e.message); }

try {
  historyData = loadDailyOrders(histFile);
  console.log(`📅 Loaded ${historyData.orders.length} orders across ${historyData.dates.length} days`);
} catch (e) { console.error('Cannot load history:', e.message); }

// API: Get available dates
app.get('/api/dates', (req, res) => {
  if (!historyData) return res.json({ success: false, error: 'No history data' });
  const dates = historyData.dates.map(d => {
    const dayOrders = historyData.byDate[d];
    return {
      date: d,
      orderCount: dayOrders.length,
      storeCount: [...new Set(dayOrders.map(o => o.store))].length,
      totalKg: Math.round(dayOrders.reduce((s, o) => s + o.weightKg, 0)),
      totalCbm: Math.round(dayOrders.reduce((s, o) => s + o.cbm, 0) * 10) / 10,
    };
  });
  res.json({ success: true, data: dates });
});

// API: Optimize a specific date
app.get('/api/optimize/:date', async (req, res) => {
  try {
    const date = req.params.date;
    if (!historyData?.byDate[date]) return res.status(404).json({ success: false, error: `No data for ${date}` });
    console.log(`\n🚛 Optimizing ${date}...`);
    const { stops, unmatched } = buildDayStops(historyData.byDate[date], storeLocations);
    if (unmatched.length) console.log(`   ⚠️ ${unmatched.length} stores without coordinates`);
    
    let zoneMapping = {};
    try {
      const zm = require('./zone_manager');
      zoneMapping = zm.loadZones(path.join(__dirname, 'Danh sách Winmart - NV chia tuyến.xlsx'), storeLocations).storeToZone;
    } catch(e) { console.log('Cannot load zone mapping', e.message); }
    
    const result = await optimizeDay(stops, zoneMapping);
    result.date = date;
    result.unmatchedStores = unmatched;
    fs.writeFileSync(path.join(__dirname, 'route_result.json'), JSON.stringify(result, null, 2));
    res.json({ success: true, data: result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

const { optimizeGeographic } = require('./geo_optimizer');

// API: Geographic Optimization (Opened / Unopened areas, 6h time constraint)
app.get('/api/geo-optimize', async (req, res) => {
  try {
    console.log(`\n🌍 Running Geographic Optimization (Khu vực Đã mở/Chưa mở)...`);
    const areasFile = path.join(__dirname, 'Khu vực đã mở.xlsx');
    const result = await optimizeGeographic(mainFile, areasFile);
    res.json({ success: true, data: result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// API: Get saved result
app.get('/api/results', (req, res) => {
  const p = path.join(__dirname, 'route_result.json');
  if (fs.existsSync(p)) res.json({ success: true, data: JSON.parse(fs.readFileSync(p, 'utf-8')) });
  else res.json({ success: false, error: 'No saved results' });
});

const { loadZones, generateBaselineSchedules } = require('./zone_manager');
const staffFile = path.join(__dirname, 'Danh sách Winmart - NV chia tuyến.xlsx');

// API: Get static zone list and baseline routes (Danh sách Tuyến)
app.get('/api/zones', async (req, res) => {
  try {
    const cachePath = path.join(__dirname, 'zone_baseline_result.json');
    if (fs.existsSync(cachePath)) {
      return res.json({ success: true, data: JSON.parse(fs.readFileSync(cachePath, 'utf-8')) });
    }
    console.log(`\n📋 Generating Baseline Zone Schedules...`);
    const zones = await generateBaselineSchedules(staffFile, storeLocations);
    fs.writeFileSync(cachePath, JSON.stringify(zones, null, 2));
    res.json({ success: true, data: zones });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Load the store-to-zone mapping so optimizeDay can use it
try {
  loadZones(staffFile, storeLocations); // initializes zoneCache inside zone_manager
} catch(e) { console.error('Cannot load zones mapping:', e.message); }

// API: History analysis
app.get('/api/history', (req, res) => {
  try {
    const cachePath = path.join(__dirname, 'history_result.json');
    if (fs.existsSync(cachePath)) return res.json({ success: true, data: JSON.parse(fs.readFileSync(cachePath, 'utf-8')) });
    if (!historyData) return res.json({ success: false, error: 'No history data' });
    const zm = require('./zone_manager');
    let zmData = {};
    try {
      zmData = zm.loadZones(path.join(__dirname, 'Danh sách Winmart - NV chia tuyến.xlsx'), storeLocations).storeToZone;
    } catch(e) {}
    const result = analyzeHistory(historyData, storeLocations, zmData);
    fs.writeFileSync(cachePath, JSON.stringify(result, null, 2));
    res.json({ success: true, data: result });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// API: Get available plan files
app.get('/api/files', (req, res) => {
  try {
    const planDir = path.join(__dirname, 'Kế hoạch xe');
    if (!fs.existsSync(planDir)) {
        return res.json({ success: true, data: [] });
    }
    const files = fs.readdirSync(planDir).filter(f => f.endsWith('.xlsb') || f.endsWith('.xlsx'));
    res.json({ success: true, data: files });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
const multer = require('multer');
const os = require('os');
const upload = multer({ dest: os.tmpdir() });
const historyManager = require('./history_manager');

// Load latest plan on startup
const latestPlanFile = process.env.VERCEL ? '/tmp/latest_plan.json' : path.join(__dirname, 'latest_plan.json');
if (fs.existsSync(latestPlanFile)) {
  try {
    const data = JSON.parse(fs.readFileSync(latestPlanFile, 'utf8'));
    global.latestPlanResult = data.result;
    global.latestPlanDate = data.date;
  } catch(e) { console.error('Cannot load latest plan:', e.message); }
}

app.get('/api/latest-plan', (req, res) => {
  if (global.latestPlanResult) {
    res.json({ success: true, data: global.latestPlanResult, date: global.latestPlanDate });
  } else {
    res.json({ success: false, error: 'Chưa có kế hoạch nào' });
  }
});

app.post('/api/plan', upload.single('planFile'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'Vui lòng chọn file Kế hoạch xe' });
    }
    const numInternal = 2; // Hardcoded default
    const selectedFile = req.file.originalname;
    const targetFile = req.file.path;
    
    console.log(`\n🚚 Processing Uploaded Plan: ${selectedFile}...`);
    
    let result;
    if (selectedFile.includes('15.6') || selectedFile.includes('15 ')) {
      console.log(`   🔄 Áp dụng logic tách cụm Việt Trì (GXT) cho ngày 15.6`);
      result = await require('./route_15_6_api').run(targetFile, storeLocations, numInternal);
    } else {
      result = await optimizeVehiclePlan(targetFile, storeLocations, numInternal);
    }
    
    try { fs.unlinkSync(targetFile); } catch(e) {}
    
    // Extract date from filename
    let dateStr = new Date().toISOString().split('T')[0];
    const match1 = selectedFile.match(/(\d{4})(\d{2})(\d{2})/);
    if (match1) {
        dateStr = `${match1[1]}-${match1[2]}-${match1[3]}`;
    } else {
        const match2 = selectedFile.match(/(\d{1,2})\.(\d{1,2})/);
        if (match2) {
            dateStr = `2026-${match2[2].padStart(2, '0')}-${match2[1].padStart(2, '0')}`;
        }
    }
    
    const wasOverwritten = historyManager.recordPlanVolume(dateStr, result.routes);
    historyManager.recordUploadLog(req.body.uploaderEmail, selectedFile, req.ip, dateStr);
    
    global.latestPlanResult = result;
    global.latestPlanDate = dateStr;
    fs.writeFileSync(latestPlanFile, JSON.stringify({ result, date: dateStr }));
    
    res.json({ success: true, data: result, wasOverwritten: wasOverwritten });
  } catch (err) {
    console.error(err);
    if (req.file) {
       try { fs.unlinkSync(req.file.path); } catch(e) {}
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

function generateExcelBuffer(data) {
  const XLSX = require('xlsx');
  const rows = [];
  
  data.routes.forEach(r => {
    const depot = r._depot || data.depot;
    rows.push({
      'Biển số / Loại xe': r.vehicleId,
      'Thứ tự': 'Bắt đầu',
      'Mã CH': '',
      'Tên Cửa Hàng': depot.name,
      'Địa chỉ': 'Kho xuất phát',
      'Khoảng cách (km)': 0,
      'Thời gian đến': r.departureTime,
      'Trọng lượng (kg)': '',
      'Thể tích (m3)': ''
    });
    
    r.schedule.forEach(s => {
      rows.push({
        'Biển số / Loại xe': r.vehicleId,
        'Thứ tự': s.order,
        'Mã CH': s.storeId,
        'Tên Cửa Hàng': s.storeName,
        'Địa chỉ': s.address,
        'Khoảng cách (km)': s.distance,
        'Thời gian đến': s.arrivalTime,
        'Trọng lượng (kg)': s.weight,
        'Thể tích (m3)': s.cbm
      });
    });
    
    rows.push({
      'Biển số / Loại xe': r.vehicleId,
      'Thứ tự': 'Kết thúc',
      'Mã CH': '',
      'Tên Cửa Hàng': depot.name,
      'Địa chỉ': 'Về kho',
      'Khoảng cách (km)': '',
      'Thời gian đến': r.returnTime,
      'Trọng lượng (kg)': '',
      'Thể tích (m3)': ''
    });
    rows.push({}); // Empty row for separation
  });
  
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "KeHoachLoTrinh");
  
  const doGanRows = [];
  result.routes.forEach(r => {
      r.schedule.forEach(s => {
          if (s.soList && s.soList.length > 0) {
              s.soList.forEach(so => {
                  doGanRows.push({
                      'Tên cửa hàng': s.storeName,
                      'SO_GXT_PTO': `${so}__GXT_PTO`
                  });
              });
          }
      });
  });
  
  if (doGanRows.length > 0) {
      const wsDoGan = XLSX.utils.json_to_sheet(doGanRows);
      XLSX.utils.book_append_sheet(wb, wsDoGan, "DO Gán");
  }

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

app.get('/api/export-plan', (req, res) => {
  try {
    const data = global.latestPlanResult;
    if (!data || !data.routes) {
        return res.status(404).send('Chưa có dữ liệu lộ trình. Vui lòng Tính toán & Đề xuất trước.');
    }
    
    const buffer = generateExcelBuffer(data);
    
    const dlDate = global.latestPlanDate || new Date().toISOString().split('T')[0];
    res.setHeader('Content-Disposition', `attachment; filename="ke_hoach_xe_supra_${dlDate}.xlsx"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
  } catch (err) {
    console.error(err);
    res.status(500).send('Lỗi khi xuất file: ' + err.message);
  }
});

app.get('/api/trend', (req, res) => {
  try {
    const data = historyManager.getHistory();
    res.json({ success: true, data });
  } catch(err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/upload-log', (req, res) => {
  try {
    const data = historyManager.getUploadLogs();
    res.json({ success: true, data });
  } catch(err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/config', (req, res) => res.json(CONFIG));

// ==========================================
// TELEGRAM WEBHOOK INTEGRATION
// ==========================================
app.post('/api/telegram-webhook', async (req, res) => {
  try {
    const message = req.body.message;
    if (!message || !message.document) return res.sendStatus(200);

    const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    if (!TELEGRAM_TOKEN) {
      console.warn('Missing TELEGRAM_BOT_TOKEN');
      return res.sendStatus(200);
    }

    const chatId = message.chat.id;
    const doc = message.document;
    
    // Accept Excel files
    if (!doc.file_name.endsWith('.xlsx') && !doc.file_name.endsWith('.xlsb')) {
      return res.sendStatus(200);
    }

    // 1. Send initial response
    const sendMsg = async (text, useHtml = false) => {
      const payload = { chat_id: chatId, text };
      if (useHtml) payload.parse_mode = 'HTML';
      await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).catch(e => console.error(e));
    };

    await sendMsg(`Đang tải và phân tích file: ${doc.file_name}...`);

    // 2. Download file
    const fileRes = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/getFile?file_id=${doc.file_id}`);
    const fileJson = await fileRes.json();
    if (!fileJson.ok) throw new Error('Cannot get file from Telegram');
    
    const filePath = fileJson.result.file_path;
    const downloadRes = await fetch(`https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${filePath}`);
    
    const os = require('os');
    const tempFile = path.join(os.tmpdir(), doc.file_name);
    
    const arrayBuffer = await downloadRes.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    fs.writeFileSync(tempFile, buffer);

    try {
      // 3. Process the file
      const fileDateMatch = doc.file_name.match(/(\d{8})/);
      let dateStr;
      if (fileDateMatch) {
          const fileDateStr = fileDateMatch[1];
          dateStr = `${fileDateStr.slice(0,4)}-${fileDateStr.slice(4,6)}-${fileDateStr.slice(6,8)}`;
      } else {
          const match2 = doc.file_name.match(/(\d{1,2})\.(\d{1,2})/);
          if (match2) {
              dateStr = `2026-${match2[2].padStart(2, '0')}-${match2[1].padStart(2, '0')}`;
          } else {
              throw new Error("Tên file không chứa ngày hợp lệ.");
          }
      }
      
      const numInternal = 2;
      let result;
      if (doc.file_name.includes('15.6') || doc.file_name.includes('15 ')) {
          result = await require('./route_15_6_api').run(tempFile, storeLocations, numInternal);
      } else {
          result = await optimizeVehiclePlan(tempFile, storeLocations, numInternal);
      }
      
      // 4. Update history
      const wasOverwritten = historyManager.recordPlanVolume(dateStr, result.routes);
      const emailLabel = message.from.username ? `@${message.from.username}` : 'Telegram User';
      historyManager.recordUploadLog(`Telegram: ${emailLabel}`, doc.file_name, 'bot', dateStr);

      // Save to latest plan
      global.latestPlanResult = result;
      global.latestPlanDate = dateStr;
      fs.writeFileSync(latestPlanFile, JSON.stringify({ result, date: dateStr }));

      // 5. Send success message (Summary)
      let summaryText = `✅ Đã xử lý thành công ngày ${dateStr}!\n`;
      if (wasOverwritten) summaryText += `⚠️ (Dữ liệu cũ đã bị ghi đè)\n\n`;
      summaryText += `📊 Thống kê:\n- Tổng Điểm Giao: ${result.totalStops}\n- Tổng Xe Điều: ${result.totalVehiclesUsed}\n- Tổng KL: ${result.totalWeight}kg\n\n📍 CHI TIẾT LỘ TRÌNH:`;
      await sendMsg(summaryText);
      
      // Send detailed routes in chunks to avoid 4096 char limit
      for (let i = 0; i < result.routes.length; i++) {
         const r = result.routes[i];
         const depot = r._depot || result.depot;
         let routeText = `<b>🚛 Xe ${i+1} (${r.vehicleId})</b>\n`;
         let mapUrl = `https://www.google.com/maps/dir/${depot.lat},${depot.lng}`;
         
         r.schedule.forEach((s) => {
            const kl = Math.round(s.weight);
            const cbm = Math.round(s.cbm * 10) / 10;
            const sName = s.storeName.replace(/&/g, 'và').replace(/</g, '').replace(/>/g, '');
            routeText += `🔹 ${s.arrivalTime} - ${sName} (${kl}kg, ${cbm}m³)\n`;
            mapUrl += `/${s.lat},${s.lng}`;
         });
         
         mapUrl += `/${depot.lat},${depot.lng}`;
         routeText += `\n🗺 <a href="${mapUrl}">Chi tiết lộ trình</a>\n`;
         
         await sendMsg(routeText, true);
      }
      
      // 6. Send Excel file
      const excelBuffer = generateExcelBuffer(result);
      const blob = new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const formData = new FormData();
      formData.append('chat_id', chatId);
      formData.append('document', blob, `ke_hoach_lo_trinh_${dateStr.replace(/-/g,'')}.xlsx`);
      
      await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendDocument`, {
        method: 'POST',
        body: formData
      }).catch(e => console.error('Error sending document', e));

      fs.unlinkSync(tempFile);
    } catch(err) {
      await sendMsg(`❌ Lỗi xử lý: ${err.message}`);
      if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
    }

    res.sendStatus(200);
  } catch(e) {
    console.error('Webhook error:', e);
    res.sendStatus(200);
  }
});

app.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`🚀 Supra v3 Optimizer is running at: http://localhost:${PORT}`);
  console.log(`======================================================\n`);
});

module.exports = app;
