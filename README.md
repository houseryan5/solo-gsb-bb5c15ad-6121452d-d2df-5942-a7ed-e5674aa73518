# 临时施工区域冲突分析台

一个 Node.js/Express Web 应用：导入带生效起止时间的 GeoJSON 多边形施工区域，基于 [polygon-clipping](https://www.npmjs.com/package/polygon-clipping) 计算**同一时段内真实相交**的区域，按重叠面积降序输出冲突清单（涉及区域、重叠面积、重叠时段），并自动生成可行的错峰建议。支持图层筛选、分析结果保存与 GeoJSON 报告导出。

## 功能

- **GeoJSON 导入**：支持 `FeatureCollection` / 单个 `Feature`，文件上传或文本粘贴；要素需带 `properties.start` / `properties.end`（ISO 日期）
- **时空冲突检测**：先判断时间窗口重叠，再用 polygon-clipping 对多边形做真实求交（支持 Polygon / MultiPolygon、带孔多边形），面积按局部等距投影计算（m²/公顷）
- **结果排序与建议**：按重叠面积降序；每处冲突给出"顺延 / 提前 / 工序穿插"三类可落地的错峰建议（含具体调整日期与天数）
- **图层筛选**：按 `properties.layer` 勾选参与分析的图层，可限定分析时段（重叠期自动按时段裁剪）
- **地图可视化**：Leaflet 地图展示各区域（按图层着色）与红色高亮的相交区域，点击结果可定位
- **保存与导出**：分析结果可命名保存（JSON 文件持久化），一键导出带元数据与建议的 GeoJSON 报告

## 快速开始

### 方式一：Docker Compose（推荐）

```bash
docker compose up -d --build
```

### 方式二：本地 Node.js（≥ 18）

```bash
npm install
npm start
```

启动后浏览器访问 **http://localhost:3000** ，点击「加载示例」→「导入」→「运行冲突分析」即可看到完整流程。

### 运行测试

```bash
npm test
```

## 输入数据格式

```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "properties": {
        "name": "基坑开挖区 A",
        "layer": "土建",
        "start": "2026-10-01",
        "end": "2026-11-15"
      },
      "geometry": { "type": "Polygon", "coordinates": [[[121.47, 31.228], [121.474, 31.228], [121.474, 31.231], [121.47, 31.231], [121.47, 31.228]]] }
    }
  ]
}
```

- `name`：区域名称（缺省自动命名）
- `layer`：图层名（缺省为「默认图层」），用于筛选与地图着色
- `start` / `end`：生效起止时间（也兼容 `startTime`/`endTime`、`from`/`to`），结束必须晚于开始
- 几何仅支持 `Polygon` / `MultiPolygon`

## API 一览

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 健康检查 |
| GET | `/api/zones` | 列出全部区域 |
| POST | `/api/zones/import` | 导入 GeoJSON |
| DELETE | `/api/zones/:id` | 删除区域 |
| DELETE | `/api/zones` | 清空区域 |
| GET | `/api/layers` | 图层列表 |
| POST | `/api/analyze` | 运行分析，body：`{layers?, start?, end?}` |
| POST | `/api/analyses` | 保存分析，body：`{name?, params?, result}` |
| GET | `/api/analyses` | 已保存分析列表 |
| GET | `/api/analyses/:id` | 分析详情 |
| DELETE | `/api/analyses/:id` | 删除分析 |
| GET | `/api/analyses/:id/export` | 导出 GeoJSON 报告（附件下载） |

## 项目结构

```
├── server.js            # Express 入口与 API 路由
├── src/
│   ├── analysis.js      # 时空冲突检测与错峰建议生成
│   ├── geo.js           # 局部投影与面积计算
│   └── store.js         # JSON 文件持久化（区域 / 已保存分析）
├── public/              # 前端（Leaflet 地图 + 分析面板）
│   └── sample.geojson   # 示例数据
├── test/analysis.test.js
├── Dockerfile
└── docker-compose.yml
```

## 说明

- 数据持久化在 `DATA_DIR`（默认 `./data`，容器内 `/app/data`，Compose 已挂载命名卷）
- 面积采用以相交区域质心为原点的局部等距圆柱投影近似，适用于施工场地尺度（公里级）的冲突评估
- 仅边界相接（零面积接触）不计为冲突
