// ===== IPC 处理器：课程 / 分类 / 章节 / 课时 CRUD =====
const { ipcMain } = require('electron');
const db = require('../../database/course-db');
const { coverPathForDb, coverUrlForDisplay } = require('../cover-path');

function _mapCoverForReturn(data) {
  if (!data) return data;
  const arr = Array.isArray(data) ? data : [data];
  arr.forEach(c => {
    if (c && Object.prototype.hasOwnProperty.call(c, 'coverImage')) {
      c.coverImage = coverUrlForDisplay(c.coverImage || '');
    }
  });
  return data;
}

function register() {
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

  // 同步功能由 sync-service.js 提供（见 sources.js）
}

module.exports = { register };