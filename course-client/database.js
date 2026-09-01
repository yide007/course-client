const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');
const courseDb = require('./course-db');

let db = null;

function getDbPath() {
  try {
    const { app } = require('electron');
    if (app && typeof app.getPath === 'function') {
      return path.join(app.getPath('userData'), 'courses.db');
    }
  } catch (e) {
    // 非 Electron 环境，fallback
  }
  // 兜底：项目目录下
  const fallbackDir = path.join(__dirname, '_data');
  if (!fs.existsSync(fallbackDir)) fs.mkdirSync(fallbackDir, { recursive: true });
  return path.join(fallbackDir, 'courses.db');
}

async function initDatabase() {
  try {
    const SQL = await initSqlJs();
    const dbPath = getDbPath();

    if (fs.existsSync(dbPath)) {
      const buffer = fs.readFileSync(dbPath);
      db = new SQL.Database(buffer);
    } else {
      db = new SQL.Database();
    }

    db.run('PRAGMA foreign_keys=ON;');
    createTables();
    seedInitialData();
    return db;
  } catch (e) {
    console.error('initDatabase error:', e.toString());
    throw e;
  }
}

function createTables() {
  const statements = [
    `CREATE TABLE IF NOT EXISTS categories (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, icon TEXT DEFAULT '', sort_order INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS learning_progress (id INTEGER PRIMARY KEY AUTOINCREMENT, course_id INTEGER NOT NULL, lesson_id INTEGER NOT NULL, progress REAL DEFAULT 0.0, completed INTEGER DEFAULT 0, last_position REAL DEFAULT 0.0, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, UNIQUE(course_id, lesson_id))`,
    'CREATE INDEX IF NOT EXISTS idx_progress_course ON learning_progress(course_id)',
  ];
  for (const sql of statements) {
    db.run(sql);
  }
}

function seedInitialData() {
  // 确保分类存在（不存在才插入），全部按用户指定的新分类
  const categories = [
    { name: '计算机基础课程', icon: '🗃️', sort_order: 1 },
    { name: '软考课程',     icon: '📘', sort_order: 2 },
    { name: '行测课程',     icon: '📝', sort_order: 3 },
    { name: '申论课程',     icon: '📜', sort_order: 4 },
    { name: '面试课程',     icon: '🎤', sort_order: 5 },
    { name: '经济经融基础课程', icon: '📊', sort_order: 6 },
    { name: '英语课程',     icon: '🔤', sort_order: 7 },
  ];
  for (const cat of categories) {
    const exists = queryOne('SELECT id FROM categories WHERE name = ?', [cat.name]);
    if (!exists) {
      db.run('INSERT INTO categories (name, icon, sort_order) VALUES (?, ?, ?)', [cat.name, cat.icon, cat.sort_order]);
    }
  }
}

function saveDatabase() {
  if (!db) return;
  try {
    const data = db.export();
    const dbPath = getDbPath();
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(dbPath, Buffer.from(data));
  } catch (e) {
    console.error('Save DB failed:', e.toString());
  }
}

function getLastInsertId() {
  try {
    const result = db.exec("SELECT last_insert_rowid()");
    if (result && result.length > 0 && result[0].values && result[0].values.length > 0) {
      return result[0].values[0][0];
    }
  } catch (e) {
    console.error('getLastInsertId error:', e.toString());
  }
  return null;
}

// ---- 工具函数：用预编译语句查询多行 ----
function queryAll(sql, params) {
  const stmt = db.prepare(sql);
  if (params && params.length > 0) stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

function queryOne(sql, params) {
  const rows = queryAll(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

// ============================================================
//  API — 课程数据委托给 course-db.js，分类 + 学习进度保持在本地
// ============================================================

/**
 * 获取所有课程（从 course-db 读取，合并分类名称）
 */
function getAllCourses() {
  const courses = courseDb.getAllCourses();
  const categories = getAllCategories();
  const catMap = {};
  for (const cat of categories) {
    catMap[cat.id] = cat.name;
  }
  return courses.map(c => {
    c.category = catMap[c.categoryId] || '未分类';
    return c;
  });
}

/**
 * 获取课程详情（从 course-db 读取，合并分类名称）
 */
function getCourseDetail(courseId) {
  const course = courseDb.getCourseDetail(courseId);
  if (!course) return null;
  const cat = queryOne('SELECT id, name FROM categories WHERE id = ?', [course.categoryId]);
  course.category = cat ? cat.name : '未分类';
  return course;
}

function getAllCategories() {
  return queryAll('SELECT id, name, icon, sort_order AS sortOrder FROM categories ORDER BY sort_order');
}

function searchCourses(keyword, categoryId, level) {
  const courses = courseDb.searchCourses(keyword, categoryId, level);
  const categories = getAllCategories();
  const catMap = {};
  for (const cat of categories) {
    catMap[cat.id] = cat.name;
  }
  return courses.map(c => {
    c.category = catMap[c.categoryId] || '未分类';
    return c;
  });
}

function getCourseStats() {
  const courseStats = courseDb.getCourseStats();
  const progressStats = queryOne('SELECT COUNT(DISTINCT course_id) AS completedCourses, COUNT(*) AS completedLessons FROM learning_progress WHERE completed = 1');
  return {
    totalCourses: courseStats.totalCourses || 0,
    totalLessons: courseStats.totalLessons || 0,
    completedCourses: progressStats ? progressStats.completedCourses : 0,
    completedLessons: progressStats ? progressStats.completedLessons : 0,
  };
}

function updateProgress(courseId, lessonId, progress, completed, lastPosition) {
  db.run(`INSERT INTO learning_progress (course_id, lesson_id, progress, completed, last_position, updated_at)
          VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(course_id, lesson_id)
          DO UPDATE SET progress = ?, completed = ?, last_position = ?, updated_at = CURRENT_TIMESTAMP`,
    [courseId, lessonId, progress, completed ? 1 : 0, lastPosition, progress, completed ? 1 : 0, lastPosition]);
  saveDatabase();
}

function getCourseProgress(courseId) {
  return queryAll(
    'SELECT lesson_id AS lessonId, progress, completed, last_position AS lastPosition FROM learning_progress WHERE course_id = ?',
    [courseId]
  );
}

// ============================================================
//  课程 CRUD — 委托给 course-db.js
// ============================================================

function addCourse(courseData) {
  return courseDb.addCourse(courseData);
}

function deleteCourse(courseId) {
  return courseDb.deleteCourse(courseId);
}

function updateCourse(courseData) {
  return courseDb.updateCourse(courseData);
}

function upsertCourseFromSource(input) {
  return courseDb.upsertCourseFromSource(input);
}

function addChapter(courseId, title) {
  return courseDb.addChapter(courseId, title);
}

function deleteChapter(chapterId) {
  return courseDb.deleteChapter(chapterId);
}

function updateChapter(chapterId, title) {
  return courseDb.updateChapter(chapterId, title);
}

function addLesson(chapterId, title, duration) {
  return courseDb.addLesson(chapterId, title, duration);
}

function deleteLesson(lessonId) {
  return courseDb.deleteLesson(lessonId);
}

function updateLesson(lessonId, data) {
  return courseDb.updateLesson(lessonId, data);
}

function closeDatabase() {
  if (db) { saveDatabase(); db.close(); db = null; }
  courseDb.closeCourseDatabase();
}

// ==================== 分类管理 ====================
function addCategory(name, icon) {
  if (!name || !name.trim()) return { success: false, error: '分类名不能为空' };
  const exists = queryOne('SELECT id FROM categories WHERE name = ?', [name.trim()]);
  if (exists) return { success: false, error: '分类已存在' };
  try {
    const maxSort = queryOne('SELECT COALESCE(MAX(sort_order),0) AS m FROM categories');
    const order = (maxSort && maxSort.m || 0) + 1;
    db.run('INSERT INTO categories (name, icon, sort_order) VALUES (?, ?, ?)', [name.trim(), icon || '', order]);
    saveDatabase();
    return { success: true, id: getLastInsertId() };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function updateCategory(id, name, icon) {
  if (!id) return { success: false, error: '缺少分类ID' };
  if (!name || !name.trim()) return { success: false, error: '分类名不能为空' };
  const exists = queryOne('SELECT id FROM categories WHERE name = ? AND id != ?', [name.trim(), id]);
  if (exists) return { success: false, error: '已存在同名分类' };
  try {
    const fields = ['name = ?'];
    const vals = [name.trim()];
    if (icon !== undefined) { fields.push('icon = ?'); vals.push(icon); }
    vals.push(id);
    db.run(`UPDATE categories SET ${fields.join(', ')} WHERE id = ?`, vals);
    saveDatabase();
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function deleteCategory(categoryId) {
  if (!categoryId) return { success: false, error: '缺少分类ID' };
  if (String(categoryId) === '1') {
    return { success: false, error: '默认分类（未分类）不能删除' };
  }
  try {
    // 先把该分类下的课程移动到默认分类(id=1) — 委托给 course-db
    courseDb.updateCategoryForCourses(categoryId, 1);
    db.run('DELETE FROM categories WHERE id = ?', [categoryId]);
    saveDatabase();
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

module.exports = {
  initDatabase, getAllCourses, getCourseDetail, getAllCategories,
  searchCourses, updateProgress, getCourseProgress, getCourseStats,
  addCourse, deleteCourse, updateCourse, closeDatabase,
  addCategory, updateCategory, deleteCategory,
  addChapter, deleteChapter, updateChapter,
  addLesson, deleteLesson, updateLesson,
  upsertCourseFromSource,
};