# 临时施工区域冲突分析台

一个 Node.js / Express 的时空冲突分析工具：导入带生效起止时间的 GeoJSON 施工区域，
系统用 [polygon-clipping](https://github.com/mfogel/polygon-clipping) 计算同一时段内的**真实几何相交区域**，
按重叠面积降序输出冲突清单，并给出涉及区域、重叠面积与可行的错峰调度建议。
支持图层筛选、分析保存与 GeoJSON 报告导出。

前端为零外部依赖的 SVG 地图（无需联网加载地图瓦片/库），容器离线环境也能直接使用。

## 功能特性

- **GeoJSON 导入**：文件上传、文本粘贴、内置示例数据三种方式；支持 Polygon / MultiPolygon
- **时空冲突检测**：先做时间窗重叠判定，再对重叠时段内的区域对做真实几何求交（非 bbox 粗判）
- **测地线面积**：相交面积由 `@turf/area` 按球面面积计算，结果以 m² / km² 展示，按面积降序排列
- **错峰建议**：
  - 单条冲突：比较"推迟 A / 推迟 B"两种方案，推荐顺延天数最小的错开窗口
  - 冲突群组：并查集聚类 + 贪心串行排布，给出群组级可行错峰计划表
- **图层筛选**：按 `layer` 属性勾选参与分析的图层，支持最小重叠面积阈值过滤
- **分析保存**：分析结果（含原始数据与参数）持久化到 `data/analyses/`，可随时加载/删除
- **GeoJSON 报告导出**：冲突交集（`role=conflict`，含面积/时段/建议）+ 原始区域（`role=zone`），可直接导入 QGIS 等 GIS 软件
- **交互地图**：滚轮缩放、拖拽平移、悬停查看属性、点击冲突联动定位

## 快速开始

### 方式一：Docker Compose（推荐）

```bash
docker compose up -d --build
```

### 方式二：Docker

```bash
docker build -t conflict-analyzer .
docker run -d -p 3000:3000 -v analyses-data:/app/data --name conflict-analyzer conflict-analyzer
```

### 方式三：本地运行

```bash
npm ci
npm start          # 或 npm run dev（文件变更自动重启）
```

启动后浏览器访问 **http://localhost:3000** 。页面会自动载入示例数据，点击「开始分析」即可看到完整效果。

## 使用流程

1. **导入数据**：上传 GeoJSON 文件 / 粘贴文本 / 使用内置示例
2. **图层筛选**：勾选参与分析的图层，可设置最小重叠面积阈值（m²）
3. **开始分析**：地图红色高亮冲突交集，右栏按面积降序展示冲突清单与错峰建议
4. **保存 / 导出**：命名保存分析供日后加载；一键导出 GeoJSON 报告

## 输入数据格式

FeatureCollection，每个 Feature 的 `properties` 需包含：

| 字段    | 必填 | 说明                                       |
| ------- | ---- | ------------------------------------------ |
| `name`  | 否   | 区域名称（缺省自动编号）                   |
| `layer` | 否   | 图层分组，用于筛选与配色（缺省「未分组」） |
| `start` | 是   | 生效开始时间，如 `2026-03-01`              |
| `end`   | 是   | 生效结束时间，需晚于 start                 |

几何类型支持 `Polygon` 与 `MultiPolygon`，坐标系 WGS84（EPSG:4326）。
缺少有效时间或几何类型不符的要素会被跳过并在「数据警告」中列出。

示例见 `public/sample.geojson`（6 个区域、3 个图层，含 7 处时空冲突）。

## API 一览

| 方法 | 路径                       | 说明                                       |
| ---- | -------------------------- | ------------------------------------------ |
| POST | `/api/analyze`             | 执行分析，body: `{geojson, layers?, minArea?}` |
| POST | `/api/export`              | 导出当前分析为 GeoJSON 报告                |
| POST | `/api/analyses`            | 保存分析 `{name, geojson, params, result}` |
| GET  | `/api/analyses`            | 已保存分析列表                             |
| GET  | `/api/analyses/:id`        | 读取单条分析（含数据与结果）               |
| GET  | `/api/analyses/:id/export` | 导出已保存分析的 GeoJSON 报告              |
| DELETE | `/api/analyses/:id`      | 删除分析                                   |
| GET  | `/api/health`              | 健康检查                                   |

## 项目结构

```
├── server.js              # Express 入口与 API 路由
├── src/
│   ├── analysis.js        # 冲突分析核心：时间窗筛选 + polygon-clipping 求交 + 错峰建议
│   ├── storage.js         # 分析记录文件持久化（data/analyses/）
│   └── report.js          # GeoJSON 报告生成
├── public/                # 前端（原生 SVG 地图，无外部依赖）
│   ├── index.html
│   ├── app.js
│   ├── style.css
│   └── sample.geojson     # 内置示例数据
├── Dockerfile
├── docker-compose.yml
└── package.json
```

## 实现说明

- **相交判定**：`polygon-clipping` 对区域对做精确多边形布尔求交，返回的交集可能为
  Polygon 或 MultiPolygon，均如实保留并参与面积计算与地图渲染。
- **面积计算**：`@turf/area` 基于球面多边形面积公式，单位平方米，避免平面投影误差。
- **时间模型**：起止时间解析为毫秒时间戳，区间重叠判定为 `max(start) < min(end)`。
- **错峰策略**：单冲突取"顺延天数最小、总完工最早"的方案；群组按原开工时间排序后贪心串行，
  仅在与已排布区域存在真实几何冲突时才顺延，保证方案可执行且不过度推迟。
- **持久化**：保存的分析以 JSON 文件存储于 `data/analyses/`，Compose 中通过命名卷持久化。

## 环境变量

| 变量       | 默认值 | 说明           |
| ---------- | ------ | -------------- |
| `PORT`     | `3000` | 服务监听端口   |
| `DATA_DIR` | `./data/analyses` | 分析记录存储目录 |
