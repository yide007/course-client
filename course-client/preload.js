const { contextBridge, ipcRenderer, webUtils } = require('electron');

// ===== 基础参数校验（防止恶意数据透传） =====
function _sanitize(val, type) {
  if (val === null || val === undefined) return val;
  if (type === 'string') return typeof val === 'string' ? val : String(val);
  if (type === 'number') return typeof val === 'number' ? val : Number(val) || 0;
  if (type === 'object') return typeof val === 'object' && val !== null ? val : {};
  return val;
}

contextBridge.exposeInMainWorld('electronAPI', {
  getCourses: () => ipcRenderer.invoke('get-courses'),
  getCourseDetail: (courseId) => ipcRenderer.invoke('get-course-detail', _sanitize(courseId, 'number')),
  getCategories: () => ipcRenderer.invoke('get-categories'),
  searchCourses: (params) => ipcRenderer.invoke('search-courses', _sanitize(params, 'object')),
  getCourseStats: () => ipcRenderer.invoke('get-course-stats'),
  updateProgress: (params) => ipcRenderer.invoke('update-progress', _sanitize(params, 'object')),
  getCourseProgress: (courseId) => ipcRenderer.invoke('get-course-progress', _sanitize(courseId, 'number')),
  addCourse: (courseData) => ipcRenderer.invoke('add-course', _sanitize(courseData, 'object')),
  deleteCourse: (courseId) => ipcRenderer.invoke('delete-course', _sanitize(courseId, 'number')),
  updateCourse: (courseData) => ipcRenderer.invoke('update-course', _sanitize(courseData, 'object')),
  updateCourseNetdisk: (params) => ipcRenderer.invoke('update-course-netdisk', _sanitize(params, 'object')),
  // 分类管理
  addCategory: (params) => ipcRenderer.invoke('add-category', _sanitize(params, 'object')),
  updateCategory: (params) => ipcRenderer.invoke('update-category', _sanitize(params, 'object')),
  deleteCategory: (categoryId) => ipcRenderer.invoke('delete-category', _sanitize(categoryId, 'number')),
  // 章节管理
  addChapter: (params) => ipcRenderer.invoke('add-chapter', _sanitize(params, 'object')),
  deleteChapter: (chapterId) => ipcRenderer.invoke('delete-chapter', _sanitize(chapterId, 'number')),
  updateChapter: (params) => ipcRenderer.invoke('update-chapter', _sanitize(params, 'object')),
  // 分集管理
  addLesson: (params) => ipcRenderer.invoke('add-lesson', _sanitize(params, 'object')),
  deleteLesson: (lessonId) => ipcRenderer.invoke('delete-lesson', _sanitize(lessonId, 'number')),
  updateLesson: (params) => ipcRenderer.invoke('update-lesson', _sanitize(params, 'object')),
  // p115 导入
  addCourseWithChapters: (courseData) => ipcRenderer.invoke('add-course-with-chapters', _sanitize(courseData, 'object')),
  pickCoverImage: () => ipcRenderer.invoke('upload-cover-image'),
  pickVideoFile: () => ipcRenderer.invoke('pick-video-file'),
  pickVideoFiles: () => ipcRenderer.invoke('pick-video-files'),
  pickFolderVideos: () => ipcRenderer.invoke('pick-folder-videos'),
  pickDocFile: () => ipcRenderer.invoke('pick-doc-file'),
  uploadVideoFile: (localPath, token, baseURL) => ipcRenderer.invoke('upload-video-file', _sanitize(localPath, 'string'), _sanitize(token, 'string'), _sanitize(baseURL, 'string')),
  getUploadToken: () => ipcRenderer.invoke('get-upload-token'),
  loginAndGetToken: (baseURL, username, password) => ipcRenderer.invoke('login-and-get-token', _sanitize(baseURL, 'string'), _sanitize(username, 'string'), _sanitize(password, 'string')),
  getAllUploadConfigs: () => ipcRenderer.invoke('get-all-upload-configs'),
  saveUploadConfig: (item) => ipcRenderer.invoke('save-upload-config', _sanitize(item, 'object')),
  deleteUploadConfig: (id) => ipcRenderer.invoke('delete-upload-config', _sanitize(id, 'string')),
  saveUploadToken: (id, token) => ipcRenderer.invoke('save-upload-token', _sanitize(id, 'string'), _sanitize(token, 'string')),
  // 115 配置
  getAllP115Configs: () => ipcRenderer.invoke('get-all-p115-configs'),
  saveP115Config: (item) => ipcRenderer.invoke('save-p115-config', _sanitize(item, 'object')),
  deleteP115Config: (id) => ipcRenderer.invoke('delete-p115-config', _sanitize(id, 'string')),
  // 115 扫码登录（开放平台设备码授权 / PKCE）
  login115QrInit: () => ipcRenderer.invoke('login-115-qr-init'),
  check115QrStatus: (uid, time, sign) => ipcRenderer.invoke('check-115-qr-status', _sanitize(uid, 'string'), _sanitize(time, 'number'), _sanitize(sign, 'string')),
  exchange115QrToken: (uid) => ipcRenderer.invoke('exchange-115-qr-token', _sanitize(uid, 'string')),
  list115DirectoryByToken: (cfgId, accessToken, dirId) => ipcRenderer.invoke('list-115-directory-by-token', _sanitize(cfgId, 'string'), _sanitize(accessToken, 'string'), _sanitize(dirId, 'string')),
  create115Folder: (cfgId, accessToken, parentId, folderName) => ipcRenderer.invoke('create-115-folder', _sanitize(cfgId, 'string'), _sanitize(accessToken, 'string'), _sanitize(parentId, 'string'), _sanitize(folderName, 'string')),
  upload115File: (cfgId, accessToken, dirId, filePath, fileName) => ipcRenderer.invoke('upload-115-file', _sanitize(cfgId, 'string'), _sanitize(accessToken, 'string'), _sanitize(dirId, 'string'), _sanitize(filePath, 'string'), _sanitize(fileName, 'string')),
  getPathForFile: (file) => {
    if (!file) return '';
    try {
      if (typeof file.path === 'string' && file.path) return file.path;
      if (webUtils && typeof webUtils.getPathForFile === 'function') return webUtils.getPathForFile(file);
      return '';
    } catch (e) { return ''; }
  },
  refresh115Token: (cfgId, refreshToken) => ipcRenderer.invoke('refresh-115-token', _sanitize(cfgId, 'string'), _sanitize(refreshToken, 'string')),
  ensure115Token: (cfgId, accessToken, refreshToken) => ipcRenderer.invoke('p115-ensure-token', _sanitize(cfgId, 'string'), _sanitize(accessToken, 'string'), _sanitize(refreshToken, 'string')),
  warm115Token: (cfgId, accessToken, refreshToken) => ipcRenderer.invoke('p115-warm-token', _sanitize(cfgId, 'string'), _sanitize(accessToken, 'string'), _sanitize(refreshToken, 'string')).catch(() => ({ success: false })),
  get115UserInfo: (cfgId, token) => ipcRenderer.invoke('get-115-user-info', _sanitize(cfgId, 'string'), _sanitize(token, 'string')),
  get115VideoUrl: (cfgId, accessToken, pickCode) => ipcRenderer.invoke('get-115-video-url', _sanitize(cfgId, 'string'), _sanitize(accessToken, 'string'), _sanitize(pickCode, 'string')),
  get115LessonUrl: (cfgId, pickCode) => ipcRenderer.invoke('get-115-lesson-url', _sanitize(cfgId, 'string'), _sanitize(pickCode, 'string')),
  warm115Lesson: (cfgId, pickCode) => ipcRenderer.invoke('warm-115-lesson', _sanitize(cfgId, 'string'), _sanitize(pickCode, 'string')).catch(() => ({ success: false })),
  get115DownUrl: (cfgId, pickCode) => ipcRenderer.invoke('get-115-downurl', _sanitize(cfgId, 'string'), _sanitize(pickCode, 'string')).catch(() => ({ success: false })),
  download115LessonToFile: (cfgId, pickCode) => ipcRenderer.invoke('download-115-lesson-to-file', _sanitize(cfgId, 'string'), _sanitize(pickCode, 'string')),
  remux115FlvToMp4: (cfgId, pickCode) => ipcRenderer.invoke('remux-115-flv-to-mp4', _sanitize(cfgId, 'string'), _sanitize(pickCode, 'string')),
  remux115FlvStream: (cfgId, pickCode) => ipcRenderer.invoke('remux-115-flv-stream', _sanitize(cfgId, 'string'), _sanitize(pickCode, 'string')),
  onRemuxProgress: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('remux-115-progress', listener);
    return () => ipcRenderer.removeListener('remux-115-progress', listener);
  },
  videoPush115: (cfgId, accessToken, pickCode, op) => ipcRenderer.invoke('video-push-115', _sanitize(cfgId, 'string'), _sanitize(accessToken, 'string'), _sanitize(pickCode, 'string'), _sanitize(op, 'string')),
  list115PickerDir: (cfgId, dirId) => ipcRenderer.invoke('list-115-picker-dir', _sanitize(cfgId, 'string'), _sanitize(dirId, 'string')),
  scan115PickerFolder: (cfgId, dirId, folderName) => ipcRenderer.invoke('scan-115-picker-folder', _sanitize(cfgId, 'string'), _sanitize(dirId, 'string'), _sanitize(folderName, 'string')),
  onTranscodeProgress: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('115-transcode-progress', listener);
    return () => ipcRenderer.removeListener('115-transcode-progress', listener);
  },
  getMediaProxyPort: () => ipcRenderer.invoke('get-media-proxy-port'),
  onWindowMoveState: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('window-move-state', listener);
    return () => ipcRenderer.removeListener('window-move-state', listener);
  },
  onUploadVideoProgress: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('upload-video-progress', listener);
    return () => ipcRenderer.removeListener('upload-video-progress', listener);
  },
  downloadFile: (params) => ipcRenderer.invoke('download-file', _sanitize(params, 'object')),
  previewFile: (params) => ipcRenderer.invoke('preview-file', _sanitize(params, 'object')),
  // 登录状态
  checkLoginStatus: () => ipcRenderer.invoke('check-login-status'),
  doLogin: (username, password) => ipcRenderer.invoke('do-login', _sanitize(username, 'string'), _sanitize(password, 'string')),
  doLogout: () => ipcRenderer.invoke('do-logout'),
  changePassword: (oldPwd, newPwd, nickname) => ipcRenderer.invoke('change-password', _sanitize(oldPwd, 'string'), _sanitize(newPwd, 'string'), _sanitize(nickname, 'string')),
  // 用户管理
  listUsers: () => ipcRenderer.invoke('list-users'),
  addUser: (params) => ipcRenderer.invoke('add-user', _sanitize(params, 'object')),
  updateUser: (params) => ipcRenderer.invoke('update-user', _sanitize(params, 'object')),
  deleteUser: (username) => ipcRenderer.invoke('delete-user', _sanitize(username, 'string')),
  // 窗口控制（无边框窗口用）
  windowMinimize: () => ipcRenderer.invoke('window-minimize'),
  windowMaximize: () => ipcRenderer.invoke('window-maximize'),
  windowClose: () => ipcRenderer.invoke('window-close'),
  isWindowMaximized: () => ipcRenderer.invoke('window-is-maximized'),
  onWindowMaximizeChange: (listener) => {
    const cb = (_e, isMax) => listener(isMax);
    ipcRenderer.on('window-maximize-change', cb);
    return () => ipcRenderer.removeListener('window-maximize-change', cb);
  },
});