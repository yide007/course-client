// ===== IPC 处理器：从源添加课程（115 选文件夹导入）=====
const { ipcMain } = require('electron');
const db = require('../../database/course-db');
const { coverPathForDb } = require('../cover-path');

function _safe(p, label) {
  return Promise.resolve(p).catch(e => {
    console.error(`[IPC ${label || '?'}] ERROR:`, e && e.stack || e);
    return { success: false, error: (e && e.message) || String(e) };
  });
}

function register() {
  ipcMain.handle('add-course-with-chapters', async (event, courseData) => {
    console.log('[add-course-with-chapters] RECEIVED title=' + (courseData && courseData.title) + ' sourceKey=' + (courseData && courseData.sourceKey) + ' chapters=' + ((courseData && courseData.chapters && courseData.chapters.length) || 0));
    const r = _safe(db.upsertCourseFromSource({
      sourceId: courseData.sourceId || null,
      sourceKey: courseData.sourceKey || ('manual::' + Date.now()),
      sourcePath: courseData.sourcePath || '',
      sourceDirId: courseData.sourceDirId || null,
      sourceCfgId: courseData.sourceCfgId || null,
      categoryId: courseData.categoryId,
      title: courseData.title,
      subtitle: courseData.subtitle || '',
      description: courseData.description || '',
      instructor: courseData.instructor || '系统导入',
      level: courseData.level || '初级',
      duration: courseData.duration || '',
      rating: Number(courseData.rating) || 4.5,
      students: Number(courseData.students) || 0,
      coverColor: courseData.coverColor || 'linear-gradient(135deg, #667eea, #764ba2)',
      coverImage: coverPathForDb(courseData.coverImage || ''),
      chapters: courseData.chapters || [],
      isP115: true,
    }), 'add-course-with-chapters');
    console.log('[add-course-with-chapters] RESULT success=' + (r && r.success) + ' err=' + (r && r.error));
    return r;
  });
}

module.exports = { register };