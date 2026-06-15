/**
 * SUPRA Route Optimizer v3 — Dashboard Controller
 * Kế hoạch xe (Vehicle Plan)
 */

const ROUTE_COLORS = ['#6366f1','#22c55e','#f59e0b','#ef4444','#06b6d4','#ec4899','#a855f7','#14b8a6','#f97316','#8b5cf6','#10b981','#f43f5e','#0ea5e9','#d946ef','#84cc16'];
let planMap = null, planRouteLayers = {}, planMarkerLayers = {}, currentPlanData = null, activePlanRoute = null;
let currentUserEmail = '';
window.storeHistoryData = {};
window.storeChartInstances = {};

// ============================================================
// AUTH LOGIC
// ============================================================
function submitEmailLogin() {
  const emailInput = document.getElementById('user-email-input').value.trim();
  if (!emailInput || !emailInput.includes('@')) {
    alert('Vui lòng nhập địa chỉ Email hợp lệ!');
    return;
  }
  currentUserEmail = emailInput;
  document.getElementById('login-overlay').style.display = 'none';
}

// ============================================================
// TABS LOGIC
// ============================================================
function switchTab(tabId) {
  document.querySelectorAll('.tab-content, main').forEach(el => {
    if (el.id.startsWith('tab-')) el.classList.add('hidden');
  });
  document.getElementById(tabId).classList.remove('hidden');
  
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.style.color = 'var(--text-secondary)';
    btn.style.borderBottomColor = 'transparent';
  });
  const activeBtn = Array.from(document.querySelectorAll('.tab-btn')).find(b => b.getAttribute('onclick').includes(tabId));
  if (activeBtn) {
    activeBtn.style.color = 'var(--accent-teal)';
    activeBtn.style.borderBottomColor = 'var(--accent-teal)';
  }

  if (tabId === 'tab-trend') {
    loadTrendData();
  } else if (tabId === 'tab-log') {
    loadUploadLogs();
  }
}

async function loadUploadLogs() {
  const container = document.getElementById('log-content');
  container.innerHTML = '<p style="color:var(--text-secondary);">Đang tải dữ liệu...</p>';
  try {
    const res = await fetch('/api/upload-log');
    const json = await res.json();
    if (!json.success) throw new Error(json.error);
    
    if (json.data.length === 0) {
      container.innerHTML = '<p style="color:var(--text-secondary);">Chưa có lịch sử upload nào.</p>';
      return;
    }

    let html = `
      <table style="width:100%; border-collapse: collapse; text-align: left;">
        <thead>
          <tr style="border-bottom: 1px solid var(--border-color); color: var(--text-secondary);">
            <th style="padding: 12px;">Thời gian</th>
            <th style="padding: 12px;">Email / IP</th>
            <th style="padding: 12px;">Kế hoạch</th>
            <th style="padding: 12px;">File tải lên</th>
          </tr>
        </thead>
        <tbody>
    `;

    json.data.forEach(log => {
      const dt = new Date(log.timestamp).toLocaleString('vi-VN');
      html += `
        <tr style="border-bottom: 1px solid var(--border-color);">
          <td style="padding: 12px;">${dt}</td>
          <td style="padding: 12px; font-weight:600; color:var(--accent-teal);">${log.email}<br><small style="color:var(--text-secondary);font-weight:normal">${log.ip}</small></td>
          <td style="padding: 12px;">${log.planDate}</td>
          <td style="padding: 12px;">${log.filename}</td>
        </tr>
      `;
    });

    html += `</tbody></table>`;
    container.innerHTML = html;
  } catch(e) {
    container.innerHTML = `<p style="color:#ef4444;">Lỗi tải dữ liệu: ${e.message}</p>`;
  }
}

window.toggleStoreDetail = function(storeId) {
  const el = document.getElementById('detail-' + storeId);
  if (!el) return;
  el.classList.toggle('hidden');

  // Lazy render chart if not hidden and chart not yet created
  if (!el.classList.contains('hidden')) {
    const canvasId = 'mini-chart-' + storeId;
    const ctx = document.getElementById(canvasId);
    if (ctx && !window.storeChartInstances[storeId]) {
       const stats = window.storeHistoryData[storeId];
       if (!stats) return;
       const dates = Object.keys(stats.history).sort();
       const wData = dates.map(d => Math.round(stats.history[d].w));
       const cData = dates.map(d => Math.round(stats.history[d].c));

       window.storeChartInstances[storeId] = new Chart(ctx, {
          type: 'line',
          data: {
             labels: dates,
             datasets: [
                { label: 'Khối lượng (kg)', data: wData, borderColor: '#3b82f6', backgroundColor: '#3b82f6', yAxisID: 'y' },
                { label: 'Thể tích (m³)', data: cData, borderColor: '#f59e0b', backgroundColor: '#f59e0b', yAxisID: 'y1' }
             ]
          },
          options: {
             responsive: true,
             maintainAspectRatio: false,
             plugins: { legend: { display: false } },
             scales: {
                y: { display: false, position: 'left' },
                y1: { display: false, position: 'right', grid: { drawOnChartArea: false } }
             }
          }
       });
    }
  }
};

async function loadTrendData() {
  const container = document.getElementById('trend-content');
  container.innerHTML = '<p style="color:var(--text-secondary);">Đang tải dữ liệu...</p>';
  try {
    const res = await fetch('/api/trend');
    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'Unknown error');
    
    if (Object.keys(json.data).length === 0) {
      container.innerHTML = '<p style="color:var(--text-secondary);">Chưa có dữ liệu lịch sử. Hãy tải lên các kế hoạch xe để hệ thống ghi nhận.</p>';
      return;
    }

    const dates = Object.keys(json.data).sort();
    
    // Aggregate for Chart
    const dailyWeight = [];
    const dailyCbm = [];
    const storeStats = {};

    dates.forEach(date => {
      let dayW = 0, dayC = 0;
      const dayData = json.data[date];
      Object.keys(dayData).forEach(store => {
        dayW += dayData[store].w;
        dayC += dayData[store].c;
        if (!storeStats[store]) storeStats[store] = { totalW: 0, totalC: 0, daysActive: 0, history: {} };
        storeStats[store].totalW += dayData[store].w;
        storeStats[store].totalC += dayData[store].c;
        storeStats[store].daysActive += 1;
        storeStats[store].history[date] = dayData[store];
      });
      dailyWeight.push(Math.round(dayW));
      dailyCbm.push(Math.round(dayC));
    });

    // Render Chart
    const ctx = document.getElementById('trend-chart');
    if (window.trendChartInstance) window.trendChartInstance.destroy();
    window.trendChartInstance = new Chart(ctx, {
      type: 'line',
      data: {
        labels: dates,
        datasets: [
          { label: 'Tổng Khối Lượng (kg)', data: dailyWeight, borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,0.1)', tension: 0.3, yAxisID: 'y', fill: true },
          { label: 'Tổng Thể Tích (m³)', data: dailyCbm, borderColor: '#f59e0b', backgroundColor: 'rgba(245,158,11,0.1)', tension: 0.3, yAxisID: 'y1', fill: true }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: { type: 'linear', display: true, position: 'left', title: {display: true, text: 'Khối lượng (kg)'} },
          y1: { type: 'linear', display: true, position: 'right', grid: { drawOnChartArea: false }, title: {display: true, text: 'Thể tích (m³)'} }
        }
      }
    });

    const sortedStores = Object.entries(storeStats).sort((a, b) => b[1].totalW - a[1].totalW);
    // Lưu vào global variable để lazy render mini chart
    window.storeHistoryData = {};
    sortedStores.forEach(([k, v]) => { window.storeHistoryData[k.replace(/[^a-zA-Z0-9]/g, '')] = v; });

    let html = `
      <table style="width:100%; border-collapse: collapse; text-align: left;">
        <thead>
          <tr style="border-bottom: 2px solid var(--border-color); color: var(--text-secondary);">
            <th style="padding: 12px;">Cửa hàng / Siêu thị</th>
            <th style="padding: 12px;">Số ngày h.động</th>
            <th style="padding: 12px;">Tổng Khối Lượng (kg)</th>
            <th style="padding: 12px;">Tổng Thể Tích (m³)</th>
            <th style="padding: 12px;">Trung bình/ngày (kg)</th>
          </tr>
        </thead>
        <tbody>
    `;

    sortedStores.forEach(([store, stats], idx) => {
      const avg = Math.round(stats.totalW / stats.daysActive);
      const isHighVolume = avg > 500 && stats.daysActive >= 2;
      const highlightStyle = isHighVolume ? 'background: rgba(239, 68, 68, 0.1); color: #ef4444; font-weight: bold;' : '';
      const badge = isHighVolume ? '<span style="margin-left:8px; background:#ef4444; color:white; padding:2px 6px; border-radius:4px; font-size:0.7rem;">HOT</span>' : '';
      const safeId = store.replace(/[^a-zA-Z0-9]/g, '');

      html += `
        <tr style="border-bottom: 1px solid var(--border-color); cursor:pointer; ${highlightStyle}" onclick="toggleStoreDetail('${safeId}')">
          <td style="padding: 12px;">${store} ${badge} <span style="font-size:0.8rem;color:var(--accent-teal)">▼</span></td>
          <td style="padding: 12px;">${stats.daysActive}</td>
          <td style="padding: 12px;">${Math.round(stats.totalW).toLocaleString()}</td>
          <td style="padding: 12px;">${Math.round(stats.totalC).toLocaleString()}</td>
          <td style="padding: 12px;">${avg.toLocaleString()}</td>
        </tr>
        <tr id="detail-${safeId}" class="hidden" style="background: rgba(0,0,0,0.02);">
          <td colspan="5" style="padding:0;">
            <div style="padding:24px; border-bottom:1px solid var(--border-color); display:flex; gap:24px; align-items:flex-start;">
              <div style="flex:1;">
                 <h4 style="margin-bottom:12px; color:var(--text-secondary);">Biểu đồ theo ngày</h4>
                 <div style="height:200px; background:white; border-radius:8px; padding:12px; border:1px solid var(--border-color);">
                    <canvas id="mini-chart-${safeId}"></canvas>
                 </div>
              </div>
              <div style="flex:1;">
                <h4 style="margin-bottom:12px; color:var(--text-secondary);">Chi tiết số liệu</h4>
                <table style="width:100%; border-collapse:collapse; font-size:0.9rem; background:white; border-radius:8px; overflow:hidden; border:1px solid var(--border-color);">
                  <tr style="background:var(--bg-primary); color:var(--text-secondary); border-bottom:1px solid var(--border-color);">
                     <th style="padding:10px 12px;">Ngày</th><th style="padding:10px 12px;">Khối lượng (kg)</th><th style="padding:10px 12px;">Thể tích (m³)</th>
                  </tr>
                  ${Object.keys(stats.history).sort().map(d => `<tr><td style="padding:10px 12px;border-bottom:1px solid var(--border-color);">${d}</td><td style="padding:10px 12px;border-bottom:1px solid var(--border-color);">${stats.history[d].w.toLocaleString()}</td><td style="padding:10px 12px;border-bottom:1px solid var(--border-color);">${stats.history[d].c.toLocaleString()}</td></tr>`).join('')}
                </table>
              </div>
            </div>
          </td>
        </tr>
      `;
    });

    html += `</tbody></table>`;
    container.innerHTML = html;
  } catch (err) {
    container.innerHTML = `<p style="color:#ef4444;">Lỗi tải dữ liệu: ${err.message}</p>`;
  }
}

// ============================================================
// PLAN TAB LOGIC
// ============================================================
async function runPlanOptimizer() {
  const fileInput = document.getElementById('plan-file-upload');
  if (!fileInput.files || fileInput.files.length === 0) {
      alert('Vui lòng chọn file Kế hoạch xe trước khi phân tích!');
      return;
  }
  const file = fileInput.files[0];

  const btn = document.getElementById('btn-plan-optimize');
  const overlay = document.getElementById('loading-overlay');
  const badge = document.getElementById('status-badge');
  btn.disabled = true; overlay.classList.remove('hidden');
  badge.textContent = '● Đang phân tích...'; badge.className = 'badge badge-running';

  const steps = ['Đọc file Kế hoạch xe...', 'Gom cụm xe nhà...', 'Tìm đường tối ưu...', 'Tính toán lộ trình...'];
  let si = 0;
  const iv = setInterval(() => { si = (si + 1) % steps.length; document.getElementById('loading-text').textContent = steps[si]; }, 2000);

  try {
    const formData = new FormData();
    formData.append('planFile', file);
    formData.append('uploaderEmail', currentUserEmail);
    
    const res = await fetch('/api/plan', {
        method: 'POST',
        body: formData
    });
    const json = await res.json();
    clearInterval(iv);
    if (json.success) { 
        currentPlanData = json.data; 
        renderPlanDashboard(currentPlanData); 
        badge.textContent = '● Hoàn tất'; badge.className = 'badge badge-live'; 
        const exportBtn = document.getElementById('btn-export-excel');
        if (exportBtn) exportBtn.classList.remove('hidden');
        
        if (json.wasOverwritten) {
            alert('Cảnh báo: Dữ liệu của ngày này đã tồn tại trên hệ thống. Bản ghi cũ đã bị ghi đè để tránh trùng lặp!');
        }
    }
    else { alert('Lỗi: ' + json.error); badge.textContent = '● Lỗi'; }
  } catch (err) { clearInterval(iv); alert('Lỗi: ' + err.message); badge.textContent = '● Lỗi'; }
  finally { btn.disabled = false; overlay.classList.add('hidden'); }
}

function renderPlanDashboard(data) {
  anim('plan-total-stops', data.totalStops);
  anim('plan-total-vehicles', data.totalVehiclesUsed);
  anim('plan-total-distance', data.totalDistance.toFixed(0) + ' km');
  anim('plan-total-weight', data.totalWeight.toFixed(0) + ' kg');
  anim('plan-total-cbm', data.totalCbm.toFixed(1) + ' m³');

  const bar = document.getElementById('plan-alert-bar');
  if (data.warnings && data.warnings.length) {
    bar.innerHTML = '⚠️ ' + data.warnings.join('<br>⚠️ ');
    bar.classList.remove('hidden');
  } else { bar.classList.add('hidden'); }

  renderPlanMap(data);
  
  const c = document.getElementById('plan-vehicle-tabs'); c.innerHTML = '';
  data.routes.forEach((r, i) => {
    const t = document.createElement('div'); 
    t.className = 'vehicle-tab'; 
    t.textContent = r.vehicleId;
    // Highlight internal vehicles
    if (r.vehicleId.includes('Xe nhà')) {
        t.style.fontWeight = '700';
    }
    if (r.isOverTime || r.weightFillPercent > 100 || r.cbmFillPercent > 100) t.innerHTML += ' ⚠️';
    t.addEventListener('click', () => selectPlanRoute(i)); 
    c.appendChild(t);
  });
  
  if (data.routes.length > 0) selectPlanRoute(0);
}

function renderPlanMap(data) {
  if (!planMap) {
      planMap = L.map('plan-map', { center: [21.326576980287744, 105.32489178650769], zoom: 10 });
      L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>', maxZoom: 19,
      }).addTo(planMap);
      document.querySelector('.leaflet-tile-pane').style.filter = 'none';
  }

  Object.values(planRouteLayers).forEach(l => planMap.removeLayer(l));
  Object.values(planMarkerLayers).forEach(l => planMap.removeLayer(l));
  planRouteLayers = {}; planMarkerLayers = {};

  const depotIcon = L.divIcon({ className: '', html: '<div class="depot-marker">🏭</div>', iconSize: [32, 32], iconAnchor: [16, 16] });
  L.marker([data.depot.lat, data.depot.lng], { icon: depotIcon }).addTo(planMap)
    .bindPopup(`<div class="popup-title">🏭 ${data.depot.name}</div><div class="popup-detail">Kho xuất phát | 13:00</div>`, { className: 'custom-popup' });

  const drawnDepots = new Set([`${data.depot.lat},${data.depot.lng}`]);
  data.routes.forEach(route => {
    if (route._depot && !drawnDepots.has(`${route._depot.lat},${route._depot.lng}`)) {
      drawnDepots.add(`${route._depot.lat},${route._depot.lng}`);
      L.marker([route._depot.lat, route._depot.lng], { icon: depotIcon }).addTo(planMap)
        .bindPopup(`<div class="popup-title">🏭 ${route._depot.name}</div><div class="popup-detail">Kho xuất phát riêng | 13:00</div>`, { className: 'custom-popup' });
    }
  });

  const bounds = L.latLngBounds([[data.depot.lat, data.depot.lng]]);
  const legend = document.getElementById('plan-legend-items'); legend.innerHTML = '';

  data.routes.forEach((route, idx) => {
    const color = ROUTE_COLORS[idx % ROUTE_COLORS.length];
    let polyline;
    if (route.routeGeometry) {
      polyline = L.geoJSON(route.routeGeometry, { style: { color, weight: 4, opacity: 0.8 } }).addTo(planMap);
    } else {
      const startDepot = route._depot || data.depot;
      const coords = [[startDepot.lat, startDepot.lng], ...route.schedule.map(s => [s.lat, s.lng]), [startDepot.lat, startDepot.lng]];
      polyline = L.polyline(coords, { color, weight: 4, opacity: 0.8, dashArray: '8, 6' }).addTo(planMap);
    }
    
    // Fix Leaflet tile loading issue on resize/init
    setTimeout(() => {
        planMap.invalidateSize();
    }, 100);
    
    planRouteLayers[idx] = polyline;

    const markers = L.layerGroup();
    route.schedule.forEach((stop, si) => {
      const icon = L.divIcon({ className: '', html: `<div class="stop-marker" style="background:${color}">${si + 1}</div>`, iconSize: [22, 22], iconAnchor: [11, 11] });
      L.marker([stop.lat, stop.lng], { icon })
        .bindPopup(`<div class="popup-title">${stop.storeName}</div><div class="popup-detail">🕐 ${stop.arrivalTime} | 📏 ${stop.distance} km | ⚖️ ${stop.weight} kg | 📦 ${stop.cbm} m³</div>`, { className: 'custom-popup' })
        .addTo(markers);
      bounds.extend([stop.lat, stop.lng]);
    });
    markers.addTo(planMap); planMarkerLayers[idx] = markers;

    const li = document.createElement('div'); li.className = 'legend-item';
    li.innerHTML = `<div class="legend-dot" style="background:${color}"></div><span style="${route.vehicleId.includes('Xe nhà') ? 'font-weight:700' : ''}">${route.vehicleId} (${route.numStops} điểm)</span>`;
    li.addEventListener('click', () => selectPlanRoute(idx));
    legend.appendChild(li);
  });

  planMap.fitBounds(bounds, { padding: [30, 30] });
}

function selectPlanRoute(idx) {
  activePlanRoute = idx;
  const color = ROUTE_COLORS[idx % ROUTE_COLORS.length];

  document.querySelectorAll('#plan-vehicle-tabs .vehicle-tab').forEach((t, i) => {
    if (i === idx) { t.classList.add('active'); t.style.background = color; t.style.borderColor = 'transparent'; t.style.color = '#fff'; }
    else { t.classList.remove('active'); t.style.background = ''; t.style.borderColor = ''; t.style.color = ''; }
  });
  document.querySelectorAll('#plan-legend-items .legend-item').forEach((it, i) => it.classList.toggle('dimmed', i !== idx));

  Object.entries(planRouteLayers).forEach(([k, l]) => {
    const i = parseInt(k);
    if (l.setStyle) l.setStyle({ opacity: i === idx ? 0.9 : 0.15, weight: i === idx ? 5 : 2 });
    else l.eachLayer(sub => sub.setStyle?.({ opacity: i === idx ? 0.9 : 0.15, weight: i === idx ? 5 : 2 }));
    if (i === idx && l.bringToFront) l.bringToFront();
  });
  Object.entries(planMarkerLayers).forEach(([k, l]) => { const i = parseInt(k); l.eachLayer(m => m.setOpacity(i === idx ? 1 : 0.2)); });

  renderPlanRouteDetails(currentPlanData.routes[idx], idx);
  const rl = planRouteLayers[idx];
  if (rl) {
    try { planMap.fitBounds(rl.getBounds(), { padding: [50, 50], maxZoom: 13 }); } catch(e) {}
  }
}

function renderPlanRouteDetails(route, idx) {
  const c = document.getElementById('plan-route-details');
  const color = ROUTE_COLORS[idx % ROUTE_COLORS.length];
  
  let html = `<div class="route-summary animate-in">
    <div class="route-metric"><div class="label">Loại xe</div><div class="value" style="color:var(--accent-teal);font-weight:700">${route.vehicleId}</div></div>
    <div class="route-metric"><div class="label">Quãng đường</div><div class="value">${route.totalDistance} km</div></div>
    <div class="route-metric"><div class="label">Thời gian</div><div class="value ${route.isOverTime ? 'text-red-500' : ''}">${route.totalWorkHours}h ${route.isOverTime ? '⚠️' : ''}</div></div>
    <div class="route-metric"><div class="label">Số điểm</div><div class="value">${route.numStops}</div></div>
    <div class="route-metric"><div class="label">Xuất phát → Về</div><div class="value" style="font-size:0.85rem">${route.departureTime} → ${route.returnTime}</div></div>`;

  const wFill = route.weightFillPercent, cFill = route.cbmFillPercent;
  const wCol = wFill > 90 ? '#ef4444' : wFill > 70 ? '#f59e0b' : '#22c55e';
  const cCol = cFill > 90 ? '#ef4444' : cFill > 70 ? '#f59e0b' : '#22c55e';
  html += `
  <div style="grid-column: span 2;">
  <div class="fill-bar-container">
    <div class="fill-bar-label"><span>⚖️ Tải: ${route.totalWeight} kg / 1,900 kg</span><span style="color:${wCol};font-weight:700">${wFill}%</span></div>
    <div class="fill-bar"><div class="fill-bar-inner" style="width:${Math.min(wFill,100)}%;background:${wCol}"></div></div>
  </div>
  <div class="fill-bar-container" style="margin-top:8px;">
    <div class="fill-bar-label"><span>📦 Thể tích: ${route.totalCbm} m³ / 12 m³</span><span style="color:${cCol};font-weight:700">${cFill}%</span></div>
    <div class="fill-bar"><div class="fill-bar-inner" style="width:${Math.min(cFill,100)}%;background:${cCol}"></div></div>
  </div></div></div><ul class="stop-list">`;

  route.schedule.forEach((stop, i) => {
    html += `<li class="stop-item animate-in" style="animation-delay:${i*25}ms" onclick="planMap.setView([${stop.lat}, ${stop.lng}], 15, { animate: true })">
      <div class="stop-number" style="background:${color}">${i+1}</div>
      <div class="stop-info">
        <div class="stop-name" title="${stop.storeName}">${stop.storeName}</div>
        <div class="stop-meta"><span>📏 ${stop.distance} km</span><span>⚖️ ${stop.weight} kg</span><span>📦 ${stop.cbm} m³</span></div>
      </div>
      <div class="stop-time">${stop.arrivalTime}</div>
    </li>`;
  });
  c.innerHTML = html + '</ul>';
}

function anim(id, val) { const el = document.getElementById(id); if (el) { el.textContent = val; el.closest('.stat-card')?.classList.add('animate-in'); } }

// ============================================================
// INIT
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
  renderPlanMap({ depot: {lat: 21.326576980287744, lng: 105.32489178650769, name: 'Kho Xuất Phát'}, routes: [] });
  
  // Load latest plan if exists
  try {
    const res = await fetch('/api/latest-plan');
    const json = await res.json();
    if (json.success && json.data) {
        currentPlanData = json.data;
        renderPlanDashboard(currentPlanData);
        
        const badge = document.getElementById('status-badge');
        if (badge) {
            badge.textContent = '● Hoàn tất (Đã lưu: ' + json.date + ')';
            badge.className = 'badge badge-live';
        }
        
        const exportBtn = document.getElementById('btn-export-excel');
        if (exportBtn) exportBtn.classList.remove('hidden');
    }
  } catch(e) {
      console.log('No previous plan found or error loading it:', e);
  }
});
