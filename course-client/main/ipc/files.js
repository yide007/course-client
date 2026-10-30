// ===== IPC 处理器：文件选择 + PDF 下载/预览 =====
const { ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const https = require('https');
const state = require('../state');

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

function register() {
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

  ipcMain.handle('pick-video-file', async () => {
    try {
      const res = await dialog.showOpenDialog(state.mainWindow, {
        title: '选择课时视频文件',
        properties: ['openFile'],
        filters: [
          { name: '视频文件', extensions: ['mp4', 'mkv', 'avi', 'mov', 'flv', 'wmv', 'webm', 'm4v', '3gp', 'ts', 'rmvb'] },
          { name: '所有文件', extensions: ['*'] },
        ],
      });
      if (!res || res.canceled || !res.filePaths || !res.filePaths[0]) {
        return { success: false, canceled: true };
      }
      const srcFile = res.filePaths[0];
      if (!fs.existsSync(srcFile)) return { success: false, error: '文件不存在' };
      return { success: true, localPath: srcFile };
    } catch (e) {
      return { success: false, error: e.message || String(e) };
    }
  });

  ipcMain.handle('pick-video-files', async () => {
    try {
      const res = await dialog.showOpenDialog(state.mainWindow, {
        title: '选择视频文件（支持多选）',
        properties: ['openFile', 'multiSelections'],
        filters: [
          { name: '视频文件', extensions: ['mp4', 'mkv', 'avi', 'mov', 'flv', 'wmv', 'webm', 'm4v', '3gp', 'ts', 'rmvb'] },
          { name: '所有文件', extensions: ['*'] },
        ],
      });
      if (!res || res.canceled || !res.filePaths || res.filePaths.length === 0) {
        return { success: false, canceled: true };
      }
      const validFiles = [];
      for (const p of res.filePaths) {
        if (fs.existsSync(p)) {
          const stat = fs.statSync(p);
          validFiles.push({ localPath: p, size: stat.size, name: path.basename(p) });
        }
      }
      if (validFiles.length === 0) return { success: false, error: '选中的文件都不存在' };
      return { success: true, files: validFiles };
    } catch (e) {
      return { success: false, error: e.message || String(e) };
    }
  });

  ipcMain.handle('pick-doc-file', async () => {
    try {
      const res = await dialog.showOpenDialog(state.mainWindow, {
        title: '选择资料文件',
        properties: ['openFile'],
        filters: [
          { name: '文档资料', extensions: ['pdf', 'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx', 'txt', 'md', 'rtf', 'zip', 'rar', '7z'] },
          { name: '所有文件', extensions: ['*'] },
        ],
      });
      if (!res || res.canceled || !res.filePaths || !res.filePaths[0]) {
        return { success: false, canceled: true };
      }
      const srcFile = res.filePaths[0];
      if (!fs.existsSync(srcFile)) return { success: false, error: '文件不存在' };
      return { success: true, localPath: srcFile };
    } catch (e) {
      return { success: false, error: e.message || String(e) };
    }
  });

  ipcMain.handle('pick-folder-videos', async () => {
    try {
      const res = await dialog.showOpenDialog(state.mainWindow, {
        title: '选择视频文件夹',
        properties: ['openDirectory'],
      });
      if (!res || res.canceled || !res.filePaths || !res.filePaths[0]) {
        return { success: false, canceled: true };
      }
      const rootDir = res.filePaths[0];
      if (!fs.existsSync(rootDir)) return { success: false, error: '文件夹不存在' };
      const stat = fs.statSync(rootDir);
      if (!stat.isDirectory()) return { success: false, error: '选择的不是文件夹' };

      const VIDEO_EXTS = new Set(['mp4', 'mkv', 'avi', 'mov', 'flv', 'wmv', 'webm', 'm4v', '3gp', 'ts', 'rmvb']);
      const rootName = path.basename(rootDir);
      const files = [];
      const subFoldersSet = new Set();

      function walk(dir, depth) {
        let entries;
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
        catch (e) { return; }
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            if (depth === 1) subFoldersSet.add(entry.name);
            walk(fullPath, depth + 1);
          } else if (entry.isFile()) {
            const ext = (path.extname(entry.name) || '').slice(1).toLowerCase();
            if (!VIDEO_EXTS.has(ext)) continue;
            try {
              const fStat = fs.statSync(fullPath);
              const rel = path.relative(rootDir, fullPath).split(path.sep).join('/');
              const parts = rel.split('/');
              const parentFolder = parts.length > 1 ? parts[0] : '';
              files.push({
                localPath: fullPath,
                size: fStat.size,
                name: entry.name,
                relativePath: rel,
                parentFolder,
              });
            } catch (_) {}
          }
        }
      }

      walk(rootDir, 1);
      files.sort((a, b) => a.relativePath.localeCompare(b.relativePath, 'zh-CN', { numeric: true }));

      return {
        success: true,
        folderName: rootName,
        folderPath: rootDir,
        files,
        subFolders: Array.from(subFoldersSet).sort((a, b) => a.localeCompare(b, 'zh-CN')),
      };
    } catch (e) {
      return { success: false, error: e.message || String(e) };
    }
  });
}

module.exports = { register };