const express = require('express');
const path = require('path');
const fs = require('fs');

// Auto-load .env if present
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split(/\r?\n/).forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx !== -1) {
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim().replace(/^["'](.*)["']$/, '$1');
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  });
}

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
    console.log(`   🔄 Áp dụng logic tách cụm Việt Trì (GXT)`);
    delete require.cache[require.resolve('./route_15_6_api')];
    result = await require('./route_15_6_api').run(targetFile, storeLocations, numInternal);
    
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
  const wb = XLSX.utils.book_new();
  
  function getProvinceAbbreviation(prov) {
    if (!prov) return 'PTO';
    const low = prov.toLowerCase();
    if (low.includes('phú thọ') || low.includes('phu tho')) return 'PTO';
    if (low.includes('sơn la') || low.includes('son la')) return 'SLA';
    if (low.includes('điện biên') || low.includes('dien bien')) return 'DBN';
    if (low.includes('lai châu') || low.includes('lai chau')) return 'LCA';
    
    const norm = prov.normalize('NFD').replace(/[\u0300-\u036f]/g, "").toUpperCase();
    const parts = norm.split(/\s+/).filter(Boolean);
    if (parts.length === 0) return 'PTO';
    if (parts.length >= 3) {
      return parts.map(p => p[0]).join('').slice(0, 3);
    } else if (parts.length === 2) {
      return parts[0][0] + parts[1][0] + (parts[1][1] || 'A');
    } else {
      return parts[0].slice(0, 3);
    }
  }

  const routesByProvince = {};
  data.routes.forEach(r => {
    const prov = r.province || 'Phú Thọ';
    if (!routesByProvince[prov]) routesByProvince[prov] = [];
    routesByProvince[prov].push(r);
  });
  
  Object.keys(routesByProvince).forEach(prov => {
    const provinceRoutes = routesByProvince[prov];
    const rows = [];
    
    provinceRoutes.forEach(r => {
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
    const sheetName = `Lộ trình - ${prov}`.slice(0, 31);
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  });
  
  const doGanRows = [];
  data.routes.forEach(r => {
      const prov = r.province || 'Phú Thọ';
      const abbr = getProvinceAbbreviation(prov);
      r.schedule.forEach(s => {
          const listToUse = s.soList || [];
          listToUse.forEach(item => {
              doGanRows.push({
                  'Tỉnh': prov,
                  'Tên cửa hàng': s.storeName,
                  [`SO_GXT_${abbr}`]: `${item}_GXT_${abbr}`
              });
          });
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
// TELEGRAM HELPERS & KEYBOARDS
// ==========================================
const cron = require('node-cron');
const { fetchLatestPlanMail, markEmailAnswered } = require('./mail_sync');

const MAIN_KEYBOARD = {
  keyboard: [
    [{ text: '🔄 Đồng bộ kế hoạch từ Mail' }]
  ],
  resize_keyboard: true,
  is_persistent: true
};

const SYNC_INLINE_KEYBOARD = {
  inline_keyboard: [
    [{ text: '🔄 Đồng bộ lại từ Mail', callback_data: 'sync_mail' }]
  ]
};

async function getTelegramSyncedState() {
  const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  if (!TELEGRAM_TOKEN) return '';
  try {
    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/getMyShortDescription`);
    const json = await res.json();
    if (json.ok && json.result && json.result.short_description) {
      return json.result.short_description;
    }
  } catch(e) {
    console.warn('Error reading Telegram short_description:', e.message);
  }
  return '';
}

async function setTelegramSyncedState(val) {
  const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  if (!TELEGRAM_TOKEN || !val) return;
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/setMyShortDescription`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ short_description: String(val).slice(0, 120) })
    });
  } catch(e) {
    console.warn('Error setting Telegram short_description:', e.message);
  }
}

async function isDuplicatePlanPersistent(fileName, messageId, isImapAnswered = false) {
  // 1. Kiểm tra cờ IMAP vĩnh viễn trên Gmail
  if (isImapAnswered) return true;

  // 2. Kiểm tra bộ nhớ đồng bộ vĩnh viễn trên Telegram Bot
  const tgState = await getTelegramSyncedState();
  if (tgState && fileName && tgState.includes(fileName)) {
    return true;
  }

  // 3. Kiểm tra local historyManager
  if (historyManager.checkIsDuplicatePlan(fileName) || (messageId && historyManager.checkIsDuplicatePlan(messageId))) {
    return true;
  }

  // 4. Nhận diện file 20260909 GHN đã chạy thành công trong group trước đó
  if (fileName && fileName.includes('20260909 GHN')) {
    return true;
  }

  return false;
}

async function sendTelegramMessage(chatId, text, useHtml = false, replyMarkup = null) {
  const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  if (!TELEGRAM_TOKEN || !chatId) return;
  const payload = { chat_id: chatId, text };
  if (useHtml) payload.parse_mode = 'HTML';
  if (replyMarkup) payload.reply_markup = replyMarkup;
  return await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }).catch(e => console.error('Telegram sendMessage error:', e));
}

async function sendTelegramDocument(chatId, buffer, filename, caption = '') {
  const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  if (!TELEGRAM_TOKEN || !chatId) return;
  const boundary = '----TelegramBotBoundary' + Math.random().toString(36).substring(2);
  const chunks = [];
  chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${chatId}\r\n`));
  if (caption) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\n${caption}\r\n`));
  }
  chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="document"; filename="${filename}"\r\nContent-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n`));
  chunks.push(buffer);
  chunks.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  const multipartBody = Buffer.concat(chunks);

  const sendDocRes = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendDocument`, {
    method: 'POST',
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': String(multipartBody.length)
    },
    body: multipartBody
  });
  if (!sendDocRes.ok) {
    const errText = await sendDocRes.text();
    console.error('Telegram sendDocument failed:', errText);
    throw new Error(`Telegram API sendDocument failed: ${errText}`);
  }
}

async function executePlanProcessing(targetFile, originalFileName, uploaderLabel, targetChatId = null) {
  // 1. Extract date from filename
  let dateStr = new Date().toISOString().split('T')[0];
  const fileDateMatch = originalFileName.match(/(\d{8})/);
  if (fileDateMatch) {
    const s = fileDateMatch[1];
    dateStr = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  } else {
    const match2 = originalFileName.match(/(\d{1,2})\.(\d{1,2})/);
    if (match2) {
      dateStr = `2026-${match2[2].padStart(2, '0')}-${match2[1].padStart(2, '0')}`;
    }
  }

  const numInternal = 2;
  delete require.cache[require.resolve('./route_15_6_api')];
  const result = await require('./route_15_6_api').run(targetFile, storeLocations, numInternal);

  // 2. Update history
  const wasOverwritten = historyManager.recordPlanVolume(dateStr, result.routes);
  historyManager.recordUploadLog(uploaderLabel, originalFileName, 'system', dateStr);

  global.latestPlanResult = result;
  global.latestPlanDate = dateStr;
  fs.writeFileSync(latestPlanFile, JSON.stringify({ result, date: dateStr }));

  // 3. Format message (chỉ gửi tóm tắt và tỷ lệ tỉnh, KHÔNG gửi lộ trình chi tiết)
  let summaryText = `✅ Đã xử lý thành công ngày ${dateStr}!\n`;
  if (wasOverwritten) summaryText += `⚠️ (Dữ liệu cũ đã bị ghi đè)\n\n`;
  summaryText += `📊 Thống kê:\n- Tổng Điểm Giao: ${result.totalStops}\n- Tổng Xe Điều: ${result.totalVehiclesUsed}\n- Tổng KL: ${result.totalWeight}kg\n\n`;

  if (result.provinceReport && result.provinceReport.length > 0) {
    summaryText += `📈 Tỷ lệ hoàn thành theo tỉnh:\n`;
    result.provinceReport.forEach(rep => {
      summaryText += `- ${rep.province}: Đã chạy ${rep.storePercent}% số CH (${rep.activeStores}/${rep.totalStores} CH), ${rep.weightPercent}% khối lượng (${Math.round(rep.activeWeight)}/${Math.round(rep.totalWeight)} kg)\n`;
    });
  }

  // 4. Generate Excel with "DO Gán" sheet
  const excelBuffer = generateExcelBuffer(result);
  const outFilename = `ke_hoach_lo_trinh_${dateStr.replace(/-/g, '')}.xlsx`;

  if (targetChatId) {
    await sendTelegramMessage(targetChatId, summaryText, false, SYNC_INLINE_KEYBOARD);
    await sendTelegramDocument(targetChatId, excelBuffer, outFilename, `📥 File kế hoạch gán đơn ngày ${dateStr}`);
  }

  return { result, dateStr, wasOverwritten, summaryText, excelBuffer, outFilename };
}

async function handleMailSyncTrigger(chatId, force = false) {
  historyManager.saveTelegramChat(chatId);
  await sendTelegramMessage(chatId, '⏳ Đang kết nối hòm thư và tìm kiếm email kế hoạch xe mới nhất từ DC Phú Thọ...');
  try {
    const mailResult = await fetchLatestPlanMail();

    // Kiểm tra trùng lặp bền vững (IMAP flag + Telegram Bot State + Filename)
    const isDup = !force && await isDuplicatePlanPersistent(
      mailResult.fileName,
      mailResult.messageId,
      mailResult.isImapAnswered
    );

    if (isDup) {
      try { fs.unlinkSync(mailResult.filePath); } catch (e) {}
      await sendTelegramMessage(
        chatId,
        `⚠️ <b>Thông báo trùng kế hoạch:</b>\n\n` +
        `Email mới nhất (<i>"${mailResult.emailSubject}"</i>)\n` +
        `📎 File: <code>${mailResult.fileName}</code>\n\n` +
        `ℹ️ Kế hoạch này <b>đã được xử lý và gửi trước đó rồi</b>. Hệ thống không gửi lại để tránh trùng lặp đơn gán!\n\n` +
        `<i>(Mẹo: Gõ lệnh <code>/force_sync</code> nếu bạn vẫn muốn ép chạy lại kế hoạch này)</i>`,
        true,
        SYNC_INLINE_KEYBOARD
      );
      return;
    }

    await sendTelegramMessage(
      chatId,
      `📧 Đã tìm thấy email mới: <b>${mailResult.emailSubject}</b>\n📎 File đính kèm: <code>${mailResult.fileName}</code>\nĐang tiến hành phân tích & tạo file gán đơn...`,
      true
    );

    const planRes = await executePlanProcessing(
      mailResult.filePath,
      mailResult.fileName,
      `Mail: ${mailResult.emailSender || 'DC Phú Thọ'}`,
      chatId
    );

    // Đánh dấu đã đồng bộ (cả Local, Telegram State và IMAP Flag)
    historyManager.markPlanSynced(mailResult.fileName, { date: planRes.dateStr, subject: mailResult.emailSubject });
    if (mailResult.messageId) {
      historyManager.markPlanSynced(mailResult.messageId, { date: planRes.dateStr, fileName: mailResult.fileName });
    }
    await setTelegramSyncedState(`SYNCED:${mailResult.fileName}`);
    if (mailResult.uid) {
      await markEmailAnswered(mailResult.uid);
    }

    try { fs.unlinkSync(mailResult.filePath); } catch (e) {}
  } catch (err) {
    console.error('Mail sync error:', err);
    await sendTelegramMessage(
      chatId,
      `❌ Không thể đồng bộ từ Mail:\n${err.message}\n\n💡 Bạn vẫn có thể gửi trực tiếp file Excel kế hoạch xe vào bot này bất cứ lúc nào!`,
      false,
      SYNC_INLINE_KEYBOARD
    );
  }
}

async function triggerDailySync() {
  console.log('⏰ Triggering 12:00 PM Daily Mail Sync...');
  const chats = historyManager.getTelegramChats();
  if (chats.length === 0) {
    console.log('No Telegram chat subscribers registered for 12:00 sync.');
    return { success: false, error: 'Chưa có nhóm hoặc người dùng nào đăng ký nhận tin tự động.' };
  }

  try {
    const mailResult = await fetchLatestPlanMail();
    console.log(`Found mail: ${mailResult.emailSubject} (${mailResult.fileName})`);

    // Kiểm tra trùng lặp lúc 12h trưa
    const isDup = await isDuplicatePlanPersistent(
      mailResult.fileName,
      mailResult.messageId,
      mailResult.isImapAnswered
    );

    if (isDup) {
      try { fs.unlinkSync(mailResult.filePath); } catch (e) {}
      console.log(`[12h Cron] File ${mailResult.fileName} already processed. Skipping re-send.`);
      for (const cid of chats) {
        try {
          await sendTelegramMessage(
            cid,
            `ℹ️ <b>[Tự động 12h trưa]</b>\n` +
            `Kế hoạch xe trong email mới nhất (<code>${mailResult.fileName}</code>) <b>đã được đồng bộ trước đó rồi</b>.\n` +
            `Bot không gửi lại file để tránh trùng lặp đơn gán!`,
            true,
            SYNC_INLINE_KEYBOARD
          );
        } catch (e) {}
      }
      return { success: true, duplicate: true, fileName: mailResult.fileName };
    }

    const primaryChat = chats[0];
    const planRes = await executePlanProcessing(
      mailResult.filePath,
      mailResult.fileName,
      `AutoSync 12h: ${mailResult.emailSender || 'DC Phú Thọ'}`,
      primaryChat
    );

    historyManager.markPlanSynced(mailResult.fileName, { date: planRes.dateStr, subject: mailResult.emailSubject });
    if (mailResult.messageId) {
      historyManager.markPlanSynced(mailResult.messageId, { date: planRes.dateStr, fileName: mailResult.fileName });
    }
    await setTelegramSyncedState(`SYNCED:${mailResult.fileName}`);
    if (mailResult.uid) {
      await markEmailAnswered(mailResult.uid);
    }

    for (let i = 1; i < chats.length; i++) {
      const cid = chats[i];
      try {
        await sendTelegramMessage(cid, planRes.summaryText, false, SYNC_INLINE_KEYBOARD);
        await sendTelegramDocument(cid, planRes.excelBuffer, planRes.outFilename, `📥 File kế hoạch gán đơn ngày ${planRes.dateStr}`);
      } catch (e) {
        console.error(`Error sending to chat ${cid}:`, e.message);
      }
    }

    try { fs.unlinkSync(mailResult.filePath); } catch (e) {}
    return { success: true, date: planRes.dateStr, totalStops: planRes.result.totalStops };
  } catch (err) {
    console.error('Daily 12h sync failed:', err);
    for (const cid of chats) {
      try {
        await sendTelegramMessage(cid, `⚠️ Tự động đồng bộ lúc 12h trưa gặp lỗi: ${err.message}`, false, SYNC_INLINE_KEYBOARD);
      } catch (e) {}
    }
    return { success: false, error: err.message };
  }
}

// Endpoint for Vercel Cron or external triggers
app.get('/api/cron-sync', async (req, res) => {
  const result = await triggerDailySync();
  res.json(result);
});

// Register local 12:00 PM schedule (Asia/Ho_Chi_Minh)
try {
  cron.schedule('0 12 * * *', () => {
    console.log('⏰ [Cron] Running daily 12:00 PM sync task...');
    triggerDailySync();
  }, {
    timezone: 'Asia/Ho_Chi_Minh'
  });
  console.log('⏰ Registered daily 12:00 PM cron job (Asia/Ho_Chi_Minh)');
} catch (e) {
  console.warn('Could not register node-cron schedule:', e.message);
}

// ==========================================
// TELEGRAM WEBHOOK INTEGRATION
// ==========================================
app.post('/api/telegram-webhook', async (req, res) => {
  try {
    const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    if (!TELEGRAM_TOKEN) {
      return res.sendStatus(200);
    }

    // 1. Handle Inline button callbacks
    if (req.body.callback_query) {
      const cb = req.body.callback_query;
      const chatId = cb.message && cb.message.chat ? cb.message.chat.id : null;
      fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/answerCallbackQuery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callback_query_id: cb.id })
      }).catch(() => {});

      if (cb.data === 'sync_mail' && chatId) {
        handleMailSyncTrigger(chatId);
      }
      return res.sendStatus(200);
    }

    const message = req.body.message;
    if (!message) return res.sendStatus(200);

    const chatId = message.chat.id;
    historyManager.saveTelegramChat(chatId);

    // 2. Handle text messages & commands
    if (message.text) {
      const text = message.text.trim();
      if (text.startsWith('/start') || text.startsWith('/help')) {
        await sendTelegramMessage(
          chatId,
          `Xin chào! Tôi là <b>Supra Route Bot</b> 🚚\n\n` +
          `• Bấm nút <b>"🔄 Đồng bộ kế hoạch từ Mail"</b> bên dưới để lấy file kế hoạch mới nhất từ email khách hàng lúc 12h và xuất file gán đơn.\n` +
          `• Hoặc bạn có thể <b>gửi trực tiếp file Excel kế hoạch (.xlsx / .xlsb)</b> vào đây bất cứ lúc nào!`,
          true,
          MAIN_KEYBOARD
        );
        return res.sendStatus(200);
      }

      if (text.startsWith('/force_sync') || text.startsWith('/sync_force')) {
        await handleMailSyncTrigger(chatId, true);
        return res.sendStatus(200);
      }

      if (text === '🔄 Đồng bộ kế hoạch từ Mail' || text.startsWith('/sync') || text.startsWith('/dongbo') || text.includes('Đồng bộ')) {
        await handleMailSyncTrigger(chatId);
        return res.sendStatus(200);
      }
    }

    // 3. Handle document upload (direct Excel upload)
    if (message.document) {
      const doc = message.document;
      if (!doc.file_name.endsWith('.xlsx') && !doc.file_name.endsWith('.xlsb')) {
        return res.sendStatus(200);
      }

      // Kiểm tra trùng lặp file gửi trực tiếp
      const isDup = await isDuplicatePlanPersistent(doc.file_name);
      if (isDup) {
        await sendTelegramMessage(
          chatId,
          `⚠️ <b>Thông báo trùng file:</b>\n` +
          `File <code>${doc.file_name}</code> đã được xử lý trên hệ thống trước đó rồi.\n` +
          `Bot không gửi lại file để tránh trùng lặp đơn gán!`,
          true,
          SYNC_INLINE_KEYBOARD
        );
        return res.sendStatus(200);
      }

      await sendTelegramMessage(chatId, `Đang tải và phân tích file: <code>${doc.file_name}</code>...`, true);

      // Download file from Telegram
      const fileRes = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/getFile?file_id=${doc.file_id}`);
      const fileJson = await fileRes.json();
      if (!fileJson.ok) throw new Error('Cannot get file from Telegram');

      const filePath = fileJson.result.file_path;
      const downloadRes = await fetch(`https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${filePath}`);

      const tempFile = path.join(os.tmpdir(), doc.file_name);
      const arrayBuffer = await downloadRes.arrayBuffer();
      fs.writeFileSync(tempFile, Buffer.from(arrayBuffer));

      const emailLabel = message.from && message.from.username
        ? `@${message.from.username}`
        : (message.from && message.from.first_name ? message.from.first_name : 'Telegram User');

      try {
        const planRes = await executePlanProcessing(tempFile, doc.file_name, `Telegram: ${emailLabel}`, chatId);
        historyManager.markPlanSynced(doc.file_name, { date: planRes.dateStr });
        await setTelegramSyncedState(`SYNCED:${doc.file_name}`);
        try { fs.unlinkSync(tempFile); } catch (e) {}
      } catch (err) {
        console.error('Processing error:', err);
        await sendTelegramMessage(chatId, `❌ Lỗi xử lý: ${err.message}`, false, SYNC_INLINE_KEYBOARD);
        if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
      }

      return res.sendStatus(200);
    }

    res.sendStatus(200);
  } catch (e) {
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

