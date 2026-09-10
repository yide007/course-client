/**
 * course-db.js — 课程数据 JSON 文件存储模块
 *
 * 使用 courses_data.json 存储课程/章节/课时数据，
 * 直接编辑 JSON 文件即可管理数据，无需数据库工具。
 */
const path = require('path');
const fs = require('fs');

// ============================================================
//  内部状态
// ============================================================

let data = {
  nextId: 1,
  nextChapterId: 1,
  nextLessonId: 1,
  courses: [],
  categories: [],
  nextCategoryId: 1,
  learningProgress: [],
};

/**
 * 决定 courses_data.json 的实际位置：
 *   1. 优先 __dirname/courses_data.json（开发时项目根；打包后在 app.asar 是只读的）
 *   2. 兜底 process.resourcesPath/courses_data.json（electron-builder extraResources 拷过来的可写副本；
 *      首次启动从安装目录资源中复制一份到 userData 可写位置）
 */
function _resolveJsonPath() {
  const orig = path.join(__dirname, 'courses_data.json');
  let resourcesDir = null;
  try {
    const { app } = require('electron');
    if (typeof process !== 'undefined' && process.resourcesPath) resourcesDir = String(process.resourcesPath);
    if (!resourcesDir && app && typeof app.getPath === 'function') resourcesDir = app.getPath('userData');
  } catch (_) {}
  const seed = resourcesDir ? path.join(resourcesDir, 'courses_data.json') : orig;
  // 开发模式：resourcesDir 通常不可用 or 就是 __dirname，直接返回项目根
  if (!resourcesDir) return orig;
  // 打包模式：JSON 需要可写，所以在 userData 下维护一份
  try {
    const { app } = require('electron');
    const userData = app && typeof app.getPath === 'function' ? app.getPath('userData') : null;
    const isPackaged = app && app.isPackaged;
    if (isPackaged && userData) {
      const runtime = path.join(userData, 'courses_data.json');
      if (!fs.existsSync(runtime)) {
        // 从打包的 seed 文件（存在 asar 里 / extraResources 里）复制过来
        const srcSeed = fs.existsSync(orig) ? orig : (fs.existsSync(seed) ? seed : null);
        if (srcSeed) {
          try {
            const dir = path.dirname(runtime);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.copyFileSync(srcSeed, runtime);
          } catch (e) {
            console.warn('[course-db] seed JSON 复制失败（可忽略）：', e.message);
          }
        }
      }
      if (fs.existsSync(runtime)) return runtime;
    }
  } catch (_) {}
  // fallback：哪个存在返回哪个
  if (fs.existsSync(orig)) return orig;
  if (fs.existsSync(seed)) return seed;
  return orig;
}

const JSON_PATH = _resolveJsonPath();

// ============================================================
//  文件读写
// ============================================================

function loadJson() {
  try {
    if (fs.existsSync(JSON_PATH)) {
      const raw = fs.readFileSync(JSON_PATH, 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.courses)) {
        data = parsed;
        return true;
      }
    }
  } catch (e) {
    console.error('[course-db] JSON 读取失败:', e.toString());
  }
  return false;
}

function saveJson() {
  try {
    const dir = path.dirname(JSON_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(JSON_PATH, JSON.stringify(data, null, 2), 'utf-8');
  } catch (e) {
    console.error('[course-db] JSON 写入失败:', e.toString());
  }
}

// ============================================================
//  初始化 & 迁移
// ============================================================

async function initCourseDatabase() {
  const loaded = loadJson();

  const needsCategories = !loaded || !Array.isArray(data.categories);
  const needsProgress = !loaded || !Array.isArray(data.learningProgress);

  if (loaded && !needsCategories && !needsProgress) {
    console.log(
      `[course-db] 已加载 JSON，${data.courses.length} 门课程，` +
      `${data.categories.length} 个分类，${data.learningProgress.length} 条学习记录`
    );
    _seedDefaultCategoriesIfEmpty();
    return;
  }

  if (needsCategories) data.categories = [];
  if (needsProgress) data.learningProgress = [];

  await migrateFromOldDb(needsCategories, needsProgress);
  _seedDefaultCategoriesIfEmpty();

  saveJson();
}

function getOldDbPath() {
  // 优先查找主目录下的旧数据库，其次 AppData
  const localPath = path.join(__dirname, 'courses.db');
  if (fs.existsSync(localPath)) return localPath;
  const appDataPath = path.join(
    process.env.APPDATA || '',
    'course-client',
    'courses.db'
  );
  if (fs.existsSync(appDataPath)) return appDataPath;
  // 再试试 Electron 的 userData
  try {
    const { app } = require('electron');
    if (app && typeof app.getPath === 'function') {
      const p = path.join(app.getPath('userData'), 'courses.db');
      if (fs.existsSync(p)) return p;
    }
  } catch (e) {}
  return localPath;
}

async function migrateFromOldDb(migrateCats, migrateProg) {
  const oldDbPath = getOldDbPath();
  if (!fs.existsSync(oldDbPath)) {
    console.log('[course-db] 未发现旧数据库，跳过迁移');
    return;
  }

  let initSqlJs;
  try {
    initSqlJs = require('sql.js');
  } catch (e) {
    console.log('[course-db] sql.js 不可用，跳过迁移');
    return;
  }

  const SQL = await initSqlJs();
  let oldDb = null;
  try {
    const buffer = fs.readFileSync(oldDbPath);
    oldDb = new SQL.Database(buffer);

    const tableCheck = oldDb.exec(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='courses'"
    );
    const hasCourses = tableCheck && tableCheck.length > 0;

    if (hasCourses) {
      const oldCourses = [];
      const stmt = oldDb.prepare('SELECT * FROM courses ORDER BY id');
      while (stmt.step()) oldCourses.push(stmt.getAsObject());
      stmt.free();

      if (oldCourses.length > 0) {
        console.log(`[course-db] 发现 ${oldCourses.length} 门旧课程，开始迁移到 JSON...`);

        let maxId = 0, maxChId = 0, maxLId = 0;

        for (const oc of oldCourses) {
          if (oc.id > maxId) maxId = oc.id;
          const course = {
            id: oc.id,
            category_id: oc.category_id || 1,
            title: oc.title || '',
            subtitle: oc.subtitle || '',
            description: oc.description || '',
            instructor: oc.instructor || '',
            level: oc.level || '初级',
            duration: oc.duration || '',
            rating: Number(oc.rating) || 0,
            students: Number(oc.students) || 0,
            cover_color: oc.cover_color || '',
            cover_image: oc.cover_image || '',
            domain: oc.domain || '',
            port: oc.port || '',
            token: oc.token || '',
            source_id: oc.source_id || null,
            source_key: oc.source_key || null,
            source_path: oc.source_path || '',
            created_at: oc.created_at || new Date().toISOString(),
            updated_at: oc.updated_at || new Date().toISOString(),
            chapters: [],
          };

          const chStmt = oldDb.prepare(
            'SELECT * FROM chapters WHERE course_id = ? ORDER BY sort_order'
          );
          chStmt.bind([oc.id]);
          while (chStmt.step()) {
            const och = chStmt.getAsObject();
            if (och.id > maxChId) maxChId = och.id;
            const chapter = {
              id: och.id,
              course_id: och.course_id,
              title: och.title || '',
              sort_order: och.sort_order || 0,
              created_at: och.created_at || new Date().toISOString(),
              lessons: [],
            };

            const lStmt = oldDb.prepare(
              'SELECT * FROM lessons WHERE chapter_id = ? ORDER BY sort_order'
            );
            lStmt.bind([och.id]);
            while (lStmt.step()) {
              const ol = lStmt.getAsObject();
              if (ol.id > maxLId) maxLId = ol.id;
              let attachments = null;
              if (ol.attachments) {
                try { attachments = JSON.parse(ol.attachments); } catch (_) { attachments = ol.attachments; }
              }
              chapter.lessons.push({
                id: ol.id,
                chapter_id: ol.chapter_id,
                title: ol.title || '',
                duration: ol.duration || '00:00',
                video_url: ol.video_url || '',
                video_url_local: ol.video_url_local || ol.video_url || '',
                video_type: ol.video_type || 'local',
                is_free: ol.is_free ? 1 : 0,
                sort_order: ol.sort_order || 0,
                attachments: attachments,
                created_at: ol.created_at || new Date().toISOString(),
              });
            }
            lStmt.free();

            chapter.lessons.sort((a, b) => a.sort_order - b.sort_order);
            course.chapters.push(chapter);
          }
          chStmt.free();

          course.chapters.sort((a, b) => a.sort_order - b.sort_order);
          data.courses.push(course);
        }

        data.nextId = maxId + 1;
        data.nextChapterId = maxChId + 1;
        data.nextLessonId = maxLId + 1;

        console.log(`[course-db] 课程迁移完成：${oldCourses.length} 门课程`);
      }
    }

    // ---- 迁移 categories ----
    if (migrateCats) {
      const catCheck = oldDb.exec(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='categories'"
      );
      if (catCheck && catCheck.length > 0) {
        const oldCats = [];
        const catStmt = oldDb.prepare('SELECT * FROM categories ORDER BY id');
        while (catStmt.step()) oldCats.push(catStmt.getAsObject());
        catStmt.free();

        if (oldCats.length > 0) {
          let maxCatId = 0;
          for (const c of oldCats) {
            if (c.id > maxCatId) maxCatId = c.id;
            data.categories.push({
              id: c.id,
              name: c.name || '',
              icon: c.icon || '',
              sort_order: c.sort_order || 0,
              created_at: c.created_at || new Date().toISOString(),
            });
          }
          data.nextCategoryId = maxCatId + 1;
          console.log(`[course-db] 分类迁移完成：${oldCats.length} 个分类`);
        } else {
          data.categories = [{ id: 1, name: '默认', icon: '📚', sort_order: 1, created_at: new Date().toISOString() }];
          data.nextCategoryId = 2;
        }
      } else {
        data.categories = [{ id: 1, name: '默认', icon: '📚', sort_order: 1, created_at: new Date().toISOString() }];
        data.nextCategoryId = 2;
      }
    }

    // ---- 迁移 learning_progress ----
    if (migrateProg) {
      const progCheck = oldDb.exec(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='learning_progress'"
      );
      if (progCheck && progCheck.length > 0) {
        const oldProg = [];
        const progStmt = oldDb.prepare('SELECT * FROM learning_progress');
        while (progStmt.step()) oldProg.push(progStmt.getAsObject());
        progStmt.free();

        if (oldProg.length > 0) {
          for (const p of oldProg) {
            data.learningProgress.push({
              courseId: Number(p.course_id),
              lessonId: Number(p.lesson_id),
              progress: Number(p.progress) || 0,
              completed: p.completed ? 1 : 0,
              lastPosition: Number(p.last_position) || 0,
              updatedAt: p.updated_at || new Date().toISOString(),
            });
          }
          console.log(`[course-db] 学习进度迁移完成：${oldProg.length} 条记录`);
        }
      }
    }
  } catch (e) {
    console.error('[course-db] 迁移失败:', e.toString());
  } finally {
    if (oldDb) oldDb.close();
  }
}

// ============================================================
//  内部工具
// ============================================================

function findCourse(courseId) {
  return data.courses.find((c) => c.id === Number(courseId)) || null;
}

function findChapter(chapterId) {
  for (const c of data.courses) {
    const ch = c.chapters.find((ch) => ch.id === Number(chapterId));
    if (ch) return ch;
  }
  return null;
}

function findChapterWithCourse(chapterId) {
  for (const c of data.courses) {
    const ch = c.chapters.find((ch) => ch.id === Number(chapterId));
    if (ch) return { course: c, chapter: ch };
  }
  return null;
}

function findLesson(lessonId) {
  for (const c of data.courses) {
    for (const ch of c.chapters) {
      const l = ch.lessons.find((l) => l.id === Number(lessonId));
      if (l) return l;
    }
  }
  return null;
}

function toCourseRow(c) {
  const chapterCount = c.chapters.length;
  let lessonCount = 0;
  for (const ch of c.chapters) lessonCount += ch.lessons.length;
  return {
    id: c.id,
    title: c.title,
    subtitle: c.subtitle,
    description: c.description,
    instructor: c.instructor,
    level: c.level,
    duration: c.duration,
    rating: c.rating,
    students: c.students,
    coverColor: c.cover_color,
    coverImage: c.cover_image,
    domain: c.domain,
    port: c.port,
    token: c.token,
    categoryId: c.category_id,
    sourceId: c.source_id,
    sourceKey: c.source_key,
    sourcePath: c.source_path,
    chapterCount,
    lessonCount,
  };
}

function toChapterRow(ch) {
  return {
    id: ch.id,
    course_id: ch.course_id,
    title: ch.title,
    sortOrder: ch.sort_order,
  };
}

function toLessonRow(l) {
  return {
    id: l.id,
    chapter_id: l.chapter_id,
    title: l.title,
    duration: l.duration,
    videoUrl: l.video_url,
    videoUrlLocal: l.video_url_local,
    videoType: l.video_type,
    isFree: l.is_free,
    sortOrder: l.sort_order,
    attachments: l.attachments || null,
    docUrl: l.doc_url || '',
    path: l.path || '',
    sectionTitle: l.sectionTitle || '',
  };
}

// ============================================================
//  课程 CRUD
// ============================================================

function getAllCourses() {
  return data.courses.map((c) => _mergeCategoryName(toCourseRow(c)));
}

function getCourseDetail(courseId) {
  const c = findCourse(courseId);
  if (!c) return null;
  const result = {
    id: c.id,
    title: c.title,
    subtitle: c.subtitle,
    description: c.description,
    instructor: c.instructor,
    level: c.level,
    duration: c.duration,
    rating: c.rating,
    students: c.students,
    coverColor: c.cover_color,
    coverImage: c.cover_image,
    domain: c.domain,
    port: c.port,
    token: c.token,
    sourcePath: c.source_path,
    categoryId: c.category_id,
    chapterCount: c.chapters.length,
    lessonCount: c.chapters.reduce((s, ch) => s + ch.lessons.length, 0),
    chapters: c.chapters.map((ch) => ({
      id: ch.id,
      title: ch.title,
      sortOrder: ch.sort_order,
      sections: Array.isArray(ch.sections) ? [...ch.sections] : [],
      lessons: ch.lessons.map(toLessonRow),
      pdfs: (ch.pdfs || []).map(p => ({
        id: p.id,
        name: p.name || p.path || '',
        url: p.url || p.path || '',
        path: p.path || p.url || '',
        sectionTitle: p.sectionTitle || '',
      })),
    })),
  };
  return _mergeCategoryName(result);
}

function searchCourses(keyword, categoryId, level) {
  let filtered = data.courses;
  if (keyword) {
    const kw = keyword.toLowerCase();
    filtered = filtered.filter(
      (c) =>
        c.title.toLowerCase().includes(kw) ||
        c.subtitle.toLowerCase().includes(kw) ||
        c.instructor.toLowerCase().includes(kw) ||
        c.description.toLowerCase().includes(kw)
    );
  }
  if (categoryId) {
    filtered = filtered.filter((c) => c.category_id === Number(categoryId));
  }
  if (level) {
    filtered = filtered.filter((c) => c.level === level);
  }
  return filtered.map((c) => _mergeCategoryName(toCourseRow(c)));
}

function getCourseStats() {
  let totalLessons = 0;
  for (const c of data.courses) {
    for (const ch of c.chapters) {
      totalLessons += ch.lessons.length;
    }
  }
  const prog = getProgressStats();
  return {
    totalCourses: data.courses.length,
    totalLessons,
    completedCourses: prog.completedCourses,
    completedLessons: prog.completedLessons,
  };
}

function addCourse(courseData) {
  try {
    const id = data.nextId++;
    const now = new Date().toISOString();
    const course = {
      id,
      category_id: courseData.categoryId || 1,
      title: courseData.title || '',
      subtitle: courseData.subtitle || '',
      description: courseData.description || '',
      instructor: courseData.instructor || '',
      level: courseData.level || '初级',
      duration: courseData.duration || '',
      rating: Number(courseData.rating) || 0,
      students: Number(courseData.students) || 0,
      cover_color: courseData.coverColor || '',
      cover_image: courseData.coverImage || '',
      domain: courseData.domain || 'yide2099.de5.net',
      port: courseData.port || '',
      token: courseData.token || '',
      source_id: null,
      source_key: null,
      source_path: courseData.sourcePath || '/',
      created_at: now,
      updated_at: now,
      chapters: [],
    };

    if (courseData.chapters) {
      for (let ci = 0; ci < courseData.chapters.length; ci++) {
        const chData = courseData.chapters[ci];
        const chId = data.nextChapterId++;
        const chapter = {
          id: chId,
          course_id: id,
          title: chData.title || '',
          sort_order: ci + 1,
          created_at: now,
          sections: Array.isArray(chData.sections) ? [...chData.sections] : [],
          lessons: [],
          pdfs: (chData.pdfs || []).map(p => ({
            id: p.id || ('p_' + Date.now() + '_' + Math.floor(Math.random() * 1e6)),
            name: p.name || p.path || '',
            url: p.url || p.path || '',
            path: p.path || p.url || '',
            sectionTitle: p.sectionTitle || '',
          })),
        };
        if (chData.lessons) {
          for (let li = 0; li < chData.lessons.length; li++) {
            const lData = chData.lessons[li];
            chapter.lessons.push({
              id: data.nextLessonId++,
              chapter_id: chId,
              title: lData.title || '',
              duration: lData.duration || '00:00',
              video_url: lData.videoUrl || '',
              video_url_local: lData.videoUrlLocal || lData.videoUrl || '',
              video_type: lData.videoType || 'local',
              is_free: lData.isFree ? 1 : 0,
              sort_order: li + 1,
              attachments: lData.attachments || null,
              doc_url: lData.docUrl || '',
              path: lData.path || '',
              sectionTitle: lData.sectionTitle || '',
              created_at: now,
            });
          }
        }
        course.chapters.push(chapter);
      }
    }

    data.courses.push(course);
    saveJson();
    return { success: true, courseId: id };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function deleteCourse(courseId) {
  try {
    const idx = data.courses.findIndex((c) => c.id === Number(courseId));
    if (idx === -1) return { success: false, error: '课程不存在' };
    data.courses.splice(idx, 1);
    saveJson();
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function updateCourse(courseData) {
  try {
    const c = findCourse(courseData.courseId);
    if (!c) return { success: false, error: '课程不存在' };

    if (courseData.title !== undefined) c.title = courseData.title;
    if (courseData.categoryId !== undefined)
      c.category_id = courseData.categoryId;
    if (courseData.subtitle !== undefined) c.subtitle = courseData.subtitle;
    if (courseData.description !== undefined)
      c.description = courseData.description;
    if (courseData.instructor !== undefined)
      c.instructor = courseData.instructor;
    if (courseData.level !== undefined) c.level = courseData.level;
    if (courseData.duration !== undefined) c.duration = courseData.duration;
    if (courseData.rating !== undefined) c.rating = Number(courseData.rating);
    if (courseData.students !== undefined)
      c.students = Number(courseData.students);
    if (courseData.coverColor !== undefined)
      c.cover_color = courseData.coverColor;
    if (courseData.coverImage !== undefined)
      c.cover_image = courseData.coverImage;
    if (courseData.domain !== undefined) c.domain = courseData.domain;
    if (courseData.port !== undefined) c.port = courseData.port;
    if (courseData.token !== undefined) c.token = courseData.token;
    if (courseData.sourcePath !== undefined)
      c.source_path = courseData.sourcePath;
    c.updated_at = new Date().toISOString();

    // 重写章节结构
    if (Object.prototype.hasOwnProperty.call(courseData, 'chapters')) {
      const now = new Date().toISOString();
      c.chapters = [];
      const chapters = Array.isArray(courseData.chapters)
        ? courseData.chapters
        : [];
      for (let ci = 0; ci < chapters.length; ci++) {
        const chData = chapters[ci];
        if (!chData || !chData.title) continue;
        const chId = data.nextChapterId++;
        const chapter = {
          id: chId,
          course_id: c.id,
          title: chData.title,
          sort_order: ci + 1,
          created_at: now,
          sections: Array.isArray(chData.sections) ? [...chData.sections] : [],
          lessons: [],
          pdfs: (chData.pdfs || []).map(p => ({
            id: p.id || ('p_' + Date.now() + '_' + Math.floor(Math.random() * 1e6)),
            name: p.name || p.path || '',
            url: p.url || p.path || '',
            path: p.path || p.url || '',
            sectionTitle: p.sectionTitle || '',
          })),
        };
        if (chData.lessons && Array.isArray(chData.lessons)) {
          for (let li = 0; li < chData.lessons.length; li++) {
            const lData = chData.lessons[li];
            if (!lData || !lData.title) continue;
            chapter.lessons.push({
              id: data.nextLessonId++,
              chapter_id: chId,
              title: lData.title,
              duration: lData.duration || '00:00',
              video_url: lData.videoUrl || '',
              video_url_local: lData.videoUrlLocal || lData.videoUrl || '',
              video_type: lData.videoType || 'local',
              is_free: lData.isFree ? 1 : 0,
              sort_order: li + 1,
              attachments: lData.attachments || null,
              doc_url: lData.docUrl || '',
              path: lData.path || '',
              sectionTitle: lData.sectionTitle || '',
              created_at: now,
            });
          }
        }
        c.chapters.push(chapter);
      }
    }

    saveJson();
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ============================================================
//  云端同步 upsert
// ============================================================

function upsertCourseFromSource(input) {
  if (!input || !input.sourceKey) throw new Error('sourceKey 不能为空');

  let categoryId = parseInt(input.categoryId);
  if (!categoryId || categoryId < 1) categoryId = 1;

  const existing = data.courses.find(
    (c) => c.source_key === input.sourceKey
  );
  let created = false;

  try {
    const now = new Date().toISOString();

    if (existing) {
      // 更新已有课程
      existing.category_id = categoryId;
      existing.title = input.title || existing.title;
      existing.subtitle = input.subtitle || '';
      existing.description = input.description || '';
      existing.instructor = input.instructor || '';
      existing.level = input.level || '初级';
      existing.duration = input.duration || '';
      existing.rating = Number(input.rating) || 0;
      existing.students = Number(input.students) || 0;
      existing.cover_color = input.coverColor || '';
      existing.cover_image = input.coverImage || '';
      existing.domain = input.domain || 'yide2099.de5.net';
      existing.port = input.port || '';
      existing.token = input.token || '';
      existing.source_id = input.sourceId || null;
      existing.source_path = input.sourcePath || '';
      existing.updated_at = now;

      // 重写章节
      const newChapters = Array.isArray(input.chapters) ? input.chapters : [];
      if (newChapters.length > 0) {
        existing.chapters = [];
        for (let ci = 0; ci < newChapters.length; ci++) {
          const ch = newChapters[ci];
          if (!ch || !ch.title || !String(ch.title).trim()) continue;
          const chId = data.nextChapterId++;
          const chapter = {
            id: chId,
            course_id: existing.id,
            title: ch.title,
            sort_order:
              ch.sortOrder && ch.sortOrder > 0 ? ch.sortOrder : ci + 1,
            created_at: now,
            sections: Array.isArray(ch.sections) ? [...ch.sections] : [],
            lessons: [],
            pdfs: (ch.pdfs || []).map(p => ({
              id: p.id || ('p_' + Date.now() + '_' + Math.floor(Math.random() * 1e6)),
              name: p.name || p.path || '',
              url: p.url || p.path || '',
              path: p.path || p.url || '',
              sectionTitle: p.sectionTitle || '',
            })),
          };
          const lessons = ch.lessons || [];
          for (let li = 0; li < lessons.length; li++) {
            const l = lessons[li];
            if (!l || !l.title || !String(l.title).trim()) continue;
            chapter.lessons.push({
              id: data.nextLessonId++,
              chapter_id: chId,
              title: l.title,
              duration: l.duration || '00:00',
              video_url: l.videoUrl || '',
              video_url_local: l.videoUrlLocal || l.videoUrl || '',
              video_type: l.videoType || 'local',
              is_free: l.isFree ? 1 : 0,
              sort_order:
                l.sortOrder && l.sortOrder > 0 ? l.sortOrder : li + 1,
              attachments: l.attachments || null,
              doc_url: l.docUrl || '',
              path: l.path || '',
              sectionTitle: l.sectionTitle || '',
              created_at: now,
            });
          }
          existing.chapters.push(chapter);
        }
      }
    } else {
      // 新建课程
      const id = data.nextId++;
      const course = {
        id,
        category_id: categoryId,
        title: input.title || '',
        subtitle: input.subtitle || '',
        description: input.description || '',
        instructor: input.instructor || '',
        level: input.level || '初级',
        duration: input.duration || '',
        rating: Number(input.rating) || 0,
        students: Number(input.students) || 0,
        cover_color: input.coverColor || '',
        cover_image: input.coverImage || '',
        domain: input.domain || 'yide2099.de5.net',
        port: input.port || '',
        token: input.token || '',
        source_id: input.sourceId || null,
        source_key: input.sourceKey,
        source_path: input.sourcePath || '',
        created_at: now,
        updated_at: now,
        chapters: [],
      };

      const chapters = input.chapters || [];
      for (let ci = 0; ci < chapters.length; ci++) {
        const ch = chapters[ci];
        if (!ch || !ch.title || !String(ch.title).trim()) continue;
        const chId = data.nextChapterId++;
        const chapter = {
          id: chId,
          course_id: id,
          title: ch.title,
          sort_order:
            ch.sortOrder && ch.sortOrder > 0 ? ch.sortOrder : ci + 1,
          created_at: now,
          sections: Array.isArray(ch.sections) ? [...ch.sections] : [],
          lessons: [],
          pdfs: (ch.pdfs || []).map(p => ({
            id: p.id || ('p_' + Date.now() + '_' + Math.floor(Math.random() * 1e6)),
            name: p.name || p.path || '',
            url: p.url || p.path || '',
            path: p.path || p.url || '',
            sectionTitle: p.sectionTitle || '',
          })),
        };
        const lessons = ch.lessons || [];
        for (let li = 0; li < lessons.length; li++) {
          const l = lessons[li];
          if (!l || !l.title || !String(l.title).trim()) continue;
          chapter.lessons.push({
            id: data.nextLessonId++,
            chapter_id: chId,
            title: l.title,
            duration: l.duration || '00:00',
            video_url: l.videoUrl || '',
            video_url_local: l.videoUrlLocal || l.videoUrl || '',
            video_type: l.videoType || 'local',
            is_free: l.isFree ? 1 : 0,
            sort_order:
              l.sortOrder && l.sortOrder > 0 ? l.sortOrder : li + 1,
            attachments: l.attachments || null,
            doc_url: l.docUrl || '',
            path: l.path || '',
            sectionTitle: l.sectionTitle || '',
            created_at: now,
          });
        }
        course.chapters.push(chapter);
      }

      data.courses.push(course);
      created = true;
    }

    saveJson();
    return created;
  } catch (e) {
    throw e;
  }
}

// ============================================================
//  章节管理
// ============================================================

function addChapter(courseId, title) {
  if (!courseId || !title || !title.trim())
    return { success: false, error: '参数不完整' };
  try {
    const c = findCourse(courseId);
    if (!c) return { success: false, error: '课程不存在' };
    const maxOrder = c.chapters.reduce(
      (max, ch) => Math.max(max, ch.sort_order),
      0
    );
    const id = data.nextChapterId++;
    c.chapters.push({
      id,
      course_id: Number(courseId),
      title: title.trim(),
      sort_order: maxOrder + 1,
      created_at: new Date().toISOString(),
      lessons: [],
    });
    saveJson();
    return { success: true, id };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function deleteChapter(chapterId) {
  try {
    for (const c of data.courses) {
      const idx = c.chapters.findIndex((ch) => ch.id === Number(chapterId));
      if (idx !== -1) {
        c.chapters.splice(idx, 1);
        saveJson();
        return { success: true };
      }
    }
    return { success: false, error: '章节不存在' };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function updateChapter(chapterId, title) {
  if (!title || !title.trim())
    return { success: false, error: '章节名不能为空' };
  try {
    const ch = findChapter(chapterId);
    if (!ch) return { success: false, error: '章节不存在' };
    ch.title = title.trim();
    saveJson();
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ============================================================
//  课时管理
// ============================================================

function addLesson(chapterId, title, duration) {
  if (!chapterId || !title || !title.trim())
    return { success: false, error: '参数不完整' };
  try {
    const result = findChapterWithCourse(chapterId);
    if (!result) return { success: false, error: '章节不存在' };
    const { chapter } = result;
    const maxOrder = chapter.lessons.reduce(
      (max, l) => Math.max(max, l.sort_order),
      0
    );
    const id = data.nextLessonId++;
    chapter.lessons.push({
      id,
      chapter_id: Number(chapterId),
      title: title.trim(),
      duration: duration || '00:00',
      video_url: '',
      video_url_local: '',
      video_type: 'local',
      is_free: 0,
      sort_order: maxOrder + 1,
      attachments: null,
      created_at: new Date().toISOString(),
    });
    saveJson();
    return { success: true, id };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function deleteLesson(lessonId) {
  try {
    for (const c of data.courses) {
      for (const ch of c.chapters) {
        const idx = ch.lessons.findIndex((l) => l.id === Number(lessonId));
        if (idx !== -1) {
          ch.lessons.splice(idx, 1);
          saveJson();
          return { success: true };
        }
      }
    }
    return { success: false, error: '课时不存在' };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function updateLesson(lessonId, data) {
  if (!data)
    return { success: false, error: '参数不能为空' };
  try {
    const l = findLesson(lessonId);
    if (!l) return { success: false, error: '课时不存在' };
    if (data.title !== undefined && data.title.trim())
      l.title = data.title.trim();
    if (data.duration !== undefined) l.duration = data.duration;
    if (data.videoUrl !== undefined) l.video_url = data.videoUrl;
    if (data.isFree !== undefined) l.is_free = data.isFree ? 1 : 0;
    saveJson();
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function closeCourseDatabase() {
  saveJson();
}

// ============================================================
//  分类变更辅助
// ============================================================

function updateCategoryForCourses(oldCategoryId, newCategoryId) {
  for (const c of data.courses) {
    if (c.category_id === Number(oldCategoryId)) {
      c.category_id = Number(newCategoryId);
    }
  }
  saveJson();
}

function _mergeCategoryName(course) {
  const cat = data.categories.find((c) => c.id === Number(course.categoryId));
  course.category = cat ? cat.name : '未分类';
  return course;
}

// ============================================================
//  Categories CRUD
// ============================================================

function getAllCategories() {
  return data.categories
    .slice()
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
    .map((c) => ({
      id: c.id,
      name: c.name,
      icon: c.icon,
      sortOrder: c.sort_order,
    }));
}

function _seedDefaultCategoriesIfEmpty() {
  if (data.categories.length > 0) return;
  const defaults = [
    { name: '计算机基础课程', icon: '🗃️', sort_order: 1 },
    { name: '软考课程', icon: '📘', sort_order: 2 },
    { name: '行测课程', icon: '📝', sort_order: 3 },
    { name: '申论课程', icon: '📜', sort_order: 4 },
    { name: '面试课程', icon: '🎤', sort_order: 5 },
    { name: '经济经融基础课程', icon: '📊', sort_order: 6 },
    { name: '英语课程', icon: '🔤', sort_order: 7 },
  ];
  for (const c of defaults) {
    data.categories.push({
      id: data.nextCategoryId++,
      name: c.name,
      icon: c.icon,
      sort_order: c.sort_order,
      created_at: new Date().toISOString(),
    });
  }
  saveJson();
}

function addCategory(name, icon) {
  if (!name || !name.trim()) return { success: false, error: '分类名不能为空' };
  const trimmed = name.trim();
  if (data.categories.some((c) => c.name === trimmed)) {
    return { success: false, error: '分类已存在' };
  }
  const maxSort = data.categories.reduce((m, c) => Math.max(m, c.sort_order || 0), 0);
  const item = {
    id: data.nextCategoryId++,
    name: trimmed,
    icon: icon || '',
    sort_order: maxSort + 1,
    created_at: new Date().toISOString(),
  };
  data.categories.push(item);
  saveJson();
  return { success: true, id: item.id };
}

function updateCategory(id, name, icon) {
  if (!id) return { success: false, error: '缺少分类ID' };
  if (!name || !name.trim()) return { success: false, error: '分类名不能为空' };
  const trimmed = name.trim();
  if (data.categories.some((c) => c.name === trimmed && c.id !== Number(id))) {
    return { success: false, error: '已存在同名分类' };
  }
  const cat = data.categories.find((c) => c.id === Number(id));
  if (!cat) return { success: false, error: '分类不存在' };
  cat.name = trimmed;
  if (icon !== undefined) cat.icon = icon;
  saveJson();
  return { success: true };
}

function deleteCategory(categoryId) {
  if (!categoryId) return { success: false, error: '缺少分类ID' };
  if (String(categoryId) === '1') {
    return { success: false, error: '默认分类（未分类）不能删除' };
  }
  const idx = data.categories.findIndex((c) => c.id === Number(categoryId));
  if (idx === -1) return { success: false, error: '分类不存在' };
  updateCategoryForCourses(categoryId, 1);
  data.categories.splice(idx, 1);
  saveJson();
  return { success: true };
}

// ============================================================
//  Learning Progress CRUD
// ============================================================

function updateProgress(courseId, lessonId, progress, completed, lastPosition) {
  const idx = data.learningProgress.findIndex(
    (p) => p.courseId === Number(courseId) && p.lessonId === Number(lessonId)
  );
  const now = new Date().toISOString();
  if (idx >= 0) {
    const p = data.learningProgress[idx];
    p.progress = Number(progress) || 0;
    p.completed = completed ? 1 : 0;
    p.lastPosition = Number(lastPosition) || 0;
    p.updatedAt = now;
  } else {
    data.learningProgress.push({
      courseId: Number(courseId),
      lessonId: Number(lessonId),
      progress: Number(progress) || 0,
      completed: completed ? 1 : 0,
      lastPosition: Number(lastPosition) || 0,
      updatedAt: now,
    });
  }
  saveJson();
}

function getCourseProgress(courseId) {
  return data.learningProgress
    .filter((p) => p.courseId === Number(courseId))
    .map((p) => ({
      lessonId: p.lessonId,
      progress: p.progress,
      completed: p.completed,
      lastPosition: p.lastPosition,
      updatedAt: p.updatedAt,
    }));
}

function getProgressStats() {
  const completedLessons = data.learningProgress.filter((p) => p.completed === 1).length;
  const completedCourses = new Set(
    data.learningProgress.filter((p) => p.completed === 1).map((p) => p.courseId)
  ).size;
  return { completedCourses, completedLessons };
}

// ============================================================
//  导出
// ============================================================

module.exports = {
  initCourseDatabase,
  getAllCourses,
  getCourseDetail,
  searchCourses,
  getCourseStats,
  addCourse,
  deleteCourse,
  updateCourse,
  upsertCourseFromSource,
  addChapter,
  deleteChapter,
  updateChapter,
  addLesson,
  deleteLesson,
  updateLesson,
  updateCategoryForCourses,
  closeCourseDatabase,
  getAllCategories,
  addCategory,
  updateCategory,
  deleteCategory,
  updateProgress,
  getCourseProgress,
};