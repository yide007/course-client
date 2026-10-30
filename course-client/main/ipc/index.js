// ===== IPC 处理器聚合入口 =====
// 各子模块按功能拆分，统一在此注册
const courses = require('./courses');
const rebuild = require('./rebuild');
const files = require('./files');
const upload = require('./upload');
const auth = require('./auth');

function registerAll() {
  courses.register();
  rebuild.register();
  files.register();
  upload.register();
  auth.register();
  console.log('[ipc] 所有 IPC 处理器已注册（%d 模块）', 5);
}

module.exports = { registerAll };