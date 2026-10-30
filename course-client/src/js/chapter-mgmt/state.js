// ============================================================
//  state.js — 章节管理：状态管理、深拷贝、统计与章节结构计算
// ============================================================

// 集中管理章节管理模式下的全部状态；进入/离开时通过 reset() 清空，避免残留上次操作
class ChapterMgmtState {
  constructor() {
    this.courseId = null;          // 当前正在编辑章节的课程 id
    this.draft = null;             // 章节草稿（可编辑副本）
    this.originalDetail = null;    // 原始课程详情（用于重置/保存）
    this.clickHandler = null;      // 章节列表的点击事件委托
    this.dragHandlers = null;      // 章节/小节/资料的拖拽排序事件
  }
  reset() {
    this.courseId = null;
    this.draft = null;
    this.originalDetail = null;
    this.clickHandler = null;
    this.dragHandlers = null;
  }
}
const chapterMgmtState = new ChapterMgmtState();

// 供各文件共享的章节草稿 / 原始详情（course-mgmt.js 中也会引用并清空）
let chapterMgmtDraft = null;
let chapterMgmtOrigDetail = null;
// 事件委托对象（events.js 挂载）
var chapterMgmtClickHandler = null;
var chapterMgmtDragHandlers = null;
// 课程管理页守卫标志（与 course-mgmt.js 保持一致）
let currentChapterMgmtCourseId = null;

// 深拷贝章节数组（含全部章/节/课时/资料）
function _chaptersDeepClone(arr) {
  return JSON.parse(JSON.stringify(arr || []));
}

// 秒 → "H:MM:SS" / "MM:SS"
function _formatDuration(sec) {
  const s = Number(sec) || 0;
  if (s <= 0) return '--';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = Math.floor(s % 60);
  const pad = (n) => String(n).padStart(2, '0');
  if (h > 0) return `${h}:${pad(m)}:${pad(ss)}`;
  return `${pad(m)}:${pad(ss)}`;
}

// 统计当前草稿的章 / 课时 / 资料数量
function _totals() {
  let L = 0, P = 0;
  (chapterMgmtDraft || []).forEach(ch => {
    L += (ch.lessons || []).length;
    P += (ch.pdfs || []).length;
  });
  return { chapters: (chapterMgmtDraft || []).length, lessons: L, pdfs: P };
}

// 保证章的 sections 字段为数组
function _ensureSectionsArr(ch) {
  if (!ch.sections) ch.sections = [];
  if (!Array.isArray(ch.sections)) ch.sections = [];
  return ch.sections;
}

// 计算章的节顺序：先按 sections 声明顺序，再补充「课时里存在但未登记」的节
function _getSectionOrder(ch) {
  const sections = _ensureSectionsArr(ch);
  const lessons = ch.lessons || [];
  const secMap = {};
  const order = [];
  sections.forEach((s) => {
    if (!secMap[s]) {
      secMap[s] = true;
      order.push(s);
    }
  });
  lessons.forEach((l) => {
    const s = l.sectionTitle || '';
    if (!secMap[s]) {
      secMap[s] = true;
      order.push(s);
    }
  });
  return order;
}

// 判断某名称的节是否已存在（sections 数组或已有课时的 sectionTitle 中）
function _sectionExistsByName(ch, name) {
  if (!name) return false;
  const sections = _ensureSectionsArr(ch);
  if (sections.indexOf(name) !== -1) return true;
  const lessons = ch.lessons || [];
  return lessons.some(l => (l.sectionTitle || '') === name);
}

// 按新节顺序重整 lessons 数组顺序
function _reorderLessonsBySection(ch, newSectionOrder) {
  const lessons = ch.lessons || [];
  const groups = {};
  newSectionOrder.forEach(s => { groups[s] = []; });
  lessons.forEach((l) => {
    const sec = l.sectionTitle || '';
    if (groups[sec]) groups[sec].push(l);
    else {
      if (!groups['__other__']) groups['__other__'] = [];
      groups['__other__'].push(l);
    }
  });
  const newLessons = [];
  newSectionOrder.forEach(s => { (groups[s] || []).forEach(l => newLessons.push(l)); });
  (groups['__other__'] || []).forEach(l => newLessons.push(l));
  ch.lessons = newLessons;
}

// 收集数组中属于某个节的全部下标（用于拖拽排序）
function _collectBySection(arr, sectionTitle) {
  var result = [];
  for (var i = 0; i < arr.length; i++) {
    if ((arr[i].sectionTitle || '') === sectionTitle) result.push(i);
  }
  return result;
}

// 将当前草稿写入数据库
function _saveChaptersDraftToDb() {
  return new Promise((resolve) => {
    (async () => {
      try {
        const detail = chapterMgmtOrigDetail;
        if (!detail) { resolve({ success: false, error: '课程信息丢失' }); return; }
        const draft = chapterMgmtDraft || [];
        const totalLessons = draft.reduce((s, c) => s + ((c.lessons || []).length), 0);
        const totalChapters = draft.length;
        const updatePayload = {
          courseId: detail.id,
          categoryId: detail.categoryId,
          title: detail.title,
          subtitle: detail.subtitle || '',
          description: detail.description || '',
          instructor: detail.instructor || '',
          level: detail.level || '初级',
          duration: `${totalChapters}章${totalLessons}集`,
          rating: detail.rating || 0,
          students: detail.students || 0,
          coverImage: detail.coverImage || '',
          coverColor: detail.coverColor || '',
          domain: detail.domain || '',
          port: detail.port != null ? detail.port : '',
          token: detail.token || '',
          sourcePath: detail.sourcePath || '/',
          _manual: !!detail._manual,
          chapters: draft,
        };
        const r = await api.updateCourse(updatePayload);
        resolve(r || { success: false, error: 'updateCourse 返回空' });
      } catch (e) {
        resolve({ success: false, error: (e && e.message) || String(e) });
      }
    })();
  });
}