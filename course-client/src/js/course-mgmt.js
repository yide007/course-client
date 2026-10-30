// ============================================================
//  课程管理聚合入口：事件绑定 + 课程列表管理 + 分类管理 + 用户管理 (course-mgmt.js)
// ============================================================
let _eventListenersSetup = false;
function setupEventListeners() {
  if (_eventListenersSetup) return;
  _eventListenersSetup = true;

  // 添加分类
  const addCatBtn = document.getElementById('btn-add-category');
  if (addCatBtn) addCatBtn.addEventListener('click', () => showCategoryModal());

  // 添加用户
  const addUserBtn = document.getElementById('btn-add-user');
  if (addUserBtn) addUserBtn.addEventListener('click', () => showUserModal());

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
    try { if (player) _resetVideoForNext(player); } catch (_) {}
    document.getElementById('video-overlay').classList.add('hidden');
    try { _sweepVideoMemory(); } catch (_) {}
  });

  document.getElementById('btn-add-course').addEventListener('click', () => {
    showCourseModal();
  });
  const mgmtAddBtn = document.getElementById('btn-mgmt-add-course');
  if (mgmtAddBtn) mgmtAddBtn.addEventListener('click', () => {
    showCourseModal();
  });
  const addUploadConfigBtn = document.getElementById('btn-add-upload-config');
  if (addUploadConfigBtn) addUploadConfigBtn.addEventListener('click', () => {
    showUploadConfigModal();
  });
  const addP115ConfigBtn = document.getElementById('btn-add-p115-config');
  if (addP115ConfigBtn) addP115ConfigBtn.addEventListener('click', () => {
    showP115ConfigModal();
  });

  // 窗口拖动/缩放期间：临时暂停 timeupdate/progress 高频解码事件，确保拖动不卡顿
  // 原理：这两个事件每秒触发 4~30 次（解码回调 -> 进度条刷新），会把渲染主线程占满，
  //       导致操作系统 WM_MOVE / WM_NCHITTEST 消息被延后，拖动窗口就会"粘住"。
  //       拖动期间把这些事件暂时静音，主进程消息队列就能及时响应。
  let _lastRestoreAt = 0;
  let _pauseToken = 0;
  const _allVideoEls = () => Array.from(document.querySelectorAll('video'));
  const _suppressHighFreq = (suppress) => {
    const now = Date.now();
    const videos = _allVideoEls();
    if (suppress) {
      _pauseToken++;
      const token = _pauseToken;
      document.documentElement.setAttribute('data-win-moving', '1');
      videos.forEach(v => {
        try {
          // 提示 Chromium：此 tab/窗口暂时不需要高刷新的解码
          if (v.requestVideoFrameCallback && !v._wmSavedRvfc) {
            v._wmSavedRvfc = true;
          }
          // 静音 timeupdate / progress / waiting / playing 事件冒泡
          ['timeupdate', 'progress', 'seeking', 'seeked'].forEach(ev => {
            const key = '_wmBlock_' + ev;
            if (!v[key]) {
              const handler = (e) => { if (document.documentElement.getAttribute('data-win-moving') === '1') { e.stopImmediatePropagation(); } };
              v.addEventListener(ev, handler, true);
              v[key] = handler;
            }
          });
          // 降低解码质量提示（不会暂停播放，只是减少回绘）
          try { v.setAttribute('playsinline', ''); v.setAttribute('webkit-playsinline', ''); } catch (_) {}
        } catch (_) {}
      });
      // 兜底恢复：防止 moved 事件在某些平台丢了
      setTimeout(() => { if (token === _pauseToken && document.documentElement.getAttribute('data-win-moving') === '1') _suppressHighFreq(false); }, 4000);
    } else {
      _lastRestoreAt = now;
      document.documentElement.removeAttribute('data-win-moving');
      videos.forEach(v => {
        ['timeupdate', 'progress', 'seeking', 'seeked'].forEach(ev => {
          const key = '_wmBlock_' + ev;
          if (v[key]) { v.removeEventListener(ev, v[key], true); delete v[key]; }
        });
      });
    }
  };
  try {
    if (api && typeof api.onWindowMoveState === 'function') {
      let _t = 0;
      api.onWindowMoveState((st) => {
        // 节流：拖动过程中不要每 1ms 都切换一次状态
        clearTimeout(_t);
        if (st && st.moving) {
          _suppressHighFreq(true);
        } else {
          _t = setTimeout(() => _suppressHighFreq(false), 120);
        }
      });
    }
  } catch (_) {}
}

// ============================================================
//  课程管理（表格表单形式）
// ============================================================
async function loadCourseMgmt() {
  const [categories, courses] = await Promise.all([
    _getCachedCategories(true),
    api.getCourses() || [],
  ]);

  // 防止异步返回时用户已切换到其他页面或进入章节管理模式，覆盖顶部工具栏
  if (currentPage !== 'course-mgmt' || currentChapterMgmtCourseId !== null) return;

  const container = document.getElementById('course-management');
  if (!container) return;

  // 清理章节管理遗留的 header 元素，隐藏课程管理列表页的 page-header
  const headerEl = document.querySelector('#page-course-mgmt > .page-header');
  if (headerEl) {
    headerEl.querySelector('#chapters-mgmt-back')?.remove();
    headerEl.querySelector('#chapters-mgmt-home')?.remove();
    headerEl.querySelector('#chapters-mgmt-stats')?.remove();
    headerEl.style.marginBottom = '';
    headerEl.style.borderBottomLeftRadius = '';
    headerEl.style.borderBottomRightRadius = '';
    headerEl.style.display = 'none';
  }
  // 在顶部工具栏渲染「课程管理」标题和「+ 添加课程」按钮
  if (typeof _renderTopbarTitle === 'function') {
    _renderTopbarTitle('课程管理',
      '<button type="button" class="btn btn-primary" id="topbar-mgmt-add-course" style="padding:8px 16px;font-size:13px;">+ 添加课程</button>');
  }
  const addBtn = document.getElementById('topbar-mgmt-add-course');
  if (addBtn) addBtn.addEventListener('click', () => showCourseModal());
  // 返回课程管理页时恢复侧边栏显示
  const sidebarEl = document.getElementById('sidebar');
  if (sidebarEl) sidebarEl.classList.remove('hidden');
  chapterMgmtDraft = null;
  chapterMgmtOrigDetail = null;
  currentChapterMgmtCourseId = null;

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
        <select id="mgmt-course-mode"><option value="">全部模式</option><option value="manual">手动课程</option><option value="netdisk">网盘课程</option></select>
      </div>
    </div>
    <div class="mgmt-scroll-body">
      <table class="course-cat-table" id="mgmt-course-table" style="width:100%;">
        <thead style="position:sticky;top:0;z-index:1;"><tr>
          <th style="width:60px;text-align:center;">封面</th>
          <th style="text-align:center;">课程名称</th>
          <th style="width:120px;text-align:center;">分类</th>
          <th style="width:120px;text-align:center;">课程模式</th>
          <th style="width:100px;text-align:center;">章/集</th>
          <th style="width:270px;text-align:center;">操作</th>
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
            const mode = c.courseMode || (c._manual ? 'manual' : 'token');
            const modeLabel = mode === 'manual' ? '手动课程' : (mode === 'netdisk' ? '网盘课程' : '令牌课程');
            const modeColor = mode === 'manual' ? '#059669' : (mode === 'netdisk' ? '#0891b2' : '#7c3aed');
            const modeBg = mode === 'manual' ? '#d1fae5' : (mode === 'netdisk' ? '#cffafe' : '#ede9fe');
            return `
            <tr data-mgmt-course-row="${c.id}">
              <td style="display:flex;align-items:center;justify-content:center;padding-left:12px;padding-right:12px;"><div style="width:48px;height:48px;border-radius:4px;display:flex;align-items:center;justify-content:center;overflow:hidden;${coverStyle}">${coverInner}</div></td>
              <td style="white-space:nowrap;text-align:center;">
                <strong class="mgmt-course-title-link" data-mgmt-view="${c.id}" style="cursor:pointer;color:#4f46e5;">${escapeHtml(c.title)}</strong>
                ${c.subtitle ? `<span style="font-size:12px;color:#94a3b8;margin-left:8px;">· ${escapeHtml(c.subtitle)}</span>` : ''}
              </td>
              <td style="padding-left:14px;padding-right:14px;text-align:center;"><span style="font-size:12px;color:#475569;">${escapeHtml(catName)}</span></td>
              <td style="text-align:center;"><span style="display:inline-block;padding:2px 10px;border-radius:10px;font-size:11px;font-weight:600;background:${modeBg};color:${modeColor};">${mode === 'manual' ? '✍️' : '🔑'} ${modeLabel}</span></td>
              <td style="font-size:12px;color:#64748b;text-align:center;">${c.chapterCount || 0}章 / ${c.lessonCount || 0}集</td>
              <td style="text-align:center;">
                ${mode === 'netdisk'
                  ? `<button class="btn btn-sm btn-primary" data-mgmt-update="${c.id}" style="white-space:nowrap;">🔄 更新课程</button>`
                  : `<button class="btn btn-sm btn-primary" data-mgmt-chapters="${c.id}" style="white-space:nowrap;">📑 章节管理</button>`}
                <button class="btn btn-sm btn-primary" data-mgmt-edit="${c.id}" style="white-space:nowrap;">✏️ 编辑</button>
                <button class="btn btn-sm btn-danger" data-mgmt-del="${c.id}">🗑️</button>
                <span class="mgmt-status-mgmt-${c.id}" style="font-size:11px;"></span>
              </td>
            </tr>`;
          }).join('') || `<tr><td colspan="6" style="text-align:center;padding:30px;color:#94a3b8;">还没有课程，点击右上角「+ 添加课程」</td></tr>`}
        </tbody>
      </table>
    </div>`;

  // 绑定搜索和筛选
  const applyFilter = () => {
    const kw = (document.getElementById('mgmt-course-search').value || '').trim().toLowerCase();
    const cat = document.getElementById('mgmt-course-filter').value;
    const lvl = document.getElementById('mgmt-course-level').value;
    const mode = document.getElementById('mgmt-course-mode').value;
    (courses || []).forEach(c => {
      const row = document.querySelector(`tr[data-mgmt-course-row="${c.id}"]`);
      if (!row) return;
      const okKw = !kw || (String(c.title || '').toLowerCase().includes(kw) || String(c.instructor || '').toLowerCase().includes(kw));
      const cCat = String(c.categoryId || c.category_id || '');
      const okCat = !cat || cCat === String(cat);
      const okLvl = !lvl || (c.level || '初级') === lvl;
      const cMode = c.courseMode || (c._manual ? 'manual' : 'token');
      const okMode = !mode || cMode === mode;
      row.style.display = (okKw && okCat && okLvl && okMode) ? '' : 'none';
    });
  };
  document.getElementById('mgmt-course-search').addEventListener('input', applyFilter);
  document.getElementById('mgmt-course-filter').addEventListener('change', applyFilter);
  document.getElementById('mgmt-course-level').addEventListener('change', applyFilter);
  document.getElementById('mgmt-course-mode').addEventListener('change', applyFilter);

  // 查看详情
  container.querySelectorAll('[data-mgmt-view]').forEach(b => {
    b.addEventListener('click', () => viewCourseDetail(parseInt(b.dataset.mgmtView)));
  });

  // 章节管理
  container.querySelectorAll('button[data-mgmt-chapters]').forEach(b => {
    b.addEventListener('click', () => openChapterMgmt(parseInt(b.dataset.mgmtChapters)));
  });

  // 网盘课程 → 更新课程（打开 115 选择器同步）
  container.querySelectorAll('button[data-mgmt-update]').forEach(b => {
    b.addEventListener('click', () => {
      if (typeof showP115UpdateWizard === 'function') {
        showP115UpdateWizard(parseInt(b.dataset.mgmtUpdate));
      } else {
        console.error('[mgmt] showP115UpdateWizard 未定义');
      }
    });
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
      if (!(await confirmCustom(`确定要删除课程「${course.title}」吗？此操作不可撤销。`))) return;
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
    if (!(await confirmCustom(`确定要把选中的 ${ids.length} 门课程统一移动到「${document.getElementById('mgmt-batch-cat-mgmt').selectedOptions[0].text}」吗？`))) return;
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

  // 防止异步返回时用户已切换到其他页面
  if (currentPage !== 'categories') return;

  // 隐藏 page-header，标题和按钮移到顶部工具栏
  if (typeof _renderTopbarTitle === 'function') {
    _renderTopbarTitle('分类管理',
      '<button type="button" class="btn btn-primary" id="topbar-add-category" style="padding:8px 16px;font-size:13px;">+ 添加分类</button>');
  }
  const addCatBtn = document.getElementById('topbar-add-category');
  if (addCatBtn) addCatBtn.addEventListener('click', () => showCategoryModal());

  const countMap = {};
  (courses || []).forEach(c => {
    const cid = String(c.categoryId || c.category_id || 0);
    countMap[cid] = (countMap[cid] || 0) + 1;
  });
  const catGrid = document.getElementById('category-management');
  let _selectedCatId = null; // 当前选中的分类ID（用于高亮）
  if (catGrid) {
    catGrid.innerHTML = `
      <div class="mgmt-section-title">📁 分类列表 <span class="section-count">共 ${categories.length} 个分类</span></div>
      <div style="overflow:auto;">
        <table class="course-cat-table" style="width:100%;border-collapse:collapse;font-size:13px;table-layout:fixed;">
          <thead>
            <tr style="background:#f8fafc;border-bottom:1px solid #e5e7eb;">
              <th style="padding:8px 12px;text-align:left;font-weight:600;color:#475569;width:80px;">分类ID</th>
              <th style="padding:8px 12px;text-align:left;font-weight:600;color:#475569;width:200px;">分类名称</th>
              <th style="padding:8px 12px;text-align:center;font-weight:600;color:#475569;width:80px;">课程数</th>
              <th style="padding:8px 12px;text-align:center;font-weight:600;color:#475569;width:170px;">操作</th>
            </tr>
          </thead>
          <tbody>
            ${categories.map(c => {
              const cnt = countMap[String(c.id)] || 0;
              return `
              <tr data-cat-card="${c.id}" style="border-bottom:1px solid #e5e7eb;cursor:pointer;transition:background 0.15s;">
                <td style="padding:8px 12px;color:#64748b;">#${c.id}</td>
                <td style="padding:8px 12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
                  <strong style="font-size:14px;color:#1e293b;">${escapeHtml(c.name)}</strong>
                </td>
                <td style="padding:8px 12px;text-align:center;font-weight:600;color:${cnt > 0 ? '#4338ca' : '#94a3b8'};">
                  ${cnt > 0 ? cnt : '—'}
                </td>
                <td style="padding:8px 12px;text-align:center;white-space:nowrap;">
                  <button class="btn btn-sm btn-secondary" data-cat-edit="${c.id}" style="padding:4px 10px;font-size:12px;">✏️ 重命名</button>
                  <button class="btn btn-sm btn-danger" data-cat-del="${c.id}" style="padding:4px 10px;font-size:12px;margin-left:6px;">🗑️ 删除</button>
                </td>
              </tr>`;
            }).join('') || `<tr><td colspan="4" style="padding:30px;text-align:center;color:#94a3b8;">还没有分类</td></tr>`}
          </tbody>
        </table>
      </div>`;
    catGrid.querySelectorAll('button[data-cat-edit]').forEach(b => {
      b.addEventListener('click', (e) => { e.stopPropagation(); showCategoryModal(parseInt(b.dataset.catEdit)); });
    });
    catGrid.querySelectorAll('button[data-cat-del]').forEach(b => {
      b.addEventListener('click', async (e) => { e.stopPropagation();
        const id = parseInt(b.dataset.catDel);
        const cnt = countMap[String(id)] || 0;
        const msg = cnt > 0
          ? `该分类下还有 ${cnt} 门课程。删除后这些课程会变成"未分类"。确定删除吗？`
          : '确定删除该分类吗？';
        if (!(await confirmCustom(msg))) return;
        api.deleteCategory(id).then(r => {
          if (r && r.success) { loadCategoryMgmt(); loadCategories(); loadCourses(); }
          else alert('删除失败: ' + ((r && r.error) || '未知错误'));
        });
      });
    });
    // 点击分类行 → 筛选下方课程表
    catGrid.querySelectorAll('tr[data-cat-card]').forEach(card => {
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
        // 高亮当前选中的行
        catGrid.querySelectorAll('tr[data-cat-card]').forEach(c => {
          c.style.background = parseInt(c.dataset.catCard) === _selectedCatId ? '#eef2ff' : '';
        });
        // 触发筛选
        const evt = new Event('change');
        document.getElementById('mgmt-cat-filter').dispatchEvent(evt);
      });
    });
  }

  const box = document.getElementById('course-category-mgmt');
  if (box) {
    _renderCourseCategoryAdjust(box, categories, courses, catGrid);
  }
}

function _renderCourseCategoryAdjust(box, categories, courses, catGrid) {
  const catOpts = categories.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
  box.innerHTML = `
      <div class="mgmt-section-title">
        <span>🏫 课程分类调整</span>
        <div class="ccmgmt-toolbar">
          <span class="section-count">${courses.length} 门课程</span>
          <input id="mgmt-cat-search" placeholder="搜索课程名...">
          <select id="mgmt-cat-filter"><option value="">全部分类</option>${catOpts}</select>
          <select id="mgmt-batch-cat"><option value="">批量移动到 →</option>${catOpts}</select>
          <button class="btn btn-sm btn-primary" id="mgmt-batch-apply">应用</button>
        </div>
      </div>
      <div style="overflow:auto;">
        <table class="course-cat-table" id="mgmt-cat-table" style="width:100%;border-collapse:collapse;font-size:13px;table-layout:fixed;">
          <thead>
            <tr style="background:#f8fafc;border-bottom:1px solid #e5e7eb;">
              <th style="width:36px;padding:8px 6px;text-align:center;"><input type="checkbox" id="mgmt-check-all"></th>
              <th style="width:60px;padding:8px 12px;text-align:left;font-weight:600;color:#475569;">ID</th>
              <th style="padding:8px 12px;text-align:left;font-weight:600;color:#475569;">课程名</th>
              <th style="width:110px;padding:8px 12px;text-align:center;font-weight:600;color:#475569;">章/集</th>
              <th style="width:180px;padding:8px 12px;text-align:left;font-weight:600;color:#475569;">分类</th>
              <th style="width:90px;padding:8px 12px;text-align:center;font-weight:600;color:#475569;">状态</th>
            </tr>
          </thead>
          <tbody id="mgmt-cat-body">
            ${(courses || []).map(c => {
              const cid = String(c.categoryId || c.category_id || '');
              return `
              <tr data-course-row="${c.id}" style="border-bottom:1px solid #e5e7eb;">
                <td style="padding:8px 6px;text-align:center;"><input type="checkbox" class="mgmt-check" data-check="${c.id}"></td>
                <td style="padding:8px 12px;color:#94a3b8;">#${c.id}</td>
                <td style="padding:8px 12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
                  <strong style="color:#1e293b;">${escapeHtml(c.title)}</strong>
                  <span style="font-size:11px;color:#94a3b8;margin-left:8px;">${escapeHtml(c.instructor || '--')} · ${c.level || '初级'}</span>
                </td>
                <td style="padding:8px 12px;text-align:center;font-size:12px;color:#64748b;">${c.chapterCount || 0}章 / ${c.lessonCount || 0}集</td>
                <td style="padding:8px 12px;">
                  <select class="cat-select" data-table-cat="${c.id}" style="width:100%;">
                    ${categories.map(ct => `<option value="${ct.id}" ${cid === String(ct.id) ? 'selected' : ''}>${escapeHtml(ct.name)}</option>`).join('')}
                  </select>
                </td>
                <td style="padding:8px 12px;text-align:center;font-size:12px;"><span class="mgmt-status-${c.id}"></span></td>
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
    if (catGrid) catGrid.querySelectorAll('tr[data-cat-card]').forEach(c => {
      c.style.background = !!catId && parseInt(c.dataset.catCard) === catId ? '#eef2ff' : '';
    });
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
    if (!(await confirmCustom(`确定要把选中的 ${ids.length} 门课程统一移动到「${document.getElementById('mgmt-batch-cat').selectedOptions[0].text}」吗？`))) return;
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

// ===== 用户管理 =====
let _userCache = [];

async function loadUserMgmt() {
  const container = document.getElementById('user-management');
  if (!container) return;
  try {
    const users = await api.listUsers();
    _userCache = users || [];
  } catch (e) {
    _userCache = [];
  }

  // 防止异步返回时用户已切换到其他页面
  if (currentPage !== 'users') return;

  // 隐藏 page-header，标题和按钮移到顶部工具栏
  if (typeof _renderTopbarTitle === 'function') {
    _renderTopbarTitle('用户/管理员管理',
      '<button type="button" class="btn btn-primary" id="topbar-add-user" style="padding:8px 16px;font-size:13px;">+ 添加用户</button>');
  }
  const addUserBtn = document.getElementById('topbar-add-user');
  if (addUserBtn) addUserBtn.addEventListener('click', () => showUserModal());

  if (_userCache.length === 0) {
    container.innerHTML = '<p style="text-align:center;color:#94a3b8;padding:60px 20px;font-size:15px;">📋 暂无用户数据</p>';
    return;
  }

  const curUser = _currentLoginUser && _currentLoginUser.username;
  container.innerHTML = `
    <div class="mgmt-section-title">👥 用户列表 <span style="font-size:13px;color:#64748b;">共 ${_userCache.length} 人</span></div>
    <div style="overflow:auto;">
      <table class="course-cat-table">
        <thead><tr>
          <th style="width:60px;">#</th>
          <th style="width:70px;">头像</th>
          <th>用户名</th>
          <th>昵称</th>
          <th style="width:120px;">角色</th>
          <th style="width:200px;">操作</th>
        </tr></thead>
        <tbody>
          ${_userCache.map((u, i) => {
            const isSelf = u.username === curUser;
            const isAdminBuiltin = u.username === 'admin';
            const roleLabel = u.role === 'admin'
              ? '<span style="display:inline-block;padding:2px 8px;border-radius:4px;background:#fef3c7;color:#d97706;font-size:12px;">管理员</span>'
              : '<span style="display:inline-block;padding:2px 8px;border-radius:4px;background:#dbeafe;color:#2563eb;font-size:12px;">普通用户</span>';
            const displayName = u.nickname || u.username || 'U';
            const avatarLetter = displayName.charAt(0).toUpperCase();
            const avatarInner = u.avatar
              ? `<img src="${escapeAttr(u.avatar)}" style="width:100%;height:100%;object-fit:cover;border-radius:10px;display:block;">`
              : escapeHtml(avatarLetter);
            return `
            <tr>
              <td style="color:#94a3b8;">${i + 1}</td>
              <td style="text-align:center;">
                <div style="width:34px;height:34px;border-radius:10px;background:linear-gradient(135deg,#6366f1 0%,#8b5cf6 50%,#ec4899 100%);color:#fff;display:inline-flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;box-shadow:0 2px 8px rgba(139,92,246,0.4);overflow:hidden;">${avatarInner}</div>
              </td>
              <td><strong>${escapeHtml(u.username)}</strong>${isSelf ? '<span style="margin-left:6px;font-size:11px;color:#64748b;">(当前)</span>' : ''}</td>
              <td>${escapeHtml(u.nickname || u.username)}</td>
              <td>${roleLabel}</td>
              <td>
                <button class="btn btn-xs btn-secondary" data-edit-user="${escapeAttr(u.username)}">编辑</button>
                <button class="btn btn-xs" style="background:#fee2e2;color:#dc2626;border:none;" data-del-user="${escapeAttr(u.username)}" ${isSelf || isAdminBuiltin ? 'disabled style="opacity:0.4;cursor:not-allowed;"' : ''}>删除</button>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;

  container.querySelectorAll('[data-edit-user]').forEach(btn => {
    btn.addEventListener('click', () => showUserModal(btn.getAttribute('data-edit-user')));
  });
  container.querySelectorAll('[data-del-user]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const uname = btn.getAttribute('data-del-user');
      if (!uname) return;
      if (!(await confirmCustom('确定要删除用户「' + uname + '」吗？此操作不可恢复。'))) return;
      try {
        const r = await api.deleteUser(uname);
        if (r && r.success) {
          loadUserMgmt();
        } else {
          alert('删除失败：' + (r && r.error ? r.error : '未知错误'));
        }
      } catch (e) {
        alert('删除失败：' + e.message);
      }
    });
  });
}

function showUserModal(username) {
  const modal = document.getElementById('modal-container');
  const editing = !!username;
  let curUser = null;
  if (editing) curUser = _userCache.find(u => u.username === username);

  const initialAvatar = (editing && curUser && curUser.avatar) ? curUser.avatar : '';
  const displayName = (editing && curUser && (curUser.nickname || curUser.username)) || 'U';
  const avatarLetter = displayName.charAt(0).toUpperCase();

  modal.innerHTML = `
    <h2>${editing ? '编辑用户' : '添加用户'}</h2>
    ${editing ? `<p style="color:#64748b;font-size:13px;margin-bottom:14px;">用户名：<strong>${escapeHtml(username)}</strong>（不可修改）</p>` : ''}
    <div class="form-group" style="display:flex;flex-direction:column;align-items:center;">
      <label>头像</label>
      <div id="u-avatar-preview" style="position:relative;width:88px;height:88px;border-radius:50%;background:linear-gradient(135deg,#6366f1 0%,#8b5cf6 50%,#ec4899 100%);color:#fff;display:flex;align-items:center;justify-content:center;font-size:32px;font-weight:700;cursor:pointer;box-shadow:0 4px 14px rgba(139,92,246,0.4);overflow:hidden;border:3px solid #fff;" title="点击上传头像">
        <span id="u-avatar-letter">${escapeHtml(avatarLetter)}</span>
      </div>
      <div style="margin-top:8px;display:flex;gap:8px;">
        <button type="button" class="btn btn-xs btn-secondary" id="u-avatar-upload-btn">📷 上传头像</button>
        <button type="button" class="btn btn-xs btn-secondary" id="u-avatar-remove-btn" style="${initialAvatar ? '' : 'display:none;'}">🗑️ 移除</button>
      </div>
      <span style="font-size:11px;color:#94a3b8;margin-top:6px;">将上传至图片服务器，与课程封面共用通道</span>
    </div>
    <div class="form-group"><label>用户名 *</label><input id="u-username" placeholder="字母、数字、下划线" ${editing ? 'disabled' : ''} value="${editing ? escapeAttr(curUser.username) : ''}"></div>
    <div class="form-group"><label>密码 ${editing ? '（留空则不修改）' : '*'}</label><input id="u-password" type="password" placeholder="至少6位"></div>
    <div class="form-group"><label>昵称</label><input id="u-nickname" placeholder="显示名称" value="${editing ? escapeAttr(curUser.nickname || '') : ''}"></div>
    <div class="form-group"><label>角色</label>
      <select id="u-role">
        <option value="user" ${editing && curUser.role === 'user' ? 'selected' : ''}>普通用户</option>
        <option value="admin" ${editing && curUser.role === 'admin' ? 'selected' : ''}>管理员</option>
      </select>
    </div>
    <div class="form-actions">
      <button class="btn btn-secondary" onclick="closeModal()">取消</button>
      <button class="btn btn-primary" id="btn-save-user">保存</button>
    </div>`;
  document.getElementById('modal-overlay').classList.remove('hidden');

  let selectedAvatar = initialAvatar;
  const avatarPreview = document.getElementById('u-avatar-preview');
  const avatarLetterEl = document.getElementById('u-avatar-letter');
  const uploadBtn = document.getElementById('u-avatar-upload-btn');
  const removeBtn = document.getElementById('u-avatar-remove-btn');

  function _renderAvatarPreview() {
    if (selectedAvatar) {
      avatarPreview.innerHTML = `<img src="${escapeAttr(selectedAvatar)}" style="width:100%;height:100%;object-fit:cover;display:block;">`;
      if (removeBtn) removeBtn.style.display = '';
    } else {
      const nickEl = document.getElementById('u-nickname');
      const unameEl = document.getElementById('u-username');
      const nameForLetter = (nickEl && nickEl.value.trim()) || (unameEl && unameEl.value.trim()) || 'U';
      avatarPreview.innerHTML = `<span id="u-avatar-letter">${escapeHtml(nameForLetter.charAt(0).toUpperCase())}</span>`;
      if (removeBtn) removeBtn.style.display = 'none';
    }
  }

  if (initialAvatar) _renderAvatarPreview();

  async function _pickAvatar() {
    const originalBtnText = uploadBtn.textContent;
    uploadBtn.disabled = true;
    uploadBtn.textContent = '⏳ 上传中...';
    try {
      const r = await api.pickCoverImage();
      if (r && r.success && r.fileUrl) {
        selectedAvatar = r.fileUrl;
        _renderAvatarPreview();
      } else if (r && !r.canceled) {
        alert('上传头像失败：' + (r && r.error ? r.error : '未知错误'));
      }
    } catch (e) {
      alert('上传头像失败：' + e.message);
    } finally {
      uploadBtn.disabled = false;
      uploadBtn.textContent = originalBtnText;
    }
  }
  avatarPreview.addEventListener('click', _pickAvatar);
  if (uploadBtn) uploadBtn.addEventListener('click', _pickAvatar);

  if (removeBtn) removeBtn.addEventListener('click', () => {
    selectedAvatar = '';
    _renderAvatarPreview();
  });

  const nickInput = document.getElementById('u-nickname');
  if (nickInput) nickInput.addEventListener('input', () => { if (!selectedAvatar) _renderAvatarPreview(); });
  const unameInput = document.getElementById('u-username');
  if (unameInput) unameInput.addEventListener('input', () => { if (!selectedAvatar) _renderAvatarPreview(); });

  document.getElementById('btn-save-user').addEventListener('click', async () => {
    const uname = (document.getElementById('u-username').value || '').trim();
    const pwd = (document.getElementById('u-password').value || '').trim();
    const nick = (document.getElementById('u-nickname').value || '').trim();
    const role = document.getElementById('u-role').value;

    if (!editing && !uname) { alert('请输入用户名'); return; }
    if (!editing && !pwd) { alert('请输入密码'); return; }

    try {
      let r;
      if (editing) {
        r = await api.updateUser({ username, password: pwd, nickname: nick, role, avatar: selectedAvatar });
      } else {
        r = await api.addUser({ username: uname, password: pwd, nickname: nick, role, avatar: selectedAvatar });
      }
      if (r && r.success) {
        if (editing && _currentLoginUser && _currentLoginUser.username === username) {
          _currentLoginUser.avatar = selectedAvatar;
          if (nick) _currentLoginUser.nickname = nick;
          _updateUserInfoBar(_currentLoginUser);
        }
        closeModal();
        loadUserMgmt();
      } else {
        alert((editing ? '保存' : '添加') + '失败：' + (r && r.error ? r.error : '未知错误'));
      }
    } catch (e) {
      alert('操作失败：' + e.message);
    }
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