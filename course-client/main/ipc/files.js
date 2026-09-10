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

  ipcMain.handle('pick-cover-image', async () => {
    try {
      const res = await dialog.showOpenDialog(state.mainWindow, {
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

      const projectImagesDir = path.join(__dirname, '..', '..', 'src', 'images');
      const coversDir = path.join(projectImagesDir, 'covers');
      if (!fs.existsSync(coversDir)) fs.mkdirSync(coversDir, { recursive: true });

      const ext = (path.extname(srcFile) || '.jpg').toLowerCase();
      const destName = `cover_${Date.now()}_${Math.floor(Math.random() * 10000)}${ext}`;
      const destPath = path.join(coversDir, destName);

      fs.copyFileSync(srcFile, destPath);

      const fileUrl = 'file:///' + destPath.replace(/\\/g, '/').replace(/^\/+/, '');
      return { success: true, fileUrl, localPath: destPath, coversDir };
    } catch (e) {
      return { success: false, error: e.message || String(e) };
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
}

module.exports = { register };