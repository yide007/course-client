const api = window.electronAPI;

let currentPage = 'courses';
let currentCourseId = null;
let currentVideoLessonId = null;
let currentCategoryId = null;

// ===== 视频预加载池（最多预加载下 1 个视频，避免占用过多带宽） =====
const preloadPlayer = document.createElement('video');
preloadPlayer.preload = 'auto';
preloadPlayer.playsInline = true;
preloadPlayer.muted = true;
preloadPlayer.setAttribute('webkit-playsinline', '');
let preloadedUrl = '';

function preloadNextVideo(url) {
  if (!url || preloadedUrl === url) return;
  preloadedUrl = url;
  try {
    preloadPlayer.pause();
    preloadPlayer.removeAttribute('src');
    try { preloadPlayer.load(); } catch (_) {}
    // 稍延迟触发，不抢占当前播放的带宽
    setTimeout(() => {
      try {
        preloadPlayer.src = url;
        preloadPlayer.load().catch(() => {});
        console.log('[预加载] 已触发下一个视频:', url.split('/').pop());
      } catch (_) {}
    }, 1200);
  } catch (_) {}
}

function formatDuration(seconds) {
  if (!seconds || isNaN(seconds) || seconds <= 0) return '00:00';
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = (m < 10 ? '0' : '') + m;
  const ss = (sec < 10 ? '0' : '') + sec;
  return h > 0 ? h + ':' + mm + ':' + ss : mm + ':' + ss;
}

// ===== 同步模式开关 =====
// 开关含义：checked=开 → IP模式（127.0.0.1 本地同步 / 播放）
//           unchecked=关 → 域名模式（yide2099.de5.net 云端同步 / 播放）
const SYNC_DOMAIN_DEFAULT = 'yide2099.de5.net';
const SYNC_DOMAIN_LOCAL = '127.0.0.1';
let useLocalSync = localStorage.getItem('useLocalSync') === 'true';

function getSyncDomain(originalDomain) {
  return useLocalSync ? SYNC_DOMAIN_LOCAL : (originalDomain || SYNC_DOMAIN_DEFAULT);
}

function getSyncOptions(baseOpts) {
  // 开关开启（IP模式）：临时使用 127.0.0.1 连接 CD2 同步章节，不覆盖课程持久化配置
  // 开关关闭（域名模式）：固定使用 yide2099.de5.net
  const overrideDomain = useLocalSync ? SYNC_DOMAIN_LOCAL : SYNC_DOMAIN_DEFAULT;
  return {
    ...baseOpts,
    _connectOverride: { domain: overrideDomain, port: null },
  };
}

document.addEventListener('DOMContentLoaded', () => {
  initNavigation();
  loadCourses();
  setupEventListeners();
  initLocalSyncToggle();
});

function _refreshModeLabels(checked) {
  const ipLabel = document.querySelector('.toggle-mode-ip');
  const domainLabel = document.querySelector('.toggle-mode-domain');
  if (ipLabel) ipLabel.classList.toggle('active', !!checked);
  if (domainLabel) domainLabel.classList.toggle('active', !checked);
}
function initLocalSyncToggle() {
  const toggle = document.getElementById('local-sync-toggle');
  const hint = document.getElementById('local-sync-hint');
  if (!toggle) return;
  toggle.checked = useLocalSync;
  _refreshModeLabels(useLocalSync);
  hint.textContent = useLocalSync
    ? 'IP 同步：从 127.0.0.1 拉取章节与本地播放'
    : '域名同步：从 yide2099.de5.net 拉取章节与播放';
  console.log('[同步模式] 初始状态:', useLocalSync ? 'IP模式(开)' : '域名模式(关)');
  toggle.addEventListener('change', () => {
    useLocalSync = toggle.checked;
    localStorage.setItem('useLocalSync', useLocalSync);
    _refreshModeLabels(useLocalSync);
    hint.textContent = useLocalSync
      ? 'IP 同步：从 127.0.0.1 拉取章节与本地播放'
      : '域名同步：从 yide2099.de5.net 拉取章节与播放';
    console.log('[同步模式] 状态切换:', useLocalSync ? 'IP模式(开)' : '域名模式(关)');
  });
}

function initNavigation() {
  document.querySelectorAll('.nav-item').forEach((item) => {
    item.addEventListener('click', () => {
      const page = item.dataset.page;
      navigateTo(page);
    });
  });
}

function navigateTo(page) {
  currentPage = page;
  document.querySelectorAll('.nav-item').forEach((n) => n.classList.toggle('active', n.dataset.page === page));
  document.querySelectorAll('.page').forEach((p) => p.classList.remove('active'));
  const pageEl = document.getElementById('page-' + page);
  if (pageEl) pageEl.classList.add('active');

  // 点击"全部课程"时清除分类筛选 + 移除分类子项高亮
  if (page === 'courses') {
    currentCategoryId = null;
    const list = document.getElementById('category-list');
    if (list) list.querySelectorAll('.category-item').forEach((n) => n.classList.remove('active'));
    loadCourses();
  } else if (page === 'course-mgmt') {
    loadCourseMgmt();
  } else if (page === 'categories') {
    loadCategoryMgmt();
  } else if (page === 'students') {
    loadStudentMgmt();
  } else if (page === 'stats') {
    loadStats();
  }
}

async function loadCourses() {
  const courses = await api.getCourses();
  const categories = await api.getCategories();
  renderCategoryList(categories || [], courses || []);
  filterAndRenderCourses(courses || []);
}

function renderCategoryList(categories, courses) {
  const container = document.getElementById('category-list');
  if (!container) return;
  // 统计每个分类下的课程数量
  const countMap = {};
  (courses || []).forEach((c) => {
    const catId = c.categoryId || c.category_id || '0';
    countMap[catId] = (countMap[catId] || 0) + 1;
  });

  const icons = ['💻', '📐', '📝', '🔬', '🌐', '🎨', '💰', '⚖️', '🏥', '📊', '🔧', '📖', '📌', '📁'];

  container.innerHTML = (categories || []).map((c, i) => {
    const count = countMap[c.id] || 0;
    return '<div class="category-item' + (String(currentCategoryId) === String(c.id) ? ' active' : '') + '" data-cat-id="' + c.id + '">' +
      '<span class="cat-icon">' + (icons[i % icons.length]) + '</span>' +
      '<span class="cat-name">' + escapeHtml(c.name) + '</span>' +
      (count > 0 ? '<span class="cat-count">' + count + '</span>' : '') +
    '</div>';
  }).join('');

  // 点击分类筛选
  container.querySelectorAll('.category-item').forEach((el) => {
    el.addEventListener('click', () => {
      const catId = el.dataset.catId;
      currentCategoryId = catId || null;

      // ===== 1. 切换到课程列表页（关键：从详情页/其他页跳回） =====
      currentPage = 'courses';
      document.querySelectorAll('.page').forEach((p) => p.classList.remove('active'));
      const coursesPage = document.getElementById('page-courses');
      if (coursesPage) coursesPage.classList.add('active');

      // ===== 2. 侧边栏高亮：分类子项 + 取消"全部课程"的 active =====
      document.querySelectorAll('.nav-item').forEach((n) => n.classList.remove('active'));
      container.querySelectorAll('.category-item').forEach((n) => n.classList.remove('active'));
      el.classList.add('active');

      // ===== 3. 筛选并重新渲染课程列表（会取最新数据） =====
      filterAndRenderCourses();
    });
  });
}

// 刷新分类缓存（被多处调用以保持数据一致性）
async function loadCategories() {
  await _getCachedCategories(true);
}

async function filterAndRenderCourses(courses) {
  let data = courses;
  if (!data) {
    data = await api.getCourses();
  }
  let filtered = data || [];
  if (currentCategoryId) {
    filtered = filtered.filter((c) => {
      const cid = c.categoryId || c.category_id;
      return String(cid) === String(currentCategoryId);
    });
  }
  renderCourseList(filtered);
}

function renderCourseList(courses) {
  const container = document.getElementById('course-list');
  if (!courses.length) {
    container.innerHTML = '<p style="text-align:center;color:#94a3b8;padding:40px;">暂无课程，请先添加课程或同步课程源</p>';
    return;
  }
  container.innerHTML = courses.map((c) => {
    const hasCover = !!(c.coverImage && String(c.coverImage).trim());
    const cover = c.coverColor || 'linear-gradient(135deg, #667eea, #764ba2)';
    const coverInner = hasCover
      ? `<img src="${escapeAttr(c.coverImage)}" style="width:100%;height:100%;object-fit:cover;display:block;">`
      : '📖';
    const coverStyle = hasCover ? '' : `background:${cover};`;
    return `
    <div class="course-card">
      <div class="course-card-cover" style="${coverStyle}" onclick="viewCourseDetail(${c.id})">${coverInner}</div>
      <div class="course-card-body" onclick="viewCourseDetail(${c.id})">
        <h3>${escapeHtml(c.title)}</h3>
        <div class="course-card-meta">
          <span>📚 ${c.chapterCount || 0}章</span>
          <span>🎬 ${c.lessonCount || 0}集</span>
          <span>⭐ ${c.rating || 0}</span>
          <span>📊 ${c.level || '初级'}</span>
        </div>
      </div>
    </div>`;
  }).join('');
}

let _catCache = null;
async function _getCachedCategories(force) {
  if (!_catCache || force) _catCache = await api.getCategories() || [];
  return _catCache;
}

async function _updateCourseCategory(courseId, categoryId) {
  try {
    // 通过 updateCourse 接口只改分类，需要保留章节数据避免被删除
    const detail = await api.getCourseDetail(courseId);
    if (!detail) return false;
    const r = await api.updateCourse({
      courseId,
      categoryId,
      title: detail.title,
      subtitle: detail.subtitle || '',
      domain: detail.domain || 'yide2099.de5.net',
      port: detail.port || '',
      token: detail.token || '',
      instructor: detail.instructor || '',
      coverImage: detail.coverImage || '',
      coverColor: detail.coverColor || '',
      level: detail.level || '初级',
      rating: detail.rating || 4.5,
      description: detail.description || '',
      // 必须传入 chapters 防止 updateCourse 删除章节数据
      chapters: detail.chapters || [],
    });
    return (r && r.success);
  } catch (e) {
    console.error('[update-cat]', e);
    return false;
  }
}

async function viewCourseDetail(courseId) {
  try {
    currentCourseId = courseId;
    const detail = await api.getCourseDetail(courseId);
    if (!detail) {
      console.error('[detail] 课程不存在:', courseId);
      alert('课程不存在或已被删除');
      navigateTo('courses');
      return;
    }

    // 调试：打印数据库返回的原始数据
    console.log('[detail] 课程详情:', detail.title, '章节数:', (detail.chapters || []).length);
    if (detail.chapters && detail.chapters.length > 0) {
      const firstCh = detail.chapters[0];
      if (firstCh.lessons && firstCh.lessons.length > 0) {
        const firstL = firstCh.lessons[0];
        console.log('[detail] 第1个课时: title=%s videoUrl=%s videoUrlLocal=%s', firstL.title, firstL.videoUrl, firstL.videoUrlLocal);
      } else {
        console.log('[detail] 警告: 第1章没有课时');
      }
    }

    const [progress, categories] = await Promise.all([
      api.getCourseProgress(courseId).catch(() => []),
      _getCachedCategories(),
    ]);

    // 切换到详情页
    document.querySelectorAll('.page').forEach((p) => p.classList.remove('active'));
    const pageEl = document.getElementById('page-detail');
    pageEl.classList.add('active');

    // 取消侧边栏高亮
    document.querySelectorAll('.nav-item').forEach((n) => n.classList.remove('active'));

    document.getElementById('detail-title').textContent = detail.title;

    const progressMap = {};
    (progress || []).forEach((p) => { progressMap[p.lessonId] = p; });

    const catId = detail.categoryId || detail.category_id;
    const catName = (categories.find(c => String(c.id) === String(catId)) || {}).name || '未分类';

    // ===== 左上：同步提示 =====
    const lessonTotal = (detail.chapters || []).reduce((s, c) => s + ((c.lessons || []).length), 0);
    // 手动模式识别：_manual=true，或【没有有效token】（token为空时无法从云盘扫描，强制显示添加内容按钮）
    const hasRealToken = Boolean(String(detail.token || '').trim() && String(detail.token || '').trim().toLowerCase() !== 'null');
    const isManualCourse = Boolean(detail._manual) || !hasRealToken;
    const hasCd2 = !isManualCourse && hasRealToken;
    const showActionBtn = true; // 手动和自动模式都显示一个操作按钮

    // ===== 左下：课程目录 =====
    const chaptersEl = document.getElementById('detail-chapters');
    const chaptersHtml = (detail.chapters || []).map((ch, idx) => {
      const safeChTitle = escapeHtml(ch.title || '');
      // 按名称（标题优先，缺省用路径）从上到下自然排序展示
      const lessons = (ch.lessons || []).slice().sort(function(a, b) {
        var na = (a && (a.title || a.path || '')) || '';
        var nb = (b && (b.title || b.path || '')) || '';
        return _naturalCmpStr(na, nb);
      });

      // ===== 按 sectionTitle 分组课时 =====
      const sectionMap = {};
      var sectionOrder = [];
      lessons.forEach(function(l) {
        var sec = l.sectionTitle || '';
        if (!sectionMap[sec]) {
          sectionMap[sec] = [];
          sectionOrder.push(sec);
        }
        sectionMap[sec].push(l);
      });

      // ===== 章节PDF资料：按目录（文件路径前缀）归属到每个节 =====
      var allPdfs = _sortByName(ch.pdfs || [], function(p) { return p.path || p.name || ''; });
      var usedPdfIdx = {};
      var pdfCount = allPdfs.length;

      // 规范化路径（统一用 /，去掉结尾 /）
      function _normP(p) { return String(p || '').replace(/\\/g, '/').replace(/\/+$/, ''); }
      // 取父目录
      function _parent(p) { var n = _normP(p); var i = n.lastIndexOf('/'); return i > 0 ? n.substring(0, i) : ''; }

      // ===== 生成每个分组的 HTML =====
      var sectionGroupsHtml = '';
      sectionOrder.forEach(function(secTitle, sIdx) {
        var secLessons = sectionMap[secTitle];

        // ---- 收集本节"所有权属标识"：
        //      1) 课时文件所在的父目录路径（兼容原逻辑）
        //      2) 节名（secTitle，即二级目录名）本身，PDF 路径中只要包含 "/节名/" 片段就算归属到本节
        var secDirs = [];
        secLessons.forEach(function(l) {
          var d = _parent(l.path || '');
          if (d && secDirs.indexOf(d) === -1) secDirs.push(d);
        });
        secDirs.sort(_naturalCmpStr);
        // 额外兼容：secTitle 非空时，把 "/secTitle/" 作为路径片段匹配维度
        var secTitleNorm = (secTitle || '').trim();

        var secLessonsHtml = secLessons.map(function(l) {
          var lp = progressMap[l.id];
          var completed = lp && lp.completed;
          var prog = lp ? Math.round(lp.progress) : 0;
          var safeTitle = escapeHtml(l.title || '');
          var safeVideoUrl = escapeAttr(l.videoUrl || '');
          var safeVideoUrlLocal = escapeAttr(l.videoUrlLocal || '');
          var duration = l.duration || '00:00';
          var sourcePath = l.path || '';
          var iconHtml = completed ? '✅' : '🎬';
          return '<li class="lesson-item ' + (completed ? 'completed' : '') + '" data-lesson-id="' + l.id + '" data-video-url="' + safeVideoUrl + '" data-video-url-local="' + safeVideoUrlLocal + '" data-course-id="' + detail.id + '" data-title="' + safeTitle + '">' +
            '<span>' + iconHtml + '</span>' +
            '<span>' + safeTitle + '</span>' +
            (l.isFree ? '<span class="lesson-free-badge">免费</span>' : '') +
            '<span class="lesson-duration">' + duration + '</span>' +
            (prog > 0 ? '<span class="lesson-progress">' + prog + '%</span>' : '') +
            '</li>';
        }).join('');

        // ===== 当前节对应的 PDF：只要 PDF 在二级目录里，就归属到该节下 =====
        //      匹配维度（任一命中即可）：
        //        ① PDF 父目录 / 爷爷目录 是该节课时所在目录（原有精确匹配）
        //        ② PDF 路径中包含 "/节目录名/" 片段（只要位于该节目录层级下就匹配，子目录也算）
        //        ③ 目录前缀匹配（PDF 在该目录的任意深层子文件夹里都算）
        var secPdfs = [];
        if (secDirs.length > 0 || secTitleNorm) {
          allPdfs.forEach(function(pdf, pi) {
            if (usedPdfIdx[pi]) return;
            var pdfFull = _normP(pdf.path || pdf.name || '');
            var pdfParent = _parent(pdfFull);
            var pdfGrandParent = pdfParent ? _parent(pdfParent) : '';
            var matched = false;
            for (var di = 0; di < secDirs.length; di++) {
              var sd = secDirs[di];
              if (!sd) continue;
              // ① 同目录 / 爷爷目录
              if (pdfParent === sd || pdfGrandParent === sd) { matched = true; break; }
              // ③ 目录前缀匹配（该目录下任意层级）
              if (pdfParent && pdfParent.indexOf(sd + '/') === 0) { matched = true; break; }
              if (pdfFull.indexOf(sd + '/') === 0) { matched = true; break; }
            }
            // ② 按节名（二级目录名）作为路径片段匹配
            if (!matched && secTitleNorm) {
              var seg = '/' + secTitleNorm + '/';
              if (pdfFull.indexOf(seg) !== -1) matched = true;
              // 兼容：PDF 直接挂在节名下面（路径结尾 "/节名/xxx.pdf" 里节名就是 pdfParent 的最后一段）
              if (!matched && pdfParent) {
                var pp = _normP(pdfParent);
                var li = pp.lastIndexOf('/');
                var parentName = li >= 0 ? pp.substring(li + 1) : pp;
                if (parentName === secTitleNorm) matched = true;
              }
            }
            if (matched) { secPdfs.push(pdf); usedPdfIdx[pi] = true; }
          });
        }


        var secPdfsHtml = '';
        if (secPdfs.length > 0) {
          _sortByName(secPdfs, function(p) { return p.path || p.name || ''; });
          var token = detail.token || '';
          var pdfItems = secPdfs.map(function(p) {
            var pName = escapeHtml(p.name || '文档');
            var pUrl = escapeAttr(p.url || '');
            var pPath = p.path || '';
            return '<div class="pdf-item">' +
              '<span class="pdf-name">📄 ' + pName + '</span>' +
              '<div class="pdf-actions">' +
              '<button class="pdf-btn pdf-btn-open" data-url="' + pUrl + '" data-filename="' + escapeAttr(p.name) + '" data-token="' + escapeAttr(token) + '" title="本地预览">👁 预览</button>' +
              '<button class="pdf-btn pdf-btn-download" data-url="' + pUrl + '" data-filename="' + escapeAttr(p.name) + '" data-token="' + escapeAttr(token) + '">⬇ 下载</button>' +
              '</div></div>';
          }).join('');
          secPdfsHtml = '<div class="chapter-pdfs section-pdfs"><div class="chapter-pdfs-title">📎 资料</div><div class="chapter-pdfs-list">' + pdfItems + '</div></div>';
        }

        // 始终用 section-content 包裹，保证所有章节的缩进一致；仅当有 sectionTitle 时显示分组标题栏
        var secHeaderHtml = '';
        var secOpen = true;
        if (secTitle) {
          var secTitleEscaped = escapeHtml(secTitle);
          var secCount = secLessons.length + secPdfs.length;
          secHeaderHtml = '<div class="section-group-title" data-section-toggle="1">' +
            '<span class="section-arrow">' + (secOpen ? '▼' : '▶') + '</span>' +
            '<span class="section-group-icon">📖</span> ' + secTitleEscaped +
            '<span style="margin-left:auto;font-size:12px;color:#94a3b8;font-weight:normal;">' + secCount + ' 项</span>' +
            '</div>';
        }

        sectionGroupsHtml += '<div class="section-group">' +
          secHeaderHtml +
          '<div class="section-content" style="display:' + (secOpen ? '' : 'none') + ';">' +
          (secLessonsHtml ? '<ul class="lesson-list">' + secLessonsHtml + '</ul>' : '') +
          secPdfsHtml +
          '</div>' +
          '</div>';
      });

      // ===== 新增：PDF-only 分组 =====
      // 剩余 PDF 按父目录分组，为「只有 PDF 没有课时」的目录创建独立 section，
      // 避免这些 PDF 全部堆在「章节资料」里丢失层级。
      var _sectionTitlesFromLessons = {};
      sectionOrder.forEach(function(s) { _sectionTitlesFromLessons[s] = true; });

      var pdfLeftoverGroups = {}; // key = 父目录路径，value = [{pdf, origIdx}]
      allPdfs.forEach(function(pdf, pi) {
        if (usedPdfIdx[pi]) return;
        var pdfFull = _normP(pdf.path || pdf.name || '');
        var parentDir = _parent(pdfFull) || '__root__';
        if (!pdfLeftoverGroups[parentDir]) pdfLeftoverGroups[parentDir] = [];
        pdfLeftoverGroups[parentDir].push({ pdf: pdf, origIdx: pi });
      });

      var _pdfGroupKeys = Object.keys(pdfLeftoverGroups);
      _pdfGroupKeys.sort(_naturalCmpStr);
      // 取直接目录名作为 section 标题的辅助函数（去掉前后斜杠，避免显示成 "/讲义"）
      function _lastDir(p) {
        var n = _normP(p);
        // 连续去掉开头/结尾的斜杠
        n = n.replace(/^\/+|\/+$/g, '');
        if (!n) return '';
        var i = n.lastIndexOf('/');
        var seg = i >= 0 ? n.substring(i + 1) : n;
        // 再做一次去首尾斜杠兜底
        return seg.replace(/^\/+|\/+$/g, '');
      }
      // 归一化目录名用于比较（忽略大小写、空格、前后斜杠）
      function _normCmpName(a) {
        return String(a || '').replace(/^\/+|\/+$/g, '').trim().toLowerCase();
      }
      // 检查"目录名"是不是已经命中了章节名或任一已存在的节名
      function _isDupWithExisting(dirName, dirFullPath) {
        if (!dirName) return true;
        var na = _normCmpName(dirName);
        if (!na) return true;
        if (_normCmpName(ch.title || '') === na) return true;
        var hit = false;
        Object.keys(_sectionTitlesFromLessons).forEach(function(s) {
          if (_normCmpName(s) === na) hit = true;
        });
        if (hit) return true;
        // 再兜底：dirFullPath 的结尾是 /章节名 或 /节目录 也算命中
        if (dirFullPath) {
          var np = _normP(dirFullPath).replace(/^\/+|\/+$/g, '');
          Object.keys(_sectionTitlesFromLessons).forEach(function(s) {
            var ns = _normCmpName(s);
            if (!ns) return;
            if (np === ns || np.endsWith('/' + ns)) hit = true;
          });
          if (_normCmpName(ch.title || '')) {
            var nc = _normCmpName(ch.title || '');
            if (np === nc || np.endsWith('/' + nc)) return true;
          }
          return hit;
        }
        return false;
      }

      var _curToken = detail.token || '';
      // 如果只有根目录一个分组且其他分组全无（= 整个章节就几份零散 PDF 没有任何子目录），
      // 就不额外建 section 了，留给下方「章节资料」显示，避免出现只有一个空壳 section
      var _onlyRoot = (_pdfGroupKeys.length === 1 && _pdfGroupKeys[0] === '__root__');

      if (!_onlyRoot) {
        _pdfGroupKeys.forEach(function(dirKey) {
          var group = pdfLeftoverGroups[dirKey];
          if (!group || group.length === 0) return;

          var parentDir = (dirKey === '__root__') ? '' : dirKey;
          var secTitle = parentDir ? _lastDir(parentDir) : '';

          // 如果这个目录名 和当前章节名 / 已有节目录 / 父目录路径的末段 重名，
          // 就不要再额外包一层壳子，直接平铺一层「📎 资料」。
          var dupAsChapterOrSection = _isDupWithExisting(secTitle, parentDir);

          var secPdfs = group.map(function(g) { return g.pdf; });
          _sortByName(secPdfs, function(p) { return p.path || p.name || ''; });
          // 标记：已被 PDF-only section 使用（后续章节资料排除它们）
          group.forEach(function(g) { usedPdfIdx[g.origIdx] = true; });

          var pdfItems = secPdfs.map(function(p) {
            var pName = escapeHtml(p.name || '文档');
            var pUrl = escapeAttr(p.url || '');
            return '<div class="pdf-item">' +
              '<span class="pdf-name">📄 ' + pName + '</span>' +
              '<div class="pdf-actions">' +
              '<button class="pdf-btn pdf-btn-open" data-url="' + pUrl + '" data-filename="' + escapeAttr(p.name) + '" data-token="' + escapeAttr(_curToken) + '" title="本地预览">👁 预览</button>' +
              '<button class="pdf-btn pdf-btn-download" data-url="' + pUrl + '" data-filename="' + escapeAttr(p.name) + '" data-token="' + escapeAttr(_curToken) + '">⬇ 下载</button>' +
              '</div></div>';
          }).join('');

          if (dupAsChapterOrSection || !secTitle) {
            // 和章节/节重名 或 根目录零散 PDF：直接平铺「📎 资料」，不加额外 section 标题和缩进
            sectionGroupsHtml += '<div class="chapter-pdfs section-pdfs" style="margin-left:0;padding-left:0;"><div class="chapter-pdfs-title">📎 资料</div><div class="chapter-pdfs-list">' + pdfItems + '</div></div>';
          } else {
            // 不同名的独立目录：显示「📁 目录名」+ PDF 列表，但不包 .section-group / .section-content（避免多加一级缩进）
            var secTitleEscaped = escapeHtml(secTitle);
            sectionGroupsHtml += '<div class="section-group-title pdf-only-dir-title" style="cursor:default;">' +
              '<span class="section-group-icon">📁</span> ' + secTitleEscaped +
              '<span style="margin-left:auto;font-size:12px;color:#94a3b8;font-weight:normal;">' + secPdfs.length + ' 份资料</span>' +
              '</div>' +
              '<div class="chapter-pdfs section-pdfs" style="margin-left:0;padding-left:0;"><div class="chapter-pdfs-title">📎 资料</div><div class="chapter-pdfs-list">' + pdfItems + '</div></div>';
          }
        });
      }

      // ===== 章级资料：匹配不到具体节 / 也没有独立目录的零散 PDF，统一显示在整个章节目录下方 =====
      var chapterPdfsHtml = '';
      var leftoverPdfs = allPdfs.filter(function(_, i) { return !usedPdfIdx[i]; });
      if (leftoverPdfs.length > 0) {
        _sortByName(leftoverPdfs, function(p) { return p.path || p.name || ''; });
        var cToken = detail.token || '';
        var cPdfItems = leftoverPdfs.map(function(p) {
          var pName = escapeHtml(p.name || '文档');
          var pUrl = escapeAttr(p.url || '');
          return '<div class="pdf-item">' +
            '<span class="pdf-name">📄 ' + pName + '</span>' +
            '<div class="pdf-actions">' +
            '<button class="pdf-btn pdf-btn-open" data-url="' + pUrl + '" data-filename="' + escapeAttr(p.name) + '" data-token="' + escapeAttr(cToken) + '" title="本地预览">👁 预览</button>' +
            '<button class="pdf-btn pdf-btn-download" data-url="' + pUrl + '" data-filename="' + escapeAttr(p.name) + '" data-token="' + escapeAttr(cToken) + '">⬇ 下载</button>' +
            '</div></div>';
        }).join('');
        chapterPdfsHtml = '<div class="chapter-pdfs chapter-level-pdfs" style="margin-top:8px;"><div class="chapter-pdfs-title">📎 章节资料</div><div class="chapter-pdfs-list">' + cPdfItems + '</div></div>';
      }

      var lessonCount = lessons.length;
      var metaParts = [];
      if (lessonCount > 0) metaParts.push(lessonCount + ' 集');
      if (pdfCount > 0) metaParts.push(pdfCount + ' 份资料');

      const open = idx === 0;
      return '<li class="chapter-item" data-chapter-idx="' + idx + '">' +
        '<div class="chapter-header">' +
        '<span><span class="chapter-icon">' + (open ? '📂' : '📁') + '</span> ' + safeChTitle + '</span>' +
        '<span style="font-size:12px;color:#94a3b8;">' + metaParts.join(' · ') + '</span>' +
        '</div>' +
        '<div class="chapter-content" style="display:' + (open ? '' : 'none') + ';">' +
        sectionGroupsHtml +
        chapterPdfsHtml +
        '</div>' +
        '</li>';
    }).join('');

    const chaptersHeaderEl = document.getElementById('detail-chapters-header');
    let actionBtnHtml = '';
    if (showActionBtn) {
      if (isManualCourse) {
        actionBtnHtml = `<button id="btn-manage-content" class="btn btn-xs" style="background:linear-gradient(135deg,#8b5cf6,#6366f1);color:#fff;border:none;box-shadow:0 2px 6px rgba(139,92,246,0.3);">➕ 添加课程内容</button>`;
      } else {
        actionBtnHtml = `<button id="btn-rebuild-chapters" class="btn btn-xs btn-rebuild-chapters">🔄 更新课程目录</button>`;
      }
    }
    chaptersHeaderEl.innerHTML =
      `<div class="detail-chapters-header">
        <h3 class="detail-chapters-title">课程目录</h3>
        ${actionBtnHtml}
      </div>`;
    chaptersEl.innerHTML =
      (detail.chapters && detail.chapters.length > 0
        ? `<ul class="chapter-list">${chaptersHtml}</ul>`
        : (isManualCourse
          ? `<div style="padding:36px 20px;text-align:center;">
              <div style="font-size:40px;margin-bottom:10px;">📝</div>
              <p style="color:#64748b;font-size:13px;margin-bottom:14px;">暂无章节内容，点击右上角「添加课程内容」开始创建</p>
            </div>`
          : '<p style="color:#94a3b8;padding:20px 0;">暂无课程章节内容</p>'));

    // ===== 手动模式：「添加课程内容」按钮 → 跳课程管理章节管理 =====
    const contentBtn = document.getElementById('btn-manage-content');
    if (contentBtn) {
      contentBtn.addEventListener('click', () => {
        switchPage('course-mgmt');
        openChapterMgmt(detail.id);
      });
    }

    // ===== 按钮：从云盘同步章节 =====
    const rebuildBtn = document.getElementById('btn-rebuild-chapters');
    if (rebuildBtn) {
      rebuildBtn.addEventListener('click', async () => {
        console.log('========== [步骤1/9] 前端：点击「从云盘同步章节」按钮 ==========');
        const syncDomain = detail.domain || '';
        const syncPort = detail.port || '';
        const syncHost = syncDomain + (syncPort ? ':' + syncPort : '');
        const curMode = useLocalSync ? 'IP' : '域名';
        const curDomain = useLocalSync ? SYNC_DOMAIN_LOCAL : SYNC_DOMAIN_DEFAULT;
        console.log('[步骤1] 课程配置 → domain:', syncDomain, 'port:', syncPort, 'sourcePath:', detail.sourcePath || '/', '同步模式:', curMode, '→', curDomain);
        const label = `【${curMode}模式】将从 ${curDomain} 连接云盘，拉取最新章节\n※ 当前课程持久化配置：${syncHost || '（未配置）'}`;
        console.log('[步骤2/9] 准备同步，配置信息：', label);
        rebuildBtn.disabled = true;
        rebuildBtn.textContent = '同步中…';
        let syncSuccess = false;
        try {
          const syncOpts = getSyncOptions({ courseId: detail.id, sourcePath: detail.sourcePath || '/' });
          console.log('[步骤3/9] 准备调用 IPC → 参数:', JSON.stringify(syncOpts, null, 2));
          const t0 = Date.now();
          const r = await api.rebuildCourseChapters(syncOpts);
          const cost = ((Date.now() - t0) / 1000).toFixed(2);
          console.log('[步骤8/9] IPC 返回结果 → 耗时:', cost + 's, 响应:', JSON.stringify(r, null, 2));
          if (!r || !r.success) throw new Error((r && r.error) || '同步失败');
          syncSuccess = true;
          showToastModal({
            type: 'success',
            title: '同步成功',
            compact: true,
            autoClose: 3000
          });
        } catch (e) {
          console.error('[步骤X] 同步异常 →', e.message || e, e.stack || '');
          showToastModal({
            type: 'error',
            title: '同步失败',
            message: e.message || String(e)
          });
        } finally {
          rebuildBtn.disabled = false;
          rebuildBtn.innerHTML = '🔄 更新课程目录';
          console.log('[步骤9/9] 按钮状态已恢复');
        }
        if (syncSuccess) {
          console.log('[步骤9] 同步成功，开始刷新页面 → viewCourseDetail + loadCourses');
          viewCourseDetail(detail.id);
          loadCourses();
        }
      });
    }

    // ===== 右下：课程简介 =====
    const descEl = document.getElementById('detail-description');
    descEl.textContent = detail.description || '暂无课程简介';

    // ===== 播放器重置 + 课程封面图显示 =====
    const player = document.getElementById('detail-player');
    if (player) {
      player.pause();
      player.removeAttribute('src');
      player.load();
    }
    const subTitleEl = document.getElementById('detail-player-subtitle');
    if (subTitleEl) subTitleEl.textContent = '';
    const _s = document.getElementById('detail-progress-slider');
    if (_s) { _s.value = 0; _s.disabled = true; }
    const _t = document.getElementById('detail-progress-text');
    if (_t) _t.textContent = '0%';

    // 进入详情页默认显示课程封面图
    const coverEl = document.getElementById('detail-player-cover');
    const coverImgEl = document.getElementById('detail-player-cover-img');
    if (coverEl && coverImgEl) {
      const coverImage = detail.coverImage;
      const coverColor = detail.coverColor || 'linear-gradient(135deg, #667eea, #764ba2)';
      if (coverImage && String(coverImage).trim()) {
        coverImgEl.src = escapeAttr(coverImage);
        coverImgEl.style.background = '';
      } else {
        coverImgEl.removeAttribute('src');
        coverImgEl.style.background = coverColor;
      }
      coverEl.style.display = 'block';
      if (player) player.style.display = 'none';
    }

    // ===== 事件绑定：章节展开/收起 =====
    chaptersEl.querySelectorAll('.chapter-header').forEach((header) => {
      header.addEventListener('click', () => {
        const li = header.parentElement;
        const content = li.querySelector('.chapter-content');
        const icon = header.querySelector('.chapter-icon');
        if (!content) return;
        if (content.style.display === 'none') {
          content.style.display = '';
          if (icon) icon.textContent = '📂';
        } else {
          content.style.display = 'none';
          if (icon) icon.textContent = '📁';
        }
      });
    });

    // ===== 事件绑定：节标题展开/收起（资料随视频一起折叠） =====
    chaptersEl.querySelectorAll('.section-group-title[data-section-toggle]').forEach((secHeader) => {
      secHeader.addEventListener('click', (e) => {
        // 阻止冒泡，避免触发行点击
        e.stopPropagation();
        var group = secHeader.parentElement;
        var secContent = group.querySelector(':scope > .section-content');
        var arrow = secHeader.querySelector('.section-arrow');
        if (!secContent) return;
        if (secContent.style.display === 'none') {
          secContent.style.display = '';
          if (arrow) arrow.textContent = '▼';
        } else {
          secContent.style.display = 'none';
          if (arrow) arrow.textContent = '▶';
        }
      });
    });

    // ===== 事件绑定：课时点击播放 =====
    chaptersEl.querySelectorAll('.lesson-item').forEach((item) => {
      item.addEventListener('click', () => {
        const lessonId = parseInt(item.dataset.lessonId);
        const videoUrl = item.dataset.videoUrl || '';
        const videoUrlLocal = item.dataset.videoUrlLocal || '';
        const title = item.dataset.title || '';
        playVideo(lessonId, title, videoUrl, videoUrlLocal, detail.id, item);
      });
    });

    // ===== 事件绑定：PDF预览按钮（带鉴权下载到本地后用系统默认阅读器打开） =====
    chaptersEl.querySelectorAll('.pdf-btn-open').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const url = btn.dataset.url;
        const filename = btn.dataset.filename;
        const token = btn.dataset.token;
        if (!url) return;
        const originalText = btn.textContent;
        btn.textContent = '加载中…';
        btn.disabled = true;
        try {
          const result = await api.previewFile({ url, filename, authToken: token });
          if (result && result.success) {
            btn.textContent = '✅ 已打开';
          } else {
            btn.textContent = '❌ 失败';
            console.error('[PDF预览] 失败:', result && result.error);
            alert('预览失败：' + (result && result.error ? result.error : '未知错误'));
          }
        } catch (e) {
          btn.textContent = '❌ 失败';
          console.error('[PDF预览] 异常:', e);
          alert('预览异常：' + (e.message || e));
        }
        setTimeout(() => {
          btn.textContent = originalText;
          btn.disabled = false;
        }, 2500);
      });
    });

    // ===== 事件绑定：PDF下载按钮 =====
    chaptersEl.querySelectorAll('.pdf-btn-download').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const url = btn.dataset.url;
        const filename = btn.dataset.filename;
        const token = btn.dataset.token;
        if (!url) return;
        btn.textContent = '下载中…';
        btn.disabled = true;
        try {
          const result = await api.downloadFile({ url, filename, authToken: token });
          if (result && result.success) {
            btn.textContent = '✅ 已下载';
          } else if (result && result.canceled) {
            btn.textContent = '⬇ 下载';
          } else {
            btn.textContent = '❌ 失败';
            console.error('[PDF下载] 失败:', result && result.error);
          }
        } catch (e) {
          btn.textContent = '❌ 失败';
          console.error('[PDF下载] 异常:', e);
        }
        setTimeout(() => {
          btn.textContent = '⬇ 下载';
          btn.disabled = false;
        }, 3000);
      });
    });

    // ===== 自动同步：仅当章节为空（首次进入）时，从云盘拉取章节 =====
    const canAutoSync = Boolean((detail.domain && detail.domain.trim()) && (detail.token && detail.token.trim()));
    const chaptersEmpty = !(detail.chapters && detail.chapters.length > 0);
    if (canAutoSync && chaptersEmpty) {
      const autoTipEl = document.createElement('div');
      autoTipEl.id = 'detail-auto-sync-tip';
      autoTipEl.style.cssText = 'margin-top:10px;padding:6px 10px;border-radius:6px;background:#eff6ff;color:#1d4ed8;font-size:12px;';
      autoTipEl.textContent = '🔄 正在从云盘同步最新章节…';
      const chaptersWrap = document.getElementById('detail-chapters');
      if (chaptersWrap) chaptersWrap.appendChild(autoTipEl);

      // 用 setTimeout 让首屏先渲染出来，不阻塞用户
      setTimeout(async () => {
        try {
          const r = await api.rebuildCourseChapters(getSyncOptions({ courseId: detail.id, sourcePath: detail.sourcePath || '/' }));
          if (r && r.success) {
            if (tip) {
              tip.style.background = '#ecfdf5';
              tip.style.color = '#047857';
              tip.textContent = `✓ 同步完成：${r.chapters} 章 ${r.lessons} 集，页面即将刷新`;
            }
            setTimeout(() => {
              // 如果当前用户没有在播放视频，安全地直接 reload 详情
              const player = document.getElementById('detail-player');
              const playing = player && !player.paused && !player.ended && player.currentTime > 0;
              if (!playing) viewCourseDetail(detail.id);
            }, 700);
          } else {
            if (tip) {
              tip.style.background = '#fef2f2';
              tip.style.color = '#b91c1c';
              tip.textContent = '⚠️ 自动同步失败：' + ((r && r.error) || '未知错误') + '（可稍后点右上角按钮重试）';
            }
          }
        } catch (e) {
          const tip = document.getElementById('detail-auto-sync-tip');
          if (tip) {
            tip.style.background = '#fef2f2';
            tip.style.color = '#b91c1c';
            tip.textContent = '⚠️ 自动同步异常：' + (e.message || e);
          }
        }
      }, 400);
    }
  } catch (e) {
    console.error('[detail] 加载课程详情失败:', e);
    alert('加载课程详情失败: ' + (e.message || '未知错误'));
    navigateTo('courses');
  }
}

function playVideo(lessonId, title, videoUrl, videoUrlLocal, courseId, lessonEl) {
  currentVideoLessonId = lessonId;
  currentCourseId = courseId;

  // 根据同步模式决定优先使用哪个 URL
  // IP 模式（127.0.0.1）：优先本地地址 videoUrlLocal
  // 域名模式（yide2099.de5.net）：优先云端地址 videoUrl
  let currentUrl, fallbackUrl;
  if (useLocalSync) {
    currentUrl = videoUrlLocal || videoUrl || '';
    fallbackUrl = (videoUrl && videoUrl !== currentUrl) ? videoUrl : '';
    console.log('[视频] IP模式（127.0.0.1），优先使用本地地址:', currentUrl);
  } else {
    // 域名模式：优先用域名地址（videoUrl），域名为空时回退到本地地址
    currentUrl = videoUrl || videoUrlLocal || '';
    fallbackUrl = (videoUrlLocal && videoUrlLocal !== currentUrl) ? videoUrlLocal : '';
  }

  if (lessonEl && document.getElementById('page-detail').classList.contains('active')) {
    // ===== 详情页内嵌播放器 =====
    const chaptersEl = document.getElementById('detail-chapters');
    if (chaptersEl) {
      chaptersEl.querySelectorAll('.lesson-item').forEach((li) => li.classList.remove('playing'));
      lessonEl.classList.add('playing');
    }

    const player = document.getElementById('detail-player');
    const slider = document.getElementById('detail-progress-slider');
    const textEl = document.getElementById('detail-progress-text');
    const titleEl = document.getElementById('detail-player-subtitle');
    const playerArea = document.getElementById('detail-player-area');
    const coverEl = document.getElementById('detail-player-cover');

    // 播放课时：隐藏封面图，显示视频播放器
    if (coverEl) coverEl.style.display = 'none';
    if (player) player.style.display = 'block';

    if (titleEl) titleEl.textContent = title;
    if (slider) slider.value = 0;
    if (textEl) textEl.textContent = '0%';

    // ===== 加载中 spinner（等 canplay / playing 后自动移除），挂载位置：卡片右上角（和"视频播放"标题同一行）=====
    const spinnerRoot = playerArea ? playerArea.parentElement : null;
    let spinner = spinnerRoot ? spinnerRoot.querySelector(':scope > .video-loading-spinner') : null;
    if (spinnerRoot && currentUrl) {
      if (!spinner) {
        spinner = document.createElement('div');
        spinner.className = 'video-loading-spinner';
        spinner.textContent = '正在缓冲视频…';
        spinnerRoot.appendChild(spinner);
      }
      spinner.style.display = 'inline-flex';
    }
    const removeSpinner = () => {
      if (spinner && spinner.parentNode) {
        try { spinner.parentNode.removeChild(spinner); } catch (_) {}
      }
      spinner = null;
    };

    // ⚠️ 先设置 onerror，再设置 src 和 load，避免时序问题
    // 视频加载失败时自动回退到备选地址
    player.onerror = function() {
      removeSpinner();
      const mediaError = player.error;
      console.error('[视频] 播放失败:');
      console.error('  URL:', player.src);
      console.error('  错误代码:', mediaError ? mediaError.code : 'unknown');
      console.error('  错误信息:', mediaError ? mediaError.message : '');
      let errType = '未知';
      if (mediaError) {
        const errMap = { 1: 'MEDIA_ERR_ABORTED', 2: 'MEDIA_ERR_NETWORK', 3: 'MEDIA_ERR_DECODE', 4: 'MEDIA_ERR_SRC_NOT_SUPPORTED' };
        errType = errMap[mediaError.code] || '未知';
        console.error('  错误类型:', errType);
      }
      if (fallbackUrl && player.src !== fallbackUrl) {
        console.log('[视频] 主地址加载失败，回退到备选地址:', fallbackUrl);
        // 显示回退提示
        titleEl.textContent = title + ' ⚠️ 主地址不可用，正在切换备选地址...';
        currentUrl = fallbackUrl;
        fallbackUrl = '';
        player.src = currentUrl;
        player.load();
        player.play().catch(() => {});
      } else {
        console.error('[视频] 主地址和备选地址都播放失败');
        const errMsg = '资源异常或网络链接错误！请检查服务器状态';
        titleEl.textContent = '⚠️ ' + title + ' - 播放失败';
        // 显示错误提示在播放器区域
        const playerContainer = player.parentElement;
        if (playerContainer) {
          let errDiv = playerContainer.querySelector('.video-error-msg');
          if (!errDiv) {
            errDiv = document.createElement('div');
            errDiv.className = 'video-error-msg';
            errDiv.style.cssText = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(0,0,0,0.85);color:#f87171;padding:20px 28px;border-radius:12px;font-size:14px;line-height:1.8;text-align:center;z-index:10;white-space:pre-line;max-width:80%;border:1px solid rgba(248,113,113,0.3);';
            playerContainer.style.position = 'relative';
            playerContainer.appendChild(errDiv);
          }
          errDiv.textContent = errMsg;
        }
      }
    };

    player.src = currentUrl;
    player.load();
    if (slider) slider.disabled = !currentUrl;

    // 播放成功时清除错误提示
    player.onplaying = function() {
      removeSpinner();
      const playerContainer = player.parentElement;
      if (playerContainer) {
        const errDiv = playerContainer.querySelector('.video-error-msg');
        if (errDiv) errDiv.remove();
      }
      titleEl.textContent = title;
    };
    // 数据可以播放时也移除 spinner（有时 canplay 先触发，playing 不一定）
    player.oncanplay = function() {
      setTimeout(removeSpinner, 400);
    };
    // 视频元数据加载完成后，用真实时长更新左侧目录的时长显示，并写入数据库
    player.onloadedmetadata = async function() {
      if (player.duration && lessonEl) {
        const realDuration = formatDuration(player.duration);
        const durationSpan = lessonEl.querySelector('.lesson-duration');
        if (durationSpan && durationSpan.textContent !== realDuration) {
          console.log('[时长修正] lessonId=' + lessonId + ' 原时长=' + durationSpan.textContent + ' 真实时长=' + realDuration);
          durationSpan.textContent = realDuration;
          // 写入数据库持久化存储
          try {
            const r = await api.updateLesson({ lessonId, data: { duration: realDuration } });
            if (r && r.success) {
              console.log('[时长修正] 已写入数据库 lessonId=' + lessonId);
            } else {
              console.warn('[时长修正] 写入数据库失败 lessonId=' + lessonId, r && r.error);
            }
          } catch (e) {
            console.warn('[时长修正] 写入数据库异常 lessonId=' + lessonId, e.message);
          }
        }
      }
    };
    player.onwaiting = function() {
      // seek 中 / 缓冲不足时，临时再显示 spinner（仍放在卡片右上角，不盖住视频）
      if (spinnerRoot) {
        spinner = spinnerRoot.querySelector(':scope > .video-loading-spinner');
        if (!spinner) {
          spinner = document.createElement('div');
          spinner.className = 'video-loading-spinner';
          spinner.textContent = '正在缓冲…';
          spinnerRoot.appendChild(spinner);
        }
        spinner.style.display = 'inline-flex';
      }
    };
    player.onplaying = (function(old) {
      return function() {
        removeSpinner();
        if (typeof old === 'function') old.apply(this, arguments);
      };
    })(player.onplaying);
    player.onerror = (function(old) {
      return function() {
        removeSpinner();
        if (typeof old === 'function') old.apply(this, arguments);
      };
    })(player.onerror);

    if (currentUrl) {
      player.play().catch(() => {});
      // ===== 启动下一个课时的预加载 =====
      try {
        const allLessonItems = Array.from(chaptersEl.querySelectorAll('.lesson-item'));
        const currentIdx = allLessonItems.findIndex((el) => el === lessonEl);
        if (currentIdx !== -1 && currentIdx + 1 < allLessonItems.length) {
          const nextEl = allLessonItems[currentIdx + 1];
          const nextUrl = nextEl.getAttribute('data-url') || nextEl.getAttribute('data-url-local') || '';
          if (nextUrl) preloadNextVideo(nextUrl);
        }
      } catch (_) {}
    } else {
      setTimeout(() => alert('该课时暂无视频地址'), 50);
    }

    player.ontimeupdate = () => {
      if (player.duration) {
        const pct = (player.currentTime / player.duration) * 100;
        if (slider) slider.value = pct;
        if (textEl) textEl.textContent = Math.round(pct) + '%';
      }
    };
    player.onended = () => {
      api.updateProgress({ courseId, lessonId, progress: 100, completed: true, lastPosition: player.duration || 0 });
      const playing = chaptersEl.querySelector('.lesson-item.playing');
      if (playing) {
        playing.classList.remove('playing');
        playing.classList.add('completed');
        const icon = playing.querySelector('span:first-child');
        if (icon) icon.textContent = '✅';
      }
    };
    player.onpause = () => {
      if (player.currentTime > 0 && player.duration) {
        const pct = (player.currentTime / player.duration) * 100;
        api.updateProgress({ courseId, lessonId, progress: pct, completed: pct >= 95, lastPosition: player.currentTime });
      }
    };
    if (slider) {
      slider.onchange = () => {
        if (player.duration) player.currentTime = (parseFloat(slider.value) / 100) * player.duration;
      };
    }
    return;
  }

  // ===== 模态框播放器（保留备用）=====
  const overlay = document.getElementById('video-overlay');
  const player = document.getElementById('video-player');
  document.getElementById('video-title').textContent = title;
  document.getElementById('video-progress-slider').value = 0;
  document.getElementById('video-progress-text').textContent = '0%';

  overlay.classList.remove('hidden');
  // ⚠️ 先设置 onerror，再设置 src 和 load
  player.onerror = function() {
    const mediaError = player.error;
    console.error('[视频-模态] 播放失败:');
    console.error('  URL:', player.src);
    console.error('  错误代码:', mediaError ? mediaError.code : 'unknown');
    console.error('  错误信息:', mediaError ? mediaError.message : '');
    let errType = '未知';
    if (mediaError) {
      const errMap = { 1: 'MEDIA_ERR_ABORTED', 2: 'MEDIA_ERR_NETWORK', 3: 'MEDIA_ERR_DECODE', 4: 'MEDIA_ERR_SRC_NOT_SUPPORTED' };
      errType = errMap[mediaError.code] || '未知';
      console.error('  错误类型:', errType);
    }
    if (fallbackUrl && player.src !== fallbackUrl) {
      console.log('[视频-模态] 主地址加载失败，回退到备选地址:', fallbackUrl);
      currentUrl = fallbackUrl;
      fallbackUrl = '';
      player.src = currentUrl;
      player.load();
      player.play().catch(() => {});
    } else {
      console.error('[视频-模态] 主地址和备选地址都播放失败');
      const errMsg = '资源异常或网络链接错误！请检查服务器状态';
      document.getElementById('video-title').textContent = '⚠️ 播放失败';
      alert(errMsg);
    }
  };
  player.src = currentUrl;
  player.load();
  player.play().catch(() => {});

  // 模态框播放器：视频元数据加载完成后更新左侧目录时长，并写入数据库
  player.onloadedmetadata = async function() {
    if (player.duration && lessonEl) {
      const realDuration = formatDuration(player.duration);
      const durationSpan = lessonEl.querySelector('.lesson-duration');
      if (durationSpan && durationSpan.textContent !== realDuration) {
        console.log('[时长修正-模态] lessonId=' + lessonId + ' 原时长=' + durationSpan.textContent + ' 真实时长=' + realDuration);
        durationSpan.textContent = realDuration;
        // 写入数据库持久化存储
        try {
          const r = await api.updateLesson({ lessonId, data: { duration: realDuration } });
          if (r && r.success) {
            console.log('[时长修正-模态] 已写入数据库 lessonId=' + lessonId);
          } else {
            console.warn('[时长修正-模态] 写入数据库失败 lessonId=' + lessonId, r && r.error);
          }
        } catch (e) {
          console.warn('[时长修正-模态] 写入数据库异常 lessonId=' + lessonId, e.message);
        }
      }
    }
  };

  player.ontimeupdate = () => {
    if (player.duration) {
      const pct = (player.currentTime / player.duration) * 100;
      document.getElementById('video-progress-slider').value = pct;
      document.getElementById('video-progress-text').textContent = Math.round(pct) + '%';
    }
  };
  player.onended = () => {
    api.updateProgress({ courseId, lessonId, progress: 100, completed: true, lastPosition: player.duration || 0 });
  };
  player.onpause = () => {
    if (player.currentTime > 0 && player.duration) {
      const pct = (player.currentTime / player.duration) * 100;
      api.updateProgress({ courseId, lessonId, progress: pct, completed: pct >= 95, lastPosition: player.currentTime });
    }
  };
}

async function loadStats() {
  const stats = await api.getCourseStats();
  const container = document.getElementById('stats-content');
  container.innerHTML = `
    <div class="stat-card"><div class="stat-value">${stats.totalCourses || 0}</div><div class="stat-label">总课程数</div></div>
    <div class="stat-card"><div class="stat-value">${stats.totalLessons || 0}</div><div class="stat-label">总课时数</div></div>
    <div class="stat-card"><div class="stat-value">${stats.completedCourses || 0}</div><div class="stat-label">已完成课程</div></div>
    <div class="stat-card"><div class="stat-value">${stats.completedLessons || 0}</div><div class="stat-label">已完成课时</div></div>`;
}

async function loadSources() {
  const sources = await api.getAllSources();
  const container = document.getElementById('sources-list');
  if (!sources || !sources.length) {
    container.innerHTML = '<p style="text-align:center;color:#94a3b8;padding:40px;">暂无课程源，请添加 CloudDrive2 / 115 源</p>';
    return;
  }
  container.innerHTML = sources.map((s) => `
    <div class="source-card">
      <div class="source-info">
        <h3>${escapeHtml(s.name || '未命名源')}</h3>
        <p>类型: ${s.type === '115' ? '115 网盘' : 'CloudDrive2'} | 地址: ${escapeHtml((s.config && s.config.endpoint) || '-')} | 根路径: ${escapeHtml((s.config && s.config.rootPath) || '/')}</p>
        <p>自动同步: ${s.autoSync !== false ? '✅ 开启' : '❌ 关闭'}</p>
      </div>
      <span class="source-status ${s.enabled !== false ? 'enabled' : 'disabled'}">${s.enabled !== false ? '已启用' : '已禁用'}</span>
      <div class="source-actions">
        <button class="btn btn-sm" style="background:#334155;color:#fff;" onclick="openScanFromSource('${s.id}')">☁️ 扫描导入</button>
        <button class="btn btn-primary btn-sm" onclick="syncSource('${s.id}')">🔄 同步</button>
        <button class="btn btn-secondary btn-sm" onclick="editSource('${s.id}')">✏️</button>
        <button class="btn btn-danger btn-sm" onclick="deleteSource('${s.id}')">🗑️</button>
      </div>
    </div>`).join('');
}

async function openScanFromSource(sourceId) {
  // 直接打开扫描向导，并预填对应源
  await showScanWizard();
  const sel = document.getElementById('w-src-sel');
  if (sel) { sel.value = sourceId; sel.dispatchEvent(new Event('change')); }
}

// ============================================================
//  ⚡ 只输入 Token 的快速添加向导（最简流程）
//  步骤：1. 填 Token（默认 115网盘 + 默认端口）
//       2. 浏览云盘选文件夹（可以双击目录进入）
//       3. 点「选这个」或「选择当前文件夹作为课程」
//       4. 文件夹名自动成课程名 → 填详情保存
// ============================================================
let _quickConn = null;

async function showQuickTokenWizard() {
  _quickConn = null;
  const modal = document.getElementById('modal-container');
  modal.innerHTML = `
    <h2>⚡ 输入 Token 快速添加课程</h2>
    <div class="scan-step-tip">
      🎯 <strong>4 步完成课程添加：</strong>① 填入 API Token → ② 连接后浏览云盘并进入想要添加的课程文件夹 → ③ 点击「✅ 选择当前文件夹作为课程」或「选这个」 → ④ 完善详情后保存。文件夹名称将自动作为课程名！
    </div>
    <div class="form-group">
      <label>① 云盘类型</label>
      <select id="q-type">
        <option value="115" selected>115 网盘（通过 CloudDrive2 连接）</option>
        <option value="cd2">CloudDrive2 通用</option>
      </select>
    </div>
    <div class="form-group">
      <label>② Endpoint（CloudDrive2 本地服务地址）</label>
      <input id="q-endpoint" value="127.0.0.1:19799" placeholder="127.0.0.1:19799 或 127.0.0.1:19798">
      <div style="font-size:12px;color:#94a3b8;margin-top:4px;">💡 115 常用端口 19799；CloudDrive2 标准版常用 19798</div>
    </div>
    <div class="form-group">
      <label>③ API Token *</label>
      <input id="q-token" placeholder="粘贴 CloudDrive2 API Token，如 b2d284cd-xxxx-xxxx...">
    </div>
    <div id="q-browser-box"></div>
    <div class="form-actions">
      <button class="btn btn-secondary" onclick="closeModal()">取消</button>
      <button class="btn btn-primary" id="q-connect-btn">🔗 连接并进入根目录</button>
    </div>`;
  document.getElementById('modal-overlay').classList.remove('hidden');

  document.getElementById('q-connect-btn').addEventListener('click', async () => {
    const token = document.getElementById('q-token').value.trim();
    if (!token) { alert('请输入 API Token'); return; }
    const type = document.getElementById('q-type').value;
    const endpoint = document.getElementById('q-endpoint').value.trim() || '127.0.0.1:19799';
    _quickConn = { type, endpoint, token };
    await _quickRenderListDir('/');
  });
}

async function _quickRenderListDir(path) {
  if (!_quickConn) return;
  const box = document.getElementById('q-browser-box');
  if (!box) return;
  box.innerHTML = `<p style="text-align:center;padding:20px;color:#64748b;">⏳ 正在读取目录：${escapeHtml(path)}</p>`;
  const btn = document.getElementById('q-connect-btn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ 读取中...'; }
  try {
    const r = await api.listCloudDirectory({ ..._quickConn, path });
    if (r && typeof r === 'object' && r.success === false) throw new Error(r.error || '读取失败');
    const items = Array.isArray(r) ? r : [];
    let crumbs;
    if (path && path !== '/') {
      const parts = path.split('/').filter(Boolean);
      const trails = parts.map((p, i) => {
        const pPath = '/' + parts.slice(0, i + 1).join('/');
        return `<a style="cursor:pointer;color:var(--primary);" data-nav="${escapeAttr(pPath)}">${escapeHtml(p)}</a>`;
      });
      trails.unshift('<a style="cursor:pointer;color:var(--primary);" data-nav="/">🏠 根目录</a>');
      crumbs = trails.join(' <span style="color:#94a3b8;">/</span> ');
    } else {
      crumbs = '<span style="color:#64748b;">🏠 根目录</span>';
    }

    const dirs = items.filter(i => i.isDir);
    const files = items.filter(i => !i.isDir);
    box.innerHTML = `
      <div style="margin-top:12px;padding:12px;border:1px solid var(--border);border-radius:8px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;gap:8px;flex-wrap:wrap;">
          <div style="font-size:13px;color:#475569;">📁 当前位置：${crumbs}</div>
          <button class="btn btn-sm" style="background:#0ea5e9;color:#fff;" id="q-use-this-folder">✅ 选择当前文件夹作为课程</button>
        </div>
        <div style="max-height:50vh;overflow-y:auto;border-top:1px solid var(--border);padding-top:8px;">
          ${dirs.length === 0 && files.length === 0 ? '<p style="color:#94a3b8;text-align:center;padding:30px;">（空文件夹）</p>' : ''}
          ${dirs.map(d => `
            <div class="q-dir-item" data-path="${escapeAttr(d.fullPath)}">
              📂 <span class="q-dir-name">${escapeHtml(d.name)}</span>
              <span style="font-size:12px;color:#94a3b8;margin-left:6px;">（双击进入浏览，或直接点右侧「选这个」）</span>
              <button class="btn btn-sm btn-primary" data-pick="${escapeAttr(d.fullPath)}">选这个</button>
            </div>
          `).join('')}
          ${files.length > 0 ? `
            <div style="font-size:12px;color:#94a3b8;margin:14px 4px 6px;padding-left:4px;border-left:3px solid var(--primary);">当前文件夹下的文件（导入时自动识别视频为章节/课时）：</div>
            ${files.slice(0, 40).map(f => `
              <div class="q-file-item">
                🎬 <span>${escapeHtml(f.name)}</span>
                <span style="margin-left:auto;font-size:11px;color:#94a3b8;">${_fmtSize(f.size)}</span>
              </div>`).join('')}
            ${files.length > 40 ? `<div style="font-size:11px;color:#94a3b8;text-align:center;padding:4px;">... 还有 ${files.length - 40} 个文件</div>` : ''}
          ` : ''}
        </div>
      </div>`;

    box.querySelectorAll('a[data-nav]').forEach(a => a.addEventListener('click', () => _quickRenderListDir(a.dataset.nav)));
    box.querySelectorAll('div.q-dir-item').forEach(row => {
      row.addEventListener('dblclick', () => _quickRenderListDir(row.dataset.path));
    });
    box.querySelectorAll('button[data-pick]').forEach(b => {
      b.addEventListener('click', () => _quickPickFolder(b.dataset.pick));
    });
    const useBtn = document.getElementById('q-use-this-folder');
    if (useBtn) useBtn.addEventListener('click', () => _quickPickFolder(path));
  } catch (e) {
    box.innerHTML = `<div style="padding:14px;background:#fef2f2;border:1px solid #fecaca;border-radius:6px;color:#991b1b;">❌ 连接/读取失败：${escapeHtml(e.message || String(e))}<br><span style="font-size:12px;">请确认：① CloudDrive2 正在运行 ② Token 正确 ③ 端口号：115 挂载一般是 19799，CD2 标准端口是 19798</span></div>`;
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🔗 重新连接'; }
  }
}

async function _quickPickFolder(folderPath) {
  if (!_quickConn) return;
  const folderName = folderPath.split('/').filter(Boolean).pop() || '未命名课程';
  if (!confirm(`📌 确认选择「${folderName}」？\n\n路径：${folderPath}\n\n✅ 文件夹名会作为课程名，子文件夹=章节，视频=课时。是否继续？`)) return;

  const modal = document.getElementById('modal-container');
  modal.innerHTML = `
    <h2>📂 扫描中：${escapeHtml(folderName)}</h2>
    <div class="scan-step-tip">正在扫描文件夹中的视频和子文件夹，构建章节结构，请稍候...</div>
    <div id="q-scan-status" style="text-align:center;padding:40px;color:#64748b;">⏳ 扫描中，请稍候...</div>`;

  try {
    const draft = await api.quickScanOneCourse({ ..._quickConn, folderPath });
    if (!draft) throw new Error('未扫描到结果');
    showDraftEditModalOneShot(draft, folderPath);
  } catch (e) {
    modal.innerHTML = `
      <h2>❌ 扫描失败</h2>
      <div class="scan-step-tip">${escapeHtml(e.message || String(e))}</div>
      <div class="form-actions">
        <button class="btn btn-secondary" onclick="showQuickTokenWizard()">← 返回浏览</button>
        <button class="btn btn-primary" onclick="closeModal()">关闭</button>
      </div>`;
  }
}

async function showDraftEditModalOneShot(draft, folderPath) {
  draft = JSON.parse(JSON.stringify(draft || {}));
  const categories = await api.getCategories();
  const modal = document.getElementById('modal-container');
  const chCount = (draft.chapters || []).length;
  const lsCount = (draft.chapters || []).reduce((s, c) => s + ((c.lessons && c.lessons.length) || 0), 0);

  modal.innerHTML = `
    <h2>编辑课程详情并保存</h2>
    <div class="scan-step-tip">✅ 已扫描：<strong>${chCount} 章 / ${lsCount} 集</strong>。文件夹名已自动填入"课程名称"，完善下面信息后保存。</div>
    <div class="form-group"><label>📂 文件夹（来源路径）</label><input value="${escapeAttr(folderPath || '')}" disabled style="background:#f1f5f9;"></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
      <div class="form-group"><label>课程名称 *</label><input id="e-title" value="${escapeAttr(draft.title || '')}"></div>
      <div class="form-group"><label>分类</label><select id="e-category">${categories.map(c => `<option value="${c.id}" ${draft.categoryId == c.id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}</select></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
      <div class="form-group"><label>讲师</label><input id="e-instructor" value="${escapeAttr(draft.instructor || '')}"></div>
      <div class="form-group"><label>难度</label><select id="e-level"><option value="初级" ${draft.level === '初级' ? 'selected' : ''}>初级</option><option value="中级" ${draft.level === '中级' ? 'selected' : ''}>中级</option><option value="高级" ${draft.level === '高级' ? 'selected' : ''}>高级</option></select></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
      <div class="form-group"><label>评分</label><input id="e-rating" type="number" step="0.1" min="0" max="10" value="${draft.rating || 4.5}"></div>
      <div class="form-group"><label>封面配色</label><input id="e-cover" value="${escapeAttr(draft.coverColor || '')}"></div>
    </div>
    <div class="form-group"><label>副标题</label><input id="e-subtitle" value="${escapeAttr(draft.subtitle || '')}"></div>
    <div class="form-group"><label>简介</label><textarea id="e-description" rows="4">${escapeHtml(draft.description || '')}</textarea></div>
    <div class="form-group">
      <label>章节与课时（${chCount}章 / ${lsCount}集，点击展开查看）</label>
      <div style="max-height:200px;overflow-y:auto;border:1px solid var(--border);border-radius:6px;padding:4px;">
        ${(draft.chapters || []).map((ch, ci) => `
          <details style="padding:4px 6px;">
            <summary style="font-size:13px;cursor:pointer;padding:2px 0;">📂 第${ci+1}章：${escapeHtml(ch.title)}（${(ch.lessons||[]).length} 集）</summary>
            <ul style="padding-left:18px;margin:4px 0;">
              ${(ch.lessons || []).map(l => `<li style="font-size:12px;color:#475569;padding:2px 0;">🎬 ${escapeHtml(l.title || '未命名视频')} <span style="color:#94a3b8;">(${l.duration || '--'})</span></li>`).join('')}
            </ul>
          </details>`).join('') || '<p style="color:#94a3b8;padding:10px;text-align:center;">（这个文件夹里没有扫描到视频文件）</p>'}
      </div>
    </div>
    <div class="form-actions">
      <button class="btn btn-secondary" onclick="showQuickTokenWizard()">← 重新选文件夹</button>
      <button class="btn btn-primary" id="e-save-btn">💾 保存为课程</button>
    </div>`;

  document.getElementById('e-save-btn').addEventListener('click', async () => {
    const title = document.getElementById('e-title').value.trim();
    if (!title) { alert('请填写课程名称'); return; }
    const data = {
      categoryId: parseInt(document.getElementById('e-category').value) || 1,
      title,
      subtitle: document.getElementById('e-subtitle').value.trim(),
      description: document.getElementById('e-description').value.trim(),
      instructor: document.getElementById('e-instructor').value.trim(),
      level: document.getElementById('e-level').value,
      rating: parseFloat(document.getElementById('e-rating').value) || 4.5,
      coverColor: document.getElementById('e-cover').value.trim(),
      chapters: draft.chapters || [],
      sourceKey: 'quick::' + (draft.sourceType || '115') + '::' + (folderPath || '') + '::' + Date.now(),
    };
    const btn = document.getElementById('e-save-btn');
    btn.disabled = true; btn.textContent = '💾 保存中...';
    try {
      const r = await api.addCourseWithChapters(data);
      if (r && r.success === false) throw new Error(r.error || '保存失败');
      alert('✅ 课程添加成功：' + title);
      closeModal();
      loadCourses();
    } catch (e) {
      alert('保存失败：' + (e.message || e));
      btn.disabled = false; btn.textContent = '💾 保存为课程';
    }
  });
}

function _fmtSize(n) {
  n = Number(n) || 0;
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
  return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}

function setupEventListeners() {
  // 添加分类
  const addCatBtn = document.getElementById('btn-add-category');
  if (addCatBtn) addCatBtn.addEventListener('click', () => showCategoryModal());

  // 添加学员
  const addStudentBtn = document.getElementById('btn-add-student');
  if (addStudentBtn) addStudentBtn.addEventListener('click', () => showStudentModal());

  document.getElementById('btn-search').addEventListener('click', async () => {
    const keyword = document.getElementById('search-keyword').value.trim();
    const level = document.getElementById('filter-level').value;
    const results = await api.searchCourses({ keyword: keyword || undefined, categoryId: currentCategoryId || undefined, level: level || undefined });
    renderCourseList(results || []);
  });

  document.getElementById('search-keyword').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('btn-search').click();
  });

  document.getElementById('btn-close-video').addEventListener('click', () => {
    const player = document.getElementById('video-player');
    player.pause();
    document.getElementById('video-overlay').classList.add('hidden');
  });

  document.getElementById('btn-add-course').addEventListener('click', () => {
    showCourseModal();
  });
  const mgmtAddBtn = document.getElementById('btn-mgmt-add-course');
  if (mgmtAddBtn) mgmtAddBtn.addEventListener('click', () => {
    showCourseModal();
  });

  api.onSourcesSynced(() => {
    loadCourses();
  });
}

async function showCourseModal(courseId) {
  const categories = await api.getCategories();
  let detail = null;
  if (courseId) detail = await api.getCourseDetail(courseId);
  let scannedChapters = null;

  const modal = document.getElementById('modal-container');
  modal.innerHTML = `
    <h2>${courseId ? '编辑课程' : '添加课程'}</h2>
    <div style="background:linear-gradient(135deg,#f8fafc 0%, #eef2ff 100%);border:1px solid #e0e7ff;border-radius:10px;padding:10px 14px;margin-bottom:12px;display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;">
      <div style="display:flex;align-items:center;gap:10px;">
        <span style="font-size:16px;">✍️</span>
        <div style="line-height:1.45;">
          <div style="font-size:13px;font-weight:700;color:#1e1b4b;">手动创建课程</div>
          <div style="font-size:11px;color:#64748b;">开启后，将隐藏下方"云盘连接信息 + 章节扫描"相关字段（无需扫描，直接手动录入课程名称/简介等）</div>
        </div>
      </div>
      <label class="f-switch-row" for="f-manual-create" style="margin:0;">
        <span style="font-size:12px;color:${detail && detail._manual ? '#10b981' : '#64748b'};font-weight:500;" id="f-manual-label">${detail && detail._manual ? '已开启 · 手动模式' : '自动模式（默认）'}</span>
        <span class="f-switch" style="margin-left:8px;">
          <input id="f-manual-create" type="checkbox">
          <span class="f-slider"></span>
        </span>
      </label>
    </div>
    <div class="form-group"><label>课程名称 *</label><input id="f-title" placeholder="例如：Python 编程入门" value="${escapeAttr(detail ? detail.title : '')}"></div>
    <div class="form-group"><label>课程分类</label><select id="f-category">${categories.map((c) => `<option value="${c.id}" ${detail && String(detail.categoryId || detail.category_id) === String(c.id) ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}</select></div>
    <div id="cloud-conn-fields" style="${detail && detail._manual ? 'display:none;' : ''}">
      <div class="form-group"><label>服务器域名（持久化保存）</label><input id="f-domain" value="${escapeAttr(detail ? detail.domain || '' : SYNC_DOMAIN_DEFAULT)}" placeholder="yide2099.de5.net"><div style="font-size:12px;color:#64748b;margin-top:4px;">保存后会写入课程配置。临时扫描/同步会优先使用左侧「同步模式开关」（当前：<strong style="color:${useLocalSync ? '#0891b2' : '#7c3aed'};">${useLocalSync ? 'IP → 127.0.0.1' : '域名 → yide2099.de5.net'}</strong>）。</div></div>
      <div class="form-group"><label>服务器端口</label><input id="f-port" value="${escapeAttr(detail ? detail.port || '' : '')}" placeholder="例如 19798"></div>
      <div class="form-group"><label>课程令牌（token）</label><input id="f-token" value="${escapeAttr(detail ? detail.token || '' : '')}" placeholder="API 访问令牌"></div>
      <div class="form-group"><label>云盘课程根路径（章节所在目录）</label>
        <input id="f-sourcePath" value="${escapeAttr(detail ? detail.sourcePath || '' : '/')}" placeholder="如 /操作系统 或 /第01章 所在的父目录">
        <div style="font-size:12px;color:#64748b;margin-top:4px;">目录结构约定：<strong>一级文件夹=章</strong>｜<strong>二级文件夹=节</strong>｜<strong>再下层=视频/PDF资料</strong></div>
      </div>
      <div class="form-group">
        <label>章节扫描</label>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
          <button type="button" class="btn btn-primary" id="btn-scan-chapters" style="font-size:13px;">📡 扫描云盘章节（${useLocalSync ? 'IP模式' : '域名模式'}）</button>
          <span id="scan-status" style="font-size:13px;color:#64748b;"></span>
        </div>
        <div id="chapters-preview" style="margin-top:8px;max-height:300px;overflow-y:auto;border:1px solid var(--border);border-radius:6px;padding:8px;display:none;"></div>
      </div>
    </div>
    <div class="form-group"><label>老师姓名</label><input id="f-instructor" value="${escapeAttr(detail ? detail.instructor : '')}"></div>
    <div class="form-group"><label>课程简介</label><textarea id="f-description" rows="4">${escapeHtml(detail ? detail.description || '' : '')}</textarea></div>
    <div class="form-group"><label>课程图片</label>
      <div id="cover-preview-wrap" style="display:flex;gap:12px;align-items:flex-start;">
        <div id="cover-preview" style="width:160px;height:100px;border-radius:8px;border:1px solid var(--border);display:flex;align-items:center;justify-content:center;background:#f1f5f9;overflow:hidden;flex-shrink:0;">
          ${detail && detail.coverImage ? `<img src="${escapeAttr(detail.coverImage)}" style="width:100%;height:100%;object-fit:cover;">` : '<span style="color:#94a3b8;font-size:12px;">暂无图片</span>'}
        </div>
        <div style="flex:1;display:flex;flex-direction:column;gap:8px;">
          <div style="display:flex;gap:8px;">
            <button type="button" class="btn btn-secondary" id="btn-pick-cover">📷 选择本地图片</button>
            <button type="button" class="btn btn-secondary" id="btn-clear-cover" style="${detail && detail.coverImage ? '' : 'display:none;'}">❌ 清除</button>
          </div>
          <input id="f-coverImage" value="${escapeAttr(detail ? detail.coverImage || '' : '')}" placeholder="或粘贴图片 URL（https://...）" style="width:100%;">
          <div style="font-size:12px;color:#94a3b8;">支持 jpg / png / gif / webp；不选则使用默认颜色渐变</div>
        </div>
      </div>
    </div>
    <div class="form-group" style="display:none;"><label>封面颜色（备选）</label><input id="f-coverColor" value="${escapeAttr(detail ? detail.coverColor || '' : 'linear-gradient(135deg, #667eea, #764ba2)')}"></div>
    <div class="form-group" style="display:none;"><label>副标题</label><input id="f-subtitle" value="${escapeAttr(detail ? detail.subtitle : '')}"></div>
    <div class="form-group" style="display:none;"><label>难度</label><select id="f-level"><option value="初级" ${detail && detail.level === '初级' ? 'selected' : ''}>初级</option><option value="中级" ${detail && detail.level === '中级' ? 'selected' : ''}>中级</option><option value="高级" ${detail && detail.level === '高级' ? 'selected' : ''}>高级</option></select></div>
    <div class="form-group" style="display:none;"><label>评分</label><input id="f-rating" type="number" step="0.1" min="0" max="10" value="${detail ? detail.rating || 4.5 : '4.5'}"></div>
    <div class="form-actions">
      <button class="btn btn-secondary" onclick="closeModal()">取消</button>
      <button class="btn btn-primary" id="btn-save-course">保存</button>
    </div>`;

  document.getElementById('modal-overlay').classList.remove('hidden');

  // ===== 手动创建课程开关 =====
  const manualSw = document.getElementById('f-manual-create');
  const manualLabel = document.getElementById('f-manual-label');
  const cloudFields = document.getElementById('cloud-conn-fields');
  if (manualSw && manualLabel && cloudFields) {
    // 编辑课程时，若未填写任何云盘连接信息（domain/port/token都空），则默认进入"手动模式"
    let defaultManual = !!(detail && detail._manual);
    if (!defaultManual && courseId) {
      const noConn = !(detail && (String(detail.domain || '').trim() || String(detail.token || '').trim()));
      if (noConn) defaultManual = true;
    }
    if (defaultManual) manualSw.checked = true;

    function applyManualState() {
      const on = !!manualSw.checked;
      if (cloudFields) cloudFields.style.display = on ? 'none' : '';
      if (manualLabel) {
        manualLabel.textContent = on ? '已开启 · 手动模式' : '自动模式（默认）';
        manualLabel.style.color = on ? '#10b981' : '#64748b';
      }
    }
    manualSw.addEventListener('change', applyManualState);
    applyManualState();
  }

  // ===== 封面图片：本地选择 / 粘贴 URL / 清除 =====
  function updateCoverPreview(url) {
    const prev = document.getElementById('cover-preview');
    const clearBtn = document.getElementById('btn-clear-cover');
    if (!prev) return;
    if (url) {
      prev.innerHTML = `<img src="${escapeAttr(url)}" style="width:100%;height:100%;object-fit:cover;">`;
      if (clearBtn) clearBtn.style.display = '';
    } else {
      prev.innerHTML = '<span style="color:#94a3b8;font-size:12px;">暂无图片</span>';
      if (clearBtn) clearBtn.style.display = 'none';
    }
  }
  document.getElementById('btn-pick-cover').addEventListener('click', async () => {
    const r = await api.pickCoverImage();
    if (r && r.success && r.fileUrl) {
      document.getElementById('f-coverImage').value = r.fileUrl;
      updateCoverPreview(r.fileUrl);
    } else if (r && r.error) {
      alert('选择图片失败：' + r.error);
    }
  });
  document.getElementById('btn-clear-cover').addEventListener('click', () => {
    document.getElementById('f-coverImage').value = '';
    updateCoverPreview('');
  });
  document.getElementById('f-coverImage').addEventListener('input', (e) => {
    updateCoverPreview((e.target.value || '').trim());
  });

  const scanBtn = document.getElementById('btn-scan-chapters');
  if (scanBtn) scanBtn.addEventListener('click', async () => {
    const savedDomain = (document.getElementById('f-domain').value || '').trim();
    const savedPort = (document.getElementById('f-port').value || '').trim();
    const token = (document.getElementById('f-token').value || '').trim();
    const sourcePath = (document.getElementById('f-sourcePath').value || '').trim() || '/';

    // 扫描章节时使用当前同步模式覆盖连接地址：
    //   开关开（IP模式）→ 127.0.0.1；开关关（域名模式）→ yide2099.de5.net
    const scanDomain = useLocalSync ? SYNC_DOMAIN_LOCAL : (savedDomain || SYNC_DOMAIN_DEFAULT);
    const scanPort = savedPort;

    if (!token) { alert('请填写课程令牌（token）'); return; }

    const btn = document.getElementById('btn-scan-chapters');
    const statusEl = document.getElementById('scan-status');
    const previewEl = document.getElementById('chapters-preview');
    btn.disabled = true;
    const originalBtnText = btn.textContent;
    btn.textContent = '⏳ 扫描中...';
    const scanModeText = useLocalSync ? 'IP模式(127.0.0.1)' : '域名模式(' + SYNC_DOMAIN_DEFAULT + ')';
    statusEl.textContent = `【${scanModeText}】正在连接云盘（${scanDomain}）并扫描目录，请稍候...`;

    try {
      // 构建 endpoint（用 scanDomain，临时覆盖）
      let endpoint = scanDomain;
      if (!/^https?:\/\//i.test(endpoint)) {
        endpoint = 'http://' + endpoint + (scanPort ? (':' + scanPort) : '');
      }
      const rawEndpoint = endpoint.replace(/^https?:\/\//i, '');

      const draft = await api.quickScanOneCourse({
        type: 'cd2',
        endpoint: rawEndpoint,
        token,
        folderPath: sourcePath
      });
      if (!draft || !draft.chapters) throw new Error('未扫描到章节结构');

      scannedChapters = draft.chapters;
      const chCount = scannedChapters.length;
      const lsCount = scannedChapters.reduce((s, c) => s + ((c.lessons && c.lessons.length) || 0), 0);
      const pdfCount = scannedChapters.reduce((s, c) => s + ((c.pdfs && c.pdfs.length) || 0), 0);

      statusEl.textContent = `✅ 已扫描 ${chCount} 章 / ${lsCount} 集 / ${pdfCount} 份资料`;
      previewEl.style.display = 'block';

      // ----- 按目录路径分配 PDF（与详情页渲染逻辑一致）-----
      function _pN(p) { return String(p || '').replace(/\\/g, '/').replace(/\/+$/, ''); }
      function _pP(p) { var n = _pN(p); var i = n.lastIndexOf('/'); return i > 0 ? n.substring(0, i) : ''; }

      previewEl.innerHTML = scannedChapters.map(function(ch, ci) {
        var lessons = ch.lessons || [];
        var allPdfs = ch.pdfs || [];
        var pdfUsed = {};

        // ---- 1. 按 sectionTitle 分节分组 ----
        var sectionMap = {}, sectionOrder = [];
        lessons.forEach(function(l) {
          var secKey = l.sectionTitle || '';
          if (!sectionMap.hasOwnProperty(secKey)) { sectionMap[secKey] = []; sectionOrder.push(secKey); }
          sectionMap[secKey].push(l);
        });

        var sectionHtml = sectionOrder.map(function(secTitle) {
          var secLessons = sectionMap[secTitle];
          var secDirs = [];
          secLessons.forEach(function(l) { var d = _pP(l.path || ''); if (d && secDirs.indexOf(d) === -1) secDirs.push(d); });

          var lessonHtml = secLessons.map(function(l) {
            return `<li style="font-size:12px;color:#475569;padding:2px 0;">🎬 ${escapeHtml(l.title || '未命名视频')} <span style="color:#94a3b8;">(${l.duration || '--'})</span></li>`;
          }).join('');

          // ---- 节级 PDF（按目录匹配）----
          var secPdfs = [];
          if (secDirs.length > 0) {
            allPdfs.forEach(function(pdf, pi) {
              if (pdfUsed[pi]) return;
              var pdfFull = _pN(pdf.path || pdf.name || '');
              var pdfParent = _pP(pdfFull);
              var pdfGrand = pdfParent ? _pP(pdfParent) : '';
              for (var di = 0; di < secDirs.length; di++) {
                var sd = secDirs[di];
                if (!sd) continue;
                if (pdfParent === sd || pdfGrand === sd || (pdfParent && pdfParent.indexOf(sd + '/') === 0) || (pdfFull.indexOf(sd + '/') === 0)) {
                  secPdfs.push(pdf); pdfUsed[pi] = true; break;
                }
              }
            });
          }
          var secPdfHtml = '';
          if (secPdfs.length > 0) {
            secPdfHtml = '<div style="margin-top:6px;"><div style="font-size:11px;color:#64748b;margin-bottom:2px;">📎 资料（' + secPdfs.length + '）</div>' +
              secPdfs.map(function(p) { return '<div style="font-size:11px;color:#64748b;padding:1px 0 1px 8px;">📄 ' + escapeHtml(p.name || '未命名') + '</div>'; }).join('') +
              '</div>';
          }

          var headerHtml = '';
          if (secTitle) {
            headerHtml = `<summary style="font-size:12px;cursor:pointer;padding:2px 0;color:#334155;">📖 ${escapeHtml(secTitle)}<span style="color:#94a3b8;margin-left:6px;">（${secLessons.length} 项）</span></summary>`;
          }
          // 有节标题用 <details> 可折叠；否则直接显示内容（保持缩进）
          return (secTitle ? '<details style="padding:2px 0 4px 4px;" open>' : '') +
            headerHtml +
            '<div style="padding:4px 0 4px 18px;border-left:1px dashed #cbd5e1;margin-left:12px;">' +
            '<ul style="padding-left:0;margin:0;list-style:none;">' + lessonHtml + '</ul>' +
            secPdfHtml +
            '</div>' +
            (secTitle ? '</details>' : '');
        }).join('');

        // ---- 2. 章级 PDF（剩下未匹配节的零散 PDF 放在章末）----
        var leftoverPdfs = allPdfs.filter(function(_, i) { return !pdfUsed[i]; });
        var chapterPdfHtml = '';
        if (leftoverPdfs.length > 0) {
          chapterPdfHtml = '<div style="margin-top:6px;padding-top:4px;border-top:1px dashed #e2e8f0;"><div style="font-size:11px;color:#64748b;margin-bottom:2px;">📎 章节资料（' + leftoverPdfs.length + '）</div>' +
            leftoverPdfs.map(function(p) { return '<div style="font-size:11px;color:#64748b;padding:1px 0 1px 8px;">📄 ' + escapeHtml(p.name || '未命名') + '</div>'; }).join('') +
            '</div>';
        }

        var chParts = [];
        if (lessons.length) chParts.push(lessons.length + ' 集');
        if (allPdfs.length) chParts.push(allPdfs.length + ' 份资料');

        return `<details style="padding:4px 6px;margin-bottom:4px;background:#f8fafc;border:1px solid var(--border);border-radius:6px;" ${ci === 0 ? 'open' : ''}>
          <summary style="font-size:13px;cursor:pointer;padding:2px 0;font-weight:600;color:#0f172a;">📂 第${ci+1}章：${escapeHtml(ch.title)}<span style="color:#94a3b8;margin-left:8px;font-weight:400;">（${chParts.join(' · ')}）</span></summary>
          <div style="padding:6px 2px 2px 8px;">${sectionHtml}${chapterPdfHtml}</div>
        </details>`;
      }).join('');
    } catch (e) {
      statusEl.textContent = `❌ ${e.message || '扫描失败'}`;
      alert('扫描失败：' + (e.message || '未知错误'));
      scannedChapters = null;
    } finally {
      btn.disabled = false;
      btn.textContent = originalBtnText;
    }
  });

  document.getElementById('btn-save-course').addEventListener('click', async () => {
    const isManual = !!(document.getElementById('f-manual-create') || {}).checked;
    const gv = (id, def = '') => {
      const el = document.getElementById(id);
      return el ? (el.value || '').trim() : def;
    };
    const data = {
      courseId: courseId || undefined,
      categoryId: parseInt(document.getElementById('f-category').value) || 1,
      title: gv('f-title'),
      subtitle: gv('f-subtitle'),
      domain: isManual ? '' : (gv('f-domain') || SYNC_DOMAIN_DEFAULT),
      port: isManual ? '' : gv('f-port'),
      token: isManual ? '' : gv('f-token'),
      sourcePath: isManual ? '' : (gv('f-sourcePath') || '/'),
      instructor: gv('f-instructor'),
      coverImage: gv('f-coverImage'),
      coverColor: gv('f-coverColor'),
      level: (document.getElementById('f-level') || {}).value || '初级',
      rating: parseFloat((document.getElementById('f-rating') || {}).value) || 0,
      description: gv('f-description'),
      _manual: isManual ? true : (detail && detail._manual ? true : false),
    };
    if (!data.title) { alert('请输入课程名称'); return; }
    // 如果已扫描章节，一并保存到数据库（手动模式通常不会扫描，但以防万一仍支持）
    if (scannedChapters) {
      data.chapters = scannedChapters;
    }
    const saveBtn = document.getElementById('btn-save-course');
    const fn = courseId ? api.updateCourse : api.addCourse;
    saveBtn.disabled = true;
    if (scannedChapters) {
      saveBtn.textContent = '保存中（含章节数据）…';
    } else {
      saveBtn.textContent = courseId ? '保存中…' : '保存中…';
    }
    let r;
    try {
      r = await fn(data);
    } catch (e) {
      r = { success: false, error: e.message || String(e) };
    }
    if (r && r.success) {
      const newCourseId = courseId || (r && r.courseId);
      // 如果还没扫描章节，且填写了连接信息（token 必须非空），且不是手动模式，则自动同步
      if (!scannedChapters && !isManual) {
        const hasConn = Boolean((data.domain && String(data.domain).trim()) && (data.token && String(data.token).trim()));
        if (hasConn) {
          try {
            saveBtn.textContent = '同步章节中…';
            const sr = await api.rebuildCourseChapters(getSyncOptions({
              courseId: newCourseId,
              domain: data.domain,
              port: data.port,
              token: data.token,
              sourcePath: data.sourcePath || '/',
            }));
            if (!sr || !sr.success) {
              alert(`保存成功！但同步章节失败：${(sr && sr.error) || '未知错误'}\n您可以稍后在详情页或课程管理中点击「同步章节」按钮重试`);
            }
          } catch (syncErr) {
            alert(`保存成功！但同步章节异常：${syncErr.message || syncErr}\n您可以稍后在详情页或课程管理中点击「同步章节」按钮重试`);
          }
        }
      }
      closeModal();
      // 同步完成后跳转到详情页（新增/编辑都跳到详情，让用户立刻看到同步好的章节）
      if (newCourseId) {
        viewCourseDetail(newCourseId);
        if (currentPage === 'course-mgmt') loadCourseMgmt();
      } else {
        if (currentPage === 'course-mgmt') loadCourseMgmt();
        else loadCourses();
      }
    } else {
      saveBtn.disabled = false;
      saveBtn.textContent = '保存';
      alert('保存失败: ' + ((r && r.error) || '未知错误'));
    }
  });
}

function showSourceModal(sourceId) {
  const modal = document.getElementById('modal-container');
  modal.innerHTML = `
    <h2>${sourceId ? '编辑源' : '添加源'}</h2>
    <div class="form-group"><label>源名称</label><input id="f-src-name" placeholder="例如：我的 115 或 CloudDrive2"></div>
    <div class="form-group"><label>类型</label><select id="f-src-type"><option value="cd2">CloudDrive2</option><option value="115">115 网盘</option></select></div>
    <div class="form-group"><label>Endpoint</label><input id="f-src-endpoint" value="127.0.0.1:19798" placeholder="127.0.0.1:19798"></div>
    <div class="form-group"><label>Token</label><input id="f-src-token" placeholder="CD2/115 API Token"></div>
    <div class="form-group"><label>根路径（课程总目录，其下每个子文件夹会被识别为一门课程）</label><input id="f-src-root" value="/" placeholder="/ 例如：/我的课程"></div>
    <div class="form-group"><label>自动同步</label><select id="f-src-autosync"><option value="1">开启</option><option value="0">关闭</option></select></div>
    <div class="form-actions">
      <button class="btn btn-secondary" onclick="closeModal()">取消</button>
      <button class="btn btn-primary" id="btn-save-source">保存</button>
    </div>`;

  document.getElementById('modal-overlay').classList.remove('hidden');

  if (sourceId) {
    api.getAllSources().then((sources) => {
      const s = (sources || []).find((x) => String(x.id) === String(sourceId));
      if (s) {
        document.getElementById('f-src-name').value = s.name || '';
        document.getElementById('f-src-endpoint').value = (s.config && s.config.endpoint) || '127.0.0.1:19798';
        document.getElementById('f-src-token').value = (s.config && s.config.token) || '';
        document.getElementById('f-src-root').value = (s.config && s.config.rootPath) || '/';
        document.getElementById('f-src-autosync').value = s.autoSync !== false ? '1' : '0';
      }
    });
  }

  document.getElementById('btn-save-source').addEventListener('click', async () => {
    const source = {
      id: sourceId || undefined,
      name: document.getElementById('f-src-name').value.trim(),
      type: document.getElementById('f-src-type').value,
      enabled: true,
      autoSync: document.getElementById('f-src-autosync').value === '1',
      config: {
        endpoint: document.getElementById('f-src-endpoint').value.trim(),
        token: document.getElementById('f-src-token').value.trim(),
        rootPath: document.getElementById('f-src-root').value.trim() || '/',
        defaultCategoryId: 1,
        defaultLevel: '初级',
        defaultInstructor: '系统导入',
        defaultRating: 4.6,
        defaultCoverColor: 'linear-gradient(135deg, #667eea, #764ba2)',
      },
    };
    if (!source.name) { alert('请输入源名称'); return; }
    const r = await api.saveSource(source);
    if (r && r.success) {
      closeModal();
      loadSources();
    } else {
      alert('保存失败: ' + ((r && r.error) || '未知错误'));
    }
  });
}

async function syncSource(sourceId) {
  const btn = event.target;
  btn.textContent = '⏳';
  btn.disabled = true;
  try {
    const r = await api.syncSource(sourceId);
    if (r && r.success) {
      alert('同步成功！');
      loadCourses();
    } else {
      alert('同步失败: ' + ((r && r.error) || (r && r.reason) || '未知错误'));
    }
  } catch (e) {
    alert('同步异常: ' + e.message);
  }
  btn.textContent = '🔄 同步';
  btn.disabled = false;
  loadSources();
}

async function editSource(sourceId) {
  showSourceModal(sourceId);
}

async function deleteSource(sourceId) {
  if (!confirm('确定要删除该课程源吗？')) return;
  const r = await api.deleteSource(sourceId);
  if (r && r.success) {
    loadSources();
  } else {
    alert('删除失败: ' + ((r && r.error) || '未知错误'));
  }
}

// ============================================================
//  章节管理
// ============================================================
let currentChapterMgmtCourseId = null;

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

async function openChapterMgmt(courseId) {
  try {
    currentChapterMgmtCourseId = courseId;
    const detail = await api.getCourseDetail(courseId);
    if (!detail) { alert('课程不存在'); return; }

    const chapters = detail.chapters || [];
    let totalLessons = 0;
    let totalPdfs = 0;
    chapters.forEach(ch => {
      totalLessons += (ch.lessons || []).length;
      totalPdfs += (ch.pdfs || []).length;
    });

    const chaptersHtml = chapters.map((ch, chIdx) => {
      const lessons = ch.lessons || [];
      const pdfs = ch.pdfs || [];
      const lessonRows = lessons.map((l, lIdx) => {
        const isFree = l.free || l.isFree;
        const videoUrl = escapeHtml(l.videoUrl || l.video_url || l.path || '');
        const safeTitle = escapeHtml(l.title || '未命名课时');
        return `
        <tr data-chapter-lesson="${chIdx}-${lIdx}">
          <td style="width:50px;color:#94a3b8;">${String(lIdx + 1).padStart(2, '0')}</td>
          <td>
            <strong>${safeTitle}</strong>
            ${isFree ? `<span style="margin-left:8px;padding:1px 8px;border-radius:10px;background:#fef3c7;color:#b45309;font-size:11px;">免费</span>` : ''}
          </td>
          <td style="max-width:480px;">
            ${videoUrl ? `<code style="display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:11px;color:#475569;background:#f8fafc;border:1px solid #e2e8f0;border-radius:4px;padding:4px 8px;" title="${videoUrl}">${videoUrl}</code>` : '<span style="color:#94a3b8;">--</span>'}
          </td>
        </tr>`;
      }).join('');

      const pdfRows = pdfs.map((p, pIdx) => {
        const pname = escapeHtml(p.name || p.path || '未命名 PDF');
        const purl = escapeHtml(p.url || p.path || '');
        return `
        <tr data-chapter-pdf="${chIdx}-${pIdx}" style="background:#fafbff;">
          <td style="width:50px;color:#94a3b8;">${String(pIdx + 1).padStart(2, '0')}</td>
          <td>📄 <strong>${pname}</strong> <span style="color:#94a3b8;font-size:11px;">（资料）</span></td>
          <td style="max-width:480px;">
            ${purl ? `<code style="display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:11px;color:#475569;background:#f8fafc;border:1px solid #e2e8f0;border-radius:4px;padding:4px 8px;" title="${purl}">${purl}</code>` : '<span style="color:#94a3b8;">--</span>'}
          </td>
        </tr>`;
      }).join('');

      const totalDur = _formatDuration(lessons.reduce((s, l) => s + (Number(l.duration) || 0), 0));

      return `
      <div class="chapter-mgmt-block" style="margin-bottom:20px;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;background:#fff;">
        <div class="chapter-mgmt-header" style="padding:12px 18px;background:linear-gradient(135deg,#eef2ff 0%,#ede9fe 100%);display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #e5e7eb;gap:12px;">
          <div style="display:flex;align-items:center;gap:12px;">
            <span style="width:28px;height:28px;border-radius:7px;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;">${chIdx + 1}</span>
            <div>
              <div style="font-size:15px;font-weight:700;color:#1e1b4b;">${escapeHtml(ch.title || `第${chIdx + 1}章`)}</div>
              <div style="font-size:12px;color:#64748b;margin-top:2px;">
                🎬 ${lessons.length} 个课时 · 📄 ${pdfs.length} 份资料 · ⏱ ${totalDur}
              </div>
            </div>
          </div>
        </div>
        <div style="overflow-x:auto;">
          <table style="width:100%;border-collapse:collapse;font-size:13px;">
            <thead>
              <tr style="background:#f8fafc;border-bottom:1px solid #e5e7eb;">
                <th style="padding:10px 16px;text-align:left;font-weight:600;color:#475569;">#</th>
                <th style="padding:10px 16px;text-align:left;font-weight:600;color:#475569;">名称</th>
                <th style="padding:10px 16px;text-align:left;font-weight:600;color:#475569;">链接/路径</th>
              </tr>
            </thead>
            <tbody>
              ${lessonRows || `<tr><td colspan="3" style="padding:20px;text-align:center;color:#94a3b8;">该章节暂无课时</td></tr>`}
              ${pdfRows}
            </tbody>
          </table>
        </div>
      </div>`;
    }).join('');

    const html = `
    <div style="padding:20px;flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;">
      <div style="margin-bottom:12px;">
        <div style="font-size:14px;font-weight:700;color:#1e293b;margin-bottom:8px;">📋 章节与课时详情</div>
      </div>

      ${chaptersHtml || `<div class="empty-state"><p style="text-align:center;color:#94a3b8;padding:60px 20px;">该课程暂无章节</p></div>`}
    </div>`;

    const container = document.getElementById('course-management');
    if (!container) return;

    // 把返回按钮 + 标题 + 统计胶囊放到顶部 page-header 中
    const pageHeader = document.querySelector('#page-course-mgmt > .page-header');
    if (pageHeader) {
      let backBtn = pageHeader.querySelector('#chapters-mgmt-back');
      if (!backBtn) {
        backBtn = document.createElement('button');
        backBtn.id = 'chapters-mgmt-back';
        backBtn.style.cssText = [
          'width:44px', 'height:44px', 'border-radius:12px',
          'border:1px solid #e5e7eb', 'background:#fff',
          'cursor:pointer', 'flexShrink:0',
          'margin-right:16px', 'padding:0',
          'display:flex', 'align-items:center', 'justify-content:center',
          'box-shadow:0 1px 2px rgba(15,23,42,0.04)',
          'transition:all .18s ease',
          'position:relative', 'overflow:hidden',
        ].join(';');
        backBtn.innerHTML = `
          <svg viewBox="0 0 2226 1024" width="40" height="18" version="1.1" xmlns="http://www.w3.org/2000/svg" style="transition:transform .18s ease;">
            <path d="M533.165042 940.740738 106.819864 509.291308 529.743106 81.325214c17.913998-18.096147 17.913998-47.487547 0-65.588811-17.881253-18.128893-46.928822-18.128893-64.782446 0L19.86135 466.12723c-8.459672 8.552793-12.93766 19.654642-13.402241 30.878265-8.116865 17.483186-5.036713 38.972617 9.233292 53.431933l451.634144 456.979896c18.162662 18.412348 47.675836 18.412348 65.837474 0C551.389102 989.007021 551.389102 959.152063 533.165042 940.740738L533.165042 940.740738z" fill="#1296db"/>
            <path d="M1044.210297 764.544807l186.599885 2.238994 244.072855-5.223978c-5.476735 16.420995-12.443403 36.071543-20.900006 58.96495l-240.33881-0.74599-183.613878-2.238994c-85.089957-0.997724-144.556327-29.855982-178.388876-86.581937-20.403702 18.905582-50.259684 52.247968-89.566922 100.016925l-30.602995-61.950957c44.037982-42.544979 75.882248-73.018014 95.538937-91.434455L827.010487 426.427042l-88.821955 0 0-55.232952 146.294924 0 0 319.457776C914.581961 738.922243 967.828676 763.547083 1044.210297 764.544807zM824.771493 120.404254c25.37697 30.852682 60.207243 77.875648 104.494912 141.068899l-52.993958 37.319977c-40.307008-63.192228-73.398684-111.958908-99.270934-146.293901L824.771493 120.404254zM1073.320289 445.833021l35.827997-38.812981c52.993958 39.558971 103.498212 77.998445 151.516856 115.318422 43.041282-45.774533 75.882248-97.153714 98.524944-154.131403l-300.05282 0c-0.50142 143.810337-35.58138 256.014838-105.240903 336.62476-10.952446-14.927991-24.1357-30.601972-39.558971-47.022966 58.71424-67.671239 88.073918-165.94445 88.073918-294.825772L1002.411309 158.470221c158.732188-1.988284 301.543777-12.688997 428.431699-32.094976l20.900006 58.21896c-128.380926 13.434987-259.250532 22.147416-392.605749 26.123984l0 105.241926 361.256764 0 0 52.993958c-24.1357 70.412676-61.828161 133.604904-113.079428 189.584869 51.746548 41.051975 99.887988 81.113389 144.428414 120.17094l-44.783972 48.514947c-47.76998-43.290969-95.538937-85.21173-143.308917-125.767402-58.21896 52.002374-129.873929 96.909144-214.96184 134.724401-10.9504-15.423271-23.387663-31.348985-37.321-47.76998 81.602529-35.325553 150.522202-77.123518 206.751854-125.393895C1169.851832 522.711969 1121.585549 483.654418 1073.320289 445.833021z" fill="#1296db"/>
            <path d="M1543.549953 151.006226l652.351562 0 0 683.6985-62.697971 0 0-47.768957-526.956643 0 0 47.768957-62.697971 0L1543.54893 151.006226zM2133.204567 206.239178l-526.956643 0 0 526.956643 526.956643 0L2133.204567 206.239178zM1710.742836 320.438103l317.218782 0 0 326.175781-58.21896 0 0-41.798988-200.781886 0 0 41.798988-58.21896 0L1710.741813 320.438103zM1969.742658 372.686071l-200.781886 0L1768.960773 552.567951l200.781886 0L1969.742658 372.686071z" fill="#1296db"/>
          </svg>`;
        backBtn.addEventListener('mouseenter', () => {
          backBtn.style.background = '#f0f9ff';
          backBtn.style.borderColor = '#bae6fd';
          backBtn.style.boxShadow = '0 4px 12px rgba(18,150,219,0.15)';
          backBtn.style.transform = 'translateY(-1px)';
          const svg = backBtn.querySelector('svg');
          if (svg) { svg.style.transform = 'translateX(-1px)'; }
        });
        backBtn.addEventListener('mouseleave', () => {
          backBtn.style.background = '#fff';
          backBtn.style.borderColor = '#e5e7eb';
          backBtn.style.boxShadow = '0 1px 2px rgba(15,23,42,0.04)';
          backBtn.style.transform = '';
          const svg = backBtn.querySelector('svg');
          if (svg) { svg.style.transform = ''; }
        });
        const h2 = pageHeader.querySelector('h2');
        if (h2) pageHeader.insertBefore(backBtn, h2);
        else pageHeader.insertBefore(backBtn, pageHeader.firstChild);
      }
      const titleH2 = pageHeader.querySelector('h2');
      if (titleH2) titleH2.style.display = 'none';
      const addBtnWrap = pageHeader.querySelector('.header-actions');
      if (addBtnWrap) addBtnWrap.style.display = 'none';

      // 插入标题+统计行（占据中间空间，左右两端对齐）
      let statsBar = pageHeader.querySelector('#chapters-mgmt-stats');
      if (!statsBar) {
        statsBar = document.createElement('div');
        statsBar.id = 'chapters-mgmt-stats';
        statsBar.style.cssText = 'flex:1;min-width:0;display:flex;align-items:center;justify-content:space-between;gap:24px;flex-wrap:wrap;';
        statsBar.innerHTML = `
          <div style="min-width:0;flex:1;">
            <h2 style="margin:0;font-size:22px;color:#0f172a;line-height:1.2;">${escapeHtml(detail.title)}</h2>
            ${detail.subtitle ? `<p style="margin:4px 0 0 0;color:#64748b;font-size:13px;">${escapeHtml(detail.subtitle)}</p>` : ''}
          </div>
          <div style="display:flex;gap:12px;flex-wrap:wrap;">
            <div style="background:#eef2ff;padding:6px 14px;border-radius:16px;font-size:12px;color:#4338ca;font-weight:600;">📚 ${chapters.length} 章</div>
            <div style="background:#fef3c7;padding:6px 14px;border-radius:16px;font-size:12px;color:#b45309;font-weight:600;">🎬 ${totalLessons} 个课时</div>
            <div style="background:#ecfdf5;padding:6px 14px;border-radius:16px;font-size:12px;color:#047857;font-weight:600;">📄 ${totalPdfs} 份资料</div>
            <div style="background:#f0f9ff;padding:6px 14px;border-radius:16px;font-size:12px;color:#0369a1;font-weight:600;">👨‍🏫 ${escapeHtml(detail.instructor || '--')}</div>
          </div>
        `;
        // 插入到返回按钮后面
        pageHeader.insertBefore(statsBar, backBtn.nextSibling);
      }
    }
    container.innerHTML = html;

    const backBtn = document.getElementById('chapters-mgmt-back');
    if (backBtn) backBtn.addEventListener('click', () => {
      // 恢复标题和添加课程按钮，清理统计行
      const pageHeader = document.querySelector('#page-course-mgmt > .page-header');
      if (pageHeader) {
        const b = pageHeader.querySelector('#chapters-mgmt-back');
        if (b) b.remove();
        const s = pageHeader.querySelector('#chapters-mgmt-stats');
        if (s) s.remove();
        const h2 = pageHeader.querySelector('h2');
        if (h2) { h2.style.display = ''; h2.textContent = '课程管理'; }
        const addBtnWrap = pageHeader.querySelector('.header-actions');
        if (addBtnWrap) addBtnWrap.style.display = '';
      }
      loadCourseMgmt();
    });

  } catch (e) {
    console.error('[chapters-mgmt]', e);
    alert('加载章节失败: ' + (e.message || '未知错误'));
  }
}

// ============================================================
//  课程管理（表格表单形式）
// ============================================================
async function loadCourseMgmt() {
  const [categories, courses] = await Promise.all([
    _getCachedCategories(true),
    api.getCourses() || [],
  ]);

  const container = document.getElementById('course-management');
  if (!container) return;

  const catOpts = categories.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
  container.innerHTML = `
    <div class="mgmt-section-title">
      <div class="ccmgmt-toolbar-left">
        <span style="font-weight:600;color:#0f172a;font-size:14px;">📋 课程列表</span>
        <span class="ccmgmt-toolbar" style="color:#64748b;background:#f1f5f9;">共 ${courses.length} 门课程</span>
      </div>
      <div class="ccmgmt-toolbar" style="margin-left:auto;">
        <input id="mgmt-course-search" placeholder="搜索课程名、讲师...">
        <select id="mgmt-course-filter"><option value="">全部分类</option>${catOpts}</select>
        <select id="mgmt-course-level"><option value="">全部难度</option><option value="初级">初级</option><option value="中级">中级</option><option value="高级">高级</option></select>
      </div>
    </div>
    <div class="mgmt-scroll-body">
      <table class="course-cat-table" id="mgmt-course-table" style="width:100%;">
        <thead style="position:sticky;top:0;z-index:1;"><tr>
          <th style="width:60px;">封面</th>
          <th>课程名称</th>
          <th style="width:100px;">讲师</th>
          <th style="width:90px;">分类</th>
          <th style="width:70px;">难度</th>
          <th style="width:100px;">章/集</th>
          <th style="width:270px;">操作</th>
        </tr></thead>
        <tbody id="mgmt-course-body">
          ${(courses || []).map(c => {
            const cid = String(c.categoryId || c.category_id || '');
            const catName = (categories.find(ct => String(ct.id) === cid) || {}).name || '未分类';
            const hasCover = !!(c.coverImage && String(c.coverImage).trim());
            const coverStyle = hasCover ? '' : `background:${c.coverColor || 'linear-gradient(135deg, #667eea, #764ba2)'};`;
            const coverInner = hasCover
              ? `<img src="${escapeAttr(c.coverImage)}" style="width:100%;height:100%;object-fit:cover;border-radius:4px;">`
              : `<span style="color:#fff;font-size:14px;">📖</span>`;
            return `
            <tr data-mgmt-course-row="${c.id}">
              <td style="display:flex;align-items:center;justify-content:center;padding-left:12px;padding-right:12px;"><div style="width:48px;height:48px;border-radius:4px;display:flex;align-items:center;justify-content:center;overflow:hidden;${coverStyle}">${coverInner}</div></td>
              <td><strong class="mgmt-course-title-link" data-mgmt-view="${c.id}" style="cursor:pointer;color:#4f46e5;">${escapeHtml(c.title)}</strong><br><span style="font-size:11px;color:#94a3b8;">${escapeHtml(c.subtitle || c.description || '').slice(0, 40)}${c.description && c.description.length > 40 ? '...' : ''}</span></td>
              <td>${escapeHtml(c.instructor || '--')}</td>
              <td style="padding-left:14px;padding-right:14px;"><select class="cat-select" data-mgmt-cat="${c.id}" style="width:100%;height:30px;min-height:30px;padding:2px 8px;">
                ${categories.map(ct => `<option value="${ct.id}" ${cid === String(ct.id) ? 'selected' : ''}>${escapeHtml(ct.name)}</option>`).join('')}
              </select></td>
              <td><span class="level-badge level-${c.level || '初级'}">${c.level || '初级'}</span></td>
              <td style="font-size:12px;color:#64748b;">${c.chapterCount || 0}章 / ${c.lessonCount || 0}集</td>
              <td>
                <button class="btn btn-sm" data-mgmt-chapters="${c.id}" style="background:#8b5cf6;color:#fff;border:none;white-space:nowrap;">📑 章节管理</button>
                <button class="btn btn-sm btn-primary" data-mgmt-edit="${c.id}" style="white-space:nowrap;">✏️ 编辑</button>
                <button class="btn btn-sm btn-danger" data-mgmt-del="${c.id}">🗑️</button>
                <span class="mgmt-status-mgmt-${c.id}" style="font-size:11px;"></span>
              </td>
            </tr>`;
          }).join('') || `<tr><td colspan="7" style="text-align:center;padding:30px;color:#94a3b8;">还没有课程，点击右上角「+ 添加课程」</td></tr>`}
        </tbody>
      </table>
    </div>`;

  // 绑定搜索和筛选
  const applyFilter = () => {
    const kw = (document.getElementById('mgmt-course-search').value || '').trim().toLowerCase();
    const cat = document.getElementById('mgmt-course-filter').value;
    const lvl = document.getElementById('mgmt-course-level').value;
    (courses || []).forEach(c => {
      const row = document.querySelector(`tr[data-mgmt-course-row="${c.id}"]`);
      if (!row) return;
      const okKw = !kw || (String(c.title || '').toLowerCase().includes(kw) || String(c.instructor || '').toLowerCase().includes(kw));
      const cCat = String(c.categoryId || c.category_id || '');
      const okCat = !cat || cCat === String(cat);
      const okLvl = !lvl || (c.level || '初级') === lvl;
      row.style.display = (okKw && okCat && okLvl) ? '' : 'none';
    });
  };
  document.getElementById('mgmt-course-search').addEventListener('input', applyFilter);
  document.getElementById('mgmt-course-filter').addEventListener('change', applyFilter);
  document.getElementById('mgmt-course-level').addEventListener('change', applyFilter);

  // 绑定分类下拉修改
  container.querySelectorAll('select[data-mgmt-cat]').forEach(sel => {
    sel.addEventListener('change', async () => {
      const cid = parseInt(sel.dataset.mgmtCat);
      const status = container.querySelector(`.mgmt-status-mgmt-${cid}`);
      status.textContent = '⏳';
      status.style.color = '#64748b';
      const ok = await _updateCourseCategory(cid, parseInt(sel.value));
      if (ok) {
        status.textContent = '✓';
        status.style.color = '#059669';
        setTimeout(()=>{ status.textContent = ''; }, 1500);
        loadCategories();
        loadCourses();
      } else {
        status.textContent = '❌';
        status.style.color = '#dc2626';
      }
    });
  });

  // 同步章节（从 CloudDrive2 拉取章→节→视频结构）
  container.querySelectorAll('button[data-mgmt-sync]').forEach(b => {
    b.addEventListener('click', async () => {
      const cid = parseInt(b.dataset.mgmtSync);
      const course = (courses || []).find(x => x.id === cid);
      if (!course) return;
      const mgmtSyncDomain = course.domain || '';
      const mgmtSyncPort = course.port || '';
      const mgmtSyncHost = mgmtSyncDomain + (mgmtSyncPort ? ':' + mgmtSyncPort : '');
      const mgmtMode = useLocalSync ? 'IP' : '域名';
      const mgmtDomain = useLocalSync ? SYNC_DOMAIN_LOCAL : SYNC_DOMAIN_DEFAULT;
      const mgmtLabel = `【${mgmtMode}模式】将从 ${mgmtDomain} 连接云盘，拉取最新章节\n※ 当前课程持久化配置：${mgmtSyncHost || '（未配置）'}`;
      if (!confirm(`${mgmtLabel}，当前已有章节会被覆盖，确定继续？`)) return;
      const status = container.querySelector(`.mgmt-status-mgmt-${cid}`);
      status.textContent = '⏳ 同步中';
      status.style.color = '#64748b';
      b.disabled = true;
      try {
        const r = await api.rebuildCourseChapters(getSyncOptions({ courseId: cid, sourcePath: course.sourcePath || '/' }));
        if (!r || !r.success) throw new Error((r && r.error) || '同步失败');
        status.textContent = `✓ ${r.chapters}章${r.lessons}集`;
        status.style.color = '#059669';
        setTimeout(() => loadCourseMgmt(), 900);
      } catch (e) {
        status.textContent = '❌';
        status.style.color = '#dc2626';
        alert('同步章节失败：' + (e.message || e));
      } finally {
        b.disabled = false;
      }
    });
  });

  // 查看详情
  container.querySelectorAll('[data-mgmt-view]').forEach(b => {
    b.addEventListener('click', () => viewCourseDetail(parseInt(b.dataset.mgmtView)));
  });

  // 章节管理
  container.querySelectorAll('button[data-mgmt-chapters]').forEach(b => {
    b.addEventListener('click', () => openChapterMgmt(parseInt(b.dataset.mgmtChapters)));
  });

  // 编辑
  container.querySelectorAll('button[data-mgmt-edit]').forEach(b => {
    b.addEventListener('click', () => showCourseModal(parseInt(b.dataset.mgmtEdit)));
  });

  // 删除
  container.querySelectorAll('button[data-mgmt-del]').forEach(b => {
    b.addEventListener('click', async () => {
      const cid = parseInt(b.dataset.mgmtDel);
      const course = (courses || []).find(x => x.id === cid);
      if (!course) return;
      if (!confirm(`确定要删除课程「${course.title}」吗？此操作不可撤销。`)) return;
      const r = await api.deleteCourse(cid);
      if (r && r.success) {
        loadCourseMgmt();
        loadCourses();
      } else {
        alert('删除失败: ' + ((r && r.error) || '未知错误'));
      }
    });
  });

  // 全选
  const checkAll = document.getElementById('mgmt-check-all-mgmt');
  if (checkAll) checkAll.addEventListener('change', (e) => {
    const on = e.target.checked;
    container.querySelectorAll('input.mgmt-check-mgmt').forEach(cb => {
      const row = cb.closest('tr');
      if (row && row.style.display !== 'none') cb.checked = on;
    });
  });

  // 批量改分类
  const batchApply = document.getElementById('mgmt-batch-apply-mgmt');
  if (batchApply) batchApply.addEventListener('click', async () => {
    const toCat = parseInt(document.getElementById('mgmt-batch-cat-mgmt').value);
    if (!toCat) { alert('请先选择要批量移动到的分类'); return; }
    const ids = Array.from(container.querySelectorAll('input.mgmt-check-mgmt:checked')).map(cb => parseInt(cb.dataset.checkMgmt));
    if (!ids.length) { alert('请先勾选要调整的课程'); return; }
    if (!confirm(`确定要把选中的 ${ids.length} 门课程统一移动到「${document.getElementById('mgmt-batch-cat-mgmt').selectedOptions[0].text}」吗？`)) return;
    let okCount = 0;
    for (const id of ids) {
      const sel = container.querySelector(`select[data-mgmt-cat="${id}"]`);
      if (sel) sel.value = String(toCat);
      const ok = await _updateCourseCategory(id, toCat);
      const status = container.querySelector(`.mgmt-status-mgmt-${id}`);
      if (ok) { okCount++; if (status) { status.textContent = '✓'; status.style.color = '#059669'; } }
      else if (status) { status.textContent = '❌'; status.style.color = '#dc2626'; }
    }
    setTimeout(() => {
      container.querySelectorAll('[class^="mgmt-status-mgmt-"]').forEach(s => s.textContent = '');
    }, 2000);
    alert(`✅ 批量完成：${okCount}/${ids.length} 门课程移动成功`);
    loadCategories();
    loadCourses();
  });
}

// ============================================================
//  分类管理 + 课程分类调整（管理中心）
// ============================================================
async function loadCategoryMgmt() {
  const [categories, courses] = await Promise.all([
    _getCachedCategories(true),
    api.getCourses() || [],
  ]);

  const countMap = {};
  (courses || []).forEach(c => {
    const cid = String(c.categoryId || c.category_id || 0);
    countMap[cid] = (countMap[cid] || 0) + 1;
  });
  const catGrid = document.getElementById('category-management');
  let _selectedCatId = null; // 当前选中的分类ID（用于高亮）
  if (catGrid) {
    catGrid.innerHTML = `
      <div class="mgmt-section-title">📁 分类列表 <span class="ccmgmt-toolbar">共 ${categories.length} 个分类</span></div>
      <div class="category-grid">
        ${categories.map(c => `
          <div class="category-card" data-cat-card="${c.id}">
            <div class="cc-head">
              <div class="cc-name">${escapeHtml(c.name)}</div>
              <div class="cc-count">${countMap[String(c.id)] || 0} 门课</div>
            </div>
            <div style="font-size:12px;color:#94a3b8;">分类 ID: ${c.id}</div>
            <div class="cc-actions">
              <button class="btn btn-sm btn-secondary" data-cat-edit="${c.id}">✏️ 重命名</button>
              <button class="btn btn-sm btn-danger" data-cat-del="${c.id}">🗑️ 删除</button>
            </div>
          </div>`).join('') || '<p style="grid-column:1/-1;text-align:center;color:#94a3b8;padding:30px;">还没有分类</p>'}
      </div>`;
    catGrid.querySelectorAll('button[data-cat-edit]').forEach(b => {
      b.addEventListener('click', (e) => { e.stopPropagation(); showCategoryModal(parseInt(b.dataset.catEdit)); });
    });
    catGrid.querySelectorAll('button[data-cat-del]').forEach(b => {
      b.addEventListener('click', (e) => { e.stopPropagation();
        const id = parseInt(b.dataset.catDel);
        const cnt = countMap[String(id)] || 0;
        const msg = cnt > 0
          ? `该分类下还有 ${cnt} 门课程。删除后这些课程会变成"未分类"。确定删除吗？`
          : '确定删除该分类吗？';
        if (!confirm(msg)) return;
        api.deleteCategory(id).then(r => {
          if (r && r.success) { loadCategoryMgmt(); loadCategories(); loadCourses(); }
          else alert('删除失败: ' + ((r && r.error) || '未知错误'));
        });
      });
    });
    // 点击分类卡片 → 筛选下方课程表
    catGrid.querySelectorAll('.category-card').forEach(card => {
      card.addEventListener('click', () => {
        const catId = parseInt(card.dataset.catCard);
        // 如果再次点击同一个分类，则取消筛选（显示全部）
        if (_selectedCatId === catId) {
          _selectedCatId = null;
          document.getElementById('mgmt-cat-filter').value = '';
        } else {
          _selectedCatId = catId;
          document.getElementById('mgmt-cat-filter').value = catId;
        }
        // 高亮当前选中的卡片
        catGrid.querySelectorAll('.category-card').forEach(c => c.classList.toggle('cat-active', parseInt(c.dataset.catCard) === _selectedCatId));
        // 触发筛选
        const evt = new Event('change');
        document.getElementById('mgmt-cat-filter').dispatchEvent(evt);
      });
    });
  }

  const box = document.getElementById('course-category-mgmt');
  if (box) {
    const catOpts = categories.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
    box.innerHTML = `
      <div class="mgmt-section-title">
        🏫 课程分类调整（${courses.length} 门课程）
        <div class="ccmgmt-toolbar">
          <input id="mgmt-cat-search" placeholder="搜索课程名...">
          <select id="mgmt-cat-filter"><option value="">全部分类</option>${catOpts}</select>
          <select id="mgmt-batch-cat"><option value="">批量移动到 →</option>${catOpts}</select>
          <button class="btn btn-sm btn-primary" id="mgmt-batch-apply">应用</button>
        </div>
      </div>
      <div style="overflow:auto;">
        <table class="course-cat-table" id="mgmt-cat-table">
          <thead><tr>
            <th style="width:36px;"><input type="checkbox" id="mgmt-check-all"></th>
            <th style="width:60px;">ID</th>
            <th>课程名</th>
            <th style="width:110px;">章/集</th>
            <th style="width:180px;">分类</th>
            <th style="width:110px;">状态</th>
          </tr></thead>
          <tbody id="mgmt-cat-body">
            ${(courses || []).map(c => {
              const cid = String(c.categoryId || c.category_id || '');
              return `
              <tr data-course-row="${c.id}">
                <td><input type="checkbox" class="mgmt-check" data-check="${c.id}"></td>
                <td style="color:#94a3b8;">#${c.id}</td>
                <td><strong>${escapeHtml(c.title)}</strong><br><span style="font-size:11px;color:#94a3b8;">${escapeHtml(c.instructor || '--')} · ${c.level || '初级'}</span></td>
                <td style="font-size:12px;color:#64748b;">${c.chapterCount || 0}章 / ${c.lessonCount || 0}集</td>
                <td><select class="cat-select" data-table-cat="${c.id}" style="width:100%;">
                  ${categories.map(ct => `<option value="${ct.id}" ${cid === String(ct.id) ? 'selected' : ''}>${escapeHtml(ct.name)}</option>`).join('')}
                </select></td>
                <td><span class="mgmt-status-${c.id}"></span></td>
              </tr>`;
            }).join('') || `<tr><td colspan="6" style="text-align:center;padding:30px;color:#94a3b8;">还没有课程</td></tr>`}
          </tbody>
        </table>
      </div>`;

    const applyFilter = () => {
      const kw = (document.getElementById('mgmt-cat-search').value || '').trim().toLowerCase();
      const cat = document.getElementById('mgmt-cat-filter').value;
      (courses || []).forEach(c => {
        const row = document.querySelector(`tr[data-course-row="${c.id}"]`);
        if (!row) return;
        const okKw = !kw || String(c.title || '').toLowerCase().includes(kw);
        const cCat = String(c.categoryId || c.category_id || '');
        const okCat = !cat || cCat === String(cat);
        row.style.display = (okKw && okCat) ? '' : 'none';
      });
    };
    document.getElementById('mgmt-cat-search').addEventListener('input', applyFilter);
    document.getElementById('mgmt-cat-filter').addEventListener('change', () => {
      // 同步分类卡片高亮
      const catId = parseInt(document.getElementById('mgmt-cat-filter').value) || null;
      _selectedCatId = catId;
      if (catGrid) catGrid.querySelectorAll('.category-card').forEach(c => c.classList.toggle('cat-active', !!catId && parseInt(c.dataset.catCard) === catId));
      applyFilter();
    });

    box.querySelectorAll('select[data-table-cat]').forEach(sel => {
      sel.addEventListener('change', async () => {
        const cid = parseInt(sel.dataset.tableCat);
        const target = (courses || []).find(x => x.id === cid);
        const opt = sel.options[sel.selectedIndex];
        if (target && opt) { target.categoryId = parseInt(sel.value); target.category = opt.text; }
        const status = box.querySelector(`.mgmt-status-${cid}`);
        status.textContent = '⏳ 保存中...';
        status.style.color = '#64748b';
        const ok = await _updateCourseCategory(cid, parseInt(sel.value));
        if (ok) {
          status.textContent = '✓ 已保存';
          status.style.color = '#059669';
          setTimeout(()=>{ status.textContent = ''; }, 1800);
          loadCategories();
          loadCourses();
        } else {
          status.textContent = '❌ 失败';
          status.style.color = '#dc2626';
        }
      });
    });

    document.getElementById('mgmt-check-all').addEventListener('change', (e) => {
      const on = e.target.checked;
      box.querySelectorAll('input.mgmt-check').forEach(cb => {
        const row = cb.closest('tr');
        if (row && row.style.display !== 'none') cb.checked = on;
      });
    });
    document.getElementById('mgmt-batch-apply').addEventListener('click', async () => {
      const toCat = parseInt(document.getElementById('mgmt-batch-cat').value);
      if (!toCat) { alert('请先选择要批量移动到的分类'); return; }
      const ids = Array.from(box.querySelectorAll('input.mgmt-check:checked')).map(cb => parseInt(cb.dataset.check));
      if (!ids.length) { alert('请先勾选要调整分类的课程'); return; }
      if (!confirm(`确定要把选中的 ${ids.length} 门课程统一移动到「${document.getElementById('mgmt-batch-cat').selectedOptions[0].text}」吗？`)) return;
      let okCount = 0;
      for (const id of ids) {
        const sel = box.querySelector(`select[data-table-cat="${id}"]`);
        if (sel) sel.value = String(toCat);
        const ok = await _updateCourseCategory(id, toCat);
        const status = box.querySelector(`.mgmt-status-${id}`);
        if (ok) {
          okCount++;
          if (status) { status.textContent = '✓ 已移动'; status.style.color = '#059669'; }
          const t = (courses || []).find(x => x.id === id);
          if (t) t.categoryId = toCat;
        } else if (status) {
          status.textContent = '❌ 失败'; status.style.color = '#dc2626';
        }
      }
      setTimeout(() => {
        box.querySelectorAll('[class^="mgmt-status-"]').forEach(s => s.textContent = '');
      }, 2500);
      alert(`✅ 批量完成：${okCount}/${ids.length} 门课程移动成功`);
      loadCategories();
      loadCourses();
      applyFilter();
    });
  }
}

// ===== 学员管理 =====
async function loadStudentMgmt() {
  const container = document.getElementById('student-management');
  if (!container) return;
  // 先尝试获取学员数据（从课程学习进度统计）
  const courses = await api.getCourses() || [];
  const progressList = await Promise.all((courses || []).map(c => api.getCourseProgress(c.id).then(p => ({ courseId: c.id, courseTitle: c.title, progress: p || [] }))));
  // 统计所有有学习进度的"学员"（这里用 deviceId 或简单用 courseId 区分）
  const students = [];
  progressList.forEach(({ courseId, courseTitle, progress }) => {
    (progress || []).forEach(p => {
      const sid = String(p.deviceId || p.studentId || 'anonymous_' + courseId);
      let s = students.find(x => x.id === sid);
      if (!s) {
        s = { id: sid, name: p.studentName || '--', courseCount: 0, lessonCount: 0, lastActive: p.updatedAt || '' };
        students.push(s);
      }
      s.courseCount++;
      s.lessonCount++;
      if (p.updatedAt && p.updatedAt > s.lastActive) s.lastActive = p.updatedAt;
    });
  });

  if (students.length === 0) {
    container.innerHTML = '<p style="text-align:center;color:#94a3b8;padding:60px 20px;font-size:15px;">📋 暂无学员数据。当有学员开始学习课程后，将在这里显示。</p>';
    return;
  }

  container.innerHTML = `
    <div class="mgmt-section-title">👥 学员列表 <span style="font-size:13px;color:#64748b;">共 ${students.length} 人</span></div>
    <div style="overflow:auto;">
      <table class="course-cat-table">
        <thead><tr>
          <th style="width:60px;">#</th>
          <th>学员名称</th>
          <th style="width:120px;">学习课程数</th>
          <th style="width:120px;">学习课时数</th>
          <th style="width:180px;">最近活跃</th>
        </tr></thead>
        <tbody>
          ${students.map((s, i) => `
            <tr>
              <td style="color:#94a3b8;">${i + 1}</td>
              <td><strong>${escapeHtml(s.name)}</strong></td>
              <td>${s.courseCount}</td>
              <td>${s.lessonCount}</td>
              <td style="font-size:12px;color:#64748b;">${s.lastActive || '—'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>`;
}

function showStudentModal() {
  const modal = document.getElementById('modal-container');
  modal.innerHTML = `
    <h2>添加学员</h2>
    <div class="form-group"><label>学员名称 *</label><input id="f-student-name" placeholder="输入学员名称"></div>
    <div class="form-group"><label>备注</label><textarea id="f-student-note" rows="3" placeholder="可选备注信息"></textarea></div>
    <div class="form-actions">
      <button class="btn btn-secondary" onclick="closeModal()">取消</button>
      <button class="btn btn-primary" id="btn-save-student">保存</button>
    </div>`;
  document.getElementById('modal-overlay').classList.remove('hidden');
  document.getElementById('btn-save-student').addEventListener('click', async () => {
    const name = document.getElementById('f-student-name').value.trim();
    if (!name) { alert('请输入学员名称'); return; }
    alert('✅ 学员「' + name + '」添加成功（学员数据将在学习记录中自动生成）');
    closeModal();
    loadStudentMgmt();
  });
}

function showCategoryModal(categoryId) {
  const modal = document.getElementById('modal-container');
  const editing = !!categoryId;
  let currentName = '';
  if (editing) {
    const found = (_catCache || []).find(c => c.id === categoryId);
    if (found) currentName = found.name || '';
  }
  modal.innerHTML = `
    <h2>${editing ? '重命名分类' : '添加分类'}</h2>
    <div class="form-group">
      <label>分类名称</label>
      <input id="f-cat-name" placeholder="例如：前端开发、计算机基础..." value="${escapeAttr(currentName)}">
    </div>
    <div class="form-actions">
      <button class="btn btn-secondary" onclick="closeModal()">取消</button>
      <button class="btn btn-primary" id="btn-save-category">保存</button>
    </div>`;
  document.getElementById('modal-overlay').classList.remove('hidden');
  document.getElementById('btn-save-category').addEventListener('click', async () => {
    const name = document.getElementById('f-cat-name').value.trim();
    if (!name) { alert('请输入分类名称'); return; }
    const r = await api.addCategory({ id: editing ? categoryId : undefined, name });
    if (r && r.success) {
      closeModal();
      loadCategoryMgmt();
      loadCategories();
      loadCourses();
    } else {
      alert('保存失败: ' + ((r && r.error) || '未知错误'));
    }
  });
}

// ============================================================
//  云盘扫描导入向导
// ============================================================
let _scanDrafts = [];
const _importedIndices = new Set();

async function showScanWizard() {
  const sources = (await api.getAllSources()) || [];
  const modal = document.getElementById('modal-container');
  _scanDrafts = [];
  _importedIndices.clear();

  modal.innerHTML = `
    <h2>从云盘 / 115 扫描导入课程</h2>
    <div class="scan-step-tip">
      📌 使用说明：选择一个已配置的"课程源"，或手动填写 CloudDrive2/115 的连接参数。程序会遍历指定"根路径"下的子文件夹，将每个子文件夹识别为一门课程（文件夹名→课程名），扫描其中的视频文件作为章节/课时，编辑课程详情后即可保存。
    </div>
    <div class="form-group">
      <label>① 选择已保存的源（可选）</label>
      <select id="w-src-sel"><option value="">-- 手动填写连接参数 --</option>` +
      sources.map(s => `<option value="${s.id}" data-type="${s.type || 'cd2'}" data-endpoint="${escapeAttr((s.config && s.config.endpoint) || '')}" data-token="${escapeAttr((s.config && s.config.token) || '')}" data-root="${escapeAttr((s.config && s.config.rootPath) || '/')}">${escapeHtml(s.name || '未命名')} (${(s.type === '115' ? '115 网盘' : 'CloudDrive2')})</option>`).join('') +
      `</select>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
      <div class="form-group"><label>② 类型</label><select id="w-type"><option value="cd2">CloudDrive2</option><option value="115">115 网盘</option></select></div>
      <div class="form-group"><label>Endpoint</label><input id="w-endpoint" placeholder="127.0.0.1:19798"></div>
    </div>
    <div class="form-group"><label>Token</label><input id="w-token" placeholder="CD2 / 115 API Token"></div>
    <div class="form-group"><label>根路径（课程总目录，其下每个子文件夹会作为一门课程）</label><input id="w-root" value="/" placeholder="/例如：/我的课程"></div>
    <div id="w-drafts" style="max-height:45vh;overflow-y:auto;padding:4px 0;margin-bottom:12px;"></div>
    <div class="form-actions">
      <button class="btn btn-secondary" onclick="closeModal()">取消</button>
      <button class="btn btn-primary" id="w-scan-btn">🔍 开始扫描</button>
    </div>`;
  document.getElementById('modal-overlay').classList.remove('hidden');

  document.getElementById('w-src-sel').addEventListener('change', (e) => {
    const sel = e.target.options[e.target.selectedIndex];
    if (sel.value) {
      document.getElementById('w-type').value = sel.dataset.type || 'cd2';
      document.getElementById('w-endpoint').value = sel.dataset.endpoint || '';
      document.getElementById('w-token').value = sel.dataset.token || '';
      document.getElementById('w-root').value = sel.dataset.root || '/';
    }
  });

  document.getElementById('w-scan-btn').addEventListener('click', async () => {
    const btn = document.getElementById('w-scan-btn');
    const sourceId = document.getElementById('w-src-sel').value || undefined;
    const type = document.getElementById('w-type').value;
    const endpoint = document.getElementById('w-endpoint').value.trim();
    const token = document.getElementById('w-token').value.trim();
    const rootPath = document.getElementById('w-root').value.trim() || '/';
    btn.disabled = true;
    btn.textContent = '⏳ 扫描中...';
    try {
      const r = await api.scanCourseDrafts({
        sourceId,
        type,
        endpoint: sourceId ? undefined : endpoint,
        token: sourceId ? undefined : token,
        rootPath: sourceId ? undefined : rootPath,
      });
      if (r && typeof r === 'object' && r.success === false) {
        throw new Error(r.error || '扫描失败');
      }
      _scanDrafts = Array.isArray(r) ? r : (r && Array.isArray(r.data) ? r.data : []);
      if (!_scanDrafts.length) {
        alert('扫描完毕，但未发现任何课程文件夹。请检查"根路径"是否指向正确的课程总目录。');
      }
      renderScanDrafts();
    } catch (e) {
      alert('扫描失败：' + (e.message || e));
    } finally {
      btn.disabled = false;
      btn.textContent = '🔍 重新扫描';
    }
  });
}

function renderScanDrafts() {
  const box = document.getElementById('w-drafts');
  if (!box) return;
  if (!_scanDrafts.length) { box.innerHTML = ''; return; }
  box.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 4px 12px;">
      <strong>扫描结果：${_scanDrafts.length} 门课程待导入</strong>
      <div style="display:flex;gap:8px;">
        <button class="btn btn-sm btn-secondary" id="w-import-all">一键导入全部</button>
      </div>
    </div>` +
    _scanDrafts.map((d, idx) => {
      const chCount = (d.chapters || []).length;
      const lsCount = (d.chapters || []).reduce((s, c) => s + ((c.lessons && c.lessons.length) || 0), 0);
      const done = _importedIndices.has(idx);
      return `
      <div class="draft-item">
        <div class="draft-info">
          <div class="draft-title">
            📂 ${escapeHtml(d.folderName || d.title)}
            ${done ? '<span class="import-status" style="background:#d1fae5;color:#065f46;">已导入</span>' : '<span class="import-status">待导入</span>'}
          </div>
          <div class="draft-meta">路径：${escapeHtml(d.sourcePath || '/')} ｜ ${chCount} 章 ${lsCount} 集 ｜ 来源：${(d.sourceType || '').toUpperCase()}</div>
        </div>
        <div style="display:flex;gap:6px;">
          <button class="btn btn-sm btn-secondary" data-edit="${idx}" ${done ? '' : ''}>✏️ 编辑详情</button>
          <button class="btn btn-sm btn-primary" data-import="${idx}" ${done ? 'disabled' : ''}>导入</button>
        </div>
      </div>`;
    }).join('');

  box.querySelectorAll('button[data-edit]').forEach(b => {
    b.addEventListener('click', () => showDraftEditModal(parseInt(b.dataset.edit)));
  });
  box.querySelectorAll('button[data-import]').forEach(b => {
    b.addEventListener('click', async () => {
      await importSingleDraft(parseInt(b.dataset.import));
    });
  });
  const impAll = document.getElementById('w-import-all');
  if (impAll) impAll.addEventListener('click', async () => {
    for (let i = 0; i < _scanDrafts.length; i++) {
      if (_importedIndices.has(i)) continue;
      await importSingleDraft(i, true);
    }
    alert(`导入完成，共成功导入 ${_importedIndices.size} / ${_scanDrafts.length} 门课程`);
    closeModal();
    loadCourses();
  });
}

async function showDraftEditModal(idx) {
  const draft = JSON.parse(JSON.stringify(_scanDrafts[idx] || {}));
  const categories = await api.getCategories();
  const modal = document.getElementById('modal-container');
  const chCount = (draft.chapters || []).length;
  const lsCount = (draft.chapters || []).reduce((s, c) => s + ((c.lessons && c.lessons.length) || 0), 0);

  modal.innerHTML = `
    <h2>编辑课程详情并保存</h2>
    <div class="scan-step-tip">已扫描章节：${chCount} 章 ${lsCount} 集。文件夹名作为课程名已预填，补充完善以下信息后即可保存为课程。</div>
    <div class="form-group"><label>文件夹名（来源）</label><input value="${escapeAttr(draft.folderName || '')}" disabled style="background:#f1f5f9;"></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
      <div class="form-group"><label>课程名称 *</label><input id="e-title" value="${escapeAttr(draft.title || '')}"></div>
      <div class="form-group"><label>分类</label><select id="e-category">${categories.map(c => `<option value="${c.id}" ${draft.categoryId == c.id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}</select></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
      <div class="form-group"><label>讲师</label><input id="e-instructor" value="${escapeAttr(draft.instructor || '')}"></div>
      <div class="form-group"><label>难度</label><select id="e-level"><option value="初级" ${draft.level === '初级' ? 'selected' : ''}>初级</option><option value="中级" ${draft.level === '中级' ? 'selected' : ''}>中级</option><option value="高级" ${draft.level === '高级' ? 'selected' : ''}>高级</option></select></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
      <div class="form-group"><label>评分</label><input id="e-rating" type="number" step="0.1" min="0" max="10" value="${draft.rating || 4.5}"></div>
      <div class="form-group"><label>封面配色</label><input id="e-cover" value="${escapeAttr(draft.coverColor || '')}"></div>
    </div>
    <div class="form-group"><label>副标题</label><input id="e-subtitle" value="${escapeAttr(draft.subtitle || '')}"></div>
    <div class="form-group"><label>简介</label><textarea id="e-description" rows="4">${escapeHtml(draft.description || '')}</textarea></div>
    <div class="form-group">
      <label>章节与课时（${chCount}章 / ${lsCount}集，点章节可展开查看）</label>
      <div style="max-height:180px;overflow-y:auto;border:1px solid var(--border);border-radius:6px;padding:4px;">
        ${(draft.chapters || []).map((ch, ci) => `
          <details style="padding:4px 6px;">
            <summary style="font-size:13px;cursor:pointer;padding:2px 0;">📂 第${ci+1}章：${escapeHtml(ch.title)}（${(ch.lessons||[]).length} 集）</summary>
            <ul style="padding-left:18px;margin:4px 0;">
              ${(ch.lessons || []).map(l => `<li style="font-size:12px;color:#475569;padding:2px 0;">🎬 ${escapeHtml(l.title || '未命名视频')} <span style="color:#94a3b8;">(${l.duration || '--'})</span></li>`).join('')}
            </ul>
          </details>`).join('') || '<p style="color:#94a3b8;padding:10px;text-align:center;">（没有扫描到视频，导入将不包含章节内容）</p>'}
      </div>
    </div>
    <div class="form-actions">
      <button class="btn btn-secondary" onclick="showScanWizardAfterEdit()">← 返回列表</button>
      <button class="btn btn-primary" id="e-save-btn">💾 保存为课程</button>
    </div>`;

  document.getElementById('e-save-btn').addEventListener('click', async () => {
    const title = document.getElementById('e-title').value.trim();
    if (!title) { alert('请填写课程名称'); return; }
    const data = {
      categoryId: parseInt(document.getElementById('e-category').value) || 1,
      title,
      subtitle: document.getElementById('e-subtitle').value.trim(),
      description: document.getElementById('e-description').value.trim(),
      instructor: document.getElementById('e-instructor').value.trim(),
      level: document.getElementById('e-level').value,
      rating: parseFloat(document.getElementById('e-rating').value) || 4.5,
      coverColor: document.getElementById('e-cover').value.trim(),
      chapters: draft.chapters || [],
      sourceKey: 'scan::' + (draft.sourceType || 'cd2') + '::' + (draft.sourcePath || '') + '::' + Date.now(),
    };
    const btn = document.getElementById('e-save-btn');
    btn.disabled = true; btn.textContent = '💾 保存中...';
    try {
      const r = await api.addCourseWithChapters(data);
      if (r && r.success === false) throw new Error(r.error || '保存失败');
      _importedIndices.add(idx);
      alert('✅ 导入成功：' + title);
      closeModal();
      loadCourses();
    } catch (e) {
      alert('保存失败：' + (e.message || e));
      btn.disabled = false; btn.textContent = '💾 保存为课程';
    }
  });
}

function showScanWizardAfterEdit() {
  // 简单实现：重新渲染草稿列表
  renderScanDrafts();
  document.getElementById('modal-overlay').classList.remove('hidden');
}

async function importSingleDraft(idx, silent) {
  const d = _scanDrafts[idx];
  if (!d) return;
  try {
    const r = await api.addCourseWithChapters({
      categoryId: d.categoryId || 1,
      title: d.title,
      subtitle: d.subtitle || '',
      description: d.description || '',
      instructor: d.instructor || '系统导入',
      level: d.level || '初级',
      rating: Number(d.rating) || 4.5,
      duration: d.duration || '',
      coverColor: d.coverColor || 'linear-gradient(135deg, #667eea, #764ba2)',
      chapters: d.chapters || [],
      sourceKey: 'scan::' + (d.sourceType || 'cd2') + '::' + (d.sourcePath || '') + '::' + Date.now() + '::' + idx,
    });
    if (r && r.success === false) throw new Error(r.error || '保存失败');
    _importedIndices.add(idx);
    renderScanDrafts();
    if (!silent) {
      alert('✅ 导入成功：' + (d.title || '未命名'));
      loadCourses();
    }
  } catch (e) {
    if (!silent) alert('导入失败：' + (e.message || e));
    console.error('[import-single]', e);
  }
}

function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
}

function showToastModal({ type = 'success', title, message, onOk, compact = false, autoClose = 0 }) {
  const overlay = document.getElementById('modal-overlay');
  const modal = document.getElementById('modal-container');
  const iconClass = type === 'success' ? 'success' : 'error';
  const iconEmoji = type === 'success' ? '✓' : '✕';
  const compactClass = compact ? ' compact' : '';
  if (compact) {
    modal.classList.add('compact-toast');
    overlay.classList.add('toast-overlay');
  } else {
    modal.classList.remove('compact-toast');
    overlay.classList.remove('toast-overlay');
  }
  modal.innerHTML = `
    <div class="toast-modal${compactClass}">
      <div class="toast-icon ${iconClass}">${iconEmoji}</div>
      <h2 class="toast-title">${escapeHtml(title || (type === 'success' ? '操作成功' : '操作失败'))}</h2>
      ${message ? `<p class="toast-msg">${escapeHtml(message)}</p>` : ''}
      <div class="toast-actions">
        <button class="btn btn-primary" id="toast-ok-btn">确定</button>
      </div>
    </div>`;
  overlay.classList.remove('hidden');
  const okBtn = document.getElementById('toast-ok-btn');
  const handleOk = () => {
    closeModal();
    modal.classList.remove('compact-toast');
    overlay.classList.remove('toast-overlay');
    if (typeof onOk === 'function') onOk();
  };
  if (okBtn) okBtn.addEventListener('click', handleOk);
  if (autoClose > 0) {
    setTimeout(() => {
      closeModal();
      modal.classList.remove('compact-toast');
      overlay.classList.remove('toast-overlay');
      if (typeof onOk === 'function') onOk();
    }, autoClose);
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeAttr(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** 自然排序：文件名里的数字按数值比较（让 1,2,...,9,10,11 正确排序，而非字典序 1,10,2） */
function _naturalCmpStr(a, b) {
  var sa = String(a || ''), sb = String(b || '');
  var reA = /(\d+)|(\D+)/g; // A、B 各用一个独立正则，避免 JS 正则 g 标志的 lastIndex 共享导致的 bug
  var reB = /(\d+)|(\D+)/g;
  var ma, mb;
  while (true) {
    ma = reA.exec(sa);
    mb = reB.exec(sb);
    if (!ma && !mb) return 0;
    if (!ma) return -1;
    if (!mb) return 1;
    if (ma[1] && mb[1]) {
      var na = parseInt(ma[1], 10), nb = parseInt(mb[1], 10);
      if (na !== nb) return na - nb;
    } else {
      var ca = ma[0].toLowerCase(), cb = mb[0].toLowerCase();
      if (ca !== cb) return ca < cb ? -1 : 1;
    }
  }
}
/** 对 PDF / 课时对象数组，按 name / title / path 字段自然排序（原地修改并返回） */
function _sortByName(arr, getName) {
  if (!Array.isArray(arr) || arr.length < 2) return arr;
  return arr.sort(function(x, y) {
    var a = (getName ? getName(x) : (x && (x.name || x.title || x.path || ''))) || '';
    var b = (getName ? getName(y) : (y && (y.name || y.title || y.path || ''))) || '';
    return _naturalCmpStr(a, b);
  });
}

document.getElementById('modal-overlay').addEventListener('click', function (e) {
  if (e.target === this) closeModal();
});
document.getElementById('video-overlay').addEventListener('click', function (e) {
  if (e.target === this) {
    document.getElementById('video-player').pause();
    this.classList.add('hidden');
  }
});