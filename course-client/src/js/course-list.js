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

function navigateTo(page) {
  _stopVideoPlayback();
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

      // ===== 离开页面自动停止视频播放 =====
      _stopVideoPlayback();

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

