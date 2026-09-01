const { app, BrowserWindow, ipcMain, Menu, dialog, session, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const https = require('https');
const db = require('./database');
const courseDb = require('./course-db');
const configMod = require('./config');
const syncService = require('./sync-service');

let mainWindow;
let appReady = false;

// ============================================================
//  打包后的路径助手（无侵入：找不到文件时才 fallback 到 extraResources）
//  electron-builder 会把 extraResources 下的文件放到安装目录 resources/
//  而 asar 中的 __dirname = resources/app.asar/，所以 ../resources 就是父级
// ============================================================
function _extraResourcesDir() {
  try {
    if (app && typeof process !== 'undefined' && process.resourcesPath) {
      return String(process.resourcesPath || '');
    }
  } catch (_) {}
  return path.join(__dirname, '..');
}
function _resolveExtra(relPath) {
  const tryPath = (base) => {
    if (!base) return null;
    const p = path.normalize(path.join(base, relPath));
    return fs.existsSync(p) ? p : null;
  };
  return tryPath(__dirname) || tryPath(_extraResourcesDir()) || null;
}

// ===== 课程封面图路径：数据库统一存「项目相对路径」，读写两端做转换 =====
const PROJECT_ROOT = __dirname;
function _isRemoteUrl(u) { return /^https?:\/\//i.test(String(u || '')); }
function _stripFileProtocol(u) {
  var s = String(u || '');
  s = s.replace(/^file:\/+/i, '');
  // Windows: /C:/a/b → C:/a/b
  if (/^\/[A-Za-z]:\//.test(s)) s = s.substring(1);
  return s;
}
// 写库：file:///... / 本地绝对路径 → 项目相对路径（http(s) 原样）
function coverPathForDb(inputUrl) {
  if (!inputUrl) return '';
  if (_isRemoteUrl(inputUrl)) return inputUrl;
  var abs = path.normalize(_stripFileProtocol(inputUrl));
  try {
    var rel = path.relative(PROJECT_ROOT, abs).replace(/\\/g, '/');
    if (rel && rel.substring(0, 2) !== '..') return rel;
  } catch (_) {}
  // 非项目内的其它本地绝对路径 → 记录绝对路径（兼容老数据 / 外部文件）
  return abs.replace(/\\/g, '/');
}
// 读库：项目相对路径 / 本地路径 → file:/// 绝对 URL（http(s) 原样）
function coverUrlForDisplay(dbValue) {
  if (!dbValue) return '';
  if (_isRemoteUrl(dbValue)) return dbValue;
  var s = String(dbValue).replace(/\\/g, '/');
  var abs;
  if (path.isAbsolute(s) || /^\/[A-Za-z]:\//.test('/' + s) || /^[A-Za-z]:\//.test(s)) {
    abs = path.normalize(s);
  } else {
    // 1) 开发/旧数据：PROJECT_ROOT（项目根或 app.asar 根）  2) 打包：extraResources/resources/ + src/ + images/ 几处兜底
    const trys = [
      path.join(PROJECT_ROOT, s),
      path.join(_extraResourcesDir(), s),
      path.join(_extraResourcesDir(), 'src', s),
    ];
    abs = null;
    for (const p of trys) { if (fs.existsSync(p)) { abs = p; break; } }
    if (!abs) abs = trys[0];
  }
  return 'file:///' + abs.replace(/\\/g, '/').replace(/^\/+/, '');
}

async function createWindow() {
  await db.initDatabase();
  await courseDb.initCourseDatabase();

  // 提前配置默认 Session：磁盘缓存、加大视频文件的磁盘缓存配额
  // 默认 Chromium 磁盘缓存只有几十 MB，视频会频繁被清理，改成最多 1GB
  try {
    const cacheDir = path.join(app.getPath('userData'), 'Cache', 'media-cache');
    const cacheSizeBytes = 1024 * 1024 * 1024; // 1GB
    await session.defaultSession.setProxy({ mode: 'system' }).catch(() => {});
    // Chromium 会根据配额自动管理磁盘缓存
    try { await session.defaultSession.setStorageQuota(cacheSizeBytes); } catch (_) {}
    // 禁用不必要的内存压力清理，尽量把视频块留在缓存里
    try { await session.defaultSession.setPreloads([]); } catch (_) {}
    // 预先触发缓存目录的创建
    const fsExtra = require('fs');
    if (!fsExtra.existsSync(cacheDir)) {
      try { fsExtra.mkdirSync(cacheDir, { recursive: true }); } catch (_) {}
    }
    console.log('[cache] 媒体磁盘缓存已配置，最大配额 ~1GB，目录：', cacheDir);
  } catch (_) {}

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    title: '在线课程学习平台',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      v8CacheOptions: 'code',
      spellcheck: false,
      sandbox: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// 注册 webRequest 拦截器，为 CloudDrive2 文件请求动态添加认证头
function registerCd2AuthInterceptor() {
  // 课程认证缓存（避免每次请求都读 JSON 文件）
  let _courseAuthCache = null;
  let _courseAuthCacheTime = 0;
  const COURSE_AUTH_CACHE_TTL = 30000; // 30秒缓存

  // 从 courses_data.json 中收集课程级别的 host:port → token 映射
  function buildCourseAuthMap() {
    const now = Date.now();
    if (_courseAuthCache && (now - _courseAuthCacheTime) < COURSE_AUTH_CACHE_TTL) {
      return _courseAuthCache;
    }
    const authMap = new Map();
    try {
      // 优先读 course-db 已解析过的那份运行期 JSON（userData），否则回落到 asar/extraResources
      const candidates = [];
      try {
        const { app } = require('electron');
        if (app && app.isPackaged && typeof app.getPath === 'function') {
          candidates.push(path.join(app.getPath('userData'), 'courses_data.json'));
        }
      } catch (_) {}
      candidates.push(path.join(__dirname, 'courses_data.json'));
      try {
        if (typeof process !== 'undefined' && process.resourcesPath) {
          candidates.push(path.join(process.resourcesPath, 'courses_data.json'));
        }
      } catch (_) {}
      let coursesPath = null;
      for (const p of candidates) { if (fs.existsSync(p)) { coursesPath = p; break; } }
      if (coursesPath) {
        const raw = JSON.parse(fs.readFileSync(coursesPath, 'utf-8'));
        const courses = raw.courses || [];
        for (const c of courses) {
          const domain = (c.domain || '').trim();
          const token = (c.token || '').trim();
          if (!domain || !token) continue;
          let host = domain.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
          if (!host.includes(':')) host += ':19798';
          if (!authMap.has(host)) {
            authMap.set(host, token);
          }
        }
      }
    } catch (e) {
      console.error('[auth] 读取课程认证信息失败:', e.message);
    }
    _courseAuthCache = authMap;
    _courseAuthCacheTime = now;
    if (authMap.size > 0) {
      console.log('[auth] 课程认证: 已加载 %d 个 host', authMap.size);
    }
    return authMap;
  }

  // 从 sources 配置 + 课程数据中收集所有需要认证的 host:port → token
  function buildAuthMap() {
    const authMap = new Map();

    // 第一层：sources 配置（优先级最高）
    const sources = configMod.allSources();
    if (sources && sources.length > 0) {
      for (const s of sources) {
        if (s.enabled === false) continue;
        const cfg = s.config || {};
        const endpoint = cfg.endpoint || s.endpoint || '127.0.0.1:19798';
        const token = cfg.token || s.token || '';
        if (!token) continue;
        let host = endpoint.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
        if (!host.includes(':')) host += ':19798';
        authMap.set(host, token);
        console.log('[auth] 注册 CD2 拦截器: %s (token=%s)', host, token.slice(0, 6) + '***');
      }
    }

    // 第二层：课程级别认证（sources 中已有的 host 不会被覆盖）
    const courseAuth = buildCourseAuthMap();
    for (const [host, token] of courseAuth) {
      if (!authMap.has(host)) {
        authMap.set(host, token);
        console.log('[auth] 注册课程拦截器: %s (token=%s)', host, token.slice(0, 6) + '***');
      }
    }
    return authMap;
  }

  // 拦截所有请求，为匹配的 host 动态添加认证头
  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    try {
      const url = new URL(details.url);
      const hostPort = url.host;
      const authMap = buildAuthMap();
      if (authMap.has(hostPort)) {
        const token = authMap.get(hostPort);
        details.requestHeaders['Authorization'] = 'Bearer ' + token;
        if (details.url.includes('.mp4') || details.url.includes('.pdf') || details.url.includes('.mkv')) {
          console.log('[auth] 为 %s 添加认证头', details.url.split('/').pop());
        }
      }
    } catch (e) {
      // URL 解析失败，忽略
    }
    callback({ requestHeaders: details.requestHeaders });
  });

  // 为 CD2 响应添加 CORS 头，解决 file:// 协议加载视频时的跨域问题
  // 同时为视频/PDF 添加缓存头，加速二次加载
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    try {
      const url = new URL(details.url);
      const hostPort = url.host;
      const authMap = buildAuthMap();
      if (authMap.has(hostPort)) {
        const isMedia = /\.(mp4|mkv|mov|avi|flv|wmv|m4v|webm|ts|mp3|wav|flac|aac|ogg|pdf)$/i.test(url.pathname);
        const responseHeaders = {
          ...details.responseHeaders,
          'Access-Control-Allow-Origin': ['*'],
          'Access-Control-Allow-Methods': ['GET, HEAD, OPTIONS, POST'],
          'Access-Control-Allow-Headers': ['Authorization, Range, Content-Type'],
          'Access-Control-Expose-Headers': ['Content-Length, Content-Range, Accept-Ranges, Cache-Control'],
          'Accept-Ranges': ['bytes'],
        };
        if (isMedia) {
          // 视频/PDF：强制允许 HTTP 缓存 7 天，ETag/Last-Modified 有效时命中缓存不走网络
          responseHeaders['Cache-Control'] = ['public, max-age=604800, immutable'];
          // 如果响应头里原本没 Vary，就不要加，避免 Chromium 因 Vary: Origin 不做磁盘缓存
          delete responseHeaders['Vary'];
          // 让 Chromium 信任这些静态资源，尽量落到磁盘缓存里
          responseHeaders['X-Cache-Hint'] = ['prefer-disk-cache'];
        }
        callback({ responseHeaders });
        return;
      }
    } catch (e) {
      // URL 解析失败，忽略
    }
    callback({ responseHeaders: details.responseHeaders });
  });

  console.log('[auth] CD2 请求拦截器已注册（含 CORS 头注入）');
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  await createWindow();
  appReady = true;

  // 注册 CloudDrive2 认证拦截器
  registerCd2AuthInterceptor();

  // 启动后台自动同步（启用了 autoSync 的源）
  try {
    setTimeout(async () => {
      console.log('[auto-sync] 开始后台自动同步');
      try {
        const r = await syncService.syncAll();
        console.log('[auto-sync] 同步结果:', JSON.stringify(r));
      } catch (e) {
        console.error('[auto-sync] 后台同步异常:', e);
      }
      if (mainWindow && !mainWindow.isDestroyed()) {
        try { mainWindow.webContents.send('sources-synced'); } catch (e) { console.error('[auto-sync] 通知前端失败:', e.message); }
      } else {
        console.log('[auto-sync] 主窗口不存在，跳过通知');
      }
    }, 2000);
  } catch (e) {
    console.error('启动自动同步失败:', e);
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  db.closeDatabase();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// ============================================================
//  IPC 处理器
// ============================================================

function _mapCoverForReturn(data) {
  if (!data) return data;
  // 数组（课程列表） / 单个对象 都处理
  const arr = Array.isArray(data) ? data : [data];
  arr.forEach(c => {
    if (c && Object.prototype.hasOwnProperty.call(c, 'coverImage')) {
      c.coverImage = coverUrlForDisplay(c.coverImage || '');
    }
  });
  return data;
}

ipcMain.handle('get-courses', async () => {
  return _mapCoverForReturn(db.getAllCourses());
});

ipcMain.handle('get-course-detail', async (event, courseId) => {
  return _mapCoverForReturn(db.getCourseDetail(courseId));
});

ipcMain.handle('get-categories', async () => {
  return db.getAllCategories();
});

ipcMain.handle('search-courses', async (event, { keyword, categoryId, level }) => {
  return _mapCoverForReturn(db.searchCourses(keyword, categoryId, level));
});

ipcMain.handle('get-course-stats', async () => {
  return db.getCourseStats();
});

ipcMain.handle('update-progress', async (event, { courseId, lessonId, progress, completed, lastPosition }) => {
  return db.updateProgress(courseId, lessonId, progress, completed, lastPosition);
});

ipcMain.handle('get-course-progress', async (event, courseId) => {
  return db.getCourseProgress(courseId);
});

ipcMain.handle('add-course', async (event, courseData) => {
  if (courseData && Object.prototype.hasOwnProperty.call(courseData, 'coverImage')) {
    courseData.coverImage = coverPathForDb(courseData.coverImage || '');
  }
  return db.addCourse(courseData);
});

// ============================================================
//  PDF 文件下载：唤出保存对话框 → 下载文件
// ============================================================
ipcMain.handle('download-file', async (event, { url, filename, authToken }) => {
  const { canceled, filePath } = await dialog.showSaveDialog({
    defaultPath: filename || 'document.pdf',
    filters: [{ name: 'PDF 文件', extensions: ['pdf'] }],
  });
  if (canceled || !filePath) return { success: false, canceled: true };

  try {
    await downloadPdfToPath(url, filePath, authToken);
    return { success: true, filePath };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

function downloadPdfToPath(url, filePath, authToken) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const options = { headers: {} };
    if (authToken) {
      options.headers['Authorization'] = 'Bearer ' + authToken;
    }
    protocol.get(url, options, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        const redirectProtocol = response.headers.location.startsWith('https') ? https : http;
        redirectProtocol.get(response.headers.location, { headers: options.headers }, (res2) => {
          const fileStream = fs.createWriteStream(filePath);
          res2.pipe(fileStream);
          fileStream.on('finish', () => { fileStream.close(); resolve(filePath); });
          fileStream.on('error', (err) => { reject(err); });
        }).on('error', (err) => { reject(err); });
        return;
      }
      const fileStream = fs.createWriteStream(filePath);
      response.pipe(fileStream);
      fileStream.on('finish', () => {
        fileStream.close();
        resolve(filePath);
      });
      fileStream.on('error', (err) => { reject(err); });
    }).on('error', (err) => { reject(err); });
  });
}

ipcMain.handle('preview-file', async (event, { url, filename, authToken }) => {
  const safeName = (filename || 'preview.pdf').replace(/[\\/:*?"<>|]/g, '_');
  const tmpDir = path.join(os.tmpdir(), 'course-client-preview');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  const filePath = path.join(tmpDir, Date.now() + '_' + safeName);
  try {
    await downloadPdfToPath(url, filePath, authToken);
    shell.openPath(filePath);
    return { success: true, filePath };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('delete-course', async (event, courseId) => {
  return db.deleteCourse(courseId);
});

ipcMain.handle('update-course', async (event, courseData) => {
  if (courseData && Object.prototype.hasOwnProperty.call(courseData, 'coverImage')) {
    courseData.coverImage = coverPathForDb(courseData.coverImage || '');
  }
  return db.updateCourse(courseData);
});

// ===== 分类管理 =====
ipcMain.handle('add-category', async (event, { id, name, icon }) => {
  if (id) return db.updateCategory(id, name, icon);
  return db.addCategory(name, icon);
});
ipcMain.handle('update-category', async (event, { id, name, icon }) => {
  return db.updateCategory(id, name, icon);
});
ipcMain.handle('delete-category', async (event, categoryId) => {
  return db.deleteCategory(categoryId);
});

// ===== 章节管理 =====
ipcMain.handle('add-chapter', async (event, { courseId, title }) => {
  return db.addChapter(courseId, title);
});
ipcMain.handle('delete-chapter', async (event, chapterId) => {
  return db.deleteChapter(chapterId);
});
ipcMain.handle('update-chapter', async (event, { chapterId, title }) => {
  return db.updateChapter(chapterId, title);
});

// ===== 分集（课时）管理 =====
ipcMain.handle('add-lesson', async (event, { chapterId, title, duration }) => {
  return db.addLesson(chapterId, title, duration);
});
ipcMain.handle('delete-lesson', async (event, lessonId) => {
  return db.deleteLesson(lessonId);
});
ipcMain.handle('update-lesson', async (event, { lessonId, data }) => {
  return db.updateLesson(lessonId, data);
});

// 从 CloudDrive2 获取云盘课程章节（旧：硬编码 token）
const { fetchCourseChapters } = require('./cd2-course');
ipcMain.handle('fetch-cd2-course', async () => {
  return await fetchCourseChapters();
});

// ===== 课程源（配置文件）管理 =====
function _safe(p, label) {
  return Promise.resolve(p).catch(e => {
    console.error(`[IPC ${label || '?'}] ERROR:`, e && e.stack || e);
    return { success: false, error: (e && e.message) || String(e) };
  });
}
ipcMain.handle('get-all-sources', async () => {
  return _safe(configMod.allSources(), 'get-all-sources');
});
ipcMain.handle('save-source', async (event, source) => {
  return _safe(configMod.upsertSource(source), 'save-source');
});
ipcMain.handle('delete-source', async (event, sourceId) => {
  return _safe(configMod.deleteSource(sourceId), 'delete-source');
});
ipcMain.handle('sync-source', async (event, sourceId) => {
  return _safe(syncService.syncSource(sourceId), 'sync-source');
});
ipcMain.handle('sync-all-sources', async () => {
  return _safe(syncService.syncAll(), 'sync-all-sources');
});
ipcMain.handle('scan-course-drafts', async (event, opts) => {
  return _safe(syncService.scanCourseDrafts(opts || {}), 'scan-course-drafts');
});
ipcMain.handle('list-cloud-directory', async (event, opts) => {
  return _safe(syncService.listCloudDirectory(opts || {}), 'list-cloud-directory');
});
ipcMain.handle('quick-scan-one-course', async (event, opts) => {
  return _safe(syncService.quickScanOneCourse(opts || {}), 'quick-scan-one-course');
});

// ============================================================
//  单门课程章节重建：从课程自身的 domain/port/token/sourcePath 拉 CD2 并写库
// ============================================================
ipcMain.handle('rebuild-course-chapters', async (event, opts) => {
  const tAllStart = Date.now();
  console.log('\n########## [步骤4/9] 主进程收到 IPC: rebuild-course-chapters ##########');
  console.log('[步骤4] 入参 opts →', JSON.stringify(opts, null, 2));
  try {
    console.log('[步骤4.1] 校验 courseId...');
    const courseId = parseInt(opts && opts.courseId);
    if (!courseId || isNaN(courseId)) {
      console.log('[步骤4.1] ✗ 失败：缺少课程ID');
      return { success: false, error: '缺少课程ID' };
    }
    console.log('[步骤4.1] ✓ courseId =', courseId);

    console.log('[步骤4.2] 从 DB 读取课程详情...');
    const detail = db.getCourseDetail(courseId);
    if (!detail) {
      console.log('[步骤4.2] ✗ 失败：课程不存在');
      return { success: false, error: '课程不存在' };
    }
    console.log('[步骤4.2] ✓ 课程存在 → id=%s title=%s 现有章节数=%d', detail.id, detail.title, (detail.chapters||[]).length);

    // ===== 持久化保存的 domain/port（用课程原本配置，不被本地同步模式临时覆盖影响）=====
    let domain = String(detail.domain || '').trim();
    let port   = String(detail.port != null ? detail.port : '').trim();
    let token  = String(detail.token != null ? detail.token : '').trim();
    let sourcePath = String((opts && opts.sourcePath != null ? opts.sourcePath : (detail.sourcePath || ''))).trim() || '/';
    console.log('[步骤4.3] 持久化配置（来自DB）→ domain=%s port=%s token=%s sourcePath(原)=%s',
      domain, port||'(空)', token?token.slice(0,6)+'***':'(空)', detail.sourcePath||'(空)');

    // ===== 临时用的连接地址（如果有 _connectOverride，本地同步模式）=====
    let connectDomain = domain;
    let connectPort = port;
    if (opts && opts._connectOverride) {
      console.log('[步骤4.4] 检测到本地同步模式 _connectOverride →', JSON.stringify(opts._connectOverride));
      if (opts._connectOverride.domain) connectDomain = String(opts._connectOverride.domain).trim();
      if (opts._connectOverride.port != null) connectPort = String(opts._connectOverride.port).trim();
      console.log('[步骤4.4] 临时连接地址被修改为 connectDomain=%s connectPort=%s（不会写回DB）', connectDomain, connectPort||'(空)');
    } else {
      // 兼容旧的调用方式：如果明确传了 opts.domain/port 且不是来自本地同步模式，就用它（同时也会写回持久化）
      if (opts && opts.domain != null) { domain = String(opts.domain).trim(); connectDomain = domain; }
      if (opts && opts.port != null)   { port   = String(opts.port).trim();   connectPort   = port; }
    }
    // token 如果明确传了，视为要更新到持久化
    if (opts && opts.token != null)  { token  = String(opts.token).trim(); console.log('[步骤4.4] token 被调用方显式传入，将写回DB'); }

    console.log('[步骤4.5] 参数校验：connectDomain=%s token=%s', connectDomain, token?'有':'无');
    if (!connectDomain) { console.log('[步骤4.5] ✗ 缺少域名'); return { success: false, error: '缺少域名：请在编辑课程里填写 CloudDrive2 地址' }; }
    if (!token)  { console.log('[步骤4.5] ✗ 缺少 Token'); return { success: false, error: '缺少 Token：请在编辑课程里填写' }; }
    console.log('[步骤4.5] ✓ 参数校验通过');

    // endpoint 组装（兼容直接写在 domain 里的完整 URL）
    let endpoint = connectDomain;
    if (!/^https?:\/\//i.test(endpoint)) {
      endpoint = 'http://' + endpoint + (connectPort ? (':' + connectPort) : '');
    } else if (connectPort) {
      try {
        const u = new URL(endpoint);
        u.port = connectPort;
        endpoint = u.origin;
      } catch (e) {}
    }

    // ⚠️ @andie/cd2 的 createClient 内部用 split(':') 提取 host/port，
    //    不能带 http:// 前缀，必须转成 host:port 格式
    const rawEndpoint = endpoint.replace(/^https?:\/\//i, '');
    console.log('[步骤4.6] endpoint 组装 → 完整URL=%s → rawEndpoint(给@andie/cd2用)=%s', endpoint, rawEndpoint);

    // 1) 拉取
    console.log('\n========== [步骤5/9] 调用 syncService.quickScanOneCourse 开始扫描云盘 ==========');
    const tScan = Date.now();
    const draft = await syncService.quickScanOneCourse({
      type: (opts && opts.type) || 'cd2',
      endpoint: rawEndpoint,
      token,
      folderPath: sourcePath,
    });
    console.log('[步骤5] quickScanOneCourse 返回，耗时 %ss', ((Date.now()-tScan)/1000).toFixed(2));
    if (!draft || !draft.chapters || draft.chapters.length === 0) {
      console.log('[步骤5] ✗ 失败：拉到空章节 draft=', JSON.stringify(draft, null, 2));
      return { success: false, error: `从 ${endpoint} 拉到了空章节，请检查路径「${sourcePath}」下是否有章→节→视频的目录结构` };
    }
    const totalLessons = draft.chapters.reduce((s,c)=>s+(c.lessons?c.lessons.length:0),0);
    console.log('[步骤5] ✓ 扫描完成 → chapters=%d 个，lessons=%d 个，各章详情：', draft.chapters.length, totalLessons);
    draft.chapters.forEach((ch, i) => {
      console.log('    章%d "%s" → %d 集', i+1, ch.title, (ch.lessons||[]).length);
      (ch.lessons||[]).slice(0, 2).forEach((l, j) => console.log('      - 课时%d: %s | URL=%s', j+1, l.title, (l.videoUrl||'').slice(0,80)+((l.videoUrl||'').length>80?'...':'')));
      if ((ch.lessons||[]).length > 2) console.log('      ... (省略剩余 %d 个课时)', (ch.lessons||[]).length - 2);
    });

    // 调试：打印第一个章节的第一个视频 URL
    const firstCh = draft.chapters[0];
    const firstLesson = firstCh && firstCh.lessons && firstCh.lessons[0];
    if (firstLesson) {
      console.log('[步骤5] 第1个课时详情: title=%s videoUrl=%s videoUrlLocal=%s', firstLesson.title, firstLesson.videoUrl, firstLesson.videoUrlLocal);
    } else {
      console.log('[步骤5] 警告: 第1章没有课时! chapters=%d', draft.chapters.length);
    }

    // 2) 回写：用 updateCourse + 明确传 chapters（已修复的安全版本）
    //    domain/port/token 只在调用方明确传入（且不是本地同步模式的临时覆盖）时才会更新持久化配置
    //    本地同步模式（_connectOverride）下不会修改保存的 domain/port
    console.log('\n========== [步骤6/9] 写回数据库 db.updateCourse ==========');
    const isLocalOverride = !!(opts && opts._connectOverride);
    const updatePayload = {
      courseId,
      categoryId: detail.categoryId,
      title: detail.title,
      subtitle: detail.subtitle || '',
      description: detail.description || '',
      instructor: detail.instructor || '',
      level: detail.level || '初级',
      duration: `${draft.chapters.length}章${totalLessons}集`,
      rating: detail.rating || 0,
      students: detail.students || 0,
      coverImage: coverPathForDb(detail.coverImage || ''),
      coverColor: detail.coverColor || '',
      domain: (!isLocalOverride && opts && opts.domain != null) ? opts.domain : detail.domain,
      port:   (!isLocalOverride && opts && opts.port   != null) ? opts.port   : detail.port,
      token:  (opts && opts.token  != null) ? opts.token  : detail.token,
      chapters: draft.chapters,
      sourcePath,
    };
    console.log('[步骤6] updateCourse 入参摘要 → courseId=%s duration=%s chapters数=%d isLocalOverride=%s (domain=%s port=%s 写回?)',
      updatePayload.courseId, updatePayload.duration, draft.chapters.length, isLocalOverride,
      updatePayload.domain, updatePayload.port||'(空)');
    const tDb = Date.now();
    const upr = db.updateCourse(updatePayload);
    console.log('[步骤6] db.updateCourse 返回，耗时 %ss →', ((Date.now()-tDb)/1000).toFixed(2), JSON.stringify(upr));
    if (!upr || !upr.success) {
      console.log('[步骤6] ✗ 写数据库失败');
      return { success: false, error: (upr && upr.error) || '写数据库失败' };
    }
    console.log('[步骤6] ✓ 写数据库成功');

    // 验证：重新读取课程，检查第一个课时的 video_url
    console.log('\n========== [步骤7/9] 数据库写入验证 ==========');
    const verify = db.getCourseDetail(courseId);
    if (verify && verify.chapters && verify.chapters.length > 0) {
      const vCh = verify.chapters[0];
      const vL = vCh.lessons && vCh.lessons[0];
      const verifyLessons = verify.chapters.reduce((s,c)=>s+(c.lessons?c.lessons.length:0),0);
      console.log('[步骤7] ✓ 验证通过 → 重读后 chapters=%d 个 lessons=%d 个', verify.chapters.length, verifyLessons);
      if (vL) {
        console.log('[步骤7] 第1课时确认: title=%s videoUrl=%s videoUrlLocal=%s', vL.title, vL.videoUrl, vL.videoUrlLocal);
      }
    } else {
      console.log('[步骤7] ✗ 验证失败：重读后仍为空');
    }

    const result = {
      success: true,
      chapters: draft.chapters.length,
      lessons: totalLessons,
      sourcePath,
      endpoint,
    };
    console.log('\n########## [步骤8/9] IPC 返回结果 总耗时 %ss ########## → %s',
      ((Date.now()-tAllStart)/1000).toFixed(2), JSON.stringify(result));
    return result;
  } catch (e) {
    console.error('[rebuild-chapters] ✗ 异常:', e && e.message ? e.message : String(e));
    console.error('[rebuild-chapters] 堆栈:', e && e.stack);
    return { success: false, error: e && e.message ? e.message : String(e) };
  }
});
ipcMain.handle('add-course-with-chapters', async (event, courseData) => {
  return _safe(db.upsertCourseFromSource({
    sourceId: courseData.sourceId || null,
    sourceKey: courseData.sourceKey || ('manual::' + Date.now()),
    categoryId: courseData.categoryId,
    title: courseData.title,
    subtitle: courseData.subtitle || '',
    description: courseData.description || '',
    instructor: courseData.instructor || '系统导入',
    level: courseData.level || '初级',
    duration: courseData.duration || '',
    rating: Number(courseData.rating) || 4.5,
    students: Number(courseData.students) || 0,
    coverColor: courseData.coverColor || 'linear-gradient(135deg, #667eea, #764ba2)',
    coverImage: coverPathForDb(courseData.coverImage || ''),
    domain: courseData.domain || 'yide2099.de5.net',
    port: courseData.port || '',
    token: courseData.token || '',
    chapters: courseData.chapters || [],
  }), 'add-course-with-chapters');
});

ipcMain.handle('pick-cover-image', async () => {
  try {
    // 1. 弹出文件选择框
    const res = await dialog.showOpenDialog(mainWindow, {
      title: '选择课程封面图片',
      properties: ['openFile'],
      filters: [
        { name: '图片文件', extensions: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'] },
      ],
    });
    if (!res || res.canceled || !res.filePaths || !res.filePaths[0]) {
      return { success: false, canceled: true };
    }
    const srcFile = res.filePaths[0];
    if (!fs.existsSync(srcFile)) return { success: false, error: '文件不存在' };

    // 2. 把图片复制到项目目录 src/images/covers
    //    （随项目一起保存/备份，避免卸载 userData 时丢失封面）
    const projectImagesDir = path.join(__dirname, 'src', 'images');
    const coversDir = path.join(projectImagesDir, 'covers');
    if (!fs.existsSync(coversDir)) fs.mkdirSync(coversDir, { recursive: true });

    // 生成唯一文件名：时间戳+原扩展名
    const ext = (path.extname(srcFile) || '.jpg').toLowerCase();
    const destName = `cover_${Date.now()}_${Math.floor(Math.random() * 10000)}${ext}`;
    const destPath = path.join(coversDir, destName);

    fs.copyFileSync(srcFile, destPath);

    // 3. 返回"file://" 绝对路径，让 HTML <img> 能直接显示
    const fileUrl = 'file:///' + destPath.replace(/\\/g, '/').replace(/^\/+/, '');
    return { success: true, fileUrl, localPath: destPath, coversDir };
  } catch (e) {
    return { success: false, error: e.message || String(e) };
  }
});