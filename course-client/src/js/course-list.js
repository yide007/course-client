function _stopVideoPlayback() {
  try {
    const dp = document.getElementById('detail-player');
    if (dp && dp.src && !dp.paused) { dp.pause(); }
  } catch (_) {}
  try {
    const vo = document.getElementById('video-overlay');
    if (vo && !vo.classList.contains('hidden')) {
      const vp = document.getElementById('video-player');
      if (vp) { vp.pause(); vp.removeAttribute('src'); try { vp.load(); } catch (_) {} }
      vo.classList.add('hidden');
    }
  } catch (_) {}
  currentVideoLessonId = null;
}

// 保存当前播放进度（供切换课时时调用）
function _saveCurrentProgress() {
  try {
    const dp = document.getElementById('detail-player');
    if (!dp || !dp.src || dp.paused || dp.ended || !dp.duration) return;
    if (!currentCourseId || !currentVideoLessonId) return;
    const cur = dp.currentTime;
    if (cur <= 0) return;
    const pct = (cur / dp.duration) * 100;
    const completed = pct >= 95;
    api.updateProgress({
      courseId: currentCourseId,
      lessonId: currentVideoLessonId,
      progress: pct,
      completed,
      lastPosition: cur,
    });
    console.log('[保存进度] 切换课时前保存: lessonId=' + currentVideoLessonId + ' pos=' + cur.toFixed(1) + 's');
  } catch (_) {}
}

function navigateTo(page, skipLoad = false) {
  _stopVideoPlayback();
  if (window._p115Hls) { try { window._p115Hls.destroy(); } catch (_) {} window._p115Hls = null; }
  if (typeof stopP115QrPoll === 'function') stopP115QrPoll();
  const navEl = document.querySelector('.nav-item[data-page="' + page + '"]');
  const pageEl = document.getElementById('page-' + page);
  const needsAdmin = (navEl && navEl.getAttribute('data-role') === 'admin') ||
                     (pageEl && pageEl.getAttribute('data-role') === 'admin');
  const isAdmin = _currentLoginUser && _currentLoginUser.role === 'admin';
  if (needsAdmin && !isAdmin) {
    return;
  }
  currentPage = page;
  document.querySelectorAll('.nav-item').forEach((n) => n.classList.toggle('active', n.dataset.page === page));
  document.querySelectorAll('.page').forEach((p) => p.classList.remove('active'));
  if (pageEl) pageEl.classList.add('active');

  // 恢复所有页面的 page-header 显示（被隐藏的页面需要还原）
  document.querySelectorAll('.page > .page-header').forEach((h) => { h.style.display = ''; });

  // 侧边栏显隐：详情页与115网盘页全屏浏览（隐藏），其余页面显示
  const sidebar = document.getElementById('sidebar');
  if (page === 'detail' || page === 'p115') {
    if (sidebar) sidebar.classList.add('hidden');
  } else {
    if (sidebar) sidebar.classList.remove('hidden');
  }

  // 进入需要显示标题的页面时，隐藏其 page-header 并在顶部工具栏渲染标题
  // 注意：course-mgmt 页面有特殊的章节管理模式，page-header 处理由 loadCourseMgmt/openChapterMgmt 负责
  const pagesWithTopbarTitle = ['courses', 'categories', 'users', 'upload-config', 'stats', 'p115'];
  if (pagesWithTopbarTitle.includes(page)) {
    if (pageEl) {
      const header = pageEl.querySelector('.page-header');
      if (header) header.style.display = 'none';
    }
  } else if (page === 'detail') {
    // 详情页由 viewCourseDetail 处理
  } else if (page === 'course-mgmt') {
    // 课程管理页由 loadCourseMgmt/openChapterMgmt 处理
  } else {
    // 其他页面清空顶部工具栏
    if (typeof _clearTopbarNav === 'function') _clearTopbarNav();
  }

  if (skipLoad) return;

  if (page === 'courses') {
    currentCategoryId = null;
    const list = document.getElementById('category-list');
    if (list) list.querySelectorAll('.category-item').forEach((n) => n.classList.remove('active'));
    loadCourses();
  } else if (page === 'course-mgmt') {
    loadCourseMgmt();
  } else if (page === 'categories') {
    loadCategoryMgmt();
  } else if (page === 'users') {
    loadUserMgmt();
  } else if (page === 'upload-config') {
    loadUploadConfigs();
    loadP115Configs();
  } else if (page === 'stats') {
    loadStats();
  } else if (page === 'p115') {
    loadP115Drive();
  }
}

async function loadCourses() {
  const courses = await api.getCourses();
  const categories = await api.getCategories();

  // 防止异步返回时用户已切换到其他页面
  if (currentPage !== 'courses') return;

  // 隐藏 page-header，标题和按钮移到顶部工具栏
  const coursesPage = document.getElementById('page-courses');
  if (coursesPage) {
    const header = coursesPage.querySelector('.page-header');
    if (header) header.style.display = 'none';
  }
  const isAdmin = _currentLoginUser && _currentLoginUser.role === 'admin';
  const actionHtml = isAdmin
    ? '<button type="button" class="btn btn-primary" id="topbar-add-course" style="padding:8px 16px;font-size:13px;">+ 添加课程</button>'
    : '';
  // 根据是否选中分类决定标题
  let pageTitle = '全部课程';
  if (currentCategoryId) {
    const cat = (categories || []).find(c => String(c.id) === String(currentCategoryId));
    if (cat) pageTitle = cat.name;
  }
  if (typeof _renderTopbarTitle === 'function') _renderTopbarTitle(pageTitle, actionHtml);
  const addBtn = document.getElementById('topbar-add-course');
  if (addBtn) addBtn.addEventListener('click', () => showCourseModal());

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
      const catNameEl = el.querySelector('.cat-name');
      const catName = catNameEl ? catNameEl.textContent : '全部课程';

      // ===== 离开页面自动停止视频播放 =====
      _stopVideoPlayback();

      // ===== 1. 切换到课程列表页（关键：从详情页/其他页跳回） =====
      currentPage = 'courses';
      document.querySelectorAll('.page').forEach((p) => p.classList.remove('active'));
      const coursesPage = document.getElementById('page-courses');
      if (coursesPage) coursesPage.classList.add('active');

      // 恢复所有页面的 page-header，然后隐藏课程列表页的
      document.querySelectorAll('.page > .page-header').forEach((h) => { h.style.display = ''; });
      if (coursesPage) {
        const coursesHeader = coursesPage.querySelector('.page-header');
        if (coursesHeader) coursesHeader.style.display = 'none';
      }
      const isAdmin = _currentLoginUser && _currentLoginUser.role === 'admin';
      const catActionHtml = isAdmin
        ? '<button type="button" class="btn btn-primary" id="topbar-add-course" style="padding:8px 16px;font-size:13px;">+ 添加课程</button>'
        : '';
      if (typeof _renderTopbarTitle === 'function') _renderTopbarTitle(catName, catActionHtml);
      const catAddBtn = document.getElementById('topbar-add-course');
      if (catAddBtn) catAddBtn.addEventListener('click', () => showCourseModal());
      // 显示侧边栏
      const sidebar = document.getElementById('sidebar');
      if (sidebar) sidebar.classList.remove('hidden');

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
    container.innerHTML = '<p style="text-align:center;color:#94a3b8;padding:40px;">暂无课程，请先添加课程或从 115 网盘导入</p>';
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
      domain: detail.domain || '',
      port: detail.port || '',
      token: detail.token || '',
      instructor: detail.instructor || '',
      coverImage: detail.coverImage || '',
      coverColor: detail.coverColor || '',
      level: detail.level || '初级',
      rating: detail.rating || 4.5,
      description: detail.description || '',
      _manual: !!detail._manual,
      chapters: detail.chapters || [],
    });
    return (r && r.success);
  } catch (e) {
    console.error('[update-cat]', e);
    return false;
  }
}

async function _updateCourseMode(courseId, mode) {
  try {
    const detail = await api.getCourseDetail(courseId);
    if (!detail) return false;
    const isManual = mode === 'manual';
    const r = await api.updateCourse({
      courseId,
      categoryId: detail.categoryId,
      title: detail.title,
      subtitle: detail.subtitle || '',
      domain: detail.domain || '',
      port: detail.port || '',
      token: detail.token || '',
      instructor: detail.instructor || '',
      coverImage: detail.coverImage || '',
      coverColor: detail.coverColor || '',
      level: detail.level || '初级',
      rating: detail.rating || 0,
      description: detail.description || '',
      _manual: isManual,
      courseMode: mode,
      chapters: detail.chapters || [],
    });
    return (r && r.success);
  } catch (e) {
    console.error('[update-mode]', e);
    return false;
  }
}