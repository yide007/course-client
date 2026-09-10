// ===== IPC 处理器：课程源管理 + 同步 =====
const { ipcMain } = require('electron');
const configMod = require('../../database/config');
const syncService = require('../../services/sync-service');

function _safe(p, label) {
  return Promise.resolve(p).catch(e => {
    console.error(`[IPC ${label || '?'}] ERROR:`, e && e.stack || e);
    return { success: false, error: (e && e.message) || String(e) };
  });
}

function register() {
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
}

module.exports = { register };