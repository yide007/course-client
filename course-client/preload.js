const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getCourses: () => ipcRenderer.invoke('get-courses'),
  getCourseDetail: (courseId) => ipcRenderer.invoke('get-course-detail', courseId),
  getCategories: () => ipcRenderer.invoke('get-categories'),
  searchCourses: (params) => ipcRenderer.invoke('search-courses', params),
  getCourseStats: () => ipcRenderer.invoke('get-course-stats'),
  updateProgress: (params) => ipcRenderer.invoke('update-progress', params),
  getCourseProgress: (courseId) => ipcRenderer.invoke('get-course-progress', courseId),
  addCourse: (courseData) => ipcRenderer.invoke('add-course', courseData),
  deleteCourse: (courseId) => ipcRenderer.invoke('delete-course', courseId),
  updateCourse: (courseData) => ipcRenderer.invoke('update-course', courseData),
  fetchCd2Course: () => ipcRenderer.invoke('fetch-cd2-course'),
  // 分类管理
  addCategory: (params) => ipcRenderer.invoke('add-category', params),
  updateCategory: (params) => ipcRenderer.invoke('update-category', params),
  deleteCategory: (categoryId) => ipcRenderer.invoke('delete-category', categoryId),
  // 章节管理
  addChapter: (params) => ipcRenderer.invoke('add-chapter', params),
  deleteChapter: (chapterId) => ipcRenderer.invoke('delete-chapter', chapterId),
  updateChapter: (params) => ipcRenderer.invoke('update-chapter', params),
  // 分集管理
  addLesson: (params) => ipcRenderer.invoke('add-lesson', params),
  deleteLesson: (lessonId) => ipcRenderer.invoke('delete-lesson', lessonId),
  updateLesson: (params) => ipcRenderer.invoke('update-lesson', params),
  // 课程源（tokens 配置 + 同步）
  getAllSources: () => ipcRenderer.invoke('get-all-sources'),
  saveSource: (source) => ipcRenderer.invoke('save-source', source),
  deleteSource: (sourceId) => ipcRenderer.invoke('delete-source', sourceId),
  syncSource: (sourceId) => ipcRenderer.invoke('sync-source', sourceId),
  syncAllSources: () => ipcRenderer.invoke('sync-all-sources'),
  scanCourseDrafts: (opts) => ipcRenderer.invoke('scan-course-drafts', opts),
  listCloudDirectory: (opts) => ipcRenderer.invoke('list-cloud-directory', opts),
  quickScanOneCourse: (opts) => ipcRenderer.invoke('quick-scan-one-course', opts),
  rebuildCourseChapters: (opts) => ipcRenderer.invoke('rebuild-course-chapters', opts),
  addCourseWithChapters: (courseData) => ipcRenderer.invoke('add-course-with-chapters', courseData),
  pickCoverImage: () => ipcRenderer.invoke('pick-cover-image'),
  downloadFile: (params) => ipcRenderer.invoke('download-file', params),
  previewFile: (params) => ipcRenderer.invoke('preview-file', params),
  // 主进程推送：后台同步完成
  onSourcesSynced: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event) => callback();
    ipcRenderer.on('sources-synced', listener);
    return () => ipcRenderer.removeListener('sources-synced', listener);
  },
});