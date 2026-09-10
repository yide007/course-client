const { contextBridge, ipcRenderer } = require('electron');

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
  // fetchCd2Course 已废弃，同步功能由 sync-source / sync-all-sources 替代
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
  // 课程源（tokens 配置 + 同步）
  getAllSources: () => ipcRenderer.invoke('get-all-sources'),
  saveSource: (source) => ipcRenderer.invoke('save-source', _sanitize(source, 'object')),
  deleteSource: (sourceId) => ipcRenderer.invoke('delete-source', _sanitize(sourceId, 'number')),
  syncSource: (sourceId) => ipcRenderer.invoke('sync-source', _sanitize(sourceId, 'number')),
  syncAllSources: () => ipcRenderer.invoke('sync-all-sources'),
  scanCourseDrafts: (opts) => ipcRenderer.invoke('scan-course-drafts', _sanitize(opts, 'object')),
  listCloudDirectory: (opts) => ipcRenderer.invoke('list-cloud-directory', _sanitize(opts, 'object')),
  quickScanOneCourse: (opts) => ipcRenderer.invoke('quick-scan-one-course', _sanitize(opts, 'object')),
  rebuildCourseChapters: (opts) => ipcRenderer.invoke('rebuild-course-chapters', _sanitize(opts, 'object')),
  addCourseWithChapters: (courseData) => ipcRenderer.invoke('add-course-with-chapters', _sanitize(courseData, 'object')),
  pickCoverImage: () => ipcRenderer.invoke('pick-cover-image'),
  pickVideoFile: () => ipcRenderer.invoke('pick-video-file'),
  pickVideoFiles: () => ipcRenderer.invoke('pick-video-files'),
  pickDocFile: () => ipcRenderer.invoke('pick-doc-file'),
  uploadVideoFile: (localPath, token, baseURL) => ipcRenderer.invoke('upload-video-file', _sanitize(localPath, 'string'), _sanitize(token, 'string'), _sanitize(baseURL, 'string')),
  getUploadToken: () => ipcRenderer.invoke('get-upload-token'),
  loginAndGetToken: (baseURL, username, password) => ipcRenderer.invoke('login-and-get-token', _sanitize(baseURL, 'string'), _sanitize(username, 'string'), _sanitize(password, 'string')),
  getAllUploadConfigs: () => ipcRenderer.invoke('get-all-upload-configs'),
  saveUploadConfig: (item) => ipcRenderer.invoke('save-upload-config', _sanitize(item, 'object')),
  deleteUploadConfig: (id) => ipcRenderer.invoke('delete-upload-config', _sanitize(id, 'number')),
  saveUploadToken: (id, token) => ipcRenderer.invoke('save-upload-token', _sanitize(id, 'number'), _sanitize(token, 'string')),
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
  // 主进程推送：后台同步完成
  onSourcesSynced: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event) => callback();
    ipcRenderer.on('sources-synced', listener);
    return () => ipcRenderer.removeListener('sources-synced', listener);
  },
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
});