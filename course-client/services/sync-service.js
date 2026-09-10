// ============================================================
//  CD2 同步编排 — 同步课程源、扫描草稿、目录列表
// ============================================================

const { createClient } = require('@andie/cd2');
const configMod = require('../database/config');
const db = require('../database/course-db');
const { fetchChaptersFromCd2 } = require('./cd2-fetch');
const {
  _isDir, _fileName, _fileSize, _joinPath, _stripTrailing,
  _cd2Timeout, formatDuration,
} = require('./cd2-utils');

// ============================================================
//  同步单个源
// ============================================================
async function syncSource(source) {
  const { endpoint, token, remotePath, name } = source;
  if (!endpoint || !token) {
    return { success: false, error: '缺少 endpoint 或 token', chapters: [] };
  }

  console.log(`[sync] 开始同步 "${name || endpoint}"，远程路径: ${remotePath || '/'}`);

  // 1) 从 CD2 拉取章节
  const chapters = await fetchChaptersFromCd2(endpoint, token, remotePath || '/');
  if (!chapters || chapters.length === 0) {
    console.log(`[sync] "${name}" 无可用章节`);
    return { success: false, error: '远程目录为空或无法访问', chapters: [] };
  }

  // 2) 写入数据库
  const course = {
    title: name || '未命名课程',
    source: endpoint,
    sourceType: 'clouddrive2',
    chapters,
    updatedAt: new Date().toISOString(),
  };

  // 查找是否已有同名课程（按 source 匹配）
  const all = db.getAllCourses();
  const exist = Array.isArray(all) ? all.find(c => c.source === endpoint) : null;

  if (exist) {
    course.id = exist.id;
    course.createdAt = exist.createdAt || new Date().toISOString();
    // 合并学习进度
    if (exist.chapters && Array.isArray(exist.chapters)) {
      for (const newCh of course.chapters) {
        const oldCh = exist.chapters.find(oc => oc.title === newCh.title);
        if (oldCh && oldCh.lessons) {
          for (const newL of newCh.lessons) {
            const oldL = oldCh.lessons.find(ol => ol.title === newL.title);
            if (oldL) {
              if (oldL.progress != null) newL.progress = oldL.progress;
              if (oldL.lastPosition != null) newL.lastPosition = oldL.lastPosition;
            }
          }
        }
      }
    }
    db.updateCourse(course);
    console.log(`[sync] 已更新课程 #${course.id} "${course.title}"`);
  } else {
    course.id = db.getNextId();
    course.createdAt = new Date().toISOString();
    db.addCourse(course);
    console.log(`[sync] 已新建课程 #${course.id} "${course.title}"`);
  }

  return { success: true, chapters, courseId: course.id };
}

// ============================================================
//  同步所有源
// ============================================================
async function syncAll() {
  const sources = configMod.allSources();
  if (!Array.isArray(sources) || sources.length === 0) {
    return { success: false, error: '没有配置的课程源', results: [] };
  }

  const results = [];
  for (const src of sources) {
    if (!src || !src.endpoint || !src.token) {
      results.push({ name: src?.name || '未命名', success: false, error: '缺少 endpoint 或 token' });
      continue;
    }
    const r = await syncSource(src);
    results.push({ name: src.name, ...r });
  }

  const ok = results.filter(r => r.success).length;
  const fail = results.filter(r => !r.success).length;
  console.log(`[sync] 同步完成: ${ok} 成功, ${fail} 失败`);
  return { success: fail === 0, results };
}

// ============================================================
//  扫描课程草稿（从 CD2 远程目录扫描 .json 课程定义）
// ============================================================

/** 扫描单个 CD2 远程目录下的 .json 课程定义文件 */
async function _scanCourseDraft(endpoint, token, dirPath, c) {
  let files = [];
  try {
    files = await _cd2Timeout(c.ls(dirPath), 99999, `CD2 列表「${dirPath}」超时`);
    if (!Array.isArray(files)) files = [];
  } catch (e) {
    console.error(`[scan] 列表失败 ${dirPath}:`, e.message);
    return [];
  }

  const drafts = [];
  for (const f of files) {
    const fn = _fileName(f);
    if (!fn.endsWith('.json')) continue;
    if (_isDir(f)) continue;

    const fp = _joinPath(dirPath, fn);
    try {
      const raw = await _cd2Timeout(c.readFile(fp), 99999, `CD2 读取「${fp}」超时`);
      const text = typeof raw === 'string' ? raw : Buffer.from(raw).toString('utf-8');
      const parsed = JSON.parse(text);
      if (parsed && parsed.title) {
        drafts.push({
          title: parsed.title,
          description: parsed.description || '',
          source: endpoint,
          remotePath: fp,
          chapters: parsed.chapters || [],
          raw: parsed,
        });
      }
    } catch (e) {
      console.error(`[scan] 解析失败 ${fp}:`, e.message);
    }
  }
  return drafts;
}

/** 扫描所有已配置源的课程草稿 */
async function scanCourseDrafts() {
  const sources = configMod.allSources();
  if (!Array.isArray(sources) || sources.length === 0) {
    return { success: false, error: '没有配置的课程源', drafts: [] };
  }

  const allDrafts = [];
  for (const src of sources) {
    if (!src || !src.endpoint || !src.token) continue;
    try {
      const c = createClient({ endpoint: src.endpoint, token: src.token });
      const path = src.remotePath || '/';
      const drafts = await _scanCourseDraft(src.endpoint, src.token, path, c);
      allDrafts.push(...drafts);
    } catch (e) {
      console.error(`[scan] 扫描源 "${src.name}" 失败:`, e.message);
    }
  }
  return { success: true, drafts: allDrafts };
}

/** 列出远程目录（供前端浏览 CD2 文件结构） */
async function listCloudDirectory(endpoint, token, dirPath = '/') {
  if (!endpoint || !token) return { success: false, error: '缺少 endpoint 或 token', items: [] };
  try {
    const c = createClient({ endpoint, token });
    const files = await _cd2Timeout(c.ls(dirPath), 99999, 'CD2 目录列表超时');
    if (!Array.isArray(files)) return { success: true, items: [] };

    const items = files.map(f => ({
      name: _fileName(f),
      isDir: _isDir(f),
      size: _fileSize(f),
      path: _joinPath(dirPath, _fileName(f)),
    }));
    return { success: true, items };
  } catch (e) {
    return { success: false, error: e.message, items: [] };
  }
}

/** 快速扫描某个远程路径下的课程 */
async function quickScanOneCourse(endpoint, token, remotePath) {
  if (!endpoint || !token) return { success: false, error: '缺少 endpoint 或 token', data: null };
  try {
    const chapters = await fetchChaptersFromCd2(endpoint, token, remotePath || '/');
    return { success: true, data: { chapters } };
  } catch (e) {
    return { success: false, error: e.message, data: null };
  }
}

module.exports = {
  syncSource,
  syncAll,
  scanCourseDrafts,
  listCloudDirectory,
  quickScanOneCourse,
};