// ===== 主进程共享状态 =====
// 被 main/index.js 和各 IPC 模块引用

module.exports = {
  mainWindow: null,
  appReady: false,
};