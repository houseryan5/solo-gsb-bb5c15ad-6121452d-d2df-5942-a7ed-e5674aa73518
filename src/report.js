'use strict';

/**
 * 生成 GeoJSON 冲突报告：
 * - 每个冲突的相交区域作为 role=conflict 的 Feature，属性含涉及区域、
 *   重叠面积、重叠时段与错峰建议；
 * - 原始施工区域作为 role=zone 的 Feature 一并附上，便于在 GIS 软件中对照。
 */
function buildReport(name, geojson, result) {
  const features = [];

  for (const c of (result && result.conflicts) || []) {
    features.push({
      type: 'Feature',
      properties: {
        role: 'conflict',
        conflictId: c.id,
        zones: c.zones.map((z) => z.name).join(' / '),
        layers: [...new Set(c.zones.map((z) => z.layer))].join(' / '),
        overlapArea_m2: c.area,
        overlapStart: c.overlapStart,
        overlapEnd: c.overlapEnd,
        overlapDays: c.overlapDays,
        suggestion: c.suggestion ? c.suggestion.text : '',
      },
      geometry: c.geometry,
    });
  }

  for (const f of (geojson && geojson.features) || []) {
    features.push({
      type: 'Feature',
      properties: { ...(f.properties || {}), role: 'zone' },
      geometry: f.geometry,
    });
  }

  return {
    type: 'FeatureCollection',
    name,
    generatedAt: new Date().toISOString(),
    generator: 'construction-zone-conflict-analyzer',
    summary: (result && result.summary) || {},
    features,
  };
}

module.exports = { buildReport };
