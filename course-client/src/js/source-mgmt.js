// ============================================================
//  115 网盘选文件夹导入课程（p115 选文件夹）
// ============================================================
async function showDraftEditModalOneShot(draft, folderPath, sourceType) {
  console.log('[editModal] 进入 showDraftEditModalOneShot folderPath=' + folderPath + ' sourceType=' + sourceType);
  draft = JSON.parse(JSON.stringify(draft || {}));
  let categories = [];
  try { categories = (await api.getCategories()) || []; } catch (e) { console.error('[editModal] 加载分类失败，用空列表兜底:', e); }
  console.log('[editModal] 分类数量=' + categories.length);
  const modal = document.getElementById('modal-container');
  modal.classList.add('course-modal');
  document.getElementById('modal-overlay').classList.remove('hidden');
  const chCount = (draft.chapters || []).length;
  const lsCount = (draft.chapters || []).reduce((s, c) => s + ((c.lessons && c.lessons.length) || 0), 0);

  modal.innerHTML = `
    <div class="cm-head">
      <div class="cm-head-tag">
        <span class="cm-head-grad"></span>
        <div>
          <h2 class="cm-title">📺 导入网盘课程</h2>
          <div class="cm-subtitle">已扫描 <strong>${chCount}</strong> 章 · <strong>${lsCount}</strong> 集，完善信息后保存</div>
        </div>
      </div>
    </div>
    <div class="cm-field cm-field-inline">
      <label>来源路径</label>
      <input value="${escapeAttr(folderPath || '')}" disabled style="background:#f1f0fa;color:#6366f1;font-weight:500;font-size:13px;">
    </div>
    <div class="cm-field cm-field-inline">
      <label>课程名称 <em>*</em></label>
      <input id="e-title" placeholder="由文件夹名自动生成" value="${escapeAttr(draft.title || '')}">
    </div>
    <div class="cm-field cm-field-inline">
      <label>课程分类</label>
      <select id="e-category">${categories.map(c => `<option value="${c.id}" ${draft.categoryId == c.id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}</select>
    </div>
    <div class="cm-section-title">
      <span class="cm-section-dot"></span>课程封面
      <span class="cm-section-opt">可选</span>
    </div>
    <div class="cm-cover-card">
      <div id="e-cover-preview" class="cm-cover-preview">
        ${draft.coverImage ? `<img src="${escapeAttr(draft.coverImage)}" style="width:100%;height:100%;object-fit:cover;">` : '<span style="color:#94a3b8;font-size:12px;">暂无封面</span>'}
      </div>
      <div class="cm-cover-ops">
        <div class="cm-cover-btns">
          <button type="button" class="btn btn-secondary btn-sm" id="e-btn-pick-cover">📷 上传封面图片</button>
          <button type="button" class="btn btn-secondary btn-sm" id="e-btn-clear-cover" style="${draft.coverImage ? '' : 'display:none;'}">❌ 清除</button>
        </div>
        <input id="e-cover-url" value="${escapeAttr(draft.coverImage || '')}" placeholder="或粘贴图片 URL（https://...）" class="cm-cover-url">
        <div class="cm-cover-tip">支持 jpg / png / gif / webp；不选则使用默认渐变</div>
      </div>
    </div>
    <div class="cm-section-title">
      <span class="cm-section-dot"></span>课程简介
      <span class="cm-section-opt">可选</span>
    </div>
    <div class="cm-field">
      <textarea id="e-description" rows="3" placeholder="简单介绍一下这门课程…">${escapeHtml(draft.description || '')}</textarea>
    </div>
    <div class="cm-section-title">
      <span class="cm-section-dot"></span>章节预览
      <span class="cm-section-opt">${chCount}章 · ${lsCount}集</span>
    </div>
    <div class="cm-field" style="margin-bottom:16px;">
      <div style="max-height:180px;overflow-y:auto;border:1px solid #e3e5f0;border-radius:10px;padding:6px;">
        ${(draft.chapters || []).map((ch, ci) => `
          <details style="padding:4px 8px;">
            <summary style="font-size:13px;cursor:pointer;padding:3px 0;color:#374151;font-weight:500;">📂 第${ci+1}章：${escapeHtml(ch.title)}<span style="font-size:11px;color:#9ca3af;margin-left:6px;">${(ch.lessons||[]).length} 集</span></summary>
            <ul style="padding-left:16px;margin:2px 0;">
              ${(ch.lessons || []).map(l => `<li style="font-size:12px;color:#64748b;padding:2px 0;display:flex;align-items:center;gap:6px;">🎬 ${escapeHtml(l.title || '未命名视频')}<span style="margin-left:auto;font-size:11px;color:#94a3b8;">${l.duration || '--'}</span></li>`).join('')}
            </ul>
          </details>`).join('') || '<p style="color:#94a3b8;padding:10px;text-align:center;">该文件夹没有扫描到视频文件</p>'}
      </div>
    </div>
    <div class="cm-actions">
      <button class="btn btn-secondary" onclick="showP115PickWizard()">← 重新选文件夹</button>
      <button class="btn btn-primary cm-save-btn" id="e-save-btn">💾 保存为课程</button>
    </div>`;

  function updateCoverPreview(url) {
    var prev = document.getElementById('e-cover-preview');
    var clearBtn = document.getElementById('e-btn-clear-cover');
    if (!prev) return;
    if (url) {
      prev.innerHTML = '<img src="' + escapeAttr(url) + '" style="width:100%;height:100%;object-fit:cover;">';
      if (clearBtn) clearBtn.style.display = '';
    } else {
      prev.innerHTML = '<span style="color:#94a3b8;font-size:12px;">暂无封面</span>';
      if (clearBtn) clearBtn.style.display = 'none';
    }
  }
  document.getElementById('e-btn-pick-cover').addEventListener('click', async function () {
    var r = await api.pickCoverImage();
    if (r && r.success && r.fileUrl) {
      document.getElementById('e-cover-url').value = r.fileUrl;
      updateCoverPreview(r.fileUrl);
    } else if (r && r.error) {
      alert('选择图片失败：' + r.error);
    }
  });
  document.getElementById('e-btn-clear-cover').addEventListener('click', function () {
    document.getElementById('e-cover-url').value = '';
    updateCoverPreview('');
  });
  document.getElementById('e-cover-url').addEventListener('input', function (e) {
    updateCoverPreview((e.target.value || '').trim());
  });

  document.getElementById('e-save-btn').addEventListener('click', async function () {
    var title = document.getElementById('e-title').value.trim();
    if (!title) { alert('请填写课程名称'); return; }
    var data = {
      categoryId: parseInt(document.getElementById('e-category').value) || 1,
      title: title,
      description: document.getElementById('e-description').value.trim(),
      coverImage: document.getElementById('e-cover-url').value.trim(),
      chapters: (draft.chapters || []).map(function (ch) {
        return Object.assign({}, ch, {
          lessons: (ch.lessons || []).map(function (l) {
            return Object.assign({}, l, {
              videoType: 'p115',
              video_source: JSON.stringify({ type: 'p115', cfgId: draft._cfgId || '', pickCode: l.pickCode || '', cid: l.cid || '' }),
            });
          }),
        });
      }),
      sourceKey: (sourceType ? sourceType + '::' : 'p115::') + (draft.sourceType || '115') + '::' + (folderPath || '') + '::' + Date.now(),
      sourceDirId: draft._dirId || '0',
      sourceCfgId: draft._cfgId || null,
    };
    var btn = document.getElementById('e-save-btn');
    btn.disabled = true; btn.textContent = '💾 保存中...';
    console.log('[saveCourse] 即将保存 title="' + title + '" sourceKey="' + data.sourceKey + '" chapters=' + ((data.chapters || []).length));
    try {
      var r = await api.addCourseWithChapters(data);
      if (r && r.success === false) throw new Error(r.error || '保存失败');
      alert('✅ 课程添加成功：' + title);
      closeModal();
      loadCourses();
    } catch (e) {
      console.error('[saveCourse] 异常:', e);
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

let _p115PickerStack = [];

let _p115UpdateCourseId = null;
let _p115UpdateCfgId = null;
let _p115UpdateDirId = null;
let _p115UpdateDirName = null;
let _p115ForcePicker = false;

async function showP115PickWizard() {
  _p115PickerStack = [];
  _p115UpdateCourseId = null;
  _p115UpdateCfgId = null;
  _p115UpdateDirId = null;
  _p115UpdateDirName = null;
  _p115ForcePicker = false;
  _renderP115PickerWizard();
}

async function showP115UpdateWizard(courseId) {
  _p115PickerStack = [];
  _p115UpdateCourseId = courseId || null;
  _p115UpdateCfgId = null;
  _p115UpdateDirId = null;
  _p115UpdateDirName = null;
  if (_p115ForcePicker) {
    _p115ForcePicker = false;
    _renderP115PickerWizard();
    return;
  }
  try {
    var detail = await api.getCourseDetail(courseId);
    if (detail && detail.courseMode === 'netdisk') {
      _p115UpdateCfgId = detail.sourceCfgId || null;
      _p115UpdateDirId = detail.sourceDirId || null;
      var dn = detail.sourcePath || '';
      var seg = dn.split('/').filter(Boolean).pop();
      _p115UpdateDirName = seg || '上次目录';
      if (_p115UpdateCfgId && _p115UpdateDirId) {
        _p115PickerPick(_p115UpdateCfgId, _p115UpdateDirId, _p115UpdateDirName);
        return;
      }
    }
  } catch (e) {}
  _renderP115PickerWizard();
}

async function _renderP115PickerWizard() {
  var updateCourseId = _p115UpdateCourseId;
  var cfgs = await api.getAllP115Configs();
  var modal = document.getElementById('modal-container');
  var emptyTip = (!cfgs || cfgs.length === 0)
    ? '<div style="padding:12px;background:#fef3c7;border:1px solid #fcd34d;border-radius:6px;color:#92400e;font-size:13px;">⚠️ 还没有配置 115 网盘账号，请先去「设置 → 115 网盘」添加。</div>'
    : '';
  var cfgOptions = (cfgs || []).map(function (c) { return '<option value="' + c.id + '">' + escapeHtml(c.name || c.id) + ' (' + escapeHtml(c.nickName || c.phone || '已配置') + ')</option>'; }).join('');
  modal.innerHTML = `
    <h2>${updateCourseId ? '🔄 同步网盘文件夹到课程' : '🎬 从 115 网盘选文件夹作为课程'}</h2>
    <div class="scan-step-tip">${updateCourseId ? '选用网盘里的新文件夹或同一文件夹，扫描后覆盖当前课程的章节内容。' : '选择一个已配置的 115 账号 → 浏览目录 → 点「选这个」扫描并保存。文件夹名自动作为课程名，子文件夹=章节，视频=课时。'}</div>
    ${emptyTip}
    <div class="form-group">
      <label>① 115 账号</label>
      <select id="p1p-cfg-select" ${!cfgs || cfgs.length === 0 ? 'disabled' : ''}>${cfgOptions || '<option value="">无可用配置</option>'}</select>
    </div>
    <div id="p1p-browser-box"></div>
    <div class="form-actions">
      <button class="btn btn-secondary" onclick="closeModal()">取消</button>
      <button class="btn btn-primary" id="p1p-connect-btn" ${!cfgs || cfgs.length === 0 ? 'disabled' : ''}>🔗 连接并浏览</button>
    </div>`;
  document.getElementById('modal-overlay').classList.remove('hidden');

  var cfgSelect = document.getElementById('p1p-cfg-select');
  if (_p115UpdateCfgId && cfgs && cfgs.some(function (c) { return String(c.id) === String(_p115UpdateCfgId); })) {
    cfgSelect.value = _p115UpdateCfgId;
  }
  document.getElementById('p1p-connect-btn').addEventListener('click', async function () {
    if (!cfgSelect.value) { alert('请先配置 115 账号'); return; }
    if (_p115UpdateCfgId && _p115UpdateDirId && String(cfgSelect.value) === String(_p115UpdateCfgId)) {
      _p115PickerStack = [{ cid: String(_p115UpdateDirId), name: _p115UpdateDirName || '上次目录' }];
      await _p115PickerRenderDir(cfgSelect.value);
    } else {
      _p115PickerStack = [{ cid: '0', name: '根目录' }];
      await _p115PickerRenderDir(cfgSelect.value);
    }
  });
}

async function _p115PickerRenderDir(cfgId) {
  var box = document.getElementById('p1p-browser-box');
  if (!box) return;
  var cur = _p115PickerStack[_p115PickerStack.length - 1];
  box.innerHTML = '<p style="text-align:center;padding:20px;color:#64748b;">⏳ 正在读取目录：' + escapeHtml(cur.name) + '</p>';
  try {
    var r = await api.list115PickerDir(cfgId, cur.cid);
    if (!r || !r.success) throw new Error(r.error || '读取失败');

    var dirs = r.items.filter(function (i) { return i.isDir; });
    var files = r.items.filter(function (i) { return !i.isDir; });

    var crumbs = _p115PickerStack.map(function (s, i) {
      if (i === _p115PickerStack.length - 1) return '<span style="color:#334155;">' + escapeHtml(s.name) + '</span>';
      return '<a style="cursor:pointer;color:var(--primary);" data-crumb="' + i + '">' + escapeHtml(s.name) + '</a>';
    }).join(' <span style="color:#94a3b8;">/</span> ');

    box.innerHTML = `
      <div style="margin-top:12px;padding:12px;border:1px solid var(--border);border-radius:8px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;gap:8px;flex-wrap:wrap;">
          <div style="font-size:13px;color:#475569;">📁 当前位置：${crumbs}</div>
          <button class="btn btn-sm" style="background:#0ea5e9;color:#fff;" id="p1p-use-this">${_p115UpdateCourseId ? '✅ 选择当前文件夹并同步到课程' : '✅ 选择当前文件夹作为课程'}</button>
        </div>
        <div style="max-height:50vh;overflow-y:auto;border-top:1px solid var(--border);padding-top:8px;">
          ${dirs.length === 0 && files.length === 0 ? '<p style="color:#94a3b8;text-align:center;padding:30px;">（空文件夹）</p>' : ''}
          ${dirs.map(function (d) { return `
            <div class="p1p-dir-item" data-cid="${escapeAttr(d.cid)}" data-name="${escapeAttr(d.name)}">
              📂 <span>${escapeHtml(d.name)}</span>
              <span style="font-size:12px;color:#94a3b8;margin-left:6px;">（双击进入）</span>
              <button class="btn btn-sm btn-primary" data-pick="${escapeAttr(d.cid)}" data-folder="${escapeAttr(d.name)}">选这个</button>
            </div>
          `; }).join('')}
          ${files.length > 0 ? `
            <div style="font-size:12px;color:#94a3b8;margin:14px 4px 6px;padding-left:4px;border-left:3px solid var(--primary);">当前文件夹下的文件（视频会自动识别为课时）：</div>
            ${files.slice(0, 40).map(function (f) { return `
              <div style="font-size:13px;padding:2px 4px;">🎬 ${escapeHtml(f.name)} <span style="margin-left:auto;font-size:11px;color:#94a3b8;">${_fmtSize(f.size)}</span></div>
            `; }).join('')}
            ${files.length > 40 ? '<div style="font-size:11px;color:#94a3b8;text-align:center;padding:4px;">... 还有 ' + (files.length - 40) + ' 个文件</div>' : ''}
          ` : ''}
        </div>
      </div>`;

    box.querySelectorAll('a[data-crumb]').forEach(function (a) { a.addEventListener('click', function () {
      var idx = parseInt(a.dataset.crumb);
      _p115PickerStack = _p115PickerStack.slice(0, idx + 1);
      _p115PickerRenderDir(cfgId);
    }); });
    box.querySelectorAll('.p1p-dir-item').forEach(function (row) {
      row.addEventListener('dblclick', function () {
        _p115PickerStack.push({ cid: row.dataset.cid, name: row.dataset.name });
        _p115PickerRenderDir(cfgId);
      });
    });
    box.querySelectorAll('button[data-pick]').forEach(function (b) {
      b.addEventListener('click', function () { _p115PickerPick(cfgId, b.dataset.pick, b.dataset.folder); });
    });
    var useBtn = document.getElementById('p1p-use-this');
    if (useBtn) useBtn.addEventListener('click', function () { _p115PickerPick(cfgId, cur.cid, cur.name); });
  } catch (e) {
    box.innerHTML = '<div style="padding:14px;background:#fef2f2;border:1px solid #fecaca;border-radius:6px;color:#991b1b;">❌ 读取失败：' + escapeHtml(e.message || String(e)) + '</div>\n      <div class="form-actions"><button class="btn btn-secondary" onclick="_p115ForcePicker=true;_p115UpdateCourseId ? showP115UpdateWizard(_p115UpdateCourseId) : showP115PickWizard()">← 重试</button></div>';
  }
}

async function _p115PickerPick(cfgId, dirId, folderName) {
  var overlay = document.getElementById('modal-overlay');
  var modal = document.getElementById('modal-container');
  overlay.classList.remove('hidden');
  modal.innerHTML = `
    <h2>📂 扫描中：${escapeHtml(folderName)}</h2>
    <div class="scan-step-tip">正在扫描子文件夹和视频文件，构建章节结构，请稍候...</div>
    <div style="text-align:center;padding:40px;color:#64748b;">⏳ 扫描中，请稍候...</div>`;
  try {
    var r = await api.scan115PickerFolder(cfgId, dirId, folderName);
    if (!r || !r.success) throw new Error(r.error || '扫描失败');
    var draft = r.data || {};
    draft._cfgId = cfgId;
    draft._dirId = dirId || '0';
    var updateCourseId = _p115UpdateCourseId;
    if (updateCourseId) {
      var chapters = (draft.chapters || []).map(function (ch) {
        return Object.assign({}, ch, {
          lessons: (ch.lessons || []).map(function (l) {
            return Object.assign({}, l, {
              videoType: 'p115',
              video_source: JSON.stringify({ type: 'p115', cfgId: String(cfgId || ''), pickCode: l.pickCode || '', cid: l.cid || '' }),
            });
          }),
        });
      });
      var chCount = chapters.length;
      var lsCount = chapters.reduce(function (s, c) { return s + ((c.lessons || []).length); }, 0);
      modal.innerHTML = `
        <h2>🔄 同步到课程</h2>
        <div class="scan-step-tip">将把文件夹「<strong>${escapeHtml(folderName)}</strong>」同步到当前课程，覆盖现有章节。<br>✅ 已扫描：<strong>${chCount} 章 / ${lsCount} 集</strong></div>
        <div style="max-height:220px;overflow-y:auto;border:1px solid var(--border);border-radius:6px;padding:6px;">
          ${(draft.chapters || []).map(function (ch, ci) { return `
            <div style="padding:4px 6px;font-size:13px;">📂 第${ci+1}章：${escapeHtml(ch.title)}（${(ch.lessons||[]).length} 集）</div>
          `; }).join('') || '<p style="color:#94a3b8;padding:10px;text-align:center;">（该文件夹没有扫描到视频）</p>'}
        </div>
        <div class="form-actions">
          <button class="btn btn-secondary" onclick="_p115ForcePicker=true;showP115UpdateWizard(${updateCourseId})">← 重新选文件夹</button>
          <button class="btn btn-primary" id="netdisk-confirm-update">✅ 确认同步</button>
        </div>`;
      document.getElementById('netdisk-confirm-update').addEventListener('click', async function () {
        var btn = document.getElementById('netdisk-confirm-update');
        btn.disabled = true; btn.textContent = '⏳ 同步中...';
        try {
          var up = await api.updateCourseNetdisk({
            courseId: updateCourseId,
            title: (draft.title || folderName),
            sourcePath: '/115/' + folderName,
            sourceDirId: dirId || '0',
            sourceCfgId: cfgId || null,
            chapters: chapters,
          });
          if (!up || up.success === false) throw new Error((up && up.error) || '同步失败');
          alert('✅ 已同步：' + (draft.title || folderName));
          closeModal();
          if (typeof viewCourseDetail === 'function') viewCourseDetail(updateCourseId);
        } catch (e) {
          alert('同步失败：' + (e.message || e));
          btn.disabled = false; btn.textContent = '✅ 确认同步';
        }
      });
      return;
    }
    showDraftEditModalOneShot(draft, '/115/' + folderName, 'p115');
  } catch (e) {
    modal.innerHTML = `
      <h2>❌ 扫描失败</h2>
      <div class="scan-step-tip">${escapeHtml(e.message || String(e))}</div>
      <div class="form-actions">
        <button class="btn btn-secondary" onclick="_p115ForcePicker=true;_p115UpdateCourseId ? showP115UpdateWizard(_p115UpdateCourseId) : showP115PickWizard()">← 返回浏览</button>
        <button class="btn btn-primary" onclick="closeModal()">关闭</button>
      </div>`;
  }
}