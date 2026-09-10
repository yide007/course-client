# 在线课程学习平台客户端 (Course Client)

基于 [Electron](https://www.electronjs.org/) 构建的桌面端在线课程学习平台，支持从 CloudDrive2 云盘同步课程、在线视频播放、学习进度追踪、课程管理、用户权限管理等功能。

---

## ✨ 功能特性

### 🎯 核心功能
- **课程浏览与播放**：课程列表、分类筛选、关键词搜索、视频播放器（支持进度记忆、续播）
- **CloudDrive2 集成**：通过 CD2 API Token 连接云盘，递归扫描目录结构自动生成课程章节与课时
- **学习进度追踪**：自动记录每节课的播放进度、完成状态，支持断点续播
- **课程管理**：新增/编辑/删除课程、章节、课时，支持封面图上传
- **分类管理**：自定义课程分类，支持多级分类
- **用户与权限**：内置管理员/普通用户双角色，支持用户增删改查、密码修改
- **视频上传**：将本地视频文件上传至媒体服务器，支持上传进度实时反馈
- **媒体代理**：本地内存滑动窗口代理，解决 OSS/CDN 分片存储导致的 Range 请求卡顿问题
- **IP/域名双模式切换**：支持局域网 IP 访问与域名访问两种播放模式一键切换

### 🛡️ 安全特性
- 登录凭证采用 **AES-256-GCM** 加密存储
- 上传 Token 同样加密持久化
- Context Isolation + 预加载脚本，渲染进程无法直接访问 Node.js
- IPC 参数经过类型校验与清洗，防止恶意数据透传

### ⚡ 性能优化
- Chromium 启动参数调优（磁盘缓存、媒体缓存、GPU 加速解码）
- 媒体代理 32MB 内存滑动窗口，减少回源请求次数
- 窗口 `ready-to-show` 后再初始化数据库，不阻塞首屏
- 后台自动同步课程源，启动后 1.5s 触发

---

## 📦 技术栈

| 类别 | 技术 |
|------|------|
| 桌面框架 | Electron 44 |
| 打包工具 | electron-builder 25 |
| 云盘通信 | CloudDrive2 gRPC-Web（自研 `@andie/cd2` 客户端） |
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
│   ├── cd2-auth.js            # CD2 请求认证拦截器（webRequest）
│   ├── media-proxy.js         # 本地媒体代理服务（内存滑动窗口）
│   ├── cover-path.js          # 课程封面图路径转换
│   └── ipc/                   # IPC 处理器（按功能拆分）
│       ├── index.js           # 聚合注册入口
│       ├── auth.js            # 登录/登出/用户管理
│       ├── courses.js         # 课程/分类/章节/课时 CRUD
│       ├── sources.js         # 课程源管理 + 同步
│       ├── rebuild.js         # 重建课程章节
│       ├── files.js           # 文件选择 + PDF 下载/预览
│       └── upload.js          # 视频上传 + 上传配置
├── services/                  # 业务服务层
│   ├── sync-service.js        # CD2 同步编排
│   ├── cd2-fetch.js           # CD2 目录递归扫描
│   └── cd2-utils.js           # CD2 工具函数
├── database/                  # 数据层
│   ├── course-db.js           # 课程数据 JSON 存储
│   ├── config.js              # 课程源配置
│   └── upload-config.js       # 上传配置（加密存储 Token）
├── packages/
│   └── cd2/                   # CloudDrive2 gRPC-Web 客户端封装
├── src/                       # 渲染进程（前端）
│   ├── index.html             # 主页面（登录页 + 主应用）
│   ├── css/style.css          # 全局样式
│   ├── images/covers/         # 课程封面图
│   └── js/
│       ├── app.js             # 全局工具（弹窗、Toast、快捷键）
│       ├── auth.js            # 登录/导航/同步模式切换
│       ├── course-list.js     # 课程列表页
│       ├── course-detail.js   # 课程详情页 + 播放器
│       ├── course-mgmt.js     # 课程/分类/用户/上传配置管理
│       ├── source-mgmt.js     # 课程源管理 + 快速添加向导
│       └── player.js          # 视频播放器（含卡顿诊断）
├── preload.js                 # 预加载脚本（暴露安全的 electronAPI）
├── clouddrive.proto           # CloudDrive2 Protobuf 定义
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

> 注意：`@andie/cd2` 是本地包（`file:./packages/cd2`），无需单独安装。

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

### 1. 添加课程（从 CloudDrive2 同步）

1. 以管理员身份登录，点击左侧「📚 课程管理」
2. 点击「⚡ 快速添加课程」或「📂 扫描云盘」
3. 填入 CloudDrive2 的 **API Token** 和 **Endpoint**（如 `127.0.0.1:19799`）
4. 浏览云盘目录，进入目标课程文件夹
5. 点击「✅ 选择当前文件夹作为课程」
6. 完善课程信息（分类、封面、难度等）后保存

### 2. 播放课程

1. 在「📖 全部课程」页点击课程卡片进入详情
2. 选择章节中的课时开始播放
3. 播放器自动记忆播放进度，下次进入可续播

### 3. 切换播放模式

左侧底部「📡 同步模式开关」：
- **IP 模式**：通过局域网 IP 直接访问 CloudDrive2
- **域名模式**：通过域名代理访问（适用于远程部署）

### 4. 上传视频

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
│  │ 数据层    │ │ 服务层    │ │ CD2 认证拦截器    │ │
│  │ (JSON)   │ │ (sync)   │ │ (webRequest)     │ │
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

### 媒体代理

视频播放时，`<video>` 元素的 Range 请求被本地代理（`127.0.0.1`）拦截：

1. 浏览器发 2MB 小 Range → 代理向上游一次请求 32MB 大窗口
2. 内存缓存最近下载的字节，短时间内重复 seek 直接命中
3. 完全不写磁盘，不占用用户存储空间

---

## 🔧 配置说明

### 课程源配置

存储于 `userData/course-sources.json`：

```json
{
  "version": 1,
  "sources": [
    {
      "id": 1,
      "name": "我的115网盘",
      "endpoint": "127.0.0.1:19799",
      "token": "b2d284cd-xxxx-xxxx",
      "remotePath": "/课程"
    }
  ]
}
```

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

- **asar 打包**：启用，`sql.js` 和 `@andie/cd2` 解包（原生模块）
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