# 在线课程学习平台客户端 (Course Client)

基于 [Electron](https://www.electronjs.org/) 构建的桌面端在线课程学习平台，支持接入 115 网盘（P115）导入课程、在线视频播放、学习进度追踪、课程管理、用户权限管理等功能。

---

## ✨ 功能特性

### 🎯 核心功能
- **课程浏览与播放**：课程列表、分类筛选、关键词搜索、视频播放器（支持进度记忆、续播）
- **115 网盘（P115）集成**：扫码登录 115 网盘，选中网盘文件夹自动生成课程章节与课时
- **学习进度追踪**：自动记录每节课的播放进度、完成状态，支持断点续播
- **课程管理**：新增/编辑/删除课程、章节、课时，支持封面图上传
- **分类管理**：自定义课程分类，支持多级分类
- **用户与权限**：内置管理员/普通用户双角色，支持用户增删改查、密码修改
- **视频上传**：将本地视频文件上传至媒体服务器，支持上传进度实时反馈
- **媒体代理**：本地流式代理，以完整浏览器指纹头 + Range 直达 115 CDN 边下边播，支持拖进度条秒切

### 🛡️ 安全特性
- 登录凭证采用 **AES-256-GCM** 加密存储
- 上传 Token 同样加密持久化
- Context Isolation + 预加载脚本，渲染进程无法直接访问 Node.js
- IPC 参数经过类型校验与清洗，防止恶意数据透传

### ⚡ 性能优化
- Chromium 启动参数调优（磁盘缓存、媒体缓存、GPU 加速解码）
- 媒体代理以完整浏览器指纹头直连 115 CDN，边下边播、拖动秒切
- 窗口 `ready-to-show` 后再初始化数据库，不阻塞首屏

---

## 📦 技术栈

| 类别 | 技术 |
|------|------|
| 桌面框架 | Electron 44 |
| 打包工具 | electron-builder 25 |
| 云盘通信 | P115 网盘 API（扫码登录 + Token 自动续期） |
| 数据存储 | JSON 文件（`courses_data.json`） |
| 加密 | Node.js `crypto`（AES-256-GCM） |
| 媒体代理 | Node.js 原生 `http`/`https` |
| 后端服务 | Express 5（媒体代理） |

---

## 📂 项目结构

```
course-client/
├── main/                      # 主进程
│   ├── index.js               # 入口：窗口创建、生命周期、启动流程
│   ├── state.js               # 主进程共享状态
│   ├── auth-manager.js        # 登录状态管理（加密存储）
│   ├── media-proxy.js         # 本地媒体代理服务（流式透传，边下边播）
│   ├── cover-path.js          # 课程封面图路径转换
│   └── ipc/                   # IPC 处理器（按功能拆分）
│   ├── index.js               # 聚合注册入口
│       ├── auth.js            # 登录/登出/用户管理
│       ├── courses.js         # 课程/分类/章节/课时 CRUD
│       ├── rebuild.js         # 重建课程章节
│       ├── files.js           # 文件选择 + PDF 下载/预览
│       └── upload.js          # 视频上传 + 上传配置
├── services/                  # 业务服务层
│   ├── p115.js                # P115 网盘 API
│   ├── p115-qr-login.js       # P115 扫码登录
│   └── p115-token-manager.js  # P115 Token 管理与自动续期
├── database/                  # 数据层
│   ├── course-db.js           # 课程数据 JSON 存储
│   ├── p115-config.js         # P115 配置
│   └── upload-config.js       # 上传配置（加密存储 Token）
├── src/                       # 渲染进程（前端）
│   ├── index.html             # 主页面（登录页 + 主应用）
│   ├── css/style.css          # 全局样式
│   ├── images/covers/         # 课程封面图
│   └── js/
│       ├── app.js             # 全局工具（弹窗、Toast、快捷键）
│       ├── auth.js            # 登录/导航
│       ├── course-list.js     # 课程列表页
│       ├── course-detail.js   # 课程详情页 + 播放器
│       ├── course-mgmt.js     # 课程/分类/用户/上传配置管理
│       ├── source-mgmt.js     # 从 115 网盘选文件夹导入课程
│       └── player.js          # 视频播放器（含卡顿诊断）
├── preload.js                 # 预加载脚本（暴露安全的 electronAPI）
├── package.json
└── .gitignore
```

---

## 🚀 快速开始

### 环境要求
- Node.js >= 18
- npm >= 9
- 操作系统：Windows 10/11（主开发目标），理论支持 macOS/Linux

### 安装依赖

```bash
cd course-client
npm install
```

> 若 `package.json` 中存在本地依赖（`file:./packages/...`），请确保其已就绪后一并安装。

### 开发运行

```bash
npm start
# 或
npm run dev
```

### 打包发布

```bash
# 仅打包（不生成安装包）
npm run pack

# 生成 Windows 安装包（NSIS）
npm run dist

# 生成 Windows 便携版（免安装）
npm run dist:portable
```

打包产物输出到 `dist/` 目录。

---

## 🔑 默认账号

| 角色 | 用户名 | 密码 | 权限 |
|------|--------|------|------|
| 管理员 | `admin` | `admin123` | 全部功能 |
| 普通用户 | `user` | `user123` | 仅课程浏览与播放 |

> 登录状态默认保留 7 天，可在登录页取消「7天内自动登录」。

---

## 🎮 使用说明

### 1. 添加课程（从 115 网盘导入）

1. 以管理员身份登录，点击左侧「📚 课程管理」
2. 点击「📂 从 115 网盘导入」
3. 使用手机 115 扫码登录，进入目标课程文件夹
4. 点击「✅ 选择当前文件夹作为课程」
5. 完善课程信息（分类、封面、难度等）后保存

### 2. 播放课程

1. 在「📖 全部课程」页点击课程卡片进入详情
2. 选择章节中的课时开始播放
3. 视频采用流式播放（边下边播），可拖动进度条秒切
4. 播放器自动记忆播放进度，下次进入可续播

### 3. 上传视频

1. 管理员进入「📤 上传配置」
2. 添加上传服务器配置（BaseURL + Token）
3. 在课程编辑页选择本地视频文件上传

---

## 🔌 核心架构说明

### 进程模型

```
┌─────────────────────────────────────────────────┐
│                   主进程 (main/)                  │
│  ┌──────────┐ ┌──────────┐ ┌──────────────────┐ │
│  │ 窗口/生命周期 │ │ IPC 处理器 │ │ 媒体代理 (Express) │ │
│  └──────────┘ └──────────┘ └──────────────────┘ │
│         │            │                │          │
│         ▼            ▼                ▼          │
│  ┌──────────┐ ┌──────────┐ ┌──────────────────┐ │
│  │ 数据层    │ │ 服务层    │ │ P115 服务          │ │
│  │ (JSON)   │ │ (sync)   │ │ (扫码登录/媒体代理) │ │
│  └──────────┘ └──────────┘ └──────────────────┘ │
└────────────────────┬────────────────────────────┘
                     │ contextBridge (preload.js)
                     ▼
┌─────────────────────────────────────────────────┐
│              渲染进程 (src/)                       │
│  登录页 / 课程列表 / 课程详情 / 播放器 / 管理后台    │
└─────────────────────────────────────────────────┘
```

### IPC 通信

渲染进程通过 `preload.js` 暴露的 `window.electronAPI` 调用主进程功能，所有参数经过类型校验：

```js
// 示例：获取课程列表
const courses = await window.electronAPI.getCourses();

// 示例：更新学习进度
await window.electronAPI.updateProgress({
  courseId: 1,
  lessonId: 10,
  progress: 45.5,      // 百分比
  completed: false,
  lastPosition: 1234,  // 秒
});
```

### 数据存储

所有课程数据存储在 `courses_data.json` 中：

| 字段 | 说明 |
|------|------|
| `courses` | 课程数组（含 chapters → lessons 嵌套） |
| `categories` | 分类数组 |
| `learningProgress` | 学习进度记录 |
| `nextId` / `nextChapterId` / `nextLessonId` | 自增 ID |

**路径策略**：
- 开发模式：项目根目录 `database/courses_data.json`
- 打包模式：`userData/courses_data.json`（首次从 `resources` 复制种子文件）

### 媒体代理与视频播放

所有 115 网盘（P115）课时播放由前端统一决策模块 `window.P115Play`（[src/js/p115-play.js](src/js/p115-play.js)）承担，课程详情页与网盘选择器共用同一套逻辑，**按文件类型区分播放策略，并隔离播放判定、降低各页面间的耦合**：

| 文件类型 | 播放方式 | 说明 |
| ------- | ------- | ---- |
| **TS / FLV / M2TS** | mpegts.js 直解（零转码秒开）→ 降级：流式转封装（边转边播）→ 兜底：全量转封装 | 优先用 mpegts.js（MSE 软解）直连 `/stream` 零转码秒开；元数据损坏导致解码失败时自动降级到 ffmpeg 流式转封装（边转边播约 1-2s）；最终兜底为全量下载+转封装 |
| **其它非原生（mkv/avi/wmv/rmvb…）** | 流式转封装（边转边播）→ 兜底：全量转封装 | mpegts.js 不支持的容器直接走 ffmpeg 流式转封装 `/watch`；失败再回退全量转封装 `file://` |
| **原生可播（mp4/mov/webm/ogg…）** | 本地 `/stream`（m3u8 走 `/hls`）边下边播 | 取原画直链，包装成本地 `127.0.0.1` 流式代理地址，Range 边下边播、可拖动进度条 |

**主播放流程（非 FLV，边下边播）**：

```
点击课时
   │  api.get115LessonUrl(cfgId, pickCode)   ← 主进程读 DB Token 自动续期
   ▼
get115DownUrl 取「原画直链」                 ← /open/ufile/downurl，支持 Range 分片
   │
   ▼
前端 window.P115Play.resolveStreamUrl(...) 把直链包装成本地流式代理地址：
   非 m3u8 → http://127.0.0.1:{port}/stream?src=<encodeURIComponent(直链)>
   m3u8   → http://127.0.0.1:{port}/hls?src=...
   │
   ▼
playVideo() → <video>.src = 代理地址
   │
   ▼
/stream 路由带完整浏览器指纹头（UA / Origin / Referer）+ Range 转发到 115 CDN，
拿到数据流式 pipe 回播放器 → 出画面即播、可拖动进度条（每次 seek 都是一次新 Range 直达 CDN，秒切）
```

**非原生容器播放流程（三层降级：mpegts 直解 → 流式转封装 → 全量转封装）**：

```
点击 TS/FLV/MKV/AVI 等课时
   │  前端按 fileName 后缀判定为浏览器原生播不了的容器
   ▼
══════════════ Layer 1（仅 TS/FLV/M2TS）══════════════
   │  P115Play.canMpegts(fileName) → P115Play.tryMpegts(player, streamUrl)
   │  mpegts.js 以 MSE 直连 /stream 零转码软解
   │  → 成功 → 秒开播放（CPU 友好）
   │  → 失败（元数据损坏/解码错误/超时）→ 自动降级↓↓
   ▼
══════════════ Layer 2（所有非原生容器）══════════════
   │  P115Play.playStreamingRemux(cfgId, pickCode)   ← IPC: remux-115-flv-stream
   │  ffmpeg 以 /stream 为输入，-c copy 实时封装 fMP4 → /watch 边转边播
   │  → 成功 → 约 1-2s 出画面，支持拖进度条、转档入缓存二次秒开
   │  → 失败（ffmpeg 异常/源格式不兼容）→ 自动降级↓↓
   ▼
══════════════ Layer 3（兜底：全量转封装）══════════════
   │  P115Play.playFlvAsRemux(cfgId, pickCode)       ← IPC: remux-115-flv-to-mp4
   │  ① 下载整片到临时目录 → ② ffmpeg -c copy 全量 remux 成 MP4
   │  → 返回 file:// 路径 → <video>.src = filePath
   ▼
播放，转档入缓存，二次秒开
```

**关键说明**：
- **分层降级播放**：非原生容器（`P115Play.needsRemux` 返回 true）按"mpegts.js 直解 → 流式转封装（方案A）→ 全量转封装（方案B兜底）"三层依次尝试，上层失败自动降级。TS/FLV/M2TS 优先走 mpegts.js 零转码秒开；mkv/avi 等 mpegts.js 不支持的容器从 Layer 2 开始。
- **隔离 / 低耦合**：扩展名判定、mpegts 尝试、直链→代理地址包装、两层转封装调用统一收敛在 `src/js/p115-play.js`；`course-detail.js`（课程详情页）与 `course-modal.js`（网盘选择器）仅各自绑定自己的播放器 UI，不再各自堆叠播放判定。
- **mpegts.js**（v1.7.3）已内置于 `src/js/mpegts.min.js` 并在 `index.html` 加载，通过 `window.mpegts` 提供；基于 MSE 的 TS/FLV 软解播放器，CPU 消耗远低于 ffmpeg 转码，且零等待即时出画面。解码失败（如 damaged onMetaData）时自动回退到 ffmpeg 流式转封装。
- `/stream`（[media-proxy.js:484](course-client/main/media-proxy.js#L484)）是纯透传路由：完整浏览器指纹头 + Range 直达 115 CDN，流式 pipe；206 分段时精确回写 Content-Range / Content-Length，从而支持 Chromium 的 Range seek 与边下边播。
- `aborted` 日志属于 Chromium 切换 Range/seek 时的正常断开，代理已静默忽略并自动终止对应上游连接，防止内存泄漏。
- 115 CDN（`cdnfhnfile.115cdn.net`）会校验浏览器指纹，代理必须以完整指纹头发起上游请求，否则返回 `403`。

#### 内存与磁盘占用说明

以下占用说明针对**非 FLV 的 `/stream` 边下边播**（FLV 需下载 + ffmpeg 转封装，会占用临时磁盘，见上文流程）：

- **磁盘占用为 0**——数据是"边拿边放给播放器"，从不落盘。过程中不使用任何临时文件、缓存目录或 `createWriteStream`。旧版"先下载到本地文件再播"的接口仍保留定义，但**非 FLV 边下边播路径已完全不调用**。
- **内存占用接近 0**——`/stream` 无内存滑动窗口、无整段缓存，数据经 Node socket 直接转发给播放器，主进程不为视频内容分配大块缓存。唯一常驻开销是路由本身（函数、响应头），几乎可忽略；打开一个长视频内存只增加几十 KB ~ 几 MB（即 socket 内核缓冲区），且不随视频时长或大小增长。
- **非原生容器（TS/FLV/MKV/AVI 等）例外**：mpegts.js 直解路径零磁盘零额外内存（MSE 缓冲由 Chromium 自身管理）；ffmpeg 流式/全量转封装路径会在系统临时目录 `courseclient-115` 落盘，全量转封装按 60 分钟缓存，二次打开直接命中缓存秒开。

**能力边界**：非 FLV 由于不上盘、不缓存，播放器支持秒开 + 拖动进度条秒切，但**不具备离线缓存 / 断网续看能力**——边下边播，网络断开即停止。

> 说明：`/hls`、`/hls-segment` 路由是项目中为 m3u8 分片播放预留的代理能力（重写 m3u8 内密钥/分片引用、分片按需代理），但**当前播放链路并不启用**，仅供后续扩展。

---

## 🔧 配置说明

### 115 网盘配置

使用扫码登录 115 网盘后，登录凭证（Token）存储在数据库，并由主进程 `p115-token-manager` **自动续期**。每个导入的课程以 `p115_<时间戳>` 为配置标识（`cfgId`）关联到对应的 115 账号。

课时内记录 `cfgId` 与 `pickCode`（文件标识），播放时由主进程据此换取原画下载直链：
- `cfgId`：当前账号配置
- `pickCode`：课时对应 115 文件的标识

### 上传配置

存储于 `userData/upload-config.json`，Token 字段经 AES-256-GCM 加密：

```json
{
  "version": 1,
  "configs": [
    {
      "id": 1,
      "name": "默认上传",
      "baseURL": "https://example.com",
      "uploadPath": "/api/admin/mediaFile/uploadMediaFile",
      "token": "<encrypted>"
    }
  ]
}
```

---

## 🛠️ 开发指南

### 新增 IPC 接口

1. 在 `main/ipc/` 对应模块中添加 `ipcMain.handle('xxx', ...)`
2. 在 `preload.js` 的 `electronAPI` 中添加对应方法（带 `_sanitize` 参数校验）
3. 在渲染进程中调用 `window.electronAPI.xxx()`

### 新增数据库字段

编辑 `database/course-db.js` 中的默认 `data` 对象，并在 `loadJson()` 中处理向后兼容。

### 调试

- 按 `F12` 打开开发者工具
- 控制台过滤 `[PlayDiag]` 查看播放器卡顿诊断日志
- 控制台过滤 `[boot]`、`[sync]`、`[ipc]` 查看主进程日志

---

## 📝 构建配置

`package.json` 中的 `build` 字段已配置：

- **asar 打包**：启用，`sql.js`（原生模块）解包
- **压缩**：maximum
- **Electron 镜像**：使用 `npmmirror.com` 加速下载
- **Windows 目标**：NSIS 安装包 + 便携版
- **NSIS**：允许选择安装目录、创建桌面/开始菜单快捷方式

---

## 📄 许可证

MIT License

---

## 🤝 贡献

欢迎提交 Issue 和 Pull Request。