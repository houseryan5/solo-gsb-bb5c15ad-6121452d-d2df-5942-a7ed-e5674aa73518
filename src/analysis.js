'use strict';

/**
 * 时空冲突分析核心模块。
 *
 * 输入：GeoJSON FeatureCollection，每个 Feature 为 Polygon/MultiPolygon，
 *       properties 中携带 name / layer / start / end（生效起止时间）。
 * 处理：先按时间窗重叠筛选区域对，再用 polygon-clipping 求真实几何交集，
 *       交集面积用测地线面积（@turf/area）计算。
 * 输出：按面积降序的冲突列表（含涉及区域、重叠面积、重叠时段、错峰建议）、
 *       冲突群组（连通分量）及群组级串行错峰排布方案。
 */

const pc = require('polygon-clipping');
const areaModule = require('@turf/area');
const turfArea = areaModule.default || areaModule;

const DAY_MS = 24 * 60 * 60 * 1000;

function iso(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * 校验并规范化输入要素，过滤无效数据并收集警告。
 */
function normalizeFeatures(fc, options = {}) {
  const warnings = [];
  const zones = [];
  const layerSet = new Set();
  const features = fc && Array.isArray(fc.features) ? fc.features : [];

  features.forEach((f, i) => {
    const props = (f && f.properties) || {};
    const name = String(props.name || props.id || `区域 ${i + 1}`);
    const layer = String(props.layer || '未分组');
    const start = Date.parse(props.start);
    const end = Date.parse(props.end);

    if (Number.isNaN(start) || Number.isNaN(end)) {
      warnings.push(`「${name}」缺少有效的 start/end 生效时间，已跳过`);
      return;
    }
    if (end <= start) {
      warnings.push(`「${name}」结束时间不晚于开始时间，已跳过`);
      return;
    }
    const geom = f.geometry;
    if (!geom || (geom.type !== 'Polygon' && geom.type !== 'MultiPolygon')) {
      warnings.push(`「${name}」几何类型为 ${geom ? geom.type : '空'}，仅支持 Polygon/MultiPolygon，已跳过`);
      return;
    }

    layerSet.add(layer);
    zones.push({
      idx: zones.length,
      id: String(props.id || `zone-${i + 1}`),
      name,
      layer,
      start,
      end,
      coords: geom.coordinates,
      geomType: geom.type,
    });
  });

  // 图层筛选：仅保留选中图层的区域参与分析
  const allowed = Array.isArray(options.layers) && options.layers.length
    ? new Set(options.layers)
    : null;
  const kept = allowed ? zones.filter((z) => allowed.has(z.layer)) : zones;
  const dropped = zones.length - kept.length;
  if (allowed && dropped > 0) {
    warnings.push(`图层筛选排除了 ${dropped} 个区域，未参与本次分析`);
  }

  return { zones: kept, warnings, layers: [...layerSet] };
}

/**
 * 用 polygon-clipping 求两个区域的几何交集。
 * 返回 MultiPolygon 坐标；null 表示不相交；undefined 表示计算异常。
 */
function intersectCoords(a, b) {
  try {
    const out = pc.intersection(a, b);
    if (!out || out.length === 0) return null;
    return out;
  } catch (err) {
    return undefined;
  }
}

function zoneRef(z) {
  return {
    idx: z.idx,
    id: z.id,
    name: z.name,
    layer: z.layer,
    start: iso(z.start),
    end: iso(z.end),
  };
}

/**
 * 单对冲突的错峰建议：比较"推迟 A"与"推迟 B"两种方案，
 * 选择顺延天数最小（并列时总完工更早）的方案。
 */
function buildSuggestion(A, B) {
  const durA = A.end - A.start;
  const durB = B.end - B.start;
  const candidates = [
    { move: B, anchor: A, newStart: A.end, newEnd: A.end + durB },
    { move: A, anchor: B, newStart: B.end, newEnd: B.end + durA },
  ].map((o) => ({ ...o, delay: o.newStart - o.move.start }));

  candidates.sort((p, q) => p.delay - q.delay || p.newEnd - q.newEnd);
  const best = candidates[0];
  const delayDays = Math.ceil(best.delay / DAY_MS);

  return {
    moveZoneId: best.move.id,
    moveZoneName: best.move.name,
    newStart: iso(best.newStart),
    newEnd: iso(best.newEnd),
    delayDays,
    text: `建议将「${best.move.name}」整体推迟至「${best.anchor.name}」结束后开工` +
      `（${iso(best.newStart)} 开工，${iso(best.newEnd)} 完工），顺延 ${delayDays} 天，可完全避开该冲突。`,
  };
}

const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/**
 * 冲突群组（并查集连通分量）+ 群组级贪心串行错峰排布：
 * 按原开工时间排序，每个区域若与已排布区域存在真实几何冲突，
 * 则推迟到这些区域的最晚完工时间之后。
 */
function buildClusters(zones, conflicts) {
  const parent = zones.map((_, i) => i);
  const find = (x) => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };

  const conflictPairs = new Set();
  for (const c of conflicts) {
    const [za, zb] = c.zones;
    union(za.idx, zb.idx);
    conflictPairs.add(pairKey(za.idx, zb.idx));
  }

  const groups = new Map();
  for (const c of conflicts) {
    const root = find(c.zones[0].idx);
    if (!groups.has(root)) groups.set(root, { zoneIdx: new Set(), conflictIds: [] });
    const g = groups.get(root);
    g.zoneIdx.add(c.zones[0].idx);
    g.zoneIdx.add(c.zones[1].idx);
    g.conflictIds.push(c.id);
  }

  const byIdx = new Map(zones.map((z) => [z.idx, z]));
  const clusters = [];
  for (const g of groups.values()) {
    const members = [...g.zoneIdx].map((i) => byIdx.get(i)).filter(Boolean);
    const sorted = [...members].sort((a, b) => a.start - b.start || a.end - b.end);

    const placed = [];
    const plan = sorted.map((z) => {
      let newStart = z.start;
      for (const p of placed) {
        if (conflictPairs.has(pairKey(z.idx, p.idx))) {
          newStart = Math.max(newStart, p.newEnd);
        }
      }
      const newEnd = newStart + (z.end - z.start);
      placed.push({ idx: z.idx, newEnd });
      return {
        zoneId: z.id,
        name: z.name,
        layer: z.layer,
        oldStart: iso(z.start),
        oldEnd: iso(z.end),
        newStart: iso(newStart),
        newEnd: iso(newEnd),
        delayDays: Math.round((newStart - z.start) / DAY_MS),
      };
    });

    const totalArea = conflicts
      .filter((c) => g.conflictIds.includes(c.id))
      .reduce((s, c) => s + c.area, 0);

    clusters.push({
      zones: members.map(zoneRef),
      conflictIds: g.conflictIds,
      totalOverlapArea: Math.round(totalArea * 100) / 100,
      plan,
      maxDelayDays: Math.max(...plan.map((p) => p.delayDays), 0),
    });
  }

  clusters.sort((a, b) => b.totalOverlapArea - a.totalOverlapArea);
  clusters.forEach((c, i) => (c.id = `G${i + 1}`));
  return clusters;
}

/**
 * 主入口：执行完整冲突分析。
 * options: { layers?: string[], minArea?: number }
 */
function analyze(fc, options = {}) {
  const { zones, warnings, layers } = normalizeFeatures(fc, options);
  const minArea = Number(options.minArea) > 0 ? Number(options.minArea) : 0;
  const conflicts = [];

  for (let i = 0; i < zones.length; i++) {
    for (let j = i + 1; j < zones.length; j++) {
      const A = zones[i];
      const B = zones[j];

      // 时间窗重叠判定
      const oStart = Math.max(A.start, B.start);
      const oEnd = Math.min(A.end, B.end);
      if (oEnd <= oStart) continue;

      // 几何真实相交判定
      const inter = intersectCoords(A.coords, B.coords);
      if (inter === undefined) {
        warnings.push(`「${A.name}」与「${B.name}」几何求交失败（可能存在自相交几何），已跳过`);
        continue;
      }
      if (!inter) continue;

      const geometry = inter.length === 1
        ? { type: 'Polygon', coordinates: inter[0] }
        : { type: 'MultiPolygon', coordinates: inter };
      const area = turfArea({ type: 'Feature', properties: {}, geometry });
      if (area < minArea) continue;

      conflicts.push({
        id: '',
        zones: [zoneRef(A), zoneRef(B)],
        area: Math.round(area * 100) / 100,
        overlapStart: iso(oStart),
        overlapEnd: iso(oEnd),
        overlapDays: Math.ceil((oEnd - oStart) / DAY_MS),
        geometry,
        suggestion: buildSuggestion(A, B),
      });
    }
  }

  // 按重叠面积降序排序并编号
  conflicts.sort((a, b) => b.area - a.area);
  conflicts.forEach((c, i) => (c.id = `C${i + 1}`));

  const clusters = buildClusters(zones, conflicts);
  const totalArea = conflicts.reduce((s, c) => s + c.area, 0);
  const times = zones.flatMap((z) => [z.start, z.end]);

  return {
    conflicts,
    clusters,
    warnings,
    layers,
    zones: zones.map(zoneRef),
    summary: {
      zoneCount: zones.length,
      layerCount: layers.length,
      conflictCount: conflicts.length,
      clusterCount: clusters.length,
      totalOverlapArea: Math.round(totalArea * 100) / 100,
      timeSpan: times.length
        ? { start: iso(Math.min(...times)), end: iso(Math.max(...times)) }
        : null,
    },
  };
}

module.exports = { analyze };
