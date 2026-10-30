// ============================================================
//  课程新增/编辑弹窗 与 上传配置管理 (course-modal.js)
// ============================================================
async function showCourseModal(courseId) {
  const categories = await api.getCategories();
  let detail = null;
  if (courseId) detail = await api.getCourseDetail(courseId);

  const modal = document.getElementById('modal-container');
  modal.classList.add('course-modal');
  const quickEntryHtml = courseId ? '' : `
    <div class="cm-quick-grid">
      <button type="button" class="cm-quick-btn cm-quick-netdisk" onclick="showP115PickWizard()">
        <span class="cm-quick-ic">🎬</span>
        <div class="cm-quick-txt">
          <div class="cm-quick-title">从 115 网盘选文件夹</div>
          <div class="cm-quick-sub">浏览网盘目录，文件夹自动成课程</div>
        </div>
      </button>
      <button type="button" class="cm-quick-btn cm-quick-manual" onclick="document.getElementById('modal-container').scrollTop=document.getElementById('f-course-mode').offsetTop-60;">
        <span class="cm-quick-ic">✍️</span>
        <div class="cm-quick-txt">
          <div class="cm-quick-title">手动填写课程</div>
          <div class="cm-quick-sub">手动创建章节、上传视频</div>
        </div>
      </button>
    </div>`;
  modal.innerHTML = `
    <div class="cm-head">
      <div class="cm-head-tag">
        <span class="cm-head-grad"></span>
        <div>
          <h2 class="cm-title">${courseId ? '编辑课程' : '添加课程'}</h2>
          <div class="cm-subtitle">${courseId ? '调整课程信息，保存后立即生效' : '填写下方信息，创建一门新课程'}</div>
        </div>
      </div>
    </div>
    ${quickEntryHtml}
    <div class="cm-field cm-field-inline">
      <label>课程模式</label>
      <select id="f-course-mode">
        <option value="manual" ${detail && (detail.courseMode === 'manual' || detail.courseMode === 'token' || detail._manual) ? 'selected' : ''}>✍️ 手动课程</option>
        <option value="netdisk" ${detail && detail.courseMode === 'netdisk' ? 'selected' : ''}>☁️ 网盘课程</option>
      </select>
    </div>
    <div class="cm-field cm-field-inline">
      <label>课程名称 <em>*</em></label>
      <input id="f-title" placeholder="例如：Python 编程入门" value="${escapeAttr(detail ? detail.title : '')}">
    </div>
    <div class="cm-field cm-field-inline">
      <label>课程分类</label>
      <select id="f-category">${categories.map((c) => `<option value="${c.id}" ${detail && String(detail.categoryId || detail.category_id) === String(c.id) ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}</select>
    </div>
    <div class="cm-section-title">
      <span class="cm-section-dot"></span>课程封面图
      <span class="cm-section-opt">可选</span>
    </div>
    <div class="cm-cover-card">
      <div id="cover-preview" class="cm-cover-preview">
        ${detail && detail.coverImage ? `<img src="${escapeAttr(detail.coverImage)}" style="width:100%;height:100%;object-fit:cover;">` : '<span style="color:#94a3b8;font-size:12px;">暂无图片</span>'}
      </div>
      <div class="cm-cover-ops">
        <div class="cm-cover-btns">
          <button type="button" class="btn btn-secondary btn-sm" id="btn-pick-cover">📷 上传封面图片</button>
          <button type="button" class="btn btn-secondary btn-sm" id="btn-clear-cover" style="${detail && detail.coverImage ? '' : 'display:none;'}">❌ 清除</button>
        </div>
        <input id="f-coverImage" value="${escapeAttr(detail ? detail.coverImage || '' : '')}" placeholder="或粘贴图片 URL（https://...）" class="cm-cover-url">
        <div class="cm-cover-tip">支持 jpg / png / gif / webp；不选则使用默认颜色渐变</div>
      </div>
    </div>
    <div class="cm-section-title">
      <span class="cm-section-dot"></span>课程简介
      <span class="cm-section-opt">可选</span>
    </div>
    <div class="cm-field">
      <textarea id="f-description" rows="3" placeholder="简单介绍一下这门课程…">${escapeHtml(detail ? detail.description || '' : '')}</textarea>
    </div>
    <div class="cm-actions">
      <button class="btn btn-secondary" onclick="closeModal()">取消</button>
      <button class="btn btn-primary cm-save-btn" id="btn-save-course">保存课程</button>
    </div>`;

  document.getElementById('modal-overlay').classList.remove('hidden');

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

  document.getElementById('btn-save-course').addEventListener('click', async () => {
    const modeSel = document.getElementById('f-course-mode');
    const courseMode = (modeSel && modeSel.value) || 'manual';
    const gv = (id, def = '') => {
      const el = document.getElementById(id);
      return el ? (el.value || '').trim() : def;
    };
    const isManual = courseMode === 'manual';
    const data = {
      courseId: courseId || undefined,
      categoryId: parseInt(document.getElementById('f-category').value) || 1,
      title: gv('f-title'),
      description: gv('f-description'),
      coverImage: gv('f-coverImage'),
      _manual: isManual,
      courseMode,
    };
    if (!data.title) { alert('请输入课程名称'); return; }
    const saveBtn = document.getElementById('btn-save-course');
    const fn = courseId ? api.updateCourse : api.addCourse;
    saveBtn.disabled = true;
    saveBtn.textContent = courseId ? '保存中…' : '保存中…';
    let r;
    try {
      r = await fn(data);
    } catch (e) {
      r = { success: false, error: e.message || String(e) };
    }
    if (r && r.success) {
      closeModal();
      if (currentPage === 'course-mgmt') {
        loadCourseMgmt();
      } else {
        loadCourses();
      }
    } else {
      saveBtn.disabled = false;
      saveBtn.textContent = '保存';
      alert('保存失败: ' + ((r && r.error) || '未知错误'));
    }
  });
}

// ============================================================
//  配置管理（独立存储，不干扰源配置）
// ============================================================
async function loadUploadConfigs() {
  let configs = [];
  try {
    configs = await api.getAllUploadConfigs() || [];
  } catch (e) {
    console.error('[配置管理] 加载上传配置失败:', e);
  }
  if (currentPage !== 'upload-config') return;
  // 隐藏 page-header，标题和按钮移到顶部工具栏
  if (typeof _renderTopbarTitle === 'function') {
    _renderTopbarTitle('配置管理',
      '<button type="button" class="btn btn-primary" id="topbar-add-upload-config" style="padding:8px 16px;font-size:13px;">+ 添加配置</button>');
  }
  const addUcBtn = document.getElementById('topbar-add-upload-config');
  if (addUcBtn) addUcBtn.addEventListener('click', () => showUploadConfigModal());
  const container = document.getElementById('upload-config-list');
  if (!configs || !configs.length) {
    container.innerHTML = '<p style="text-align:center;color:#94a3b8;padding:40px;">暂无配置，点击右上角添加</p>';
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
    <h2>${configId ? '编辑配置' : '添加配置'}</h2>
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

function editUploadConfig(id) {
  showUploadConfigModal(id);
}

async function deleteUploadConfig(id) {
  if (!(await confirmCustom('确定要删除该配置吗？'))) return;
  const r = await api.deleteUploadConfig(id);
  if (r && r.success) {
    loadUploadConfigs();
  } else {
    alert('删除失败: ' + ((r && r.error) || '未知错误'));
  }
}

// ============================================================
//  115 配置管理
// ============================================================
async function loadP115Configs() {
  let configs = [];
  try {
    configs = await api.getAllP115Configs() || [];
  } catch (e) {
    console.error('[115配置] 加载失败:', e);
  }
  if (currentPage !== 'upload-config') return;
  const container = document.getElementById('p115-config-list');
  if (!configs || !configs.length) {
    container.innerHTML = '<p style="text-align:center;color:#94a3b8;padding:40px;">暂无配置，点击右上角添加</p>';
    return;
  }
  container.innerHTML = configs.map((c) => {
    const loggedIn = !!(c.authToken && c.refreshToken);
    return `
    <div class="source-card">
      <div class="source-info">
        <h3>${escapeHtml(c.name || '未命名配置')} ${loggedIn ? '<span style="font-size:12px;color:#10b981;">● 已登录</span>' : '<span style="font-size:12px;color:#ef4444;">● 未登录</span>'}</h3>
        <p>账号: ${escapeHtml(c.username || '-')}</p>
        <p>UID: ${escapeHtml(c.uid || '-')}</p>
        <p>authorize Token: ${c.authToken ? escapeHtml(String(c.authToken).slice(0, 12) + '...') : '未设置'}</p>
      </div>
      <div class="source-actions">
        <button class="btn btn-primary btn-sm" onclick="editP115Config('${c.id}')">✏️</button>
        <button class="btn btn-danger btn-sm" onclick="deleteP115Config('${c.id}')">🗑️</button>
      </div>
    </div>`;
  }).join('');
}

// ===== 115 网盘文件浏览 =====
let _p115Configs = [];
let _p115CurrentToken = '';
let _p115CurrentRefreshToken = '';
let _p115CurrentCfgId = '';
let _p115PathStack = [{ cid: '0', name: '根目录' }];
let _p115ViewMode = 'grid'; // grid: 小图标卡片, list: 列表行
let _p115DirItems = [];
let _p115CurrentPlaying = null;
let _p115PlaySeq = 0;

// ===== 115 失效诊断：区分 access_token / refresh_token 失效 + 刷新失败原因 =====
function _p115FailExplain(r, freshen, errMsg) {
  const rf = freshen || {};
  const msg = errMsg || (r && r.error) || '未知错误';
  const hasDiag = r && (r.refreshFailed !== undefined || r.refreshFrozen !== undefined || r.refreshCode !== undefined);

  // 1) refresh_token 终态失效：无法自动续期，必须重新扫码
  if (rf.frozen || (r && r.refreshFrozen) || (r && r.frozen)) {
    const why = (rf.error && rf.error !== msg) ? rf.error : ((r && r.refreshError) || 'refresh_token 已失效');
    const code = (rf.code || (r && r.refreshCode) || (r && r.code));
    return { title: 'refresh_token 已失效（无法自动续期）', detail: why + (code ? '（错误码 ' + code + '）' : ''), mustRelogin: true };
  }
  // 2) access_token 已过期，尝试过自动刷新但未成功（带诊断）
  if (hasDiag || (r && r.authInvalid)) {
    const why = (r && r.refreshError) || ((rf.error && rf.error !== msg) ? rf.error : '');
    const code = (r && r.refreshCode) || rf.code || (r && r.code);
    return {
      title: 'access_token 已过期，自动刷新未成功',
      detail: why
        ? (why + (code ? '（错误码 ' + code + '）' : ''))
        : ('自动续期未成功，最近一次接口返回：' + msg + '，可稍后手动刷新或重新扫码登录'),
      mustRelogin: !!(rf.frozen || (r && r.refreshFrozen)),
    };
  }
  // 3) access_token 失效，无刷新诊断
  const why = (rf.error && rf.error !== msg) ? rf.error : msg;
  return { title: 'access_token 已过期', detail: why, mustRelogin: false };
}

function p115RenderFailBlock(ex) {
  const actionBtn = ex.mustRelogin
    ? '<button id="p115-relogin-btn" class="btn btn-primary" style="padding:8px 22px;font-size:13px;">📱 重新扫码登录</button>'
    : '<button id="p115-retry-btn" class="btn btn-primary" style="padding:8px 22px;font-size:13px;">🔄 重试</button>';
  return `<div style="text-align:center;color:#ef4444;padding:60px 24px;">
    <div style="font-size:15px;font-weight:600;margin-bottom:10px;">⚠ ${escapeHtml(ex.title)}</div>
    <div style="font-size:13px;color:#b91c1c;margin-bottom:4px;word-break:break-all;">${escapeHtml(ex.detail)}</div>
    <div style="font-size:12px;color:#94a3b8;margin:8px 0 16px;">${ex.mustRelogin ? 'refresh_token 已失效，请重新扫码登录' : '可稍后重试，系统将自动续期'}</div>
    ${actionBtn}
  </div>`;
}

async function loadP115Drive() {
  let configs = [];
  try {
    configs = await api.getAllP115Configs() || [];
  } catch (e) {
    console.error('[115网盘] 加载配置失败:', e);
  }
  if (currentPage !== 'p115') return;
  _p115Configs = configs;

  // 已登录配置：必须有 access_token 和 refresh_token
  const loggedIn = configs.filter(c => c && c.authToken && c.refreshToken);

  const select = document.getElementById('p115-config-select');
  select.innerHTML = '<option value="">选择 115 配置</option>' +
    configs.map(c => `<option value="${c.id}">${escapeHtml(c.name || '未命名')}${c.authToken ? ' ✅' : ''}</option>`).join('');

  // 标题和操作区移到顶部工具栏：像课程详情页一样显示返回+主页按钮
  if (typeof _renderTopbarNav === 'function') {
    _renderTopbarNav('courses', null, '115网盘');
  }
  const topbarLeft = document.getElementById('topbar-left');
  if (topbarLeft && !document.getElementById('topbar-p115-config-select')) {
    const opsWrap = document.createElement('div');
    opsWrap.style.cssText = 'display:inline-flex;align-items:center;gap:8px;margin-left:12px;';
    opsWrap.innerHTML =
      '<select id="topbar-p115-config-select" style="padding:6px 10px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;background:#fff;">' +
      '<option value="">选择 115 配置</option>' +
      configs.map(c => `<option value="${c.id}">${escapeHtml(c.name || '未命名')}${c.authToken ? ' ✅' : ''}</option>`).join('') +
      '</select>' +
      '<button id="topbar-p115-refresh" class="btn btn-secondary" style="padding:6px 14px;font-size:13px;">刷新</button>';
    topbarLeft.appendChild(opsWrap);
  }

  const topSelect = document.getElementById('topbar-p115-config-select');
  const topRefresh = document.getElementById('topbar-p115-refresh');
  const breadcrumbEl = document.getElementById('p115-breadcrumb');
  const fileListEl = document.getElementById('p115-file-list');

  function enterConfig(cfg) {
    if (!cfg || !cfg.authToken) {
      // 未登录配置：提示并展示扫码登录
      fileListEl.innerHTML = p115RenderNeedLogin('该配置尚未登录');
      const launch = document.getElementById('p115-qr-launch');
      if (launch) launch.onclick = () => startP115QrLogin(cfg ? String(cfg.id) : '');
      return;
    }
    _p115CurrentToken = cfg.authToken || '';
    _p115CurrentRefreshToken = cfg.refreshToken || '';
    _p115CurrentCfgId = String(cfg.id || '');
    console.log('[115网盘] enterConfig cfgId=' + _p115CurrentCfgId +
      '\n  authToken=' + (_p115CurrentToken || '(空)') +
      '\n  refreshToken=' + (_p115CurrentRefreshToken || '(空)') +
      '\n  db_tokenExpiresAt=' + (cfg.tokenExpiresAt || '未存') +
      '\n  db_refreshTokenExpiresAt=' + (cfg.refreshTokenExpiresAt || '未存'));
    _p115PathStack = [{ cid: '0', name: '根目录' }];
    // 预热主进程 token 缓存，提前调度自动刷新
    if (typeof api.warm115Token === 'function' && _p115CurrentRefreshToken) {
      api.warm115Token(_p115CurrentCfgId, _p115CurrentToken, _p115CurrentRefreshToken);
    }
    p115LoadDirectory('0');
    p115LoadUserInfo(cfg);
  }

  function bindSelectEvents(sel) {
    if (!sel) return;
    sel.onchange = () => {
      const cfg = configs.find(c => String(c.id) === String(sel.value));
      enterConfig(cfg);
    };
  }

  if (topRefresh) {
    topRefresh.onclick = async () => {
      const btn = topRefresh;
      const origText = btn.textContent;
      btn.disabled = true;
      btn.textContent = '加载中…';
      const restore = () => { btn.disabled = false; btn.textContent = origText; };
      try {
        // 强制刷新：真正调用 115 /open/refreshToken（而非懒刷新的缓存命中）
        if (_p115CurrentRefreshToken) {
          const r = await api.refresh115Token(_p115CurrentCfgId || '', _p115CurrentRefreshToken || '');
          if (r && r.success && r.accessToken) {
            _p115CurrentToken = r.accessToken;
            if (r.refreshToken) _p115CurrentRefreshToken = r.refreshToken;
            console.log('[115刷新] 强制刷新成功 ✓' +
              '\n  新 accessToken=' + r.accessToken +
              '\n  新 refreshToken=' + (r.refreshToken || '(未滚动)'));
          } else {
            const ex = _p115FailExplain(
              { ...r, refreshFrozen: !!(r && r.frozen), refreshCode: r && r.code, refreshError: (r && r.error) || '强制刷新失败' },
              {},
              (r && r.error) || '强制刷新失败'
            );
            restore();
            alert('⚠ ' + ex.title + '\n' + ex.detail + (ex.mustRelogin ? '\n\n请重新扫码登录' : '\n\n可稍后再试'));
            return;
          }
        }
        if (!_p115CurrentToken) { restore(); return; }
        await p115LoadDirectory(_p115PathStack[_p115PathStack.length - 1].cid);
      } catch (e) {
        console.error('[115刷新] 异常:', e);
        restore();
        alert('刷新异常：' + ((e && e.message) || e));
      } finally {
        restore();
      }
    };
  }

  // 跨 Electron prompt() 禁用的自定义输入框弹窗：用项目已有的 modal 系统
function p115Prompt(title, placeholder) {
  return new Promise((resolve) => {
    const modal = document.getElementById('modal-container');
    const overlay = document.getElementById('modal-overlay');
    modal.innerHTML = `
      <div class="modal-box">
        <h3 class="modal-title" style="margin:0 0 14px;font-size:15px;color:#1e293b;">${escapeHtml(title || '请输入')}</h3>
        <input id="p115-prompt-input" type="text" placeholder="${escapeAttr(placeholder || '')}"
          style="width:100%;padding:10px 12px;border:1px solid #e2e8f0;border-radius:8px;font-size:14px;outline:none;box-sizing:border-box;">
        <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:18px;">
          <button class="btn btn-secondary" id="p115-prompt-cancel">取消</button>
          <button class="btn btn-primary" id="p115-prompt-ok">确定</button>
        </div>
      </div>`;
    overlay.classList.remove('hidden');
    const input = document.getElementById('p115-prompt-input');
    const okBtn = document.getElementById('p115-prompt-ok');
    const cancelBtn = document.getElementById('p115-prompt-cancel');
    let settled = false;
    const done = (val) => {
      if (settled) return;
      settled = true;
      closeModal();
      resolve(val);
    };
    input.focus();
    input.select();
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); done(input.value.trim()); }
      else if (e.key === 'Escape') { e.preventDefault(); done(null); }
    });
    okBtn.addEventListener('click', () => done(input.value.trim()));
    cancelBtn.addEventListener('click', () => done(null));
    overlay.addEventListener('click', () => done(null), { once: true });
  });
}

// 新建文件夹
  const btnNewFolder = document.getElementById('btn-p115-newfolder');
  console.log('[p115] btnNewFolder element=', !!btnNewFolder);
  if (btnNewFolder) btnNewFolder.onclick = async () => {
    try {
      console.log('[p115] btnNewFolder clicked, _p115CurrentToken=', !!_p115CurrentToken);
      if (!_p115CurrentToken) { alert('请先登录 115 网盘'); return; }
      const name = await p115Prompt('请输入新文件夹名称', '例如：课程资料');
      if (!name || !name.trim()) return;
      const parentId = _p115PathStack[_p115PathStack.length - 1].cid;
      if (!parentId) { alert('当前目录异常，请刷新页面重试'); return; }
      let accessToken = _p115CurrentToken;
      const freshen = await p115SilentRefresh();
      if (freshen && freshen.success) accessToken = _p115CurrentToken;
      const r = await api.create115Folder(_p115CurrentCfgId, accessToken, parentId, name.trim());
      console.log('[p115] create115Folder result=', r);
      if (!r || !r.success) {
        const errMsg = (r && r.error) || '未知错误';
        const shouldRefresh = (r && (r.tokenExpired || r.authInvalid)) || /token|401|未授权|已失效|expired/i.test(errMsg);
        if (shouldRefresh && !r.frozen) {
          const f2 = await p115SilentRefresh();
          if (f2 && f2.success) {
            const r2 = await api.create115Folder(_p115CurrentCfgId, _p115CurrentToken, parentId, name.trim());
            if (r2 && r2.success) { p115LoadDirectory(parentId); return; }
            alert('新建文件夹失败：' + ((r2 && r2.error) || errMsg));
            return;
          }
        }
        alert('新建文件夹失败：' + errMsg);
        return;
      }
      p115LoadDirectory(parentId);
    } catch (e) {
      console.error('[p115] btnNewFolder error', e);
      alert('新建文件夹异常：' + (e && e.message ? e.message : String(e)));
    }
  };

  // 上传文件
  const btnUpload = document.getElementById('btn-p115-upload');
  const fileInput = document.getElementById('p115-file-input');
  const progressEl = document.getElementById('p115-upload-progress');
  if (btnUpload) btnUpload.onclick = () => {
    if (!_p115CurrentToken) { alert('请先登录 115 网盘'); return; }
    if (fileInput) fileInput.click();
  };
  if (fileInput) fileInput.onchange = () => {
    const files = Array.from(fileInput.files || []);
    if (!files.length) return;
    const parentId = _p115PathStack[_p115PathStack.length - 1].cid;
    p115UploadFiles(files, parentId, progressEl);
    fileInput.value = '';
  };

  bindSelectEvents(select);
  bindSelectEvents(topSelect);

  // 上一集 / 下一集按钮（当前目录内切换视频文件）
  const btnPrev = document.getElementById('p115-btn-prev');
  const btnNext = document.getElementById('p115-btn-next');
  if (btnPrev) {
    if (btnPrev._prevHandler) btnPrev.removeEventListener('click', btnPrev._prevHandler);
    btnPrev._prevHandler = () => _p115NavigateVideo(-1);
    btnPrev.addEventListener('click', btnPrev._prevHandler);
  }
  if (btnNext) {
    if (btnNext._nextHandler) btnNext.removeEventListener('click', btnNext._nextHandler);
    btnNext._nextHandler = () => _p115NavigateVideo(1);
    btnNext.addEventListener('click', btnNext._nextHandler);
  }

  // 查看方式切换：小图标 / 列表，并重新渲染当前目录
  const viewSelect = document.getElementById('p115-view-select');
  if (viewSelect) {
    viewSelect.value = _p115ViewMode;
    viewSelect.onchange = () => {
      _p115ViewMode = (viewSelect.value === 'list') ? 'list' : 'grid';
      const top = _p115PathStack[_p115PathStack.length - 1];
      if (top) p115LoadDirectory(top.cid);
    };
  }

  if (loggedIn.length > 0) {
    // 有已登录配置：直接进入
    const first = loggedIn[0];
    if (select) select.value = first.id;
    if (topSelect) topSelect.value = first.id;
    enterConfig(first);
  } else {
    // 无已登录配置：展示扫码登录界面
    breadcrumbEl.innerHTML = '';
    fileListEl.innerHTML = p115RenderNeedLogin();
    const launch = document.getElementById('p115-qr-launch');
    if (launch) launch.onclick = () => startP115QrLogin('');
  }
}

// 渲染「未登录 / 需要扫码」界面
function p115RenderNeedLogin(hint) {
  const el = document.getElementById('p115-user-info');
  if (el) el.innerHTML = '';
  return `
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:70px 20px;text-align:center;">
      <div style="font-size:48px;margin-bottom:16px;">☁️</div>
      <div style="font-size:16px;font-weight:600;color:#475569;">${escapeHtml(hint || '尚未登录 115 网盘')}</div>
      <div style="font-size:13px;color:#94a3b8;margin-top:6px;">点击下方按钮，使用「115 APP」扫码登录后即可浏览网盘</div>
      <button id="p115-qr-launch" class="btn btn-primary" style="margin-top:20px;padding:10px 26px;font-size:14px;">📱 扫码登录 115</button>
      <div id="p115-page-qr-area" style="display:none;margin-top:16px;text-align:center;">
        <img id="p115-page-qr-img" alt="二维码" style="width:220px;height:220px;border:1px solid #e2e8f0;border-radius:8px;background:#fff;">
        <p id="p115-page-qr-hint" style="font-size:13px;color:#64748b;margin-top:6px;">请使用「115 APP」扫描二维码登录</p>
      </div>
      <div id="p115-page-login-status" style="font-size:13px;color:#94a3b8;margin-top:10px;">&nbsp;</div>
    </div>`;
}

// ===== 115 页面内嵌扫码登录 =====
let _p115QrPollTimer = null;
function stopP115QrPoll() {
  if (_p115QrPollTimer) {
    if (_p115QrPollTimer._t !== undefined) clearTimeout(_p115QrPollTimer._t);
    else clearInterval(_p115QrPollTimer);
    _p115QrPollTimer = null;
  }
}

async function startP115QrLogin(targetCfgId) {
  const statusEl = document.getElementById('p115-page-login-status');
  const qrArea = document.getElementById('p115-page-qr-area');
  const imgEl = document.getElementById('p115-page-qr-img');
  const hintEl = document.getElementById('p115-page-qr-hint');
  function setStatus(text, color) {
    if (statusEl) { statusEl.textContent = text; statusEl.style.color = color || '#94a3b8'; }
  }
  setStatus('⏳ 正在获取二维码...', '#64748b');
  if (qrArea) qrArea.style.display = 'none';

  const initR = await api.login115QrInit();
  if (!initR || !initR.success || !initR.qrImage) {
    setStatus('❌ 获取二维码失败：' + ((initR && initR.error) || '未知错误'), '#ef4444');
    return;
  }
  if (imgEl) imgEl.src = initR.qrImage;
  if (hintEl) hintEl.textContent = '请使用「115 APP」扫描二维码登录';
  if (qrArea) qrArea.style.display = 'block';
  setStatus('🟡 等待扫码...', '#f59e0b');

  const POLL_TOTAL_MS = 3 * 60 * 1000;
  const pollStart = Date.now();

  async function doPoll() {
    if (!_p115QrPollTimer) return;
    if (Date.now() - pollStart > POLL_TOTAL_MS) {
      stopP115QrPoll();
      setStatus('❌ 扫码超时，请重试', '#ef4444');
      if (qrArea) qrArea.style.display = 'none';
      return;
    }
    let stRes;
    try { stRes = await api.check115QrStatus(initR.uid, initR.time, initR.sign); } catch (_) { stRes = null; }
    if (!_p115QrPollTimer) return;
    if (!stRes || !stRes.success) { _p115QrPollTimer = setTimeout(doPoll, 1000); return; }
    if (stRes.status === 1) {
      if (hintEl) hintEl.textContent = '✅ 已扫码，请在手机上确认';
    } else if (stRes.status === 2) {
      stopP115QrPoll();
      if (hintEl) hintEl.textContent = '✅ 扫码成功，正在获取 token...';
      setStatus('⏳ 正在获取 token...', '#64748b');
      const tokenR = await api.exchange115QrToken(initR.uid);
      if (!tokenR || !tokenR.success || !tokenR.accessToken) {
        setStatus('❌ 获取 token 失败：' + ((tokenR && tokenR.error) || '未知错误'), '#ef4444');
        return;
      }
      // 拉取用户信息
      let uid = String(initR.uid || '');
      let userInfo = null;
      try {
        const ui = await api.get115UserInfo(targetCfgId || '', tokenR.accessToken);
        if (ui && ui.success && ui.user) {
          uid = String(ui.user.user_id || initR.uid || '');
          userInfo = ui.user;
        }
      } catch (_) {}

      // 自动保存 / 更新 token 配置
      const cfg = targetCfgId
        ? (_p115Configs || []).find(c => String(c.id) === String(targetCfgId))
        : null;
      const saveItem = {
        id: cfg ? cfg.id : undefined,
        name: cfg ? cfg.name : ('115网盘_' + (uid || Date.now() % 10000)),
        username: (cfg && cfg.username) || (userInfo && userInfo.user_name) || uid || '',
        authToken: tokenR.accessToken,
        refreshToken: tokenR.refreshToken || '',
        uid: uid,
        userInfo: userInfo || undefined,
        tokenExpiresAt: Number(tokenR.expiresIn || 0) > 0 ? Date.now() + Number(tokenR.expiresIn) * 1000 : 0,
        refreshTokenExpiresAt: Number(tokenR.refreshTokenExpiresIn || 0) > 0 ? Date.now() + Number(tokenR.refreshTokenExpiresIn) * 1000 : 0,
      };
      const saveR = await api.saveP115Config(saveItem);
      if (saveR && saveR.success) {
        setStatus('✅ 登录成功，Token 已保存（' + uid + '）', '#10b981');
        if (qrArea) qrArea.style.display = 'none';
        // 预热主进程 token 缓存，调度自动刷新
        if (typeof api.warm115Token === 'function') {
          api.warm115Token(String(saveItem.id || ''), saveItem.authToken, saveItem.refreshToken);
        }
        // 进入目录页
        loadP115Drive();
      } else {
        setStatus('❌ 保存配置失败：' + ((saveR && saveR.error) || '未知错误'), '#ef4444');
      }
      return;
    } else if (stRes.status === 0) {
      stopP115QrPoll();
      setStatus('❌ 二维码已失效，请重新扫码登录', '#ef4444');
      if (qrArea) qrArea.style.display = 'none';
      return;
    }
    _p115QrPollTimer = setTimeout(doPoll, 1000);
  }
  _p115QrPollTimer = { _t: null };
  _p115QrPollTimer._t = setTimeout(doPoll, 500);
}

async function p115LoadUserInfo(cfg) {
  const infoEl = document.getElementById('p115-user-info');
  if (!infoEl) return;
  if (!cfg) {
    infoEl.innerHTML = '';
    return;
  }

  // 优先使用登录时捕获的用户信息
  if (cfg.userInfo && (cfg.userInfo.user_id || cfg.userInfo.user_name)) {
    p115RenderUserInfo(cfg.userInfo);
    return;
  }

  // 回退：尝试用 access_token 调用开放平台接口
  if (cfg.authToken) {
    infoEl.innerHTML = '<div style="color:#64748b;font-size:12px;">正在获取用户信息...</div>';
    try {
      const r = await api.get115UserInfo(_p115CurrentCfgId, cfg.authToken);
      if (r && r.__newAccessToken) {
        _p115CurrentToken = r.__newAccessToken;
        if (r.__newRefreshToken) _p115CurrentRefreshToken = r.__newRefreshToken;
      }
      if (currentPage !== 'p115') return;
      if (r && r.success && r.user) {
        p115RenderUserInfo(r.user);
      } else {
        infoEl.innerHTML = `<div style="color:#94a3b8;font-size:12px;">暂无用户信息</div>`;
      }
    } catch (e) {
      infoEl.innerHTML = `<div style="color:#94a3b8;font-size:12px;">暂无用户信息</div>`;
    }
  } else {
    infoEl.innerHTML = '<div style="color:#94a3b8;font-size:12px;">重新登录后可显示用户信息</div>';
  }
}

function p115RenderUserInfo(u) {
  const infoEl = document.getElementById('p115-user-info');
  if (!infoEl) return;
  // is_vip 可能是时间戳（VIP 到期时间），也可能是 0/1
  const isVip = u.is_vip && Number(u.is_vip) > 1;
  const vipExpire = u.is_vip && Number(u.is_vip) > 1000000000 ? new Date(Number(u.is_vip) * 1000) : null;
  const usedPct = u.space_total ? ((u.space_used / u.space_total) * 100).toFixed(1) : 0;
  infoEl.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;padding:10px 14px;background:linear-gradient(135deg,#6366f1,#8b5cf6);border-radius:12px;color:#fff;">
      <div style="width:44px;height:44px;border-radius:50%;background:rgba(255,255,255,.25);display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0;overflow:hidden;">
        ${u.avatar ? `<img src="${escapeHtml(u.avatar)}" style="width:44px;height:44px;object-fit:cover;">` : '👤'}
      </div>
      <div style="flex:1;min-width:0;">
        <div style="font-size:15px;font-weight:600;">${escapeHtml(u.user_name || '115 用户')}</div>
        <div style="font-size:12px;opacity:.85;margin-top:2px;">
          UID: ${escapeHtml(String(u.user_id || '-'))}
          ${u.mobile ? `<span style="margin-left:8px;">📱 ${escapeHtml(u.mobile)}</span>` : ''}
          ${isVip ? '<span style="margin-left:8px;background:#fbbf24;color:#78350f;padding:1px 8px;border-radius:10px;font-size:11px;">VIP</span>' : '<span style="margin-left:8px;background:rgba(255,255,255,.3);padding:1px 8px;border-radius:10px;font-size:11px;">普通</span>'}
        </div>
        ${vipExpire ? `<div style="font-size:11px;opacity:.8;margin-top:2px;">VIP 到期：${vipExpire.getFullYear()}-${String(vipExpire.getMonth()+1).padStart(2,'0')}-${String(vipExpire.getDate()).padStart(2,'0')}</div>` : ''}
        ${u.space_total ? `
          <div style="margin-top:6px;">
            <div style="height:6px;background:rgba(255,255,255,.3);border-radius:3px;overflow:hidden;">
              <div style="height:100%;width:${Math.min(usedPct, 100)}%;background:#fff;border-radius:3px;"></div>
            </div>
            <div style="font-size:11px;opacity:.8;margin-top:2px;">${_p115FormatSize(u.space_used)} / ${_p115FormatSize(u.space_total)} (${usedPct}%)</div>
          </div>` : ''}
      </div>
    </div>`;
}

function p115RenderBreadcrumb() {
  const bc = document.getElementById('p115-breadcrumb');
  bc.innerHTML = _p115PathStack.map((p, i) =>
    `<a href="#" data-idx="${i}" style="color:${i === _p115PathStack.length - 1 ? '#6366f1' : '#64748b'};text-decoration:none;font-size:13px;">${escapeHtml(p.name)}</a>${i < _p115PathStack.length - 1 ? '<span style="color:#cbd5e1;">/</span>' : ''}`
  ).join('');
  bc.querySelectorAll('a').forEach(a => {
    a.onclick = (e) => {
      e.preventDefault();
      const idx = parseInt(a.dataset.idx);
      if (idx >= 0 && idx < _p115PathStack.length) {
        _p115PathStack = _p115PathStack.slice(0, idx + 1);
        p115LoadDirectory(_p115PathStack[idx].cid);
      }
    };
  });
}

// 静默刷新 access_token：复用主进程并发锁，成功后更新前端内存 token
let _p115Refreshing = false;
async function p115SilentRefresh() {
  if (_p115Refreshing) {
    await _p115RefreshWait;
    return { success: !!(_p115CurrentToken && _p115CurrentRefreshToken) };
  }
  if (!_p115CurrentRefreshToken) return { success: false, failure: 'no_refresh' };
  _p115Refreshing = true;
  _p115RefreshWait = (async () => {
    const prevAT = _p115CurrentToken;
    const prevRT = _p115CurrentRefreshToken;
    console.log('[前端] p115SilentRefresh 开始' +
      '\n  cfgId=' + (_p115CurrentCfgId || '') +
      '\n  旧 accessToken=' + prevAT +
      '\n  旧 refreshToken=' + prevRT);
    try {
      const r = await api.ensure115Token(_p115CurrentCfgId || '', _p115CurrentToken || '', _p115CurrentRefreshToken || '');
      if (r && r.success && r.accessToken) {
        _p115CurrentToken = r.accessToken;
        if (r.refreshToken) _p115CurrentRefreshToken = r.refreshToken;
        console.log('[前端] p115SilentRefresh 成功 ✓' +
          '\n  新 accessToken=' + r.accessToken +
          '\n  新 refreshToken=' + (r.refreshToken || '(未轮换)'));
        return { success: true, frozen: false };
      }
      if (r && r.frozen) {
        console.log('[前端] p115SilentRefresh 失败 frozen=true error=' + r.error);
        return { success: false, frozen: true, error: r.error };
      }
      console.log('[前端] p115SilentRefresh 失败 error=' + ((r && r.error) || '未知'));
      return { success: false, frozen: false, error: (r && r.error) || '刷新失败' };
    } catch (e) {
      console.log('[前端] p115SilentRefresh 异常', e);
      return { success: false, frozen: false, error: (e && e.message) || '刷新异常' };
    } finally {
      _p115Refreshing = false;
    }
  })();
  return _p115RefreshWait;
}

// 上传一组文件到 115 网盘指定目录
async function p115UploadFiles(files, dirId, progressEl) {
  if (!files || !files.length) return;
  let accessToken = _p115CurrentToken;
  const freshen = await p115SilentRefresh();
  if (freshen.success) accessToken = _p115CurrentToken;

  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const realPath = (typeof api.getPathForFile === 'function')
      ? api.getPathForFile(f)
      : (f.path || f.name);
    if (progressEl) progressEl.textContent = `上传中 ${i + 1}/${files.length}：${f.name}`;
    try {
      if (!realPath) { alert(`无法获取文件真实路径：${f.name}`); continue; }
      const r = await api.upload115File(_p115CurrentCfgId, accessToken, dirId, realPath, f.name);
      if (!r || !r.success) {
        const err = (r && r.error) || '上传失败';
        const shouldRefresh = (r && (r.tokenExpired || r.authInvalid)) || /token|401|未授权|已失效|expired/i.test(err);
        if (shouldRefresh && !r.frozen) {
          const f2 = await p115SilentRefresh();
          if (f2.success) {
            const r2 = await api.upload115File(_p115CurrentCfgId, _p115CurrentToken, dirId, realPath, f.name);
            if (r2 && r2.success) { if (progressEl) progressEl.textContent = `✅ ${f.name} 上传成功`; continue; }
            alert('上传失败：' + ((r2 && r2.error) || err));
            continue;
          }
        }
        alert(`上传失败：${f.name}\n${err}`);
        continue;
      }
      if (progressEl) progressEl.textContent = `✅ ${f.name} 上传成功`;
    } catch (e) {
      alert(`上传异常：${f.name}\n${(e && e.message) || e}`);
    }
  }
  if (progressEl) setTimeout(() => { progressEl.textContent = ''; }, 2500);
  p115LoadDirectory(dirId);
}

async function p115LoadDirectory(cid, _retried) {
  if (!_p115CurrentToken) {
    document.getElementById('p115-file-list').innerHTML =
      '<p style="text-align:center;color:#94a3b8;padding:60px;">请先登录 115 网盘</p>';
    return;
  }
  document.getElementById('p115-file-list').innerHTML =
    '<p style="text-align:center;color:#94a3b8;padding:60px;">加载中...</p>';
  p115RenderBreadcrumb();

  try {
    const r = await api.list115DirectoryByToken(_p115CurrentCfgId, _p115CurrentToken, cid);
    if (currentPage !== 'p115') return;
    // 后端自动续期后会附加新 token，同步到前端
    if (r && r.__newAccessToken) {
      console.log('[115] 收到后端自动续期的新 token' +
        '\n  旧 accessToken=' + _p115CurrentToken +
        '\n  新 accessToken=' + r.__newAccessToken +
        (r.__newRefreshToken ? '\n  新 refreshToken=' + r.__newRefreshToken : ''));
      _p115CurrentToken = r.__newAccessToken;
      if (r.__newRefreshToken) _p115CurrentRefreshToken = r.__newRefreshToken;
    }
    if (!r || !r.success) {
      const errMsg = (r && r.error) || '未知错误';
      const isTokenExpired = (r && (r.tokenExpired || r.authInvalid)) || errMsg.includes('token') || errMsg.includes('401') || errMsg.includes('已过期') || errMsg.includes('未授权') || (r && r.code === 401) || errMsg.includes('990001') || errMsg.includes('重新登录');
      if (r && (r.frozen || r.refreshFrozen)) {
        document.getElementById('p115-file-list').innerHTML =
          p115RenderFailBlock(_p115FailExplain(r, {}, errMsg));
        const rb = document.getElementById('p115-relogin-btn');
        if (rb) rb.onclick = () => { document.getElementById('p115-file-list').innerHTML = p115RenderNeedLogin('登录已失效，请重新扫码登录'); const l = document.getElementById('p115-qr-launch'); if (l) l.onclick = () => startP115QrLogin(_p115CurrentCfgId || ''); };
        return;
      }
      // 静默刷新重试：token 失效且尚未重试过，且还有 refresh_token
      console.log('[115网盘] listDir 失败，isTokenExpired=' + isTokenExpired + ' frozen=' + (r && r.frozen),
                  'authInvalid=' + (r && r.authInvalid) + ' _retried=' + _retried +
                  ' refreshFailed=' + !!(r && r.refreshFailed) +
                  ' refreshFrozen=' + !!(r && r.refreshFrozen),
                  'hasRefreshToken=' + !!_p115CurrentRefreshToken + ' refreshTokenLen=' + (_p115CurrentRefreshToken ? _p115CurrentRefreshToken.length : 0));
      if (isTokenExpired && !_retried && _p115CurrentRefreshToken) {
        const freshen = await p115SilentRefresh();
        if (freshen.success && _p115CurrentToken) {
          await p115LoadDirectory(cid, true);
          return;
        }
        document.getElementById('p115-file-list').innerHTML =
          p115RenderFailBlock(_p115FailExplain(r, freshen, errMsg));
        const relogin2 = document.getElementById('p115-relogin-btn');
        const retry2 = document.getElementById('p115-retry-btn');
        if (relogin2) relogin2.onclick = () => { document.getElementById('p115-file-list').innerHTML = p115RenderNeedLogin('登录已失效，请重新扫码登录'); const l = document.getElementById('p115-qr-launch'); if (l) l.onclick = () => startP115QrLogin(_p115CurrentCfgId || ''); };
        if (retry2) retry2.onclick = () => p115LoadDirectory(cid);
        return;
      }
      const ex = _p115FailExplain(r, {}, errMsg);
      const failHtml = p115RenderFailBlock(ex) +
        `<p style="text-align:center;color:#94a3b8;font-size:12px;margin-top:-36px;">最近一次接口返回：${escapeHtml(errMsg)}</p>`;
      document.getElementById('p115-file-list').innerHTML = failHtml;
      const reloginEnd = document.getElementById('p115-relogin-btn');
      const retryEnd = document.getElementById('p115-retry-btn');
      if (reloginEnd) reloginEnd.onclick = () => {
        document.getElementById('p115-file-list').innerHTML = p115RenderNeedLogin('登录已失效，请重新扫码登录');
        const launch = document.getElementById('p115-qr-launch');
        if (launch) launch.onclick = () => startP115QrLogin(_p115CurrentCfgId || '');
      };
      if (retryEnd) retryEnd.onclick = () => p115LoadDirectory(cid);
      return;
    }
    const items = r.items || [];
    if (!items.length) {
      document.getElementById('p115-file-list').innerHTML =
        '<p style="text-align:center;color:#94a3b8;padding:60px;">空目录</p>';
      return;
    }
    const folders = items.filter(i => i.isDir);
    const files = items.filter(i => !i.isDir);
    const sorted = [...folders.sort((a, b) => a.name.localeCompare(b.name)), ...files.sort((a, b) => a.name.localeCompare(b.name))];
    _p115DirItems = sorted;

    // 切换目录时重置播放器状态（隐藏 video，恢复封面 placeholder）
    const _player = document.getElementById('p115-player');
    const _ph = document.getElementById('p115-player-placeholder');
    if (_player) { try { _player.pause(); } catch (_) {} _player.style.display = 'none'; _player.removeAttribute('src'); _player.load(); }
    if (_ph) _ph.style.display = 'flex';
    const _vTitle = document.getElementById('p115-player-title');
    const _vSub = document.getElementById('p115-player-subtitle');
    if (_vTitle) _vTitle.textContent = '视频播放';
    if (_vSub) _vSub.textContent = '';
    _p115CurrentPlaying = null;

    const listEl = document.getElementById('p115-file-list');
    if (_p115ViewMode === 'list') {
      listEl.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:2px;">
        ${sorted.map((it, i) => {
          const rawName = String(it.name || '');
          return `
          <div class="p115-item" data-cid="${it.cid || ''}" data-name="${escapeHtml(it.name)}" data-isdir="${it.isDir ? 1 : 0}" data-pickcode="${escapeHtml(it.pickCode || '')}" data-sha="${escapeHtml(it.sha || '')}" style="cursor:pointer;display:flex;align-items:center;gap:12px;padding:8px 12px;border-radius:8px;background:#fff;transition:background .15s;border-bottom:1px solid #f1f5f9;">
            <span style="font-size:22px;flex-shrink:0;pointer-events:none;width:24px;text-align:center;">${it.isDir ? '📁' : _p115FileIcon(it.name)}</span>
            <span title="${escapeAttr(rawName)}" style="flex:1;font-size:13px;color:#475569;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:none;">${escapeHtml(rawName)}</span>
            ${!it.isDir ? `<span style="flex-shrink:0;font-size:11px;color:#94a3b8;pointer-events:none;">${_p115FormatSize(it.size)}</span>` : ''}
          </div>`;
        }).join('')}
      </div>`;
    } else {
      listEl.innerHTML = `
      <div class="course-grid" style="grid-template-columns:repeat(4,1fr);gap:12px;">
        ${sorted.map((it, i) => {
          const rawName = String(it.name || '');
          const nLen = rawName.length;
          const shortName = nLen > 10 ? rawName.slice(0, 10) + '…' : rawName;
          const nameFont = nLen >= 9 ? 11 : nLen >= 6 ? 12 : nLen >= 3 ? 13 : 14;
          return `
          <div class="p115-item" data-cid="${it.cid || ''}" data-name="${escapeHtml(it.name)}" data-isdir="${it.isDir ? 1 : 0}" data-pickcode="${escapeHtml(it.pickCode || '')}" data-sha="${escapeHtml(it.sha || '')}" style="cursor:pointer;position:relative;border:1px solid #e2e8f0;border-radius:10px;padding:12px;text-align:center;background:#fff;transition:all .15s;">
            <div style="font-size:32px;pointer-events:none;">${it.isDir ? '📁' : _p115FileIcon(it.name)}</div>
            <div title="${escapeAttr(rawName)}" style="font-size:${nameFont}px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#475569;margin-top:6px;line-height:1.4;pointer-events:none;max-width:100%;">${escapeHtml(shortName)}</div>
            ${!it.isDir ? `<div style="font-size:11px;color:#94a3b8;margin-top:2px;pointer-events:none;">${_p115FormatSize(it.size)}</div>` : ''}
          </div>`;
        }).join('')}
      </div>`;
    }

    document.querySelectorAll('.p115-item').forEach(el => {
      const cid = el.dataset.cid;
      el.onclick = (e) => {
        const isDir = el.dataset.isdir === '1';
        const name = el.dataset.name;
        const pickCode = el.dataset.pickcode || '';
        const sha = el.dataset.sha || '';
        console.log('[115点击] item name=', name, 'isDir=', isDir, 'pickCode=', pickCode, 'sha=', sha, 'cid=', cid);
        if (isDir) {
          _p115PathStack.push({ cid, name });
          p115LoadDirectory(cid);
        } else {
          const ext = (name.split('.').pop() || '').toLowerCase();
          const videoExts = ['mp4', 'm4v', 'mov', 'avi', 'mkv', 'flv', 'webm', 'wmv', 'rmvb', 'rm', 'ts', 'm2ts', '3gp'];
          if (videoExts.includes(ext)) {
            p115PlayVideo(name, pickCode, sha);
          } else {
            alert('文件：' + name + '\n（非视频文件，下载功能待实现）');
          }
        }
      };
    });
  } catch (e) {
    document.getElementById('p115-file-list').innerHTML =
      `<p style="text-align:center;color:#ef4444;padding:60px;">异常：${escapeHtml(e.message || String(e))}</p>`;
  }
}

// 115网盘：在当前目录文件列表中切换上一个/下一个视频文件
function _p115NavigateVideo(delta) {
  if (!_p115DirItems || !_p115DirItems.length) return;
  const videoExts = ['mp4', 'm4v', 'mov', 'avi', 'mkv', 'flv', 'webm', 'wmv', 'rmvb', 'rm', 'ts', 'm2ts', '3gp'];
  const videos = _p115DirItems.filter(it => !it.isDir && videoExts.includes((String(it.name || '').split('.').pop() || '').toLowerCase()));
  if (!videos.length) return;
  let curIdx = -1;
  if (_p115CurrentPlaying) {
    curIdx = videos.findIndex(v => v.name === _p115CurrentPlaying.name && v.pickCode === _p115CurrentPlaying.pickCode);
  }
  let targetIdx;
  if (curIdx < 0) {
    targetIdx = delta > 0 ? 0 : videos.length - 1;
  } else {
    targetIdx = (curIdx + delta + videos.length) % videos.length;
  }
  const target = videos[targetIdx];
  if (target && typeof p115PlayVideo === 'function') {
    p115PlayVideo(target.name || '', target.pickCode || '', target.sha || '');
  }
}

async function p115PlayVideo(name, pickCode, sha) {
  console.log('[115播放] 入口 name=', name, 'pickCode=', pickCode, 'sha=', sha);
  if (!_p115CurrentToken) {
    alert('未登录，无法播放');
    return;
  }
  if (!pickCode) {
    alert('该文件缺少 pick_code，无法播放');
    return;
  }
  const player = document.getElementById('p115-player');
  const placeholder = document.getElementById('p115-player-placeholder');
  const vTitle = document.getElementById('p115-player-title');
  const vSubtitle = document.getElementById('p115-player-subtitle');
  if (!player) return;

  if (placeholder) placeholder.style.display = 'none';
  player.style.display = 'block';
  if (vTitle) vTitle.textContent = name || '视频播放';
  if (vSubtitle) vSubtitle.textContent = '加载中…';
  try { player.pause(); } catch (_) {}
  if (player._p115Flv) {
    try { player._p115Flv.destroy(); } catch (_) {}
    player._p115Flv = null;
  }
  if (player._p115Mse) {
    try { player._p115Mse.destroy(); } catch (_) {}
    player._p115Mse = null;
  }
  player.removeAttribute('src');
  player.load();

  // 保存当前播放文件引用
  _p115CurrentPlaying = { name, pickCode, sha };
  _p115PlaySeq++;
  const _mySeq = _p115PlaySeq;

  // 外置进度条绑定
  const slider = document.getElementById('p115-progress-slider');
  const pctText = document.getElementById('p115-progress-text');
  if (slider) {
    if (slider._p115TimeUpdateHandler) player.removeEventListener('timeupdate', slider._p115TimeUpdateHandler);
    slider._p115TimeUpdateHandler = () => {
      const effDur = _p115EffDuration(player);
      if (effDur && isFinite(effDur) && effDur > 0) {
        const pct = (player.currentTime / effDur) * 100;
        slider.value = pct;
        if (pctText) pctText.textContent = pct.toFixed(1) + '%';
        return;
      }
      // 时长未知时打诊断（限次数，避免刷屏）
      try {
        const _i = (slider._p115DiagC = (slider._p115DiagC || 0) + 1);
        if (_i <= 5) {
          let sEnd = 'N/A';
          try { sEnd = player.seekable && player.seekable.length ? player.seekable.end(player.seekable.length - 1) : 'N/A'; } catch (_) { sEnd = 'err'; }
          console.log('[115视频] [时长未知] currentTime=' + player.currentTime +
            ' duration=' + player.duration +
            ' metaDuration=' + player._p115MetaDuration +
            ' seekable=' + sEnd);
        }
      } catch (_) {}
    };
    player.addEventListener('timeupdate', slider._p115TimeUpdateHandler);

    if (slider._p115SeekHandler) slider.removeEventListener('input', slider._p115SeekHandler);
    slider._p115SeekHandler = () => {
      const effDur = _p115EffDuration(player);
      if (!effDur || !isFinite(effDur) || effDur <= 0) return;
      player.currentTime = (slider.value / 100) * effDur;
    };
    slider.addEventListener('input', slider._p115SeekHandler);
  }

  // 播放结束自动跳下一集
  if (player._p115EndedHandler) player.removeEventListener('ended', player._p115EndedHandler);
  player._p115EndedHandler = () => { _p115NavigateVideo(1); };
  player.addEventListener('ended', player._p115EndedHandler);

  // ===== 网盘播放独立一套：用网盘专用接口 get-115-downurl 取原画直链 → 本地 /stream 边下边播（不落盘）=====
  const r = await api.get115DownUrl(_p115CurrentCfgId, pickCode);
  if (!r || !r.success) {
    const vErr = (r && r.error) || '未知错误';
    if (vTitle) vTitle.textContent = (name || '视频') + '（获取播放地址失败）';
    if (vSubtitle) vSubtitle.textContent = '';
    alert('获取播放地址失败：' + vErr);
    return;
  }
  const directUrl = r.url || '';
  if (!directUrl) {
    if (vTitle) vTitle.textContent = (name || '视频') + '（无有效播放地址）';
    if (vSubtitle) vSubtitle.textContent = '';
    alert('未获取到有效的原画直链');
    return;
  }
  console.log('[115视频] 原画直链:', directUrl.slice(0, 120));

  // 统一用 P115Play 生成流式代理地址（完整指纹 + Range 直达 CDN，边下边播 + 可拖进度条）
  let streamUrl = directUrl;
  try { streamUrl = await window.P115Play.resolveStreamUrl(directUrl, r.streamUrl || ''); } catch (_) {}
  console.log('[115视频] 流式代理地址:', streamUrl.slice(0, 120));

  if (window._p115Hls) {
    try { window._p115Hls.destroy(); } catch (_) {}
    window._p115Hls = null;
  }

  // ─── Native-first：MKV 等容器 Chrome 实际支持 H.264+AAC，先尝试 <video> 原生播放 ───
  // 成功则秒开，失败再走 ffmpeg 转封装兜底
  if (window.P115Play && window.P115Play.canNativeFirst && window.P115Play.canNativeFirst(name)) {
    console.log('[115视频] 尝试原生播放（MKV 等容器）');
    if (vSubtitle) vSubtitle.textContent = '正在加载…';
    player.src = streamUrl;
    var _nfErr = false;
    var _nfHandler = function () { _nfErr = true; };
    player.addEventListener('error', _nfHandler, { once: true });
    player.play().catch(function (_) {});
    await new Promise(function (r) { setTimeout(r, 3000); });
    try { player.removeEventListener('error', _nfHandler); } catch (_) {}
    if (!_nfErr && player.duration && isFinite(player.duration) && player.duration > 0) {
      console.log('[115视频] 原生播放成功 ✓');
      if (vSubtitle) vSubtitle.textContent = '';
      return;
    }
    console.log('[115视频] 原生播放失败，降级转封装');
    try { player.pause(); } catch (_) {}
    player.removeAttribute('src');
    player.load();
  }

  // FLV/TS/MKV/AVI 等容器原生 <video> 无法解码：
  // 三层降级：mpegts.js 直解秒开 → 流式转封装边转边播 → 全量转封装
  // FLV 直接全量转封装（放弃秒播分层），TS/M2TS/MKV 等才走 mpegts/流式
  const _p115NeedRemux = (window.P115Play && window.P115Play.needsRemux) ? window.P115Play.needsRemux(name) : ((String(name).split('.').pop() || '').toLowerCase() === 'flv');
  if (_p115NeedRemux) {
    var _p115IsFlv = window.P115Play && window.P115Play.isFlv && window.P115Play.isFlv(name);

    if (!_p115IsFlv) {
    // ─── Layer 1：mpegts.js 直解（TS/M2TS，零转码秒开；FLV 跳过）───
    if (!_p115IsFlv && window.P115Play && window.P115Play.canMpegts && window.P115Play.canMpegts(name)) {
      if (vSubtitle) vSubtitle.textContent = '正在解码…';
      const mpegtsResult = await window.P115Play.tryMpegts(player, streamUrl, 15000);
      if (mpegtsResult && mpegtsResult.success) {
        console.log('[115] mpegts 播放中（零转码秒开）');
        player.play().catch(e => console.error('[115视频] 播放失败:', e));
        if (vSubtitle) vSubtitle.textContent = '';
        return;
      }
      console.log('[115] mpegts 失败，降级到流式转封装（' + ((mpegtsResult && mpegtsResult.error) || 'unknown') + '）');
    }

    // ─── Layer 2：流式转封装（方案A：ffmpeg 边拉边转 fMP4 → /watch 约1-2s出画面；FLV 直接走此层主力）───
    if (vSubtitle) vSubtitle.textContent = '正在边转边播…';
    if (_p115PlaySeq !== _mySeq) return;
    var _p115L2Failed = false;
    var _p115L2ErrMsg = '';
    try {
      const streamR = await window.P115Play.playStreamingRemux(_p115CurrentCfgId, pickCode);
      if (streamR && streamR.success && streamR.watchUrl) {
          if (_p115PlaySeq !== _mySeq) { console.log('[115] 流式转封装被新请求取消'); return; }
          console.log('[115] 流式转封装播放 watchUrl=' + String(streamR.watchUrl).slice(0, 100));
          var _l2fallback = false;
          var _l2errHandler = function () { _l2fallback = true; };
          player.addEventListener('error', _l2errHandler, { once: true });
          player.src = streamR.watchUrl;
          var _startedPlay2 = false;
          var _tryPlay2 = function () {
            if (_startedPlay2) return;
            _startedPlay2 = true;
            player.play().catch(function (e) { console.error('[115视频] 播放失败:', e); });
          };
          if (player._p115CanplayH2) player.removeEventListener('canplay', player._p115CanplayH2);
          if (player._p115LoadeddataH2) player.removeEventListener('loadeddata', player._p115LoadeddataH2);
          player._p115CanplayH2 = _tryPlay2;
          player._p115LoadeddataH2 = _tryPlay2;
          player.addEventListener('canplay', _tryPlay2);
          player.addEventListener('loadeddata', _tryPlay2);
          setTimeout(_tryPlay2, 3000);
          await new Promise(function (r) { setTimeout(r, 5000); });
          try { player.removeEventListener('error', _l2errHandler); } catch (_) {}
          if (!_l2fallback) {
            if (vSubtitle) vSubtitle.textContent = '';
            return;
          }
          console.log('[115] 流式转封装解码异常，降级到全量转封装');
        } else {
          _p115L2Failed = true;
          _p115L2ErrMsg = (streamR && streamR.error) || '返回无 watchUrl';
        }
      } catch (e) {
        _p115L2Failed = true;
        _p115L2ErrMsg = (e && e.message) || '异常';
      }
      if (_p115L2Failed) console.error('[115] 流式转封装失败: ' + _p115L2ErrMsg + '，降级到全量转封装');
      else console.log('[115] 流式转封装失败，降级到全量转封装');
      try {
        if (player._p115CanplayH2) player.removeEventListener('canplay', player._p115CanplayH2);
        if (player._p115LoadeddataH2) player.removeEventListener('loadeddata', player._p115LoadeddataH2);
        player._p115CanplayH2 = null;
        player._p115LoadeddataH2 = null;
      } catch (_) {}
    } // end：非 FLV 走 mpegts/流式，FLV 直接跳过到全量

    // ─── Layer 3：全量转封装（整片下载+remux→file://；FLV 直接走此层，放弃秒播分层）───
    if (_p115PlaySeq !== _mySeq) return;
    if (typeof api.remux115FlvToMp4 !== 'function') {
      if (vSubtitle) vSubtitle.textContent = '不支持预览';
      alert('播放该格式需要 ffmpeg，主进程未就绪');
      return;
    }
    if (vSubtitle) vSubtitle.textContent = '正在下载并转封装…';
    // 订阅转档进度，实时反馈到字幕
    const _offProg = (typeof api.onRemuxProgress === 'function')
      ? api.onRemuxProgress((p) => {
          if (!p || !vSubtitle) return;
          if (p.stage === 'download') {
            const pct = (p.value == null ? '' : p.value + '%');
            vSubtitle.textContent = pct ? ('正在下载 ' + pct + '…') : '正在下载…';
          } else if (p.stage === 'remux') {
            vSubtitle.textContent = '正在转封装…';
          }
        })
      : null;
    try {
      const r = await api.remux115FlvToMp4(_p115CurrentCfgId, pickCode);
      if (typeof _offProg === 'function') _offProg();
      if (!r || !r.success || !r.filePath) {
        const vErr = (r && r.error) || '启动失败';
        console.error('[115视频] 全量转档失败:', vErr);
        if (vSubtitle) vSubtitle.textContent = '转换失败';
        alert('视频转换失败：' + vErr);
        return;
      }
      console.log('[115视频] 全量转档 filePath=' + r.filePath + ' duration=' + r.duration);
      player.src = r.filePath;
      // 缓存命中时 filePath 立即可播；首次 await 已完成转档，监听 canplay 后 play，避免自动播放策略报错
      let _startedPlay = false;
      const _tryPlay = () => {
        if (_startedPlay) return;
        _startedPlay = true;
        player.play().catch(e => console.error('[115视频] 播放失败:', e));
      };
      if (player._p115CanplayH) player.removeEventListener('canplay', player._p115CanplayH);
      if (player._p115LoadeddataH) player.removeEventListener('loadeddata', player._p115LoadeddataH);
      player._p115CanplayH = _tryPlay;
      player._p115LoadeddataH = _tryPlay;
      player.addEventListener('canplay', _tryPlay);
      player.addEventListener('loadeddata', _tryPlay);
      setTimeout(_tryPlay, 3000); // 兜底
      if (vSubtitle) vSubtitle.textContent = '';
    } catch (e) {
      if (typeof _offProg === 'function') _offProg();
      console.error('[115视频] 全量转档调用异常:', e && e.message);
      if (vSubtitle) vSubtitle.textContent = '转换失败';
      alert('视频播放失败：' + ((e && e.message) || String(e)));
    }
    return;
  }

  console.log('[115视频] 原生播放（/stream 边下边播）');
  player.src = streamUrl;
  player.play().catch(e => console.error('[115视频] 播放失败:', e));
  if (vSubtitle) vSubtitle.textContent = '';
}

function _p115FileIcon(name) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  const map = {
    mp4: '🎬', m4v: '🎬', mov: '🎬', avi: '🎬', mkv: '🎬', flv: '🎬', webm: '🎬',
    jpg: '🖼️', jpeg: '🖼️', png: '🖼️', gif: '🖼️', bmp: '🖼️', webp: '🖼️',
    mp3: '🎵', wav: '🎵', flac: '🎵', aac: '🎵', ogg: '🎵',
    pdf: '📕', doc: '📘', docx: '📘', xls: '📗', xlsx: '📗', ppt: '📙', pptx: '📙',
    zip: '🗜️', rar: '🗜️', '7z': '🗜️', tar: '🗜️', gz: '🗜️',
    txt: '📄', md: '📄', json: '📄',
  };
  return map[ext] || '📄';
}

function _p115FormatSize(bytes) {
  if (!bytes) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0, v = bytes;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return v.toFixed(v >= 100 || i === 0 ? 0 : 1) + ' ' + u[i];
}

// FLV 已改为 ffmpeg remux 成 fMP4 由原生 <video> 播放，时长可由文件正确解析；
// 此处仍保留多级兜底，避免个别封装/meta 异常，只为进度条/seek 取"有效时长"：
// 优先级 remux 返回时长 → player.duration(有限值) → seekable 上界 → 0(未知)
function _p115EffDuration(player) {
  try {
    const meta = Number(player && player._p115MetaDuration);
    if (meta && isFinite(meta) && meta > 0) return meta;
  } catch (_) {}
  try {
    const d = player && Number(player.duration);
    if (d && isFinite(d) && d > 0) return d;
  } catch (_) {}
  try {
    if (player && player.seekable && player.seekable.length) {
      const end = player.seekable.end(player.seekable.length - 1);
      if (end && isFinite(end) && end > 0) return end;
    }
  } catch (_) {}
  return 0;
}

function showP115ConfigModal(configId) {
  let loginResult = null;
  let pollTimer = null;
  const modal = document.getElementById('modal-container');
  modal.innerHTML = `
    <h2>${configId ? '编辑 115 配置' : '添加 115 配置'}</h2>
    <div class="form-group"><label>配置名称</label><input id="f-p115-name" placeholder="例如：我的115网盘"></div>
    <div class="form-group"><label>账号</label><input id="f-p115-username" placeholder="115 账号 / 手机号 / UID"></div>
    <div class="form-group"><label>authorize Token（access_token，扫码后自动填入）</label><input id="f-p115-token" placeholder="115 API access_token"></div>
    <div class="form-group">
      <label>登录状态</label>
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
        <button type="button" class="btn btn-secondary" id="btn-login-115-qr" style="padding:6px 14px;background:#eef2ff;border-color:#6366f1;color:#4f46e5;">📱 扫码登录</button>
        <span id="p115-login-status" style="font-size:13px;color:#94a3b8;">未登录</span>
      </div>
    </div>
    <div id="p115-qr-area" style="display:none;text-align:center;padding:10px 0;">
      <img id="p115-qr-img" alt="二维码" style="width:240px;height:240px;border:1px solid #e2e8f0;border-radius:8px;background:#fff;">
      <p id="p115-qr-hint" style="font-size:13px;color:#64748b;margin-top:6px;">请使用「115 APP」扫描二维码登录</p>
    </div>
    <div class="form-actions">
      <button class="btn btn-secondary" onclick="closeModal()">取消</button>
      <button class="btn btn-primary" id="btn-save-p115-config">保存</button>
    </div>`;

  document.getElementById('modal-overlay').classList.remove('hidden');

  if (configId) {
    api.getAllP115Configs().then((configs) => {
      const c = (configs || []).find((x) => String(x.id) === String(configId));
      if (c) {
        document.getElementById('f-p115-name').value = c.name || '';
        document.getElementById('f-p115-username').value = c.username || '';
        document.getElementById('f-p115-token').value = c.authToken || '';
        if (c.authToken && c.refreshToken) {
          document.getElementById('p115-login-status').textContent = '✅ 已登录（token 已保存）';
          document.getElementById('p115-login-status').style.color = '#10b981';
        }
      }
    });
  }

  // ===== 扫码登录流程 =====
  function stopPoll() {
    if (pollTimer) {
      if (pollTimer._t !== undefined) clearTimeout(pollTimer._t);
      else clearInterval(pollTimer);
      pollTimer = null;
    }
  }
  function setStatus(text, color) {
    const el = document.getElementById('p115-login-status');
    if (el) { el.textContent = text; el.style.color = color || '#94a3b8'; }
  }

  document.getElementById('btn-login-115-qr').addEventListener('click', async () => {
    stopPoll();
    loginResult = null;
    setStatus('⏳ 正在获取二维码...', '#64748b');
    document.getElementById('p115-qr-area').style.display = 'none';

    // ① 获取设备码 + 二维码
    const initR = await api.login115QrInit();
    if (!initR || !initR.success || !initR.qrImage) {
      setStatus('❌ 获取二维码失败：' + ((initR && initR.error) || '未知错误'), '#ef4444');
      return;
    }
    document.getElementById('p115-qr-img').src = initR.qrImage;
    document.getElementById('p115-qr-hint').textContent = '请使用「115 APP」扫描二维码登录';
    document.getElementById('p115-qr-area').style.display = 'block';
    setStatus('🟡 等待扫码...', '#f59e0b');

    // ② 轮询二维码状态（长轮询接口，单次请求最长阻塞约 30~45s）
    //    使用「等待上一次返回后再发起下一次」的递归方式，避免并发堆积
    const POLL_TOTAL_MS = 3 * 60 * 1000; // 总轮询 3 分钟
    let pollStart = Date.now();

    async function doPoll() {
      if (!pollTimer) return; // 已停止
      if (Date.now() - pollStart > POLL_TOTAL_MS) {
        stopPoll();
        setStatus('❌ 扫码超时，请重试', '#ef4444');
        document.getElementById('p115-qr-area').style.display = 'none';
        return;
      }
      let stRes;
      try {
        stRes = await api.check115QrStatus(initR.uid, initR.time, initR.sign);
      } catch (_) {
        stRes = null;
      }
      if (!pollTimer) return;
      if (!stRes || !stRes.success) { pollTimer = setTimeout(doPoll, 1000); return; }
      if (stRes.status === 1) {
        document.getElementById('p115-qr-hint').textContent = '✅ 已扫码，请在手机上确认';
      } else if (stRes.status === 2) {
        stopPoll();
        document.getElementById('p115-qr-hint').textContent = '✅ 扫码成功，正在获取 token...';
        // ③ 兑换 access_token
        const tokenR = await api.exchange115QrToken(initR.uid);
        if (!tokenR || !tokenR.success || !tokenR.accessToken) {
          setStatus('❌ 获取 token 失败：' + ((tokenR && tokenR.error) || '未知错误'), '#ef4444');
          document.getElementById('p115-qr-area').style.display = 'none';
          return;
        }
        loginResult = tokenR;
        document.getElementById('f-p115-token').value = tokenR.accessToken;
        if (!document.getElementById('f-p115-username').value.trim() && initR.uid) {
          document.getElementById('f-p115-username').value = initR.uid;
        }
        // ④ 拉取用户信息（可选），填充账号
        try {
          const ui = await api.get115UserInfo('', tokenR.accessToken);
          if (ui && ui.success && ui.user) {
            const uname = ui.user.user_name || '';
            if (uname && !document.getElementById('f-p115-username').value.trim()) {
              document.getElementById('f-p115-username').value = uname;
            }
            loginResult.uid = String(ui.user.user_id || initR.uid || '');
            loginResult.userInfo = ui.user;
          }
        } catch (_) {}
        setStatus('✅ 登录成功，Token 已获取（' + (loginResult.uid || '') + '）', '#10b981');
        document.getElementById('p115-qr-area').style.display = 'none';
        return;
      } else if (stRes.status === 0) {
        stopPoll();
        setStatus('❌ 二维码已失效，请重新点「扫码登录」', '#ef4444');
        document.getElementById('p115-qr-area').style.display = 'none';
        return;
      }
      // status=-1/-2（暂无扫码事件），继续下一轮
      pollTimer = setTimeout(doPoll, 1000);
    }
    // 用一个非 interval 的句柄对象承载递归定时器
    pollTimer = { _t: null };
    const schedule = () => { pollTimer._t = setTimeout(doPoll, 500); };
    schedule();
  });

  // 关闭/取消时停止轮询
  document.getElementById('modal-overlay').addEventListener('click', stopPoll);

  document.getElementById('btn-save-p115-config').addEventListener('click', async () => {
    stopPoll();
    const item = {
      id: configId || undefined,
      name: document.getElementById('f-p115-name').value.trim(),
      username: document.getElementById('f-p115-username').value.trim(),
      authToken: document.getElementById('f-p115-token').value.trim(),
    };
    if (!item.name) { alert('请输入配置名称'); return; }
    if (loginResult) {
      item.authToken = loginResult.accessToken || item.authToken;
      if (loginResult.refreshToken) item.refreshToken = loginResult.refreshToken;
      if (loginResult.uid) item.uid = loginResult.uid;
      if (loginResult.userInfo) item.userInfo = loginResult.userInfo;
      const ttl = Number(loginResult.expiresIn || 0);
      if (ttl > 0) item.tokenExpiresAt = Date.now() + ttl * 1000;
      const rttl = Number(loginResult.refreshTokenExpiresIn || 0);
      if (rttl > 0) item.refreshTokenExpiresAt = Date.now() + rttl * 1000;
    }
    if (!item.username) {
      alert('请输入账号（115 账号 / 手机号 / UID）');
      return;
    }
    const r = await api.saveP115Config(item);
    if (r && r.success) {
      closeModal();
      if (currentPage === 'p115') {
        loadP115Drive();
      } else {
        loadP115Configs();
      }
    } else {
      alert('保存失败: ' + ((r && r.error) || '未知错误'));
    }
  });
}

function editP115Config(id) {
  showP115ConfigModal(id);
}

async function deleteP115Config(id) {
  if (!(await confirmCustom('确定要删除该 115 配置吗？'))) return;
  const r = await api.deleteP115Config(id);
  if (r && r.success) {
    loadP115Configs();
  } else {
    alert('删除失败: ' + ((r && r.error) || '未知错误'));
  }
}