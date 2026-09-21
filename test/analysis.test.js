'use strict';

const assert = require('assert');
const { analyze, normalizeZone } = require('../src/analysis');

function square(lon1, lat1, lon2, lat2) {
  return {
    type: 'Polygon',
    coordinates: [[[lon1, lat1], [lon2, lat1], [lon2, lat2], [lon1, lat2], [lon1, lat1]]],
  };
}

const zones = [
  {
    id: 'a', name: 'A', layer: '土建',
    start: '2026-10-01T00:00:00.000Z', end: '2026-11-15T00:00:00.000Z',
    geometry: square(121.470, 31.228, 121.474, 31.231),
  },
  {
    id: 'b', name: 'B', layer: '市政',
    start: '2026-10-20T00:00:00.000Z', end: '2026-11-30T00:00:00.000Z',
    geometry: square(121.472, 31.229, 121.476, 31.232), // 与 A 时空均重叠
  },
  {
    id: 'c', name: 'C', layer: '市政',
    start: '2027-01-01T00:00:00.000Z', end: '2027-01-31T00:00:00.000Z',
    geometry: square(121.472, 31.229, 121.476, 31.232), // 与 B 空间重叠但时间不重叠
  },
  {
    id: 'd', name: 'D', layer: '临建',
    start: '2026-10-05T00:00:00.000Z', end: '2026-10-25T00:00:00.000Z',
    geometry: square(121.500, 31.250, 121.504, 31.253), // 时间重叠但空间不重叠
  },
];

// 1. 时空同时重叠才产生冲突
let result = analyze(zones);
assert.strictEqual(result.conflictCount, 1, '应只检测到 A∩B 一处冲突');
const c = result.conflicts[0];
assert.deepStrictEqual(c.zones.map((z) => z.id).sort(), ['a', 'b']);
assert.ok(c.areaM2 > 0, '重叠面积应大于 0');
assert.strictEqual(c.overlapStart, '2026-10-20T00:00:00.000Z');
assert.strictEqual(c.overlapEnd, '2026-11-15T00:00:00.000Z');
assert.ok(c.suggestions.length >= 2, '应至少给出顺延/提前两条建议');
assert.ok(c.geometry.type === 'MultiPolygon' && c.geometry.coordinates.length > 0);

// 2. 面积合理性：0.002°×0.002° 在 31°N 约 3.9 万 m²
assert.ok(c.areaM2 > 30000 && c.areaM2 < 50000, `重叠面积异常: ${c.areaM2}`);

// 3. 图层筛选
result = analyze(zones, { layers: ['市政', '临建'] });
assert.strictEqual(result.conflictCount, 0, '排除土建图层后 A 不参与，应无冲突');

// 4. 时段筛选：分析窗口避开 A∩B 重叠期
result = analyze(zones, { start: '2026-11-16', end: '2026-12-31' });
assert.strictEqual(result.conflictCount, 0, '分析时段在重叠期之后，应无冲突');

// 5. 时段裁剪：重叠期被分析窗口截断
result = analyze(zones, { start: '2026-11-01', end: '2026-11-10' });
assert.strictEqual(result.conflictCount, 1);
assert.strictEqual(result.conflicts[0].overlapStart, '2026-11-01T00:00:00.000Z');
assert.strictEqual(result.conflicts[0].overlapEnd, '2026-11-10T00:00:00.000Z');

// 6. normalizeZone 校验
assert.throws(() => normalizeZone({ type: 'Feature', geometry: square(0, 0, 1, 1), properties: {} }, 0), /起止时间/);
const nz = normalizeZone({
  type: 'Feature',
  geometry: square(0, 0, 1, 1),
  properties: { name: 'X', start: '2026-01-01', end: '2026-02-01' },
}, 0);
assert.strictEqual(nz.layer, '默认图层');

// 7. 排序：多冲突时按面积降序
const zones2 = [
  zones[0], zones[1],
  {
    id: 'e', name: 'E', layer: '土建',
    start: '2026-10-01T00:00:00.000Z', end: '2026-11-15T00:00:00.000Z',
    geometry: square(121.4705, 31.2282, 121.4745, 31.2312), // 与 A 几乎完全重叠，面积更大
  },
];
result = analyze(zones2);
assert.ok(result.conflictCount >= 2);
for (let i = 1; i < result.conflicts.length; i++) {
  assert.ok(result.conflicts[i - 1].areaM2 >= result.conflicts[i].areaM2, '结果应按面积降序');
}

console.log('✅ 全部测试通过');
