'use strict';

const path = require('path');
const express = require('express');
const { analyze } = require('./src/analysis');
const storage = require('./src/storage');
const { buildReport } = require('./src/report');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

/** 执行冲突分析 */
app.post('/api/analyze', (req, res) => {
  try {
    const { geojson, layers, minArea } = req.body || {};
    if (!geojson || !Array.isArray(geojson.features)) {
      return res.status(400).json({ error: '请求体缺少有效的 geojson（FeatureCollection）' });
    }
    res.json(analyze(geojson, { layers, minArea }));
  } catch (err) {
    res.status(400).json({ error: `分析失败：${err.message}` });
  }
});

/** 导出当前（未保存）分析结果为 GeoJSON 报告 */
app.post('/api/export', (req, res) => {
  try {
    const { name, geojson, result } = req.body || {};
    if (!result) return res.status(400).json({ error: '缺少分析结果，无法导出' });
    const report = buildReport(name || '未命名分析', geojson, result);
    res.setHeader('Content-Type', 'application/geo+json');
    res.json(report);
  } catch (err) {
    res.status(400).json({ error: `导出失败：${err.message}` });
  }
});

/** 保存分析 */
app.post('/api/analyses', (req, res) => {
  try {
    const { name, geojson, params, result } = req.body || {};
    if (!result) return res.status(400).json({ error: '缺少分析结果，无法保存' });
    const saved = storage.save({
      name: name || `分析 ${new Date().toLocaleString('zh-CN')}`,
      geojson,
      params,
      result,
    });
    res.status(201).json(saved);
  } catch (err) {
    res.status(500).json({ error: `保存失败：${err.message}` });
  }
});

/** 已保存分析列表 */
app.get('/api/analyses', (req, res) => res.json(storage.list()));

/** 读取单条分析 */
app.get('/api/analyses/:id', (req, res) => {
  const rec = storage.get(req.params.id);
  if (!rec) return res.status(404).json({ error: '未找到该分析记录' });
  res.json(rec);
});

/** 导出已保存分析的 GeoJSON 报告 */
app.get('/api/analyses/:id/export', (req, res) => {
  const rec = storage.get(req.params.id);
  if (!rec) return res.status(404).json({ error: '未找到该分析记录' });
  const report = buildReport(rec.name, rec.geojson, rec.result);
  res.setHeader('Content-Type', 'application/geo+json');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="conflict-report-${rec.id}.geojson"`
  );
  res.json(report);
});

/** 删除已保存分析 */
app.delete('/api/analyses/:id', (req, res) => {
  if (!storage.remove(req.params.id)) {
    return res.status(404).json({ error: '未找到该分析记录' });
  }
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`临时施工区域冲突分析台已启动: http://localhost:${PORT}`);
});
