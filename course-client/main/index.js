// ============================================================
//  主进程入口
//  职责：Chromium 开关 + 窗口创建 + 应用生命周期 + 启动流程
// ============================================================
const { app, BrowserWindow, Menu, session, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const db = require('../database/course-db');
const state = require('./state');
const { startMediaProxy } = require('./media-proxy');
const { registerAll } = require('./ipc');

// ===== 全局异常捕获 =====
process.on('uncaughtException', (err) => {
  console.error('[FATAL] 未捕获的异常:', err && err.message);
  try { console.error(err && err.stack); } catch (_) {}
});

process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] 未处理的 Promise 拒绝:', reason);
});

// ===== 低内存 / 快速启动 Chromium 开关 =====
try {
  app.commandLine.appendSwitch('disk-cache-size', String(1024 * 1024 * 1024));
  app.commandLine.appendSwitch('media-cache-size', String(256 * 1024 * 1024));
  app.commandLine.appendSwitch('disable-gpu-cache');  // 避免 Windows 缓存目录权限错误 (0x5)
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
  app.commandLine.appendSwitch('enable-accelerated-video-decode');
  app.commandLine.appendSwitch('enable-zero-copy');
  app.commandLine.appendSwitch('video-threads', '4');
  app.commandLine.appendSwitch('max-unused-vulkan-memory-mb', '64');
  app.commandLine.appendSwitch('disable-component-update');
  app.commandLine.appendSwitch('no-default-browser-check');
  app.commandLine.appendSwitch('disable-sync');
  app.commandLine.appendSwitch('no-pings');
  app.commandLine.appendSwitch('disable-default-apps');
  app.commandLine.appendSwitch('disable-extensions');
  app.commandLine.appendSwitch('renderer-process-limit', '4');
  app.commandLine.appendSwitch('disable-renderer-backgrounding');
  app.commandLine.appendSwitch('v8-cache-strategies-for-cache-storage', 'b');
  app.commandLine.appendSwitch('v8-cache-options', 'code');
  app.commandLine.appendSwitch('disable-media-suspend');
  app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
  app.commandLine.appendSwitch('disable-features', 'MediaSessionService,HardwareMediaKeyHandling');
  app.commandLine.appendSwitch('enable-resource-scheduler');
  app.commandLine.appendSwitch('media-range-requests-cache-size', String(256 * 1024 * 1024));
} catch (_) {}

// ===== 窗口创建 =====
async function createWindow() {
  state.mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    title: '在线课程学习平台',
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    backgroundColor: '#F5F3FF',
    show: false,
    paintWhenInitiallyHidden: true,
    frame: false,
    titleBarStyle: 'hidden',
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      v8CacheOptions: 'code',
      spellcheck: false,
      sandbox: false,
      offscreen: false,
      enableWebSQL: false,
      webgl: true,
      autoplayPolicy: 'no-user-gesture-required',
      disableBlinkFeatures: 'AutoDarkMode,MediaSessionService',
    },
  });

  state.mainWindow.once('ready-to-show', () => {
    try { state.mainWindow && state.mainWindow.show(); } catch (_) {}
    setImmediate(async () => {
      try {
        await db.initCourseDatabase();
        try {
          const cacheDir = path.join(app.getPath('userData'), 'Cache', 'media-cache');
          await session.defaultSession.setProxy({ mode: 'system' }).catch(() => {});
          try { await session.defaultSession.setStorageQuota(512 * 1024 * 1024); } catch (_) {}
          if (!fs.existsSync(cacheDir)) try { fs.mkdirSync(cacheDir, { recursive: true }); } catch (_) {}
          const marker = path.join(cacheDir, '.initialized');
          if (!fs.existsSync(marker)) {
            try { fs.writeFileSync(marker, '1'); } catch (_) {}
            try { await session.defaultSession.clearCache(); } catch (_) {}
          }
        } catch (_) {}
        console.log('[boot] 数据库 & 认证拦截器就绪（已在 show 之后初始化，不阻塞首屏）');
      } catch (e) {
        console.error('[boot] 后初始化失败:', e && e.message);
      }
    });
  });

  state.mainWindow.loadFile(path.join(__dirname, '..', 'src', 'index.html'));

  // 将渲染进程 console 转发到主进程终端，方便用 npm run dev 排查前端日志
  state.mainWindow.webContents.on('console-message', (_e, level, msg) => {
    console.log('[renderer:' + level + '] ' + msg);
  });

  state.mainWindow.on('will-move', () => {
    try { state.mainWindow.webContents.send('window-move-state', { moving: true }); } catch (_) {}
  });
  state.mainWindow.on('moved', () => {
    try { state.mainWindow.webContents.send('window-move-state', { moving: false }); } catch (_) {}
  });
  state.mainWindow.on('will-resize', () => {
    try { state.mainWindow.webContents.send('window-move-state', { moving: true }); } catch (_) {}
  });
  state.mainWindow.on('resized', () => {
    try { state.mainWindow.webContents.send('window-move-state', { moving: false }); } catch (_) {}
  });

  state.mainWindow.on('closed', () => {
    state.mainWindow = null;
  });

  state.mainWindow.on('maximize', () => {
    try { state.mainWindow.webContents.send('window-maximize-change', true); } catch (_) {}
  });
  state.mainWindow.on('unmaximize', () => {
    try { state.mainWindow.webContents.send('window-maximize-change', false); } catch (_) {}
  });
}

// ===== 应用生命周期 =====
app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  state.appReady = true;

  // 注册所有 IPC 处理器
  registerAll();

  // 注册无边框窗口控制 IPC
  ipcMain.handle('window-minimize', () => {
    const w = state.mainWindow;
    if (w && !w.isDestroyed()) w.minimize();
  });
  ipcMain.handle('window-maximize', () => {
    const w = state.mainWindow;
    if (w && !w.isDestroyed()) {
      if (w.isMaximized()) w.unmaximize(); else w.maximize();
    }
  });
  ipcMain.handle('window-close', () => {
    const w = state.mainWindow;
    if (w && !w.isDestroyed()) w.close();
  });
  ipcMain.handle('window-is-maximized', () => {
    const w = state.mainWindow;
    return w && !w.isDestroyed() && w.isMaximized();
  });

  // 并行启动：窗口显示 + 媒体代理 + 其它后台任务
  createWindow().catch(e => console.error('[boot] createWindow 异常:', e && e.message));

  startMediaProxy().then(port => {
    // port 已通过 media-proxy 内部变量管理，无需额外处理
    console.log('[boot] 媒体代理端口:', port);
  }).catch(() => {});
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  db.closeCourseDatabase();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});