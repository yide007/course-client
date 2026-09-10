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

  api.onSourcesSynced(() => {
    loadCourses();
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

// ============================================================
//  上传配置管理（独立存储，不干扰源配置）
// ============================================================
async function loadUploadConfigs() {
  const configs = await api.getAllUploadConfigs();
  const container = document.getElementById('upload-config-list');
  if (!configs || !configs.length) {
    container.innerHTML = '<p style="text-align:center;color:#94a3b8;padding:40px;">暂无上传配置，点击右上角添加</p>';
    return;
  }
  container.innerHTML = configs.map((c) => `
    <div class="source-card">
      <div class="source-info">
        <h3>${escapeHtml(c.name || '未命名配置')}</h3>
        <p>域名: ${escapeHtml(c.baseURL || '-')}</p>
        <p>账号: ${escapeHtml(c.username || '-')}</p>
      </div>
      <div class="source-actions">
        <button class="btn btn-primary btn-sm" onclick="editUploadConfig('${c.id}')">✏️</button>
        <button class="btn btn-danger btn-sm" onclick="deleteUploadConfig('${c.id}')">🗑️</button>
      </div>
    </div>`).join('');
}

function showUploadConfigModal(configId) {
  const modal = document.getElementById('modal-container');
  modal.innerHTML = `
    <h2>${configId ? '编辑上传配置' : '添加上传配置'}</h2>
    <div class="form-group"><label>源名称</label><input id="f-uc-name" placeholder="例如：天眼云"></div>
    <div class="form-group"><label>上传域名（视频上传接口地址）</label><input id="f-uc-base" placeholder="例如：https://mac.eyesnews.cn"></div>
    <div class="form-group"><label>登录用户名</label><input id="f-uc-username" placeholder="后台登录账号"></div>
    <div class="form-group"><label>登录密码</label><input id="f-uc-password" type="password" placeholder="后台登录密码"></div>
    <p style="color:#94a3b8;font-size:12px;margin-top:4px;">上传视频时会自动调用 /api/admin/login 获取最新 Token，无需手动填写 Token</p>
    <div class="form-actions">
      <button class="btn btn-secondary" onclick="closeModal()">取消</button>
      <button class="btn btn-primary" id="btn-save-upload-config">保存</button>
    </div>`;

  document.getElementById('modal-overlay').classList.remove('hidden');

  if (configId) {
    api.getAllUploadConfigs().then((configs) => {
      const c = (configs || []).find((x) => String(x.id) === String(configId));
      if (c) {
        document.getElementById('f-uc-name').value = c.name || '';
        document.getElementById('f-uc-base').value = c.baseURL || '';
        document.getElementById('f-uc-username').value = c.username || '';
        document.getElementById('f-uc-password').value = c.password || '';
      }
    });
  }

  document.getElementById('btn-save-upload-config').addEventListener('click', async () => {
    const item = {
      id: configId || undefined,
      name: document.getElementById('f-uc-name').value.trim(),
      baseURL: document.getElementById('f-uc-base').value.trim(),
      username: document.getElementById('f-uc-username').value.trim(),
      password: document.getElementById('f-uc-password').value.trim(),
    };
    if (!item.name) { alert('请输入源名称'); return; }
    if (!item.baseURL) { alert('请输入上传域名'); return; }
    if (!item.username) { alert('请输入登录用户名'); return; }
    if (!item.password) { alert('请输入登录密码'); return; }
    const r = await api.saveUploadConfig(item);
    if (r && r.success) {
      closeModal();
      loadUploadConfigs();
    } else {
      alert('保存失败: ' + ((r && r.error) || '未知错误'));
    }
  });
}

async function editUploadConfig(id) {
  showUploadConfigModal(id);
}

async function deleteUploadConfig(id) {
  if (!(await confirmCustom('确定要删除该上传配置吗？'))) return;
  const r = await api.deleteUploadConfig(id);
  if (r && r.success) {
    loadUploadConfigs();
  } else {
    alert('删除失败: ' + ((r && r.error) || '未知错误'));
  }
}

// ============================================================
//  章节管理
// ============================================================
let currentChapterMgmtCourseId = null;
let chapterMgmtDraft = null;
let chapterMgmtOrigDetail = null;

function _chaptersDeepClone(arr) {
  return JSON.parse(JSON.stringify(arr || []));
}

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
    chapterMgmtOrigDetail = detail;
    chapterMgmtDraft = _chaptersDeepClone(detail.chapters || []);

    function _totals() {
      let L = 0, P = 0;
      (chapterMgmtDraft || []).forEach(ch => {
        L += (ch.lessons || []).length;
        P += (ch.pdfs || []).length;
      });
      return { chapters: (chapterMgmtDraft || []).length, lessons: L, pdfs: P };
    }

    function _ensureSectionsArr(ch) {
      if (!ch.sections) ch.sections = [];
      if (!Array.isArray(ch.sections)) ch.sections = [];
      return ch.sections;
    }

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

    function _renderLessonRow(ch, chIdx, l, lIdx, runningNum) {
      const isFree = l.free || l.isFree;
      const videoUrl = l.videoUrl || l.video_url || l.path || '';
      const safeTitle = escapeHtml(l.title || '未命名课时');
      const safeUrl = escapeHtml(videoUrl);
      return `
      <tr data-chapter-lesson="${chIdx}-${lIdx}" draggable="true" style="cursor:grab;transition:background 0.15s;">
        <td style="width:60px;color:#94a3b8;text-align:center;">
          <span style="cursor:grab;user-select:none;margin-right:4px;">⋮⋮</span>${String(runningNum).padStart(2, '0')}
        </td>
        <td style="min-width:200px;">
          <strong>${safeTitle}</strong>
          ${isFree ? `<span style="margin-left:8px;padding:1px 8px;border-radius:10px;background:#fef3c7;color:#b45309;font-size:11px;">免费</span>` : ''}
        </td>
        <td style="max-width:420px;">
          ${safeUrl ? `<code style="display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:11px;color:#475569;background:#f8fafc;border:1px solid #e2e8f0;border-radius:4px;padding:4px 8px;" title="${safeUrl}">${safeUrl}</code>` : '<span style="color:#94a3b8;">--</span>'}
        </td>
        <td style="width:160px;text-align:center;">
          <button class="btn btn-sm" data-act="edit-lesson" data-ch="${chIdx}" data-idx="${lIdx}" style="padding:4px 10px;font-size:12px;">✏️ 编辑</button>
          <button class="btn btn-sm btn-danger-outline" data-act="del-lesson" data-ch="${chIdx}" data-idx="${lIdx}" style="padding:4px 10px;font-size:12px;margin-left:6px;">🗑 删除</button>
        </td>
      </tr>`;
    }

    function _renderPdfRow(ch, chIdx, p, pIdx) {
      const pname = escapeHtml(p.name || p.path || '未命名资料');
      const purl = escapeHtml(p.url || p.path || '');
      return `
      <tr data-chapter-pdf="${chIdx}-${pIdx}" draggable="true" style="cursor:grab;background:#fafbff;transition:background 0.15s;">
        <td style="width:60px;color:#94a3b8;text-align:center;">
          <span style="cursor:grab;user-select:none;margin-right:4px;">⋮⋮</span>${String(pIdx + 1).padStart(2, '0')}
        </td>
        <td style="min-width:200px;">📄 <strong>${pname}</strong> <span style="color:#94a3b8;font-size:11px;">（资料）</span></td>
        <td style="max-width:420px;">
          ${purl ? `<code style="display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:11px;color:#475569;background:#f8fafc;border:1px solid #e2e8f0;border-radius:4px;padding:4px 8px;" title="${purl}">${purl}</code>` : '<span style="color:#94a3b8;">--</span>'}
        </td>
        <td style="width:160px;text-align:center;">
          <button class="btn btn-sm" data-act="edit-pdf" data-ch="${chIdx}" data-idx="${pIdx}" style="padding:4px 10px;font-size:12px;">✏️ 编辑</button>
          <button class="btn btn-sm btn-danger-outline" data-act="del-pdf" data-ch="${chIdx}" data-idx="${pIdx}" style="padding:4px 10px;font-size:12px;margin-left:6px;">🗑 删除</button>
        </td>
      </tr>`;
    }

    function _render() {
      const T = _totals();
      const tableHeader = `
        <thead>
          <tr style="background:#f8fafc;border-bottom:1px solid #e5e7eb;">
            <th style="padding:10px 16px;text-align:center;font-weight:600;color:#475569;width:60px;">序号</th>
            <th style="padding:10px 16px;text-align:center;font-weight:600;color:#475569;">名称</th>
            <th style="padding:10px 16px;text-align:center;font-weight:600;color:#475569;">链接/路径</th>
            <th style="padding:10px 16px;text-align:center;font-weight:600;color:#475569;width:160px;">操作</th>
          </tr>
        </thead>`;

      const html = `
      <div style="padding:20px;flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;">
        <div style="margin-bottom:16px;display:flex;gap:10px;flex-wrap:wrap;align-items:center;justify-content:space-between;">
          <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;">
            <div style="font-size:14px;font-weight:700;color:#1e293b;">📋 章节与课时管理</div>
            <span style="color:#94a3b8;font-size:12px;">（编辑完成后点击页面右上角「💾 保存修改」写入数据库）</span>
          </div>
          <button id="btn-add-chapter-top" class="btn btn-primary">添加章</button>
        </div>

        ${(chapterMgmtDraft && chapterMgmtDraft.length) ? chapterMgmtDraft.map((ch, chIdx) => {
          const lessons = ch.lessons || [];
          const pdfs = ch.pdfs || [];
          const totalDur = _formatDuration(lessons.reduce((s, l) => s + (Number(l.duration) || 0), 0));
          const sectionOrder = _getSectionOrder(ch);
          const sectionCount = sectionOrder.filter(s => s !== '').length;

          let sectionHtmlParts = '';
          let globalLessonNum = 0;

          sectionOrder.forEach((secTitle, secIdx) => {
            const secLessons = lessons.filter(l => (l.sectionTitle || '') === secTitle);
            const sectionLessonsStartNum = globalLessonNum + 1;

            let secLessonRows = '';
            secLessons.forEach((secL) => {
              const origIdx = lessons.indexOf(secL);
              globalLessonNum++;
              secLessonRows += _renderLessonRow(ch, chIdx, secL, origIdx, globalLessonNum);
            });

            if (secTitle === '') {
              const ungroupedPdfs = pdfs.filter(p => !(p.sectionTitle));
              const ungroupedPdfRows = ungroupedPdfs.map(p => {
                const origIdx = pdfs.indexOf(p);
                return _renderPdfRow(ch, chIdx, p, origIdx);
              }).join('');
              if (secLessonRows || ungroupedPdfRows) {
                sectionHtmlParts += `
                <div data-drop-root="${chIdx}" style="padding:4px 0;border-radius:6px;transition:background 0.15s;">
                  <table style="width:100%;border-collapse:collapse;font-size:13px;">
                    ${tableHeader}
                    <tbody>
                      ${secLessonRows}
                      ${ungroupedPdfRows}
                    </tbody>
                  </table>
                </div>`;
              } else {
                sectionHtmlParts += `
                <div data-drop-root="${chIdx}" style="padding:14px;text-align:center;color:#94a3b8;font-size:12px;border:2px dashed #e2e8f0;border-radius:6px;transition:background 0.15s;">
                  章根区域（拖拽课时/资料到此处可放回未分组）
                </div>`;
              }
            } else {
              const secLessonsCount = secLessons.length;
              const secDur = _formatDuration(secLessons.reduce((s, l) => s + (Number(l.duration) || 0), 0));
              const secPdfs = pdfs.filter(p => (p.sectionTitle || '') === secTitle);
              const secPdfRows = secPdfs.map((p) => {
                const origIdx = pdfs.indexOf(p);
                return _renderPdfRow(ch, chIdx, p, origIdx);
              }).join('');
              const secEmpty = !secLessonRows && !secPdfRows;
              sectionHtmlParts += `
              <div data-section-block="${chIdx}-${secIdx}" data-drop-section="${escapeAttr(secTitle)}" style="margin:10px 18px;border:1px solid #e0e7ff;border-radius:8px;overflow:hidden;background:#fafbff;transition:box-shadow 0.15s,border-color 0.15s;">
                <div style="padding:10px 14px;background:linear-gradient(135deg,#f0f9ff 0%,#eef2ff 100%);display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;border-bottom:1px solid #e0e7ff;">
                  <div style="display:flex;align-items:center;gap:10px;flex:1;min-width:0;">
                    <span style="width:22px;height:22px;border-radius:5px;background:linear-gradient(135deg,#0ea5e9,#6366f1);color:#fff;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex-shrink:0;">${secIdx}</span>
                    <div style="min-width:0;">
                      <div style="font-size:13px;font-weight:600;color:#1e3a8a;">📖 ${escapeHtml(secTitle)}</div>
                      <div style="font-size:11px;color:#64748b;margin-top:1px;">🎬 ${secLessonsCount} 个课时 · 📄 ${secPdfs.length} 份资料 · ⏱ ${secDur}</div>
                    </div>
                  </div>
                  <div style="display:flex;gap:4px;flex-wrap:wrap;">
                    <button class="btn btn-sm" data-act="add-lesson-to-section" data-ch="${chIdx}" data-sec="${escapeAttr(secTitle)}" style="padding:4px 8px;font-size:11px;">🎬 添加课时</button>
                    <button class="btn btn-sm" data-act="batch-upload-to-section" data-ch="${chIdx}" data-sec="${escapeAttr(secTitle)}" style="padding:4px 8px;font-size:11px;background:linear-gradient(135deg,#10b981,#059669);color:#fff;border:none;">📦 批量</button>
                    <button class="btn btn-sm" data-act="add-pdf-to-section" data-ch="${chIdx}" data-sec="${escapeAttr(secTitle)}" style="padding:4px 8px;font-size:11px;">📄 添加资料</button>
                    <button class="btn btn-sm" data-act="edit-section" data-ch="${chIdx}" data-sec="${escapeAttr(secTitle)}" style="padding:4px 8px;font-size:11px;">✏️ 编辑</button>
                    <button class="btn btn-sm" data-act="move-section-up" data-ch="${chIdx}" data-sec="${escapeAttr(secTitle)}" style="padding:4px 6px;background:transparent;border:none;box-shadow:none;" title="上移"><svg viewBox="0 0 1024 1024" width="18" height="18" xmlns="http://www.w3.org/2000/svg"><path d="M893.1584 480.4864L538.6752 63.5136a34.8928 34.8928 0 0 0-53.2224 0L130.8672 480.4864a35.4304 35.4304 0 0 0 26.6752 58.4704h167.3472v358.2464A75.2896 75.2896 0 0 0 399.744 972.8h224.5376a75.2896 75.2896 0 0 0 74.8544-75.5968v-358.144h167.4752a35.5072 35.5072 0 0 0 26.5472-58.5728z" fill="#1296db"></path></svg></button>
                    <button class="btn btn-sm" data-act="move-section-down" data-ch="${chIdx}" data-sec="${escapeAttr(secTitle)}" style="padding:4px 6px;background:transparent;border:none;box-shadow:none;" title="下移"><svg viewBox="0 0 1024 1024" width="18" height="18" xmlns="http://www.w3.org/2000/svg" style="transform:rotate(180deg);"><path d="M893.1584 480.4864L538.6752 63.5136a34.8928 34.8928 0 0 0-53.2224 0L130.8672 480.4864a35.4304 35.4304 0 0 0 26.6752 58.4704h167.3472v358.2464A75.2896 75.2896 0 0 0 399.744 972.8h224.5376a75.2896 75.2896 0 0 0 74.8544-75.5968v-358.144h167.4752a35.5072 35.5072 0 0 0 26.5472-58.5728z" fill="#1296db"></path></svg></button>
                    <button class="btn btn-sm btn-danger-outline" data-act="del-section" data-ch="${chIdx}" data-sec="${escapeAttr(secTitle)}" style="padding:4px 8px;font-size:11px;">🗑 删除</button>
                  </div>
                </div>
                <div style="overflow-x:auto;">
                  <table style="width:100%;border-collapse:collapse;font-size:13px;">
                    ${tableHeader}
                    <tbody>
                      ${secLessonRows}
                      ${secPdfRows}
                      ${secEmpty ? `<tr><td colspan="4" style="padding:14px;text-align:center;color:#94a3b8;font-size:12px;">该节暂无内容，拖拽课时/资料到此处，或点击上方「🎬 添加课时」开始创建</td></tr>` : ''}
                    </tbody>
                  </table>
                </div>
              </div>`;
            }
          });

          const hasContent = sectionHtmlParts;
          const emptyTip = !hasContent
            ? `<tr><td colspan="4" style="padding:24px;text-align:center;color:#94a3b8;">该章节暂无课时和资料，点击上方「📖 添加节」或「🎬 添加课时」开始创建</td></tr>`
            : '';

          return `
          <div class="chapter-mgmt-block" style="margin-bottom:20px;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;background:#fff;">
            <div class="chapter-mgmt-header" style="padding:12px 18px;background:linear-gradient(135deg,#eef2ff 0%,#ede9fe 100%);display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #e5e7eb;gap:12px;flex-wrap:wrap;">
              <div style="display:flex;align-items:center;gap:12px;flex:1;min-width:0;">
                <span style="width:28px;height:28px;border-radius:7px;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;flex-shrink:0;">${chIdx + 1}</span>
                <div style="min-width:0;">
                  <div style="font-size:15px;font-weight:700;color:#1e1b4b;">${escapeHtml(ch.title || `第${chIdx + 1}章`)}</div>
                  <div style="font-size:12px;color:#64748b;margin-top:2px;">
                    📖 ${sectionCount} 节 · 🎬 ${lessons.length} 个课时 · 📄 ${pdfs.length} 份资料 · ⏱ ${totalDur}
                  </div>
                </div>
              </div>
              <div style="display:flex;gap:6px;flex-wrap:wrap;">
                <button class="btn btn-sm" data-act="add-section" data-ch="${chIdx}" style="padding:6px 12px;font-size:12px;background:linear-gradient(135deg,#0ea5e9,#6366f1);color:#fff;border:none;">📖 添加节</button>
                <button class="btn btn-sm" data-act="add-lesson" data-ch="${chIdx}" style="padding:6px 12px;font-size:12px;">🎬 添加课时</button>
                <button class="btn btn-sm" data-act="batch-upload" data-ch="${chIdx}" style="padding:6px 12px;font-size:12px;background:linear-gradient(135deg,#10b981,#059669);color:#fff;border:none;">📦 批量上传</button>
                <button class="btn btn-sm" data-act="add-pdf" data-ch="${chIdx}" style="padding:6px 12px;font-size:12px;">📄 添加资料</button>
                <button class="btn btn-sm" data-act="edit-chapter" data-ch="${chIdx}" style="padding:6px 12px;font-size:12px;">✏️ 编辑</button>
                <button class="btn btn-sm" data-act="move-chapter-up" data-ch="${chIdx}" style="padding:4px 6px;background:transparent;border:none;box-shadow:none;" title="上移"><svg viewBox="0 0 1024 1024" width="18" height="18" xmlns="http://www.w3.org/2000/svg"><path d="M893.1584 480.4864L538.6752 63.5136a34.8928 34.8928 0 0 0-53.2224 0L130.8672 480.4864a35.4304 35.4304 0 0 0 26.6752 58.4704h167.3472v358.2464A75.2896 75.2896 0 0 0 399.744 972.8h224.5376a75.2896 75.2896 0 0 0 74.8544-75.5968v-358.144h167.4752a35.5072 35.5072 0 0 0 26.5472-58.5728z" fill="#1296db"></path></svg></button>
                <button class="btn btn-sm" data-act="move-chapter-down" data-ch="${chIdx}" style="padding:4px 6px;background:transparent;border:none;box-shadow:none;" title="下移"><svg viewBox="0 0 1024 1024" width="18" height="18" xmlns="http://www.w3.org/2000/svg" style="transform:rotate(180deg);"><path d="M893.1584 480.4864L538.6752 63.5136a34.8928 34.8928 0 0 0-53.2224 0L130.8672 480.4864a35.4304 35.4304 0 0 0 26.6752 58.4704h167.3472v358.2464A75.2896 75.2896 0 0 0 399.744 972.8h224.5376a75.2896 75.2896 0 0 0 74.8544-75.5968v-358.144h167.4752a35.5072 35.5072 0 0 0 26.5472-58.5728z" fill="#1296db"></path></svg></button>
                <button class="btn btn-sm btn-danger-outline" data-act="del-chapter" data-ch="${chIdx}" style="padding:6px 12px;font-size:12px;">🗑 删除章节</button>
              </div>
            </div>
            ${emptyTip ? `<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:13px;">${tableHeader}<tbody>${emptyTip}</tbody></table></div>` : ''}
            ${sectionHtmlParts}
          </div>`;
        }).join('') : `<div class="empty-state"><p style="text-align:center;color:#94a3b8;padding:60px 20px 20px;">该课程暂无章节</p>
          <div style="text-align:center;padding-bottom:40px;"><button id="btn-add-chapter-empty" class="btn btn-primary">＋ 添加第一个章节</button></div>
        </div>`}

        <div style="padding:18px 24px;border:2px dashed #cbd5e1;border-radius:12px;background:#fafbff;margin-bottom:24px;display:flex;gap:12px;flex-wrap:wrap;align-items:center;justify-content:space-between;">
          <div>
            <div style="font-weight:700;color:#334155;margin-bottom:4px;">💡 提示</div>
            <div style="font-size:12px;color:#64748b;">修改完成后，请点击页面右上角「💾 保存修改」将章节（章/节/课时/资料）写入数据库。</div>
          </div>
          <div style="font-size:12px;color:#64748b;text-align:right;">
            <div style="margin-bottom:2px;">当前草稿</div>
            <div style="font-weight:600;color:#334155;">📚 ${T.chapters} 章 · 🎬 ${T.lessons} 课时 · 📄 ${T.pdfs} 资料</div>
          </div>
        </div>
      </div>`;

      const container = document.getElementById('course-management');
      if (!container) return;
      container.innerHTML = html;
      _bindChapterMgmtEvents();
      _updateHeaderStats();
    }

    function _updateHeaderStats() {
      const T = _totals();
      const statsBar = document.getElementById('chapters-mgmt-stats');
      if (statsBar) {
        const boxes = statsBar.querySelectorAll('[data-stat-box]');
        if (boxes.length >= 3) {
          boxes[0].textContent = `📚 ${T.chapters} 章`;
          boxes[1].textContent = `🎬 ${T.lessons} 个课时`;
          boxes[2].textContent = `📄 ${T.pdfs} 份资料`;
        }
      }
    }

    function _openChapterModal({ title = '', chIdx = null } = {}) {
      const modal = document.getElementById('modal-container');
      const overlay = document.getElementById('modal-overlay');
      modal.innerHTML = `
        <div class="modal-box">
          <h2 style="margin:0 0 16px 0;font-size:18px;">${chIdx == null ? '添加章' : '✏️ 编辑章名称'}</h2>
          <div class="form-group">
            <label>章节名称 *</label>
            <input id="modal-chapter-title" placeholder="例如：第一章 基础知识" value="${escapeAttr(title)}">
          </div>
          <div class="form-actions">
            <button class="btn btn-secondary" onclick="closeModal()">取消</button>
            <button class="btn btn-primary" id="modal-chapter-ok">确定</button>
          </div>
        </div>`;
      overlay.classList.remove('hidden');
      document.getElementById('modal-chapter-ok').onclick = () => {
        const v = document.getElementById('modal-chapter-title').value.trim();
        if (!v) { alert('请输入章节名称'); return; }
        if (chIdx == null) {
          chapterMgmtDraft = chapterMgmtDraft || [];
          chapterMgmtDraft.push({
            id: 'ch_' + Date.now() + '_' + Math.floor(Math.random() * 1e6),
            title: v,
            sections: [],
            lessons: [],
            pdfs: [],
          });
        } else {
          chapterMgmtDraft[chIdx].title = v;
        }
        closeModal();
        _render();
      };
    }

    function _sectionExistsByName(ch, name) {
      if (!name) return false;
      const sections = _ensureSectionsArr(ch);
      if (sections.indexOf(name) !== -1) return true;
      const lessons = ch.lessons || [];
      return lessons.some(l => (l.sectionTitle || '') === name);
    }

    function _openSectionModal({ chIdx, oldTitle = null } = {}) {
      const ch = chapterMgmtDraft[chIdx];
      if (!ch) return;
      const isEdit = oldTitle != null;
      const sectionsArr = _ensureSectionsArr(ch);
      const modal = document.getElementById('modal-container');
      const overlay = document.getElementById('modal-overlay');
      modal.innerHTML = `
        <div class="modal-box">
          <h2 style="margin:0 0 16px 0;font-size:18px;">${isEdit ? '✏️ 编辑节名称' : '📖 添加节'}</h2>
          <div class="form-group">
            <label>节名称 *</label>
            <input id="modal-section-title" placeholder="例如：1.1 操作系统的基本概念" value="${isEdit ? escapeAttr(oldTitle || '') : ''}">
          </div>
          ${isEdit ? `
          <div style="padding:10px 14px;background:#fef3c7;border-radius:8px;font-size:12px;color:#92400e;margin-bottom:12px;">
            ⚠️ 修改节名称后，该节下所有课时会被归入新节名
          </div>` : ''}
          <div class="form-actions">
            <button class="btn btn-secondary" onclick="closeModal()">取消</button>
            <button class="btn btn-primary" id="modal-section-ok">确定</button>
          </div>
        </div>`;
      overlay.classList.remove('hidden');
      document.getElementById('modal-section-ok').onclick = async () => {
        const newTitle = document.getElementById('modal-section-title').value.trim();
        if (!newTitle) { alert('请输入节名称'); return; }
        const lessons = ch.lessons || [];
        if (!isEdit) {
          if (_sectionExistsByName(ch, newTitle)) { alert('该节名称已存在，请使用其他名称'); return; }
          if (!(await confirmCustom(`确认添加新节「${newTitle}」？\n（后续可通过「🎬 添加课时」或「📄 添加资料」按钮向该节添加内容）`))) return;
          sectionsArr.push(newTitle);
        } else {
          if (oldTitle !== newTitle) {
            if (_sectionExistsByName(ch, newTitle)) { alert('该节名称已存在，请使用其他名称'); return; }
            if (!(await confirmCustom(`确认将「${oldTitle}」改名为「${newTitle}」？\n该节下所有课时和资料将被归入新名称。`))) return;
            const si = sectionsArr.indexOf(oldTitle);
            if (si !== -1) sectionsArr[si] = newTitle;
            lessons.forEach((l) => {
              if ((l.sectionTitle || '') === oldTitle) l.sectionTitle = newTitle;
            });
            (ch.pdfs || []).forEach((p) => {
              if ((p.sectionTitle || '') === oldTitle) p.sectionTitle = newTitle;
            });
          }
        }
        closeModal();
        _render();
      };
    }

    async function _addLessonFlow({ chIdx, sectionTitle = null } = {}) {
      try {
        const r = await api.pickVideoFile();
        if (!r || r.canceled) return;
        if (!r || !r.success || !r.localPath) { alert('选择视频失败：' + (r?.error || '未知原因')); return; }
        const localPath = r.localPath;
        const fileName = localPath.split(/[\\/]/).pop() || '';
        const autoTitle = fileName.replace(/\.[^.]+$/, '');
        _openLessonModal({ chIdx, sectionTitle, autoTitle, autoUploadPath: localPath });
      } catch (e) {
        alert('选择视频失败：' + (e.message || e));
      }
    }

    async function _batchUploadFlow({ chIdx, sectionTitle = null } = {}) {
      const ch = chapterMgmtDraft[chIdx];
      if (!ch) return;
      try {
        const pickR = await api.pickVideoFiles();
        if (!pickR || pickR.canceled) return;
        if (!pickR || !pickR.success || !pickR.files || pickR.files.length === 0) {
          alert('选择视频失败：' + (pickR?.error || '未知原因'));
          return;
        }

        let token = null, baseURL = null, uploadCfgId = null, uploadCfg = null;
        try {
          uploadCfg = await api.getUploadToken();
          if (uploadCfg) {
            token = uploadCfg.token || null;
            baseURL = uploadCfg.baseURL || null;
            uploadCfgId = uploadCfg.id || null;
          }
        } catch (_) {}

        if (!token && !(uploadCfg && uploadCfg.username && uploadCfg.password && uploadCfg.baseURL)) {
          alert('未配置上传信息。\n请在左侧导航栏"📤 上传配置"中填写域名、用户名和密码');
          return;
        }

        if (!token) {
          const loginR = await api.loginAndGetToken(uploadCfg.baseURL, uploadCfg.username, uploadCfg.password);
          if (loginR && loginR.success && loginR.token) {
            token = loginR.token;
            if (uploadCfgId) api.saveUploadToken(uploadCfgId, token).catch(() => {});
          } else {
            alert('自动登录失败：' + (loginR?.error || '未知原因') + '\n请检查 📤 上传配置');
            return;
          }
        }

        const files = pickR.files;
        const totalFiles = files.length;
        let doneCount = 0, successCount = 0, failCount = 0;
        let totalSize = files.reduce((s, f) => s + (f.size || 0), 0);

        const modal = document.getElementById('modal-container');
        const overlay = document.getElementById('modal-overlay');
        const fileItemsHtml = files.map((f, i) => {
          const mb = ((f.size || 0) / 1048576).toFixed(1);
          return `<div class="batch-file-item" data-idx="${i}" style="padding:8px 12px;border-radius:8px;background:#f8fafc;border:1px solid #e2e8f0;margin-bottom:6px;font-size:12px;">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
              <span class="batch-file-status" style="font-size:14px;">⏳</span>
              <span class="batch-file-name" style="flex:1;color:#334155;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(f.name)}</span>
              <span style="color:#64748b;flex-shrink:0;">${mb}MB</span>
            </div>
            <div class="batch-file-bar" style="height:4px;background:#e2e8f0;border-radius:2px;overflow:hidden;">
              <div class="batch-file-bar-fill" style="height:100%;width:0%;background:#94a3b8;border-radius:2px;transition:width .2s;"></div>
            </div>
            <div class="batch-file-msg" style="margin-top:3px;font-size:11px;color:#94a3b8;">等待中...</div>
          </div>`;
        }).join('');

        const fixedSecDisplay = sectionTitle
          ? `<div style="font-size:12px;color:#1d4ed8;background:#eff6ff;padding:4px 10px;border-radius:6px;display:inline-block;margin-bottom:12px;">📖 将添加到「${escapeHtml(sectionTitle)}」</div>`
          : `<div style="font-size:12px;color:#64748b;background:#f1f5f9;padding:4px 10px;border-radius:6px;display:inline-block;margin-bottom:12px;">📚 将添加到章级（${escapeHtml(ch.title || '')}）</div>`;

        modal.innerHTML = `
          <div class="modal-box" style="max-width:640px;">
            <h2 style="margin:0 0 8px 0;font-size:18px;">📦 批量上传视频（${totalFiles} 个文件）</h2>
            ${fixedSecDisplay}
            <div style="padding:12px 16px;background:linear-gradient(135deg,#f0f9ff 0%,#fef3c7 100%);border-radius:10px;margin-bottom:14px;border:1px solid #fed7aa;">
              <div style="display:flex;justify-content:space-between;margin-bottom:8px;font-size:13px;">
                <span class="batch-summary-text" style="font-weight:600;color:#334155;">总进度</span>
                <span class="batch-summary-num" style="font-weight:700;color:#334155;">0 / ${totalFiles}</span>
              </div>
              <div style="height:8px;background:#e2e8f0;border-radius:4px;overflow:hidden;">
                <div class="batch-total-bar" style="height:100%;width:0%;background:linear-gradient(90deg,#10b981,#059669);border-radius:4px;transition:width .25s;"></div>
              </div>
              <div style="margin-top:8px;font-size:11px;color:#64748b;">
                <span class="batch-total-info">${(totalSize / 1048576).toFixed(1)}MB · 串行上传</span>
                <span style="float:right;" class="batch-speed-info"></span>
              </div>
            </div>
            <div style="max-height:300px;overflow-y:auto;">${fileItemsHtml}</div>
            <div style="display:flex;justify-content:flex-end;margin-top:14px;gap:10px;">
              <button class="btn btn-secondary batch-cancel-btn" style="padding:6px 16px;font-size:13px;">取消</button>
            </div>
          </div>`;
        overlay.classList.remove('hidden');

        let canceled = false;
        const cancelBtn = modal.querySelector('.batch-cancel-btn');
        if (cancelBtn) {
          cancelBtn.onclick = async () => {
            if (!(await confirmCustom('确定取消批量上传？已上传的视频会自动添加为课时。'))) return;
            canceled = true;
            cancelBtn.textContent = '取消中...';
            cancelBtn.disabled = true;
          };
        }

        const updateItem = (idx, status, pct, msg) => {
          const el = modal.querySelector(`.batch-file-item[data-idx="${idx}"]`);
          if (!el) return;
          const statusEl = el.querySelector('.batch-file-status');
          const barFill = el.querySelector('.batch-file-bar-fill');
          const msgEl = el.querySelector('.batch-file-msg');
          if (statusEl) statusEl.textContent = status;
          if (barFill) {
            const p = Math.max(0, Math.min(100, pct || 0));
            barFill.style.width = p + '%';
            if (status === '✅') barFill.style.background = '#10b981';
            else if (status === '❌') barFill.style.background = '#ef4444';
            else if (status === '🔑' || status === '⏳' || status === '📤' || status === '🗂️') barFill.style.background = '#3b82f6';
          }
          if (msgEl && msg != null) msgEl.textContent = msg;
        };

        const updateSummary = () => {
          const numEl = modal.querySelector('.batch-summary-num');
          const barEl = modal.querySelector('.batch-total-bar');
          const infoEl = modal.querySelector('.batch-total-info');
          const pct = totalFiles > 0 ? Math.round((doneCount / totalFiles) * 100) : 0;
          if (numEl) numEl.textContent = `${successCount} 成功 · ${failCount} 失败 · ${doneCount}/${totalFiles}`;
          if (barEl) barEl.style.width = pct + '%';
          if (infoEl) infoEl.textContent = `共 ${(totalSize / 1048576).toFixed(1)}MB`;
        };

        const _ensureSectionsArr = (c) => {
          if (!c.sections) c.sections = [];
          if (!Array.isArray(c.sections)) c.sections = [];
          return c.sections;
        };

        for (let i = 0; i < files.length; i++) {
          if (canceled) {
            updateItem(i, '⏸', 0, '已取消');
            doneCount++;
            updateSummary();
            continue;
          }
          const file = files[i];
          const fileName = file.name;
          const nameNoExt = fileName.replace(/\.[^.]+$/, '');
          let uploadOff = null;

          try {
            updateItem(i, '⏳', 0, '准备上传...');
            const doUpload = async (tk, bURL) => await api.uploadVideoFile(file.localPath, tk, bURL);

            uploadOff = api.onUploadVideoProgress && api.onUploadVideoProgress((info) => {
              if (!info || info.fileName !== fileName && info.fileName && fileName && !fileName.includes(info.fileName)) return;
              if (info.fileName && fileName && info.fileName !== fileName) {
                const n1 = fileName.toLowerCase();
                const n2 = info.fileName.toLowerCase();
                if (n1 !== n2) return;
              }
              const pct = Math.max(0, Math.min(100, parseInt(info.percent || '0', 10)));
              let stage = '⏳ 处理中';
              if (info.stage === 'uploading') {
                if (info.bytesTotal) {
                  const mbSent = (info.bytesSent / 1048576).toFixed(1);
                  const mbTotal = (info.bytesTotal / 1048576).toFixed(1);
                  stage = `📤 上传中 ${mbSent}/${mbTotal}MB`;
                } else {
                  stage = '📤 上传中';
                }
                updateItem(i, '📤', pct, stage);
              } else if (info.stage === 'processing') {
                updateItem(i, '🗂️', pct, '🗂️ 服务端处理中...');
              } else if (info.stage === 'done') {
                updateItem(i, '✅', 100, '上传成功');
              } else {
                updateItem(i, '⏳', pct, stage);
              }
            });

            let result = await doUpload(token, baseURL);

            if (uploadOff) { try { uploadOff(); } catch(_) {} uploadOff = null; }

            if (!result || !result.success) {
              const expired = result && (result.code === 5001 || result.code === 401 || (result.error && /过期|expired|token/i.test(result.error)));
              if (expired && uploadCfg && uploadCfg.username && uploadCfg.password && uploadCfg.baseURL) {
                updateItem(i, '🔑', 0, 'Token 过期，重新登录...');
                const loginR = await api.loginAndGetToken(uploadCfg.baseURL, uploadCfg.username, uploadCfg.password);
                if (loginR && loginR.success && loginR.token) {
                  token = loginR.token;
                  if (uploadCfgId) api.saveUploadToken(uploadCfgId, token).catch(() => {});

                  uploadOff = api.onUploadVideoProgress && api.onUploadVideoProgress((info) => {
                    if (!info) return;
                    const pct = Math.max(0, Math.min(100, parseInt(info.percent || '0', 10)));
                    if (info.stage === 'uploading') {
                      updateItem(i, '📤', pct, `📤 重新上传中 ${pct}%`);
                    } else if (info.stage === 'processing') {
                      updateItem(i, '🗂️', pct, '🗂️ 服务端处理中...');
                    } else if (info.stage === 'done') {
                      updateItem(i, '✅', 100, '上传成功');
                    }
                  });

                  result = await doUpload(token, baseURL);
                  if (uploadOff) { try { uploadOff(); } catch(_) {} uploadOff = null; }
                }
              }
            }

            if (result && result.success) {
              const d = result.data || {};
              const videoUrl = d.ossUrl || d.url || '';
              updateItem(i, '✅', 100, '✅ 上传成功');

              const lessonId = 'l_' + Date.now() + '_' + Math.floor(Math.random() * 1e6);
              const lesson = {
                id: lessonId,
                title: nameNoExt || fileName,
                videoUrl: videoUrl,
                path: videoUrl,
                videoUrlLocal: file.localPath,
                duration: 0,
                free: false,
                sectionTitle: sectionTitle || '',
              };

              if (sectionTitle) {
                const secArr = _ensureSectionsArr(ch);
                if (secArr.indexOf(sectionTitle) === -1) secArr.push(sectionTitle);
                if (!Array.isArray(ch.sectionOrders)) ch.sectionOrders = ['', ...secArr];
              }

              if (!Array.isArray(ch.lessons)) ch.lessons = [];
              ch.lessons.push(lesson);

              successCount++;
            } else {
              const errMsg = result?.error || '上传失败';
              updateItem(i, '❌', 0, '❌ ' + errMsg);
              failCount++;
            }
          } catch (e) {
            if (uploadOff) { try { uploadOff(); } catch(_) {} uploadOff = null; }
            updateItem(i, '❌', 0, '❌ ' + (e.message || String(e)));
            failCount++;
          }

          doneCount++;
          updateSummary();
          _render();

          if (canceled) break;
        }

        const cancelBtn2 = modal.querySelector('.batch-cancel-btn');
        if (cancelBtn2) {
          cancelBtn2.textContent = '关闭';
          cancelBtn2.disabled = false;
          cancelBtn2.onclick = () => {
            closeModal();
            _render();
          };
        }

        updateSummary();

        if (failCount === 0 && !canceled) {
          setTimeout(() => {
            alert(`✅ 批量上传完成！\n${successCount} 个视频全部上传成功\n已自动添加到章节「${ch.title || ''}」${sectionTitle ? ' → 节「' + sectionTitle + '」' : ''}`);
          }, 300);
        } else if (canceled) {
          setTimeout(() => {
            alert(`⏸ 批量上传已停止\n已完成：${successCount} 成功 / ${failCount} 失败`);
          }, 300);
        } else {
          setTimeout(() => {
            alert(`⚠️ 批量上传完成\n成功：${successCount} 个\n失败：${failCount} 个\n已自动添加成功的视频到章节`);
          }, 300);
        }
      } catch (e) {
        alert('批量上传失败：' + (e.message || e));
      }
    }

    function _openLessonModal({ chIdx, lessonIdx = null, sectionTitle = null, autoTitle = null, autoUploadPath = null } = {}) {
      const ch = chapterMgmtDraft[chIdx];
      if (!ch) return;
      const item = lessonIdx == null ? { title: '', videoUrl: '', duration: 0, free: false } : (ch.lessons[lessonIdx] || {});
      // 所属节：固定值。章点进来=章级；节点进来=该节；编辑时=原所属节；不需要用户选
      const fixedSec = (lessonIdx != null) ? (item.sectionTitle || '')
                      : (sectionTitle != null ? String(sectionTitle) : '');
      let defaultTitle = item.title || '';
      if (lessonIdx == null && !defaultTitle) {
        defaultTitle = autoTitle || (fixedSec ? fixedSec : (ch.title || ''));
      } else if (autoTitle && lessonIdx == null) {
        defaultTitle = autoTitle;
      }
      // 所属节只读显示标签（不再给下拉选择）
      const sectionTagHtml = fixedSec
        ? `<div class="form-group">
             <div style="display:block;font-size:13px;font-weight:600;margin-bottom:4px;color:#475569;">归属</div>
             <div style="display:inline-flex;align-items:center;gap:6px;padding:8px 12px;border:1px solid #e2e8f0;border-radius:8px;background:#eff6ff;color:#1d4ed8;font-size:13px;font-weight:600;">📖 ${escapeHtml(fixedSec)}</div>
           </div>`
        : `<div class="form-group">
             <div style="display:block;font-size:13px;font-weight:600;margin-bottom:4px;color:#475569;">归属</div>
             <div style="display:inline-flex;align-items:center;gap:6px;padding:8px 12px;border:1px solid #e2e8f0;border-radius:8px;background:#f8fafc;color:#334155;font-size:13px;font-weight:600;">📚 章级（${escapeHtml(ch.title || '')}）</div>
           </div>`;
      const modal = document.getElementById('modal-container');
      const overlay = document.getElementById('modal-overlay');
      modal.innerHTML = `
        <div class="modal-box">
          <h2 style="margin:0 0 16px 0;font-size:18px;">${lessonIdx == null ? '🎬 添加课时' : '✏️ 编辑课时'}</h2>
          <div class="form-group">
            <label>课时名称 *</label>
            <input id="modal-lesson-title" placeholder="例如：1.1 课程介绍" value="${escapeAttr(defaultTitle)}">
          </div>
          ${sectionTagHtml}
          <div class="form-group">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
              <label style="margin:0;">视频地址 *</label>
              <button type="button" class="btn btn-sm" id="btn-pick-video" style="padding:4px 10px;font-size:12px;line-height:1.6;">📁 选择视频</button>
            </div>
            <input type="text" id="modal-lesson-url" placeholder="http(s):// 或本地文件完整路径" value="${escapeAttr(item.videoUrl || item.path || '')}" style="position:relative;z-index:2;">
          </div>
          <div style="position:relative;z-index:1;display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;padding:4px 0;">
            <div style="font-size:13px;color:#334155;font-weight:600;">免费试看</div>
            <label class="toggle-switch" style="margin:0;">
              <input id="modal-lesson-free" type="checkbox" ${item.free || item.isFree ? 'checked' : ''}>
              <span class="toggle-slider"></span>
            </label>
          </div>
          <div class="form-actions">
            <button class="btn btn-secondary" onclick="closeModal()">取消</button>
            <button class="btn btn-primary" id="modal-lesson-ok">确定</button>
          </div>
        </div>`;
      overlay.classList.remove('hidden');
      const pickVideoBtn = document.getElementById('btn-pick-video');
      let uploadOff = null;
      const setBtnState = (text, disabled, cursor='not-allowed') => {
        if (pickVideoBtn) {
          pickVideoBtn.textContent = text;
          pickVideoBtn.disabled = !!disabled;
          pickVideoBtn.style.cursor = disabled ? cursor : 'pointer';
          pickVideoBtn.style.opacity = disabled ? '0.7' : '1';
        }
      };
      if (uploadOff) { try { uploadOff(); } catch(_) {} uploadOff = null; }
      if (autoUploadPath && pickVideoBtn) {
        try { pickVideoBtn.dataset.presetPath = autoUploadPath; } catch(_) {}
      }
      if (pickVideoBtn) {
        pickVideoBtn.onclick = async function () {
          if (pickVideoBtn.disabled) return;
          try {
            let localPath = null;
            const preset = pickVideoBtn && pickVideoBtn.dataset ? pickVideoBtn.dataset.presetPath : null;
            if (preset) {
              try { delete pickVideoBtn.dataset.presetPath; } catch(_) { try { pickVideoBtn.dataset.presetPath = ''; } catch(_) {} }
              localPath = preset;
            } else {
              const r = await api.pickVideoFile();
              if (!r || r.canceled) return;
              if (!r || !r.success || !r.localPath) { alert('选择视频失败：' + (r?.error || '未知原因')); return; }
              localPath = r.localPath;
            }

            const fileName = localPath.split(/[\\/]/).pop() || '';
            const nameNoExt = fileName.replace(/\.[^.]+$/, '');

            const urlInput = document.getElementById('modal-lesson-url');
            const titleInput = document.getElementById('modal-lesson-title');

            const handleUploadSuccess = (result, urlInput, titleInput, nameNoExt, fixedSec) => {
              const d = result.data || {};
              if (urlInput) {
                urlInput.value = d.ossUrl || d.url || '';
                urlInput.focus();
              }
              if (titleInput && nameNoExt) {
                const cur = (titleInput.value || '').trim();
                if (!cur || /^(课时\d+|第.+[节课时]|chapter|lesson)$/i.test(cur) || cur === (fixedSec || '')) {
                  titleInput.value = nameNoExt;
                }
              }
            };

            let token = null, baseURL = null, uploadCfgId = null;
            let uploadCfg = null;
            try {
              uploadCfg = await api.getUploadToken();
              if (uploadCfg) {
                token = uploadCfg.token || null;
                baseURL = uploadCfg.baseURL || null;
                uploadCfgId = uploadCfg.id || null;
              }
            } catch (_) {}

            if (!token && !(uploadCfg && uploadCfg.username && uploadCfg.password && uploadCfg.baseURL)) {
              alert('未配置上传信息。\n请在左侧导航栏"📤 上传配置"中填写域名、用户名和密码');
              setBtnState('📁 选择视频', false, 'pointer');
              return;
            }

            // 上传函数（带自动重试）
            const doUpload = async (tk, bURL) => {
              return await api.uploadVideoFile(localPath, tk, bURL);
            };

            // 先尝试缓存 token
            if (token) {
              setBtnState('📤 准备中 0%', true);
              if (uploadOff) { try { uploadOff(); } catch(_) {} uploadOff = null; }
              uploadOff = api.onUploadVideoProgress && api.onUploadVideoProgress((info) => {
                if (!info) return;
                const pct = Math.max(0, Math.min(100, parseInt(info.percent || '0', 10)));
                let stageText = '⏳ 处理中';
                if (info.stage === 'reading') stageText = '📖 读取文件';
                else if (info.stage === 'uploading') {
                  let extra = '';
                  if (info.bytesTotal) {
                    const mbSent = (info.bytesSent / 1048576).toFixed(1);
                    const mbTotal = (info.bytesTotal / 1048576).toFixed(0);
                    extra = ` ${mbSent}/${mbTotal}MB`;
                  }
                  stageText = '📤 上传中' + extra;
                }
                else if (info.stage === 'processing') stageText = '🗂️ 服务端处理中';
                else if (info.stage === 'done') stageText = '✅ 完成';
                setBtnState(`${stageText} ${pct}%`, true);
              });

              let result = await doUpload(token, baseURL);
              if (uploadOff) { try { uploadOff(); } catch(_) {} uploadOff = null; }

              if (result && result.success) {
                setBtnState('📁 选择视频', false, 'pointer');
                return handleUploadSuccess(result, urlInput, titleInput, nameNoExt, fixedSec);
              }

              const expired = result && (result.code === 5001 || result.code === 401 || (result.error && /过期|expired|token/i.test(result.error)));
              if (expired && uploadCfg && uploadCfg.username && uploadCfg.password && uploadCfg.baseURL) {
                // Token 过期，自动登录换新 token
                setBtnState('🔑 Token过期，重新登录中...', true);
                const loginR = await api.loginAndGetToken(uploadCfg.baseURL, uploadCfg.username, uploadCfg.password);
                if (loginR && loginR.success && loginR.token) {
                  token = loginR.token;
                  // 保存新 token 到配置
                  if (uploadCfgId) api.saveUploadToken(uploadCfgId, token).catch(() => {});
                  // 重试上传
                  if (uploadOff) { try { uploadOff(); } catch(_) {} uploadOff = null; }
                  uploadOff = api.onUploadVideoProgress && api.onUploadVideoProgress((info) => {
                    if (!info) return;
                    const pct = Math.max(0, Math.min(100, parseInt(info.percent || '0', 10)));
                    let stageText = '📤 上传中';
                    if (info.stage === 'processing') stageText = '🗂️ 服务端处理中';
                    else if (info.stage === 'done') stageText = '✅ 完成';
                    setBtnState(`${stageText} ${pct}%`, true);
                  });
                  result = await doUpload(token, baseURL);
                  if (uploadOff) { try { uploadOff(); } catch(_) {} uploadOff = null; }
                  setBtnState('📁 选择视频', false, 'pointer');
                  if (result && result.success) {
                    return handleUploadSuccess(result, urlInput, titleInput, nameNoExt, fixedSec);
                  }
                } else {
                  alert('Token已过期，自动登录失败：' + (loginR?.error || '未知原因') + '\n请检查 📤 上传配置 中的用户名和密码');
                  setBtnState('📁 选择视频', false, 'pointer');
                  return;
                }
              }

              const msg = result?.detail
                ? '上传视频失败：' + (result?.error || '未知原因') + '\n\n--- 服务器响应详情 ---\n' + result.detail
                : '上传视频失败：' + (result?.error || '未知原因');
              alert(msg);
              setBtnState('📁 选择视频', false, 'pointer');
              return;
            }

            // 无缓存 token，首次登录
            setBtnState('🔑 登录中...', true);
            const loginR = await api.loginAndGetToken(uploadCfg.baseURL, uploadCfg.username, uploadCfg.password);
            if (loginR && loginR.success && loginR.token) {
              token = loginR.token;
              if (uploadCfgId) api.saveUploadToken(uploadCfgId, token).catch(() => {});
            } else {
              alert('自动登录失败：' + (loginR?.error || '未知原因') + '\n请检查 📤 上传配置 中的用户名和密码');
              setBtnState('📁 选择视频', false, 'pointer');
              return;
            }

            setBtnState('📤 准备中 0%', true);
            if (uploadOff) { try { uploadOff(); } catch(_) {} uploadOff = null; }
            uploadOff = api.onUploadVideoProgress && api.onUploadVideoProgress((info) => {
              if (!info) return;
              const pct = Math.max(0, Math.min(100, parseInt(info.percent || '0', 10)));
              let stageText = '⏳ 处理中';
              if (info.stage === 'reading') stageText = '📖 读取文件';
              else if (info.stage === 'uploading') {
                let extra = '';
                if (info.bytesTotal) {
                  const mbSent = (info.bytesSent / 1048576).toFixed(1);
                  const mbTotal = (info.bytesTotal / 1048576).toFixed(0);
                  extra = ` ${mbSent}/${mbTotal}MB`;
                }
                stageText = '📤 上传中' + extra;
              }
              else if (info.stage === 'processing') stageText = '🗂️ 服务端处理中';
              else if (info.stage === 'done') stageText = '✅ 完成';
              setBtnState(`${stageText} ${pct}%`, true);
            });

            const result = await doUpload(token, baseURL);
            if (uploadOff) { try { uploadOff(); } catch(_) {} uploadOff = null; }
            setBtnState('📁 选择视频', false, 'pointer');

            if (!result || !result.success) {
              const msg = result?.detail
                ? '上传视频失败：' + (result?.error || '未知原因') + '\n\n--- 服务器响应详情 ---\n' + result.detail
                : '上传视频失败：' + (result?.error || '未知原因');
              alert(msg);
              return;
            }

            return handleUploadSuccess(result, urlInput, titleInput, nameNoExt, fixedSec);
          } catch (e) {
            if (uploadOff) { try { uploadOff(); } catch(_) {} uploadOff = null; }
            setBtnState('📁 选择视频', false, 'pointer');
            alert('上传视频失败：' + (e.message || e));
          }
        };
      }
      if (autoUploadPath && pickVideoBtn && typeof pickVideoBtn.onclick === 'function') {
        setTimeout(() => {
          try {
            const urlInput = document.getElementById('modal-lesson-url');
            if (urlInput && !urlInput.value) urlInput.value = autoUploadPath;
            pickVideoBtn.onclick();
          } catch (_) {}
        }, 50);
      }
      document.getElementById('modal-lesson-ok').onclick = () => {
        const title = document.getElementById('modal-lesson-title').value.trim();
        const url = document.getElementById('modal-lesson-url').value.trim();
        const free = document.getElementById('modal-lesson-free').checked;
        if (!title) { alert('请输入课时名称'); return; }
        if (!url) { alert('请输入视频地址'); return; }
        // 节归属确保存在 sections 数组中
        if (fixedSec) {
          const secArr = _ensureSectionsArr(ch);
          if (secArr.indexOf(fixedSec) === -1) secArr.push(fixedSec);
        }
        const data = {
          id: item.id || ('l_' + Date.now() + '_' + Math.floor(Math.random() * 1e6)),
          title, videoUrl: url, path: url,
          duration: Number(item.duration || 0) || 0,
          free,
          sectionTitle: fixedSec || '',
        };
        if (lessonIdx == null) {
          ch.lessons = ch.lessons || [];
          ch.lessons.push(data);
        } else {
          ch.lessons[lessonIdx] = { ...(ch.lessons[lessonIdx] || {}), ...data };
        }
        closeModal();
        _render();
      };
    }

    function _openPdfModal({ chIdx, pdfIdx = null, sectionTitle = null } = {}) {
      const ch = chapterMgmtDraft[chIdx];
      if (!ch) return;
      const item = pdfIdx == null ? { name: '', url: '' } : (ch.pdfs[pdfIdx] || {});
      // 所属节：固定值。章点进来=章级；节点进来=该节；编辑时=原所属节；不需要用户选
      const fixedSec = (pdfIdx != null) ? (item.sectionTitle || '')
                      : (sectionTitle != null ? String(sectionTitle) : '');
      // 资料名称默认值：章点进来=章名 + "- 资料"；节点进来=节名 + "- 资料"；编辑=原名称
      let defaultName = item.name || item.path || '';
      if (pdfIdx == null && !defaultName) {
        defaultName = fixedSec ? (fixedSec + ' - 资料') : (ch.title ? ch.title + ' - 资料' : '');
      }
      // 所属节只读显示标签
      const sectionTagHtml = fixedSec
        ? `<div class="form-group">
             <div style="display:block;font-size:13px;font-weight:600;margin-bottom:4px;color:#475569;">归属</div>
             <div style="display:inline-flex;align-items:center;gap:6px;padding:8px 12px;border:1px solid #e2e8f0;border-radius:8px;background:#eff6ff;color:#1d4ed8;font-size:13px;font-weight:600;">📖 ${escapeHtml(fixedSec)}</div>
           </div>`
        : `<div class="form-group">
             <div style="display:block;font-size:13px;font-weight:600;margin-bottom:4px;color:#475569;">归属</div>
             <div style="display:inline-flex;align-items:center;gap:6px;padding:8px 12px;border:1px solid #e2e8f0;border-radius:8px;background:#f8fafc;color:#334155;font-size:13px;font-weight:600;">📚 章级（${escapeHtml(ch.title || '')}）</div>
           </div>`;
      const modal = document.getElementById('modal-container');
      const overlay = document.getElementById('modal-overlay');
      modal.innerHTML = `
        <div class="modal-box">
          <h2 style="margin:0 0 16px 0;font-size:18px;">${pdfIdx == null ? '📄 添加资料文档' : '✏️ 编辑资料'}</h2>
          <div class="form-group">
            <label>资料名称 *</label>
            <input id="modal-pdf-name" placeholder="例如：课程配套讲义.pdf" value="${escapeAttr(defaultName)}">
          </div>
          <div class="form-group">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
              <label style="margin:0;">资料地址 / 文件路径 *</label>
              <button type="button" class="btn btn-sm" id="btn-pick-doc" style="padding:4px 10px;font-size:12px;line-height:1.6;">📁 选择文件</button>
            </div>
            <input type="text" id="modal-pdf-url" placeholder="http(s):// 或 本地文件路径，支持 pdf/doc/ppt/xls 等" value="${escapeAttr(item.url || item.path || '')}">
          </div>
          ${sectionTagHtml}
          <div class="form-actions">
            <button class="btn btn-secondary" onclick="closeModal()">取消</button>
            <button class="btn btn-primary" id="modal-pdf-ok">确定</button>
          </div>
        </div>`;
      overlay.classList.remove('hidden');
      const pickDocBtn = document.getElementById('btn-pick-doc');
      if (pickDocBtn) {
        pickDocBtn.onclick = async function () {
          try {
            const r = await api.pickDocFile();
            if (r && r.success && r.localPath) {
              const urlInput = document.getElementById('modal-pdf-url');
              const nameInput = document.getElementById('modal-pdf-name');
              if (urlInput) { urlInput.value = r.localPath; urlInput.focus(); }
              // 如果资料名称为空，自动填文件 basename
              if (nameInput && !nameInput.value.trim()) {
                try {
                  const sepIdx = Math.max(r.localPath.lastIndexOf('\\'), r.localPath.lastIndexOf('/'));
                  const base = sepIdx >= 0 ? r.localPath.substring(sepIdx + 1) : r.localPath;
                  if (base) nameInput.value = base;
                } catch (_) {}
              }
            }
          } catch (e) { alert('选择文件失败：' + (e.message || e)); }
        };
      }
      document.getElementById('modal-pdf-ok').onclick = () => {
        const name = document.getElementById('modal-pdf-name').value.trim();
        const url = document.getElementById('modal-pdf-url').value.trim();
        if (!name) { alert('请输入资料名称'); return; }
        if (!url) { alert('请输入资料地址或路径'); return; }
        if (fixedSec) {
          const secArr = _ensureSectionsArr(ch);
          if (secArr.indexOf(fixedSec) === -1) secArr.push(fixedSec);
        }
        const data = {
          id: item.id || ('p_' + Date.now() + '_' + Math.floor(Math.random() * 1e6)),
          name, url, path: url,
          sectionTitle: fixedSec || '',
        };
        if (pdfIdx == null) {
          ch.pdfs = ch.pdfs || [];
          ch.pdfs.push(data);
        } else {
          ch.pdfs[pdfIdx] = { ...(ch.pdfs[pdfIdx] || {}), ...data };
        }
        closeModal();
        _render();
      };
    }

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

    let _mgmtClickHandler = null;
    let _dragHandlers = null;

    function _bindChapterMgmtEvents() {
      const container = document.getElementById('course-management');
      if (!container) return;
      if (_mgmtClickHandler) {
        container.removeEventListener('click', _mgmtClickHandler);
        _mgmtClickHandler = null;
      }
      if (_dragHandlers) {
        container.removeEventListener('dragstart', _dragHandlers.dragstart);
        container.removeEventListener('dragend', _dragHandlers.dragend);
        container.removeEventListener('dragover', _dragHandlers.dragover);
        container.removeEventListener('dragleave', _dragHandlers.dragleave);
        container.removeEventListener('drop', _dragHandlers.drop);
        _dragHandlers = null;
      }
      _mgmtClickHandler = async (ev) => {
        const t = ev.target;
        if (!(t instanceof HTMLElement)) return;
        const btn = t.closest('button');
        if (!btn) return;
        const act = btn.getAttribute('data-act');
        const chIdxStr = btn.getAttribute('data-ch');
        const idxStr = btn.getAttribute('data-idx');
        const secTitleRaw = btn.getAttribute('data-sec');
        const chIdx = chIdxStr == null ? null : Number(chIdxStr);
        const idx = idxStr == null ? null : Number(idxStr);

        if (btn.id === 'btn-add-chapter-top' || btn.id === 'btn-add-chapter-empty') {
          _openChapterModal({});
          return;
        }
        if (btn.id === 'btn-save-chapters' || btn.id === 'btn-save-chapters-top') {
          btn.disabled = true;
          const origText = btn.textContent;
          btn.textContent = '⏳ 保存中...';
          try {
            const r = await _saveChaptersDraftToDb();
            if (r && r.success !== false) {
              alert('✅ 保存成功！章节、课时、资料已写入数据库');
              chapterMgmtOrigDetail = await api.getCourseDetail(currentChapterMgmtCourseId);
              chapterMgmtDraft = _chaptersDeepClone(chapterMgmtOrigDetail?.chapters || []);
            } else {
              alert('❌ 保存失败：' + ((r && r.error) || '未知错误'));
            }
          } catch (e) {
            alert('❌ 保存异常：' + (e.message || e));
          } finally {
            btn.disabled = false;
            btn.textContent = origText;
            _render();
          }
          return;
        }
        if (btn.id === 'btn-reset-chapters' || btn.id === 'btn-reset-chapters-top') {
          if (!(await confirmCustom('确认撤销所有未保存的修改，恢复到原始数据？'))) return;
          chapterMgmtDraft = _chaptersDeepClone(chapterMgmtOrigDetail?.chapters || []);
          _render();
          return;
        }

        if (chIdx == null || !(chapterMgmtDraft[chIdx])) return;
        const ch = chapterMgmtDraft[chIdx];

        if (act === 'add-section') {
          _openSectionModal({ chIdx });
          return;
        } else if (act === 'edit-section') {
          _openSectionModal({ chIdx, oldTitle: secTitleRaw });
          return;
        } else if (act === 'del-section') {
          const secLessons = (ch.lessons || []).filter(l => (l.sectionTitle || '') === secTitleRaw);
          const secPdfs = (ch.pdfs || []).filter(p => (p.sectionTitle || '') === secTitleRaw);
          let msg = `确认删除节「${secTitleRaw}」？`;
          const parts = [];
          if (secLessons.length > 0) parts.push(`该节下 ${secLessons.length} 个课时不会被删除，而是变为「无分组」状态`);
          if (secPdfs.length > 0) parts.push(`${secPdfs.length} 份资料将变为章级（无分组）`);
          if (parts.length === 0) msg = `确认删除空节「${secTitleRaw}」？`;
          else msg += '\n' + parts.join('，') + '。';
          if (!(await confirmCustom(msg))) return;
          const secArr = _ensureSectionsArr(ch);
          const si = secArr.indexOf(secTitleRaw);
          if (si !== -1) secArr.splice(si, 1);
          (ch.lessons || []).forEach((l) => {
            if ((l.sectionTitle || '') === secTitleRaw) l.sectionTitle = '';
          });
          (ch.pdfs || []).forEach((p) => {
            if ((p.sectionTitle || '') === secTitleRaw) p.sectionTitle = '';
          });
          _render();
          return;
        } else if (act === 'move-section-up' || act === 'move-section-down') {
          const secArr = _ensureSectionsArr(ch);
          const order = _getSectionOrder(ch);
          const nonEmpty = order.filter(s => s !== '');
          const curIdx = nonEmpty.indexOf(secTitleRaw);
          if (curIdx === -1) return;
          if (act === 'move-section-up') {
            if (curIdx === 0) { alert('已经是第一节了'); return; }
            const tmp = nonEmpty[curIdx]; nonEmpty[curIdx] = nonEmpty[curIdx - 1]; nonEmpty[curIdx - 1] = tmp;
          } else {
            if (curIdx === nonEmpty.length - 1) { alert('已经是最后一节了'); return; }
            const tmp = nonEmpty[curIdx]; nonEmpty[curIdx] = nonEmpty[curIdx + 1]; nonEmpty[curIdx + 1] = tmp;
          }
          secArr.length = 0;
          nonEmpty.forEach(s => secArr.push(s));
          const newOrder = order.includes('') ? ['', ...nonEmpty] : nonEmpty;
          _reorderLessonsBySection(ch, newOrder);
          _render();
          return;
        } else if (act === 'add-lesson-to-section') {
          _addLessonFlow({ chIdx, sectionTitle: secTitleRaw });
          return;
        } else if (act === 'add-pdf-to-section') {
          _openPdfModal({ chIdx, sectionTitle: secTitleRaw });
          return;
        }

        if (act === 'edit-chapter') {
          _openChapterModal({ title: chapterMgmtDraft[chIdx].title || '', chIdx });
        } else if (act === 'del-chapter') {
          if (!(await confirmCustom(`确认删除章节「${chapterMgmtDraft[chIdx].title || '第' + (chIdx + 1) + '章'}」？该章节下的所有课时和资料也会被删除。`))) return;
          chapterMgmtDraft.splice(chIdx, 1);
          _render();
        } else if (act === 'move-chapter-up') {
          if (chIdx === 0) { alert('已经是第一章了'); return; }
          const tmp = chapterMgmtDraft[chIdx]; chapterMgmtDraft[chIdx] = chapterMgmtDraft[chIdx - 1]; chapterMgmtDraft[chIdx - 1] = tmp;
          _render();
        } else if (act === 'move-chapter-down') {
          if (chIdx === chapterMgmtDraft.length - 1) { alert('已经是最后一章了'); return; }
          const tmp = chapterMgmtDraft[chIdx]; chapterMgmtDraft[chIdx] = chapterMgmtDraft[chIdx + 1]; chapterMgmtDraft[chIdx + 1] = tmp;
          _render();
        } else if (act === 'add-lesson') {
          _addLessonFlow({ chIdx });
        } else if (act === 'batch-upload') {
          _batchUploadFlow({ chIdx });
        } else if (act === 'batch-upload-to-section') {
          _batchUploadFlow({ chIdx, sectionTitle: secTitleRaw });
        } else if (act === 'edit-lesson') {
          _openLessonModal({ chIdx, lessonIdx: idx });
        } else if (act === 'del-lesson') {
          const l = chapterMgmtDraft[chIdx].lessons[idx];
          if (!l) return;
          if (!(await confirmCustom(`确认删除课时「${l.title || '未命名'}」？`))) return;
          chapterMgmtDraft[chIdx].lessons.splice(idx, 1);
          _render();
        } else if (act === 'add-pdf') {
          _openPdfModal({ chIdx });
        } else if (act === 'edit-pdf') {
          _openPdfModal({ chIdx, pdfIdx: idx });
        } else if (act === 'del-pdf') {
          const p = chapterMgmtDraft[chIdx].pdfs[idx];
          if (!p) return;
          if (!(await confirmCustom(`确认删除资料「${p.name || '未命名'}」？`))) return;
          chapterMgmtDraft[chIdx].pdfs.splice(idx, 1);
          _render();
        }
      };
      container.addEventListener('click', _mgmtClickHandler);

      let _dragSrc = null;
      var DRAG_ROW_SEL = 'tr[data-chapter-lesson], tr[data-chapter-pdf]';
      var DRAG_ZONE_SEL = '[data-drop-section], [data-drop-root]';
      var ALL_DROP_SEL = DRAG_ROW_SEL + ', ' + DRAG_ZONE_SEL;

      function _findDropTarget(e) {
        var el = e.target;
        while (el && el !== container) {
          if (el.matches && el.matches(ALL_DROP_SEL)) return el;
          el = el.parentNode;
        }
        return null;
      }
      function _clearDropHighlight() {
        container.querySelectorAll(DRAG_ROW_SEL).forEach(function (r) {
          r.style.borderTop = ''; r.style.borderBottom = '';
        });
        container.querySelectorAll('[data-drop-section]').forEach(function (b) {
          b.style.boxShadow = ''; b.style.borderColor = '';
        });
        container.querySelectorAll('[data-drop-root]').forEach(function (b) {
          b.style.background = ''; b.style.borderColor = '';
        });
      }

      _dragHandlers = {
        dragstart: function (e) {
          var tr = e.target.closest && e.target.closest(DRAG_ROW_SEL);
          if (!tr) { e.preventDefault(); return; }
          var kind = tr.hasAttribute('data-chapter-lesson') ? 'lesson' : 'pdf';
          var parts = (kind === 'lesson' ? tr.dataset.chapterLesson : tr.dataset.chapterPdf).split('-').map(Number);
          _dragSrc = { kind: kind, chIdx: parts[0], idx: parts[1], el: tr };
          tr.style.opacity = '0.4';
          e.dataTransfer.effectAllowed = 'move';
          try { e.dataTransfer.setData('text/plain', kind + ':' + parts.join('-')); } catch (_) {}
        },
        dragend: function () {
          _clearDropHighlight();
          if (_dragSrc && _dragSrc.el) _dragSrc.el.style.opacity = '';
          _dragSrc = null;
        },
        dragover: function (e) {
          if (!_dragSrc) return;
          var target = _findDropTarget(e);
          if (!target) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          _clearDropHighlight();
          if (target.tagName === 'TR') {
            var rect = target.getBoundingClientRect();
            var before = (e.clientY - rect.top) < rect.height / 2;
            target.style.borderTop = before ? '2px solid #4f46e5' : '';
            target.style.borderBottom = before ? '' : '2px solid #4f46e5';
          } else if (target.hasAttribute('data-drop-section')) {
            target.style.boxShadow = '0 0 0 2px #4f46e5, 0 4px 16px rgba(79,70,229,0.25)';
            target.style.borderColor = '#4f46e5';
          } else if (target.hasAttribute('data-drop-root')) {
            target.style.background = '#eef2ff';
            target.style.borderColor = '#4f46e5';
          }
        },
        dragleave: function () { _clearDropHighlight(); },
        drop: function (e) {
          if (!_dragSrc) return;
          var target = _findDropTarget(e);
          if (!target) return;
          e.preventDefault();
          _clearDropHighlight();

          if (target.tagName === 'TR') {
            var kind = target.hasAttribute('data-chapter-lesson') ? 'lesson' : 'pdf';
            var parts = (kind === 'lesson' ? target.dataset.chapterLesson : target.dataset.chapterPdf).split('-').map(Number);
            var rect = target.getBoundingClientRect();
            var before = (e.clientY - rect.top) < rect.height / 2;
            var lessons = chapterMgmtDraft[parts[0]].lessons;
            var arr = kind === 'lesson' ? lessons : chapterMgmtDraft[parts[0]].pdfs;
            var dstItem = arr[parts[1]];
            var dstSec = (dstItem && dstItem.sectionTitle) || '';
            if (_dragSrc.kind === 'lesson' && kind === 'lesson') {
              _doMoveLesson(parts[0], dstSec, parts[1], before);
            } else if (_dragSrc.kind === 'pdf' && kind === 'pdf') {
              _doMovePdf(parts[0], dstSec, parts[1], before);
            } else {
              _render();
            }
          } else if (target.hasAttribute('data-drop-section')) {
            var chIdx = parseInt(target.dataset.sectionBlock.split('-')[0], 10);
            var secTitle = target.dataset.dropSection;
            if (_dragSrc.kind === 'lesson') _doMoveLesson(chIdx, secTitle, null, false);
            else if (_dragSrc.kind === 'pdf') _doMovePdf(chIdx, secTitle, null, false);
          } else if (target.hasAttribute('data-drop-root')) {
            var rCh = parseInt(target.dataset.dropRoot, 10);
            if (_dragSrc.kind === 'lesson') _doMoveLesson(rCh, '', null, false);
            else if (_dragSrc.kind === 'pdf') _doMovePdf(rCh, '', null, false);
          }
        }
      };

      container.addEventListener('dragstart', _dragHandlers.dragstart);
      container.addEventListener('dragend', _dragHandlers.dragend);
      container.addEventListener('dragover', _dragHandlers.dragover);
      container.addEventListener('dragleave', _dragHandlers.dragleave);
      container.addEventListener('drop', _dragHandlers.drop);

      function _collectBySection(arr, sectionTitle) {
        var result = [];
        for (var i = 0; i < arr.length; i++) {
          if ((arr[i].sectionTitle || '') === sectionTitle) result.push(i);
        }
        return result;
      }

      function _doMoveLesson(dstCh, dstSection, dstIdx, beforeInsert) {
        var src = _dragSrc; _dragSrc = null;
        if (!src || src.kind !== 'lesson' || src.chIdx !== dstCh) { _render(); return; }
        var lessons = chapterMgmtDraft[dstCh].lessons;
        if (!lessons || src.idx < 0 || src.idx >= lessons.length) { _render(); return; }
        var srcLesson = lessons[src.idx];
        if (dstSection !== undefined && dstSection !== null) {
          srcLesson.sectionTitle = dstSection;
        }
        var newIdx = lessons.indexOf(srcLesson);
        if (newIdx === -1) { _render(); return; }

        if (dstIdx !== undefined && dstIdx !== null) {
          if (newIdx === dstIdx) { _render(); return; }
          var item = lessons.splice(newIdx, 1)[0];
          var targetIdx = dstIdx;
          if (newIdx < dstIdx) targetIdx -= 1;
          var insertAt = beforeInsert ? targetIdx : targetIdx + 1;
          lessons.splice(Math.max(0, Math.min(insertAt, lessons.length)), 0, item);
        } else {
          var sameSectionIdx = _collectBySection(lessons, srcLesson.sectionTitle || '');
          if (sameSectionIdx.length <= 1) { _render(); return; }
          if (sameSectionIdx[0] === newIdx) { _render(); return; }
          var item2 = lessons.splice(newIdx, 1)[0];
          var firstOfSection = _collectBySection(lessons, srcLesson.sectionTitle || '');
          var insertAt2 = firstOfSection.length ? firstOfSection[firstOfSection.length - 1] + 1 : lessons.length;
          lessons.splice(insertAt2, 0, item2);
        }
        _render();
      }

      function _doMovePdf(dstCh, dstSection, dstIdx, beforeInsert) {
        var src = _dragSrc; _dragSrc = null;
        if (!src || src.kind !== 'pdf' || src.chIdx !== dstCh) { _render(); return; }
        var pdfs = chapterMgmtDraft[dstCh].pdfs;
        if (!pdfs || src.idx < 0 || src.idx >= pdfs.length) { _render(); return; }
        var srcPdf = pdfs[src.idx];
        if (dstSection !== undefined && dstSection !== null) {
          srcPdf.sectionTitle = dstSection;
        }
        var newIdx = pdfs.indexOf(srcPdf);
        if (dstIdx !== undefined && dstIdx !== null) {
          if (newIdx === dstIdx) { _render(); return; }
          var item = pdfs.splice(newIdx, 1)[0];
          var targetIdx = dstIdx;
          if (newIdx < dstIdx) targetIdx -= 1;
          var insertAt = beforeInsert ? targetIdx : targetIdx + 1;
          pdfs.splice(Math.max(0, Math.min(insertAt, pdfs.length)), 0, item);
        } else {
          var sameSectionIdx = _collectBySection(pdfs, srcPdf.sectionTitle || '');
          if (sameSectionIdx.length <= 1) { _render(); return; }
          var item2 = pdfs.splice(newIdx, 1)[0];
          var list = _collectBySection(pdfs, srcPdf.sectionTitle || '');
          var insertAt2 = list.length ? list[list.length - 1] + 1 : pdfs.length;
          pdfs.splice(insertAt2, 0, item2);
        }
        _render();
      }
    }

    const container = document.getElementById('course-management');
    if (!container) return;

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

      let statsBar = pageHeader.querySelector('#chapters-mgmt-stats');
      const T0 = _totals();
      if (!statsBar) {
        statsBar = document.createElement('div');
        statsBar.id = 'chapters-mgmt-stats';
        statsBar.style.cssText = 'flex:1;min-width:0;display:flex;align-items:center;justify-content:space-between;gap:24px;flex-wrap:wrap;';
        statsBar.innerHTML = `
          <div style="min-width:0;flex:1;">
            <h2 style="margin:0;font-size:22px;color:#0f172a;line-height:1.2;">${escapeHtml(detail.title)}</h2>
            ${detail.subtitle ? `<p style="margin:4px 0 0 0;color:#64748b;font-size:13px;">${escapeHtml(detail.subtitle)}</p>` : ''}
          </div>
          <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center;">
            <div data-stat-box style="background:#eef2ff;padding:6px 14px;border-radius:16px;font-size:12px;color:#4338ca;font-weight:600;">📚 ${T0.chapters} 章</div>
            <div data-stat-box style="background:#fef3c7;padding:6px 14px;border-radius:16px;font-size:12px;color:#b45309;font-weight:600;">🎬 ${T0.lessons} 个课时</div>
            <div data-stat-box style="background:#ecfdf5;padding:6px 14px;border-radius:16px;font-size:12px;color:#047857;font-weight:600;">📄 ${T0.pdfs} 份资料</div>
            <div style="background:#f0f9ff;padding:6px 14px;border-radius:16px;font-size:12px;color:#0369a1;font-weight:600;">👨‍🏫 ${escapeHtml(detail.instructor || '--')}</div>
            <div style="height:24px;width:1px;background:#e2e8f0;margin:0 4px;"></div>
            <button id="btn-reset-chapters-top" class="btn btn-secondary" style="padding:8px 14px;font-size:13px;">↺ 撤销修改</button>
            <button id="btn-save-chapters-top" class="btn btn-primary" style="padding:8px 18px;font-size:13px;">💾 保存修改</button>
          </div>
        `;
        pageHeader.insertBefore(statsBar, backBtn.nextSibling);
      }
      // 顶部栏「保存修改 / 撤销修改」按钮事件绑定（由于按钮位于 header，不在 _render 的容器里，需单独绑定）
      const saveTop = document.getElementById('btn-save-chapters-top');
      if (saveTop) {
        saveTop.onclick = async function() {
          const btn = saveTop;
          btn.disabled = true;
          const origText = btn.textContent;
          btn.textContent = '⏳ 保存中...';
          try {
            const r = await _saveChaptersDraftToDb();
            if (r && r.success !== false) {
              alert('✅ 保存成功！章节、课时、资料已写入数据库');
              chapterMgmtOrigDetail = await api.getCourseDetail(currentChapterMgmtCourseId);
              chapterMgmtDraft = _chaptersDeepClone(chapterMgmtOrigDetail?.chapters || []);
              _updateHeaderStats();
            } else {
              alert('❌ 保存失败：' + ((r && r.error) || '未知错误'));
            }
          } catch (e) {
            alert('❌ 保存异常：' + (e.message || e));
          } finally {
            btn.disabled = false;
            btn.textContent = origText;
            _render();
          }
        };
      }
      const resetTop = document.getElementById('btn-reset-chapters-top');
      if (resetTop) {
        resetTop.onclick = async function() {
          if (!(await confirmCustom('确认撤销所有未保存的修改，恢复到原始数据？'))) return;
          chapterMgmtDraft = _chaptersDeepClone(chapterMgmtOrigDetail?.chapters || []);
          _updateHeaderStats();
          _render();
        };
      }
    }

    backBtn = document.getElementById('chapters-mgmt-back');
    if (backBtn) {
      backBtn.onclick = null;
      backBtn.addEventListener('click', () => {
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
        chapterMgmtDraft = null;
        chapterMgmtOrigDetail = null;
        loadCourseMgmt();
      });
    }

    _render();
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
      if (!(await confirmCustom(`${mgmtLabel}，当前已有章节会被覆盖，确定继续？`))) return;
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
            return `
            <tr>
              <td style="color:#94a3b8;">${i + 1}</td>
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

  modal.innerHTML = `
    <h2>${editing ? '编辑用户' : '添加用户'}</h2>
    ${editing ? `<p style="color:#64748b;font-size:13px;margin-bottom:14px;">用户名：<strong>${escapeHtml(username)}</strong>（不可修改）</p>` : ''}
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
        r = await api.updateUser({ username, password: pwd, nickname: nick, role });
      } else {
        r = await api.addUser({ username: uname, password: pwd, nickname: nick, role });
      }
      if (r && r.success) {
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

