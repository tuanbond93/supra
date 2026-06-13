const fs = require('fs');
const path = require('path');

const HISTORY_FILE = process.env.VERCEL ? '/tmp/history.json' : path.join(__dirname, 'history.json');
const LOG_FILE = process.env.VERCEL ? '/tmp/upload_log.json' : path.join(__dirname, 'upload_log.json');

function getHistory() {
    if (fs.existsSync(HISTORY_FILE)) {
        try { return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')); } catch(e) { return {}; }
    }
    return {};
}

function saveHistory(data) {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function recordPlanVolume(dateStr, routes) {
    const history = getHistory();
    const wasOverwritten = !!history[dateStr];
    
    // Chống trùng lặp: Reset lại data của ngày này trước khi ghi đè
    history[dateStr] = {};
    
    routes.forEach(route => {
        if (route.schedule) {
            route.schedule.forEach(stop => {
                const store = stop.storeName || stop.storeId;
                if (!store) return;
                if (!history[dateStr][store]) {
                    history[dateStr][store] = { w: 0, c: 0 };
                }
                history[dateStr][store].w += stop.weight || 0;
                history[dateStr][store].c += stop.cbm || 0;
            });
        }
    });
    
    saveHistory(history);
    return wasOverwritten;
}

function getUploadLogs() {
    if (fs.existsSync(LOG_FILE)) {
        try { return JSON.parse(fs.readFileSync(LOG_FILE, 'utf8')); } catch(e) { return []; }
    }
    return [];
}

function recordUploadLog(email, filename, ip, dateStr) {
    const logs = getUploadLogs();
    logs.unshift({
        timestamp: new Date().toISOString(),
        email: email || 'Ẩn danh',
        filename: filename,
        ip: ip,
        planDate: dateStr
    });
    // Giữ lại 100 log gần nhất
    if (logs.length > 100) logs.length = 100;
    fs.writeFileSync(LOG_FILE, JSON.stringify(logs, null, 2), 'utf8');
}

module.exports = {
    getHistory,
    recordPlanVolume,
    getUploadLogs,
    recordUploadLog
};
