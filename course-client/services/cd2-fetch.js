// ============================================================
//  CD2 核心拉取 — 从 CloudDrive2 递归扫描目录结构，生成章节/课时
// ============================================================

const { createClient } = require('@andie/cd2');
const configMod = require('../database/config');
const {
  _isDir, _fileName, _fileSize, _directUrl, _directUrlDomain, _directUrlLocal,
  _videoExt, _docExt, _naturalCmpStr, _sortByFileName,
  _cd2Timeout, _joinPath, formatDuration,
} = require('./cd2-utils');

// ============================================================
//  从 CloudDrive2 动态拉取章节
// ============================================================
async function fetchChaptersFromCd2(endpoint, token, rootPath = '/') {
  // --- 解析入口主机/端口 --------------------------------------------------
  const _cfg = configMod.loadConfig() || {};
  const entryHost = (endpoint || '').replace(/^https?:\/\//i, '').split(':')[0];
  const DEFAULT_REMOTE_HOST = (_cfg.DOMAIN_CD2_HOST || '').replace(/^https?:\/\//i, '').split(':')[0];
  const innerHost = _cfg.DOMAIN_CD2_HOST
    ? DEFAULT_REMOTE_HOST
    : entryHost;

  // 代理路径生成
  function _cd2ProxyPath(path, useDomain) {
    const _entry = entryHost || '127.0.0.1';
    const _inner = innerHost || _entry;
    const hostPart = (useDomain && _cfg.DOMAIN_CD2_HOST) ? _inner : _entry;
    const clean = String(path || '').replace(/^https?:\/\//i, '');
    const enc = encodeURIComponent(clean);
    return `http://127.0.0.1:12521/proxy/${hostPart}/${enc}`;
  }
  function _cd2UrlDomain(f) {
    const u = _directUrlDomain(f);
    if (!u) return '';
    if (_cfg.DOMAIN_CD2_HOST) {
      const _inner = innerHost || entryHost || '127.0.0.1';
      const replacement = `http://127.0.0.1:12521/proxy/${_inner}/`;
      return replacement + encodeURIComponent(u.replace(/^https?:\/\//i, ''));
    }
    const _entry = entryHost || '127.0.0.1';
    const replacement = `http://127.0.0.1:12521/proxy/${_entry}/`;
    return replacement + encodeURIComponent(u.replace(/^https?:\/\//i, ''));
  }
  function _cd2UrlLocal(f) {
    const u = _directUrlLocal(f);
    if (!u) return '';
    const _entry = entryHost || '127.0.0.1';
    const replacement = `http://127.0.0.1:12521/proxy/${_entry}/`;
    return replacement + encodeURIComponent(u.replace(/^https?:\/\//i, ''));
  }
  function _videoUrl(f) {
    const u = _directUrl(f);
    if (!u) return '';
    const _entry = entryHost || '127.0.0.1';
    const replacement = `http://127.0.0.1:12521/proxy/${_entry}/`;
    return replacement + encodeURIComponent(u.replace(/^https?:\/\//i, ''));
  }
  function _videoUrlLocal(f) {
    const u = _directUrlLocal(f);
    if (!u) return '';
    const _entry = entryHost || '127.0.0.1';
    const replacement = `http://127.0.0.1:12521/proxy/${_entry}/`;
    return replacement + encodeURIComponent(u.replace(/^https?:\/\//i, ''));
  }
  function _docUrl(f) {
    const u = _directUrl(f);
    if (!u) return '';
    const _entry = entryHost || '127.0.0.1';
    const replacement = `http://127.0.0.1:12521/proxy/${_entry}/`;
    return replacement + encodeURIComponent(u.replace(/^https?:\/\//i, ''));
  }

  // --- 主逻辑 ----------------------------------------------------------
  const TIMEOUT = 99999;
  const c = createClient({ endpoint, token });
  const targetPath = rootPath || '/';

  // 1) 列出根目录
  let rootFiles = [];
  try {
    rootFiles = await _cd2Timeout(c.ls(targetPath), TIMEOUT, 'CD2 根目录列表超时');
    if (!Array.isArray(rootFiles)) {
      console.error('[cd2-fetch] 根目录不是数组:', rootFiles);
      return [];
    }
  } catch (e) {
    console.error('rootFiles error:', e.message);
    return [];
  }

  // 2) 过滤出目录（章节）
  const chapterDirs = rootFiles.filter(f => _isDir(f));
  _sortByFileName(chapterDirs);

  const chapters = [];

  for (const chapterDir of chapterDirs) {
    const chapterName = _fileName(chapterDir);
    const chapterPath = _joinPath(targetPath, chapterName);
    const chapterItem = {
      title: chapterName,
      lessons: [],
      materials: [],
    };

    // 2a) 列出章节目录
    let chapterFiles = [];
    const startTime = Date.now();
    try {
      chapterFiles = await _cd2Timeout(c.ls(chapterPath), TIMEOUT, `CD2 列表「${chapterName}」超时`);
      if (!Array.isArray(chapterFiles)) {
        console.error(`[cd2-fetch] 章节「${chapterName}」列表不是数组`);
        chapters.push(chapterItem);
        continue;
      }
    } catch (e) {
      console.error(`chapterFiles error for ${chapterName}:`, e.message);
      chapters.push(chapterItem);
      continue;
    }

    // 2b) 分离直接视频和子目录
    const subDirs = chapterFiles.filter(f => _isDir(f));
    const directVideos = chapterFiles.filter(f => _videoExt(_fileName(f)));
    _sortByFileName(subDirs);
    _sortByFileName(directVideos);

    // 2c) 如果有子目录 → 视为课时目录
    if (subDirs.length > 0) {
      for (const lessonDir of subDirs) {
        const lessonName = _fileName(lessonDir);
        const lessonPath = _joinPath(chapterPath, lessonName);
        let lessonFiles = [];
        try {
          lessonFiles = await _cd2Timeout(c.ls(lessonPath), TIMEOUT, `CD2 列表「${lessonName}」超时`);
          if (!Array.isArray(lessonFiles)) lessonFiles = [];
        } catch (e) {
          console.error(`lessonFiles error for ${lessonName}:`, e.message);
          lessonFiles = [];
        }

        const videos = lessonFiles.filter(f => _videoExt(_fileName(f)));
        _sortByFileName(videos);
        const docs = lessonFiles.filter(f => _docExt(_fileName(f)));
        _sortByFileName(docs);

        const lesson = {
          title: lessonName,
          duration: '00:00',
          lessons: [],
          materials: [],
        };

        // 视频课时
        if (videos.length > 0) {
          for (const v of videos) {
            const vn = _fileName(v);
            const vs = _fileSize(v);
            const vd = formatDuration(vs);
            const url = _videoUrl(v);
            const urlLocal = _videoUrlLocal(v);
            lesson.lessons.push({
              title: vn.replace(/\.(mp4|mkv|avi|flv|mov|wmv|webm|m4v|ts|mpg|mpeg)$/i, ''),
              duration: vd,
              url,
              urlLocal: urlLocal || undefined,
              ossUrl: undefined,
              chapterTitle: chapterName,
            });
          }
        }

        // 资料
        if (docs.length > 0) {
          for (const d of docs) {
            const dn = _fileName(d);
            const du = _docUrl(d);
            lesson.materials.push({
              title: dn,
              url: du,
              type: 'file',
            });
          }
        }

        // 如果课时下没有视频，但有资料，仍然保留
        if (lesson.lessons.length > 0 || lesson.materials.length > 0) {
          chapterItem.lessons.push(lesson);
        }
      }
    }

    // 2d) 如果章节下有直接视频 → 视为一个课时
    if (directVideos.length > 0) {
      const lesson = {
        title: chapterName,
        duration: '00:00',
        lessons: [],
        materials: [],
      };
      for (const v of directVideos) {
        const vn = _fileName(v);
        const vs = _fileSize(v);
        const vd = formatDuration(vs);
        const url = _videoUrl(v);
        const urlLocal = _videoUrlLocal(v);
        lesson.lessons.push({
          title: vn.replace(/\.(mp4|mkv|avi|flv|mov|wmv|webm|m4v|ts|mpg|mpeg)$/i, ''),
          duration: vd,
          url,
          urlLocal: urlLocal || undefined,
          ossUrl: undefined,
          chapterTitle: chapterName,
        });
      }
      chapterItem.lessons.push(lesson);
    }

    // 2e) 收集章节级资料（非视频、非目录的文件）
    if (Array.isArray(chapterFiles) && chapterFiles.length > 0) {
      const topDocs = chapterFiles.filter(f => _docExt(_fileName(f)) && !_isDir(f));
      _sortByFileName(topDocs);
      for (const d of topDocs) {
        const dn = _fileName(d);
        const du = _docUrl(d);
        chapterItem.materials.push({
          title: dn,
          url: du,
          type: 'file',
        });
      }
    }

    chapters.push(chapterItem);
  } // end for chapterDir

  return chapters;
}

module.exports = { fetchChaptersFromCd2 };