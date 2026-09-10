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

// ========= 登录状态管理 =========
let _currentLoginUser = null;

function _updateUserInfoBar(user) {
  const nameEl = document.getElementById('user-name');
  const avatarEl = document.getElementById('user-avatar');
  if (!nameEl || !avatarEl) return;
  const displayName = user && user.nickname ? user.nickname : (user && user.username ? user.username : '用户');
  const role = user && user.role || 'user';
  const roleTag = role === 'admin' ? '（管理员）' : '';
  nameEl.textContent = displayName + roleTag;
  const letter = displayName && displayName.length ? displayName.charAt(0).toUpperCase() : 'U';
  if (avatarEl) avatarEl.textContent = letter;
}

function applyRoleVisibility(role) {
  const isAdmin = role === 'admin';
  document.querySelectorAll('[data-role]').forEach(el => {
    const required = el.getAttribute('data-role');
    if (required === 'admin' && !isAdmin) {
      el.style.display = 'none';
    } else {
      el.style.display = '';
    }
  });
  // 清理非管理员残留的 active 状态（如果当前选中了管理页）
  if (!isAdmin) {
    const activeNav = document.querySelector('.nav-item.active');
    if (activeNav && activeNav.getAttribute('data-role') === 'admin') {
      activeNav.classList.remove('active');
      const coursesNav = document.querySelector('.nav-item[data-page="courses"]');
      if (coursesNav) coursesNav.classList.add('active');
    }
    const activePage = document.querySelector('section.page.active');
    if (activePage && activePage.getAttribute('data-role') === 'admin') {
      activePage.classList.remove('active');
      const coursesPage = document.getElementById('page-courses');
      if (coursesPage) coursesPage.classList.add('active');
    }
  }
}

function showLoginScreen() {
  const app = document.getElementById('app');
  const login = document.getElementById('login-screen');
  if (app) app.style.display = 'none';
  if (login) login.style.display = 'flex';
  // 聚焦用户名输入框
  _ensureLoginInputFocus();
}

// 确保登录页输入框能正常接收键盘输入
function _ensureLoginInputFocus() {
  const uInput = document.getElementById('login-username');
  if (!uInput) return;
  // 立即尝试聚焦
  uInput.focus();
  // 多重延迟补偿（各种异步场景：DOM 渲染、窗口焦点恢复等）
  [50, 150, 300, 500, 1000, 2000].forEach(t => {
    setTimeout(() => {
      const login = document.getElementById('login-screen');
      if (login && login.style.display !== 'none' && document.activeElement !== uInput) {
        uInput.focus();
      }
    }, t);
  });
  // 点击登录页任意位置聚焦输入框
  const login = document.getElementById('login-screen');
  if (login) {
    login.addEventListener('click', function _onClick(e) {
      // 如果点的是输入框本身，交给浏览器默认行为
      if (e.target.tagName === 'INPUT') return;
      uInput.focus();
    });
  }
}

function showMainApp() {
  const login = document.getElementById('login-screen');
  const app = document.getElementById('app');
  if (login) login.style.display = 'none';
  if (app) app.style.display = 'flex';
}

function setupLoginEvents() {
  const formEl = document.getElementById('login-screen');
  if (!formEl) return;
  const btn = document.getElementById('login-submit-btn');
  const err = document.getElementById('login-error-msg');

  function _showError(msg) {
    if (err) {
      err.textContent = msg || '';
      if (msg) {
        err.animate(
          [{ transform: 'translateX(0)' }, { transform: 'translateX(-4px)' }, { transform: 'translateX(4px)' }, { transform: 'translateX(0)' }],
          { duration: 250 }
        );
      }
    }
  }

  function _afterLoginSuccess(r) {
    _currentLoginUser = { username: r.username, nickname: r.nickname, loginAt: r.loginAt, role: r.role || 'user' };
    _updateUserInfoBar(_currentLoginUser);
    applyRoleVisibility(_currentLoginUser.role);
    try { _installVideoClickControls(); } catch (_) {}
    try {
      initNavigation();
      initLocalSyncToggle();
      setupEventListeners();
    } catch (_) {}
    const scheduleDataLoad = () => {
      try { loadCourses(); } catch (_) {}
      try {
        MEDIA_PROXY_READY_P.then(() => {
          console.log('[boot] 媒体代理首屏并行启动完成，PORT=', MEDIA_PROXY_PORT);
        }).catch(() => {});
      } catch (_) {}
    };
    if ('requestIdleCallback' in window) requestIdleCallback(scheduleDataLoad, { timeout: 200 });
    else setTimeout(scheduleDataLoad, 0);
    showMainApp();
  }

  async function _submit() {
    if (btn && btn.disabled) return;
    const uEl = document.getElementById('login-username');
    const pEl = document.getElementById('login-password');
    const u = uEl ? uEl.value.trim() : '';
    const p = pEl ? pEl.value : '';
    if (!u || !p) { _showError('请输入账号和密码'); return; }
    if (btn) { btn.disabled = true; btn.classList.add('loading'); btn.textContent = '登 录 中'; }
    _showError('');
    try {
      const r = await api.doLogin(u, p);
      if (r && r.success) {
        _afterLoginSuccess(r);
      } else {
        _showError(r && r.error ? r.error : '登录失败');
      }
    } catch (e) {
      _showError('登录异常：' + (e && e.message ? e.message : '未知错误'));
    } finally {
      if (btn) { btn.disabled = false; btn.classList.remove('loading'); btn.textContent = '登 录'; }
    }
  }

  if (btn) btn.addEventListener('click', _submit);
  ['login-username', 'login-password'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); _submit(); }
    });
  });
}

async function handleLogout() {
  try {
    showToastModal({
      type: 'confirm',
      title: '确认退出',
      message: '确定要退出当前账号吗？退出后需要重新登录。',
      onOk: async () => {
        await api.doLogout();
        _currentLoginUser = null;
        const pEl = document.getElementById('login-password');
        const err = document.getElementById('login-error-msg');
        if (pEl) pEl.value = '';
        if (err) err.textContent = '';
        setTimeout(() => {
          showLoginScreen();
        }, 100);
      }
    });
  } catch (_) {}
}

async function handleChangePassword() {
  const modal = document.getElementById('modal-container');
  if (!modal) return;
  const overlay = document.getElementById('modal-overlay');
  modal.innerHTML = `
    <h2>修改账号密码</h2>
    <div class="form-group"><label>当前登录账号</label><input value="${escapeAttr(_currentLoginUser && _currentLoginUser.username ? _currentLoginUser.username : '')}" disabled style="background:#f1f5f9;"></div>
    <div class="form-group"><label>昵称</label><input id="pwd-nickname" value="${escapeAttr(_currentLoginUser && _currentLoginUser.nickname ? _currentLoginUser.nickname : '')}" placeholder="选填，显示用的名称"></div>
    <div class="form-group"><label>原密码 *</label><input id="pwd-old" type="password" placeholder="请输入当前使用的密码"></div>
    <div class="form-group"><label>新密码 *</label><input id="pwd-new" type="password" placeholder="至少6位"></div>
    <div class="form-group"><label>确认新密码 *</label><input id="pwd-new2" type="password" placeholder="再次输入新密码"></div>
    <div class="form-actions">
      <button class="btn btn-secondary" onclick="closeModal()">取消</button>
      <button class="btn btn-primary" id="pwd-save-btn">💾 保存修改</button>
    </div>`;
  if (overlay) overlay.classList.remove('hidden');
  const saveBtn = document.getElementById('pwd-save-btn');
  if (saveBtn) saveBtn.addEventListener('click', async () => {
    const oldP = document.getElementById('pwd-old').value;
    const newP = document.getElementById('pwd-new').value;
    const newP2 = document.getElementById('pwd-new2').value;
    const nick = document.getElementById('pwd-nickname').value.trim();
    if (!oldP) { alert('请输入原密码'); return; }
    if (!newP || newP.length < 6) { alert('新密码至少6位'); return; }
    if (newP !== newP2) { alert('两次输入的新密码不一致'); return; }
    saveBtn.disabled = true; saveBtn.textContent = '保存中...';
    try {
      const r = await api.changePassword(oldP, newP, nick);
      if (r && r.success) {
        if (_currentLoginUser) {
          if (nick) _currentLoginUser.nickname = nick;
        }
        _updateUserInfoBar(_currentLoginUser);
        alert('✅ 密码修改成功');
        closeModal();
      } else {
        alert('❌ 修改失败：' + (r && r.error ? r.error : '未知错误'));
      }
    } catch (e) {
      alert('异常：' + (e && e.message ? e.message : '未知错误'));
    } finally {
      saveBtn.disabled = false; saveBtn.textContent = '💾 保存修改';
    }
  });
}

function setupUserBarEvents() {
  const logoutBtn = document.getElementById('user-logout');
  const pwdBtn = document.getElementById('user-change-pwd');
  if (logoutBtn) logoutBtn.addEventListener('click', (e) => { e.preventDefault(); handleLogout(); });
  if (pwdBtn) pwdBtn.addEventListener('click', (e) => { e.preventDefault(); handleChangePassword(); });
}

document.addEventListener('DOMContentLoaded', async () => {
  setupLoginEvents();
  setupUserBarEvents();
  try {
    const r = await api.checkLoginStatus();
    if (r && r.loggedIn) {
      _currentLoginUser = { username: r.username, nickname: r.nickname, loginAt: r.loginAt, role: r.role || 'user' };
      _updateUserInfoBar(_currentLoginUser);
      applyRoleVisibility(_currentLoginUser.role);
      try { _installVideoClickControls(); } catch (_) {}
      try {
        initNavigation();
        initLocalSyncToggle();
        setupEventListeners();
      } catch (_) {}
      const scheduleDataLoad = () => {
        try { loadCourses(); } catch (_) {}
        try {
          MEDIA_PROXY_READY_P.then(() => {
            console.log('[boot] 媒体代理首屏并行启动完成，PORT=', MEDIA_PROXY_PORT);
          }).catch(() => {});
        } catch (_) {}
      };
      if ('requestIdleCallback' in window) requestIdleCallback(scheduleDataLoad, { timeout: 200 });
      else setTimeout(scheduleDataLoad, 0);
      showMainApp();
    } else {
      showLoginScreen();
    }
  } catch (_) {
    showLoginScreen();
  }
});

function _refreshModeLabels(checked) {
  const ipLabel = document.querySelector('.toggle-mode-ip');
  const domainLabel = document.querySelector('.toggle-mode-domain');
  if (ipLabel) ipLabel.classList.toggle('active', !!checked);
  if (domainLabel) domainLabel.classList.toggle('active', !checked);
}
let _localSyncToggleInited = false;
function initLocalSyncToggle() {
  const toggle = document.getElementById('local-sync-toggle');
  const hint = document.getElementById('local-sync-hint');
  if (!toggle) return;
  if (_localSyncToggleInited) return;
  _localSyncToggleInited = true;
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

let _navigationInited = false;
function initNavigation() {
  if (_navigationInited) return;
  _navigationInited = true;
  document.querySelectorAll('.nav-item').forEach((item) => {
    item.addEventListener('click', () => {
      const page = item.dataset.page;
      navigateTo(page);
    });
  });
}

