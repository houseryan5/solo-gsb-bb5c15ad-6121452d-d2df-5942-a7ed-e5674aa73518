'use strict';

/* 临时施工区域冲突分析台前端：SVG 地图渲染（无外部依赖，离线可用）+ 分析交互 */

const $ = (s) => document.querySelector(s);

const PALETTE = ['#2563eb', '#059669', '#d97706', '#dc2626', '#7c3aed', '#0891b2', '#db2777', '#65a30d', '#ea580c', '#4f46e5'];
const CONFLICT_COLOR = '#e11d48';
const SVG_NS = 'http://www.w3.org/2000/svg';

const state = {
  geojson: null,
  result: null,
  layers: [],
  activeLayers: new Set(),
  layerColor: {},
  selectedConflictId: null,
  k: 1,          // 经度缩放系数 cos(中纬度)
  viewBox: null, // 当前 SVG viewBox {x, y, w, h}
};

const svg = $('#map');

/* ---------- 工具 ---------- */

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function fmtArea(a) {
  if (a >= 1e6) return `${(a / 1e6).toFixed(3)} km²`;
  return `${Math.round(a).toLocaleString('zh-CN')} m²`;
}

let toastTimer = null;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 3000);
}

function el(tag) {
  return document.createElementNS(SVG_NS, tag);
}

/* ---------- 投影与视图 ---------- */

function eachCoord(geom, cb) {
  if (!geom) return;
  const polys = geom.type === 'Polygon' ? [geom.coordinates]
    : geom.type === 'MultiPolygon' ? geom.coordinates : [];
  for (const poly of polys) for (const ring of poly) for (const c of ring) cb(c);
}

const project = (lon, lat) => [lon * state.k, -lat];

function geomToPath(geom) {
  const polys = geom.type === 'Polygon' ? [geom.coordinates]
    : geom.type === 'MultiPolygon' ? geom.coordinates : [];
  return polys.map((poly) => poly.map((ring) =>
    ring.map(([lon, lat], i) => {
      const [x, y] = project(lon, lat);
      return `${i ? 'L' : 'M'}${x.toFixed(7)},${y.toFixed(7)}`;
    }).join('') + 'Z'
  ).join('')).join('');
}

function applyViewBox() {
  const v = state.viewBox;
  if (v) svg.setAttribute('viewBox', `${v.x} ${v.y} ${v.w} ${v.h}`);
}

function fitView(geom) {
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
  const scan = (g) => eachCoord(g, ([lon, lat]) => {
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  });

  if (geom) {
    scan(geom);
    state.k = Math.cos(((minLat + maxLat) / 2) * Math.PI / 180) || 1;
  } else {
    (state.geojson ? state.geojson.features : []).forEach((f) => scan(f.geometry));
    (state.result ? state.result.conflicts : []).forEach((c) => scan(c.geometry));
    if (!isFinite(minLon)) { minLon = 116.3; maxLon = 116.5; minLat = 39.8; maxLat = 40; }
    state.k = Math.cos(((minLat + maxLat) / 2) * Math.PI / 180) || 1;
  }

  const [x0, y1] = project(minLon, minLat);
  const [x1, y0] = project(maxLon, maxLat);
  const w = Math.max(x1 - x0, 1e-9);
  const h = Math.max(y1 - y0, 1e-9);
  const pad = Math.max(w, h) * (geom ? 0.35 : 0.08);
  state.viewBox = { x: x0 - pad, y: y0 - pad, w: w + 2 * pad, h: h + 2 * pad };
  applyViewBox();
}

/* ---------- 地图渲染 ---------- */

function renderMap() {
  svg.innerHTML = '';
  if (!state.geojson) return;

  const gZones = el('g');
  const gConf = el('g');
  svg.append(gZones, gConf);

  state.geojson.features.forEach((f, i) => {
    if (!f.geometry) return;
    const layer = String((f.properties && f.properties.layer) || '未分组');
    const color = state.layerColor[layer] || '#64748b';
    const p = el('path');
    p.setAttribute('d', geomToPath(f.geometry));
    p.setAttribute('fill', color);
    p.setAttribute('fill-opacity', state.activeLayers.has(layer) ? '0.30' : '0.05');
    p.setAttribute('stroke', color);
    p.setAttribute('stroke-width', '1');
    p.setAttribute('vector-effect', 'non-scaling-stroke');
    p.classList.add('zone-path');
    p.addEventListener('mousemove', (e) => showTip(e, zoneTip(f, i)));
    p.addEventListener('mouseleave', hideTip);
    gZones.appendChild(p);
  });

  (state.result ? state.result.conflicts : []).forEach((c) => {
    const selected = c.id === state.selectedConflictId;
    const p = el('path');
    p.setAttribute('d', geomToPath(c.geometry));
    p.setAttribute('fill', CONFLICT_COLOR);
    p.setAttribute('fill-opacity', selected ? '0.8' : '0.5');
    p.setAttribute('stroke', selected ? '#881337' : '#9f1239');
    p.setAttribute('stroke-width', selected ? '2.5' : '1.2');
    p.setAttribute('vector-effect', 'non-scaling-stroke');
    p.classList.add('conflict-path');
    p.addEventListener('click', () => selectConflict(c.id, false));
    p.addEventListener('mousemove', (e) => showTip(e, conflictTip(c)));
    p.addEventListener('mouseleave', hideTip);
    gConf.appendChild(p);
  });
}

function zoneTip(f, i) {
  const p = f.properties || {};
  return `<b>${escapeHtml(p.name || `区域 ${i + 1}`)}</b><br>` +
    `图层：${escapeHtml(p.layer || '未分组')}<br>` +
    `有效期：${escapeHtml(p.start || '?')} ~ ${escapeHtml(p.end || '?')}`;
}

function conflictTip(c) {
  return `<b>冲突 ${c.id}</b>　${fmtArea(c.area)}<br>` +
    c.zones.map((z) => escapeHtml(z.name)).join(' × ') + '<br>' +
    `重叠期：${c.overlapStart} ~ ${c.overlapEnd}`;
}

function showTip(e, html) {
  const tip = $('#tooltip');
  const wrap = svg.parentElement.getBoundingClientRect();
  tip.innerHTML = html;
  tip.classList.remove('hidden');
  tip.style.left = `${e.clientX - wrap.left + 12}px`;
  tip.style.top = `${e.clientY - wrap.top + 12}px`;
}

function hideTip() {
  $('#tooltip').classList.add('hidden');
}

function renderLegend() {
  const box = $('#legend');
  if (!state.layers.length) { box.innerHTML = ''; return; }
  box.innerHTML = state.layers.map((l) =>
    `<span class="legend-item"><i style="background:${state.layerColor[l]}"></i>${escapeHtml(l)}</span>`
  ).join('') + (state.result && state.result.conflicts.length
    ? `<span class="legend-item"><i style="background:${CONFLICT_COLOR}"></i>冲突交集</span>` : '');
}

/* ---------- 图层筛选 ---------- */

function collectLayers() {
  const set = new Set();
  (state.geojson ? state.geojson.features : []).forEach((f) => {
    set.add(String((f.properties && f.properties.layer) || '未分组'));
  });
  state.layers = [...set];
  state.layers.forEach((l, i) => { state.layerColor[l] = PALETTE[i % PALETTE.length]; });
  state.activeLayers = new Set(state.layers);
}

function renderLayerList() {
  const box = $('#layerList');
  if (!state.layers.length) {
    box.innerHTML = '<span class="muted small">导入数据后显示图层</span>';
    return;
  }
  box.innerHTML = state.layers.map((l) =>
    `<label class="layer-item">
       <input type="checkbox" data-layer="${escapeHtml(l)}" ${state.activeLayers.has(l) ? 'checked' : ''}>
       <i style="background:${state.layerColor[l]}"></i>${escapeHtml(l)}
     </label>`
  ).join('');
  box.querySelectorAll('input').forEach((cb) => {
    cb.addEventListener('change', () => {
      if (cb.checked) state.activeLayers.add(cb.dataset.layer);
      else state.activeLayers.delete(cb.dataset.layer);
      renderMap();
      renderLegend();
    });
  });
}

/* ---------- 数据导入 ---------- */

function setGeojson(fc, sourceLabel) {
  if (!fc || !Array.isArray(fc.features)) {
    toast('数据不是有效的 FeatureCollection');
    return;
  }
  state.geojson = fc;
  state.result = null;
  state.selectedConflictId = null;
  collectLayers();
  fitView();
  renderMap();
  renderLayerList();
  renderLegend();
  renderResult();

  const times = [];
  fc.features.forEach((f) => {
    const p = f.properties || {};
    const s = Date.parse(p.start);
    const e = Date.parse(p.end);
    if (!Number.isNaN(s)) times.push(s);
    if (!Number.isNaN(e)) times.push(e);
  });
  const span = times.length
    ? `，时间跨度 ${new Date(Math.min(...times)).toISOString().slice(0, 10)} ~ ${new Date(Math.max(...times)).toISOString().slice(0, 10)}`
    : '';
  $('#dataInfo').textContent = `已载入 ${sourceLabel}：${fc.features.length} 个区域，${state.layers.length} 个图层${span}`;
  toast(`已载入 ${fc.features.length} 个区域`);
}

async function loadSample() {
  try {
    const res = await fetch('/sample.geojson');
    if (!res.ok) throw new Error();
    setGeojson(await res.json(), '示例数据');
  } catch {
    toast('示例数据加载失败');
  }
}

/* ---------- 分析与结果渲染 ---------- */

async function runAnalysis() {
  if (!state.geojson) return toast('请先导入 GeoJSON 数据');
  if (!state.activeLayers.size) return toast('请至少勾选一个图层');
  const body = {
    geojson: state.geojson,
    layers: [...state.activeLayers],
    minArea: Number($('#minArea').value) || 0,
  };
  try {
    const res = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) return toast(data.error || '分析失败');
    state.result = data;
    state.selectedConflictId = null;
    fitView();
    renderMap();
    renderLegend();
    renderResult();
    toast(`分析完成：发现 ${data.conflicts.length} 处冲突`);
  } catch (err) {
    toast(`分析请求失败：${err.message}`);
  }
}

function renderResult() {
  const r = state.result;
  if (!r) {
    $('#summary').textContent = '尚未分析';
    $('#conflictList').innerHTML = '<span class="muted small">暂无冲突</span>';
    $('#clusterList').innerHTML = '<span class="muted small">暂无</span>';
    $('#warningCard').hidden = true;
    return;
  }

  const s = r.summary;
  $('#summary').innerHTML =
    `参与分析区域 <b>${s.zoneCount}</b> 个（${s.layerCount} 个图层）<br>` +
    `发现冲突 <b class="danger">${s.conflictCount}</b> 处，涉及 <b>${s.clusterCount}</b> 个冲突群组<br>` +
    `累计重叠面积 <b>${fmtArea(s.totalOverlapArea)}</b>` +
    (s.timeSpan ? `<br>数据时间跨度 ${s.timeSpan.start} ~ ${s.timeSpan.end}` : '');

  // 冲突列表
  const list = $('#conflictList');
  if (!r.conflicts.length) {
    list.innerHTML = '<span class="muted small">未发现时空重叠冲突 🎉</span>';
  } else {
    list.innerHTML = r.conflicts.map((c) => `
      <div class="conflict-item ${c.id === state.selectedConflictId ? 'active' : ''}" data-id="${c.id}">
        <div class="conflict-head">
          <span class="badge">${c.id}</span>
          <b>${fmtArea(c.area)}</b>
          <span class="muted small">${c.overlapDays} 天重叠</span>
        </div>
        <div>${c.zones.map((z) => `<span class="chip" style="border-color:${state.layerColor[z.layer] || '#999'}">${escapeHtml(z.name)}</span>`).join(' × ')}</div>
        <div class="small muted">重叠时段：${c.overlapStart} ~ ${c.overlapEnd}</div>
        <div class="small suggestion">💡 ${escapeHtml(c.suggestion.text)}</div>
      </div>`).join('');
    list.querySelectorAll('.conflict-item').forEach((item) => {
      item.addEventListener('click', () => selectConflict(item.dataset.id, true));
    });
  }

  // 冲突群组与错峰排布
  const cl = $('#clusterList');
  if (!r.clusters.length) {
    cl.innerHTML = '<span class="muted small">暂无</span>';
  } else {
    cl.innerHTML = r.clusters.map((g) => `
      <div class="cluster-item">
        <div class="conflict-head">
          <span class="badge group">${g.id}</span>
          <b>${g.zones.length} 个区域 · ${g.conflictIds.length} 处冲突</b>
          <span class="muted small">累计 ${fmtArea(g.totalOverlapArea)}</span>
        </div>
        <div class="small">涉及：${g.zones.map((z) => escapeHtml(z.name)).join('、')}</div>
        <table class="plan">
          <thead><tr><th>区域</th><th>原计划</th><th>建议计划</th><th>顺延</th></tr></thead>
          <tbody>
            ${g.plan.map((p) => `<tr class="${p.delayDays ? 'shifted' : ''}">
              <td>${escapeHtml(p.name)}</td>
              <td>${p.oldStart} ~ ${p.oldEnd}</td>
              <td>${p.newStart} ~ ${p.newEnd}</td>
              <td>${p.delayDays ? `+${p.delayDays} 天` : '—'}</td>
            </tr>`).join('')}
          </tbody>
        </table>
        <div class="small muted">群组最长顺延 ${g.maxDelayDays} 天；按上表串行排布可避开群组内全部冲突。</div>
      </div>`).join('');
  }

  // 数据警告
  const wc = $('#warningCard');
  if (r.warnings && r.warnings.length) {
    wc.hidden = false;
    $('#warnings').innerHTML = r.warnings.map((w) => `<div class="warn-item">⚠️ ${escapeHtml(w)}</div>`).join('');
  } else {
    wc.hidden = true;
  }
}

function selectConflict(id, zoom) {
  state.selectedConflictId = id;
  renderMap();
  renderResult();
  const c = (state.result ? state.result.conflicts : []).find((x) => x.id === id);
  if (c && zoom) fitView(c.geometry);
  const item = document.querySelector(`.conflict-item[data-id="${id}"]`);
  if (item) item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/* ---------- 保存 / 导出 / 读取 ---------- */

async function refreshSaved() {
  try {
    const res = await fetch('/api/analyses');
    const list = await res.json();
    const box = $('#savedList');
    if (!list.length) {
      box.innerHTML = '<span class="muted small">暂无</span>';
      return;
    }
    box.innerHTML = list.map((m) => `
      <div class="saved-item">
        <div class="saved-name" title="${escapeHtml(m.name)}">${escapeHtml(m.name)}</div>
        <div class="small muted">${m.createdAt.slice(0, 16).replace('T', ' ')} · ${m.zoneCount} 区域 · ${m.conflictCount} 冲突</div>
        <div class="row">
          <button class="btn tiny" data-act="load" data-id="${m.id}">加载</button>
          <button class="btn tiny" data-act="export" data-id="${m.id}">导出</button>
          <button class="btn tiny danger-btn" data-act="del" data-id="${m.id}">删除</button>
        </div>
      </div>`).join('');
    box.querySelectorAll('button').forEach((b) => {
      b.addEventListener('click', () => {
        if (b.dataset.act === 'load') loadSaved(b.dataset.id);
        else if (b.dataset.act === 'export') exportSaved(b.dataset.id);
        else deleteSaved(b.dataset.id);
      });
    });
  } catch {
    /* 忽略列表刷新失败 */
  }
}

async function saveAnalysis() {
  if (!state.result) return toast('请先执行分析');
  const name = $('#analysisName').value.trim() || undefined;
  try {
    const res = await fetch('/api/analyses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        geojson: state.geojson,
        params: { layers: [...state.activeLayers], minArea: Number($('#minArea').value) || 0 },
        result: state.result,
      }),
    });
    const data = await res.json();
    if (!res.ok) return toast(data.error || '保存失败');
    toast(`已保存「${data.name}」`);
    refreshSaved();
  } catch (err) {
    toast(`保存失败：${err.message}`);
  }
}

async function loadSaved(id) {
  try {
    const res = await fetch(`/api/analyses/${id}`);
    const rec = await res.json();
    if (!res.ok) return toast(rec.error || '加载失败');
    state.geojson = rec.geojson;
    state.result = rec.result;
    state.selectedConflictId = null;
    collectLayers();
    if (rec.params && Array.isArray(rec.params.layers) && rec.params.layers.length) {
      state.activeLayers = new Set(rec.params.layers.filter((l) => state.layers.includes(l)));
    }
    $('#analysisName').value = rec.name || '';
    fitView();
    renderMap();
    renderLayerList();
    renderLegend();
    renderResult();
    toast(`已加载「${rec.name}」`);
  } catch (err) {
    toast(`加载失败：${err.message}`);
  }
}

async function deleteSaved(id) {
  try {
    const res = await fetch(`/api/analyses/${id}`, { method: 'DELETE' });
    if (!res.ok) return toast('删除失败');
    toast('已删除');
    refreshSaved();
  } catch {
    toast('删除失败');
  }
}

function download(filename, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/geo+json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

async function exportCurrent() {
  if (!state.result) return toast('请先执行分析');
  try {
    const res = await fetch('/api/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: $('#analysisName').value.trim() || '未命名分析',
        geojson: state.geojson,
        result: state.result,
      }),
    });
    const report = await res.json();
    if (!res.ok) return toast(report.error || '导出失败');
    download(`conflict-report-${Date.now()}.geojson`, report);
    toast('报告已导出');
  } catch (err) {
    toast(`导出失败：${err.message}`);
  }
}

async function exportSaved(id) {
  try {
    const res = await fetch(`/api/analyses/${id}/export`);
    const report = await res.json();
    if (!res.ok) return toast(report.error || '导出失败');
    download(`conflict-report-${id}.geojson`, report);
    toast('报告已导出');
  } catch {
    toast('导出失败');
  }
}

/* ---------- 地图交互：缩放 / 平移 ---------- */

function svgPoint(e) {
  const r = svg.getBoundingClientRect();
  const v = state.viewBox;
  return {
    x: v.x + ((e.clientX - r.left) / r.width) * v.w,
    y: v.y + ((e.clientY - r.top) / r.height) * v.h,
  };
}

function bindMapEvents() {
  svg.addEventListener('wheel', (e) => {
    if (!state.viewBox) return;
    e.preventDefault();
    const scale = e.deltaY > 0 ? 1.2 : 1 / 1.2;
    const pt = svgPoint(e);
    const v = state.viewBox;
    v.x = pt.x - (pt.x - v.x) * scale;
    v.y = pt.y - (pt.y - v.y) * scale;
    v.w *= scale;
    v.h *= scale;
    applyViewBox();
  }, { passive: false });

  let drag = null;
  svg.addEventListener('mousedown', (e) => {
    if (!state.viewBox) return;
    drag = { x: e.clientX, y: e.clientY, vx: state.viewBox.x, vy: state.viewBox.y };
    svg.classList.add('grabbing');
  });
  window.addEventListener('mousemove', (e) => {
    if (!drag) return;
    const r = svg.getBoundingClientRect();
    const v = state.viewBox;
    v.x = drag.vx - ((e.clientX - drag.x) / r.width) * v.w;
    v.y = drag.vy - ((e.clientY - drag.y) / r.height) * v.h;
    applyViewBox();
  });
  window.addEventListener('mouseup', () => {
    drag = null;
    svg.classList.remove('grabbing');
  });
}

/* ---------- 初始化 ---------- */

function bindEvents() {
  $('#sampleBtn').addEventListener('click', loadSample);
  $('#analyzeBtn').addEventListener('click', runAnalysis);
  $('#saveBtn').addEventListener('click', saveAnalysis);
  $('#exportBtn').addEventListener('click', exportCurrent);
  $('#fitBtn').addEventListener('click', () => fitView());

  $('#fileInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        setGeojson(JSON.parse(reader.result), file.name);
      } catch {
        toast('文件不是有效的 JSON');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  });

  $('#pasteBtn').addEventListener('click', () => {
    try {
      setGeojson(JSON.parse($('#pasteArea').value), '粘贴的数据');
    } catch {
      toast('粘贴内容不是有效的 JSON');
    }
  });

  bindMapEvents();
}

bindEvents();
refreshSaved();
loadSample(); // 启动即载入示例数据，便于直接体验
