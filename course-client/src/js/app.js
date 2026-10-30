let currentPage = 'courses';
let currentCourseId = null;
let currentVideoLessonId = null;
let currentCategoryId = null;

function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
  document.getElementById('modal-container').classList.remove('compact-toast');
  document.getElementById('modal-container').classList.remove('course-modal');
  document.getElementById('modal-overlay').classList.remove('toast-overlay');
  try { if (window.focus) window.focus(); } catch (_) {}
}

// ── 全局键盘快捷键：Escape 关闭弹窗、Enter 在弹窗输入框中触发"确定/保存"按钮 ──
(function () {
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      var overlay = document.getElementById('modal-overlay');
      if (overlay && !overlay.classList.contains('hidden')) {
        closeModal();
        e.preventDefault();
      }
    }
    if (e.key === 'Enter') {
      var overlay = document.getElementById('modal-overlay');
      if (overlay && !overlay.classList.contains('hidden')) {
        var activeEl = document.activeElement;
        if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) {
          var type = (activeEl.type || '').toLowerCase();
          if (type === 'text' || type === 'password' || type === 'number' ||
              type === 'email' || type === 'url' || type === 'search' || type === 'tel' || type === '' ||
              activeEl.tagName === 'TEXTAREA') {
            var container = document.getElementById('modal-container');
            if (container) {
              var primaryBtn = container.querySelector('.btn-primary[id]');
              if (!primaryBtn) primaryBtn = container.querySelector('.btn-primary');
              if (primaryBtn && !primaryBtn.disabled) {
                e.preventDefault();
                primaryBtn.click();
              }
            }
          }
        }
      }
    }
  });
})();

function showToastModal({ type = 'success', title, message, onOk, onCancel, compact = false, autoClose = 0 }) {
  const overlay = document.getElementById('modal-overlay');
  const modal = document.getElementById('modal-container');
  let iconClass, iconEmoji, html, modalClass = compact ? ' compact' : '';
  if (type === 'confirm') {
    iconClass = 'confirm';
    iconEmoji = '⚠️';
    modalClass += ' toast-modal--confirm';
    html = `
      <div class="toast-modal${modalClass}">
        <div class="toast-icon ${iconClass}">${iconEmoji}</div>
        <h2 class="toast-title">${escapeHtml(title || '确认操作')}</h2>
        ${message ? `<p class="toast-msg">${escapeHtml(message)}</p>` : ''}
        <div class="toast-actions toast-actions--confirm">
          <button class="btn btn-secondary" id="toast-cancel-btn">取消</button>
          <button class="btn btn-primary" id="toast-ok-btn">确定</button>
        </div>
      </div>`;
  } else {
    iconClass = type === 'success' ? 'success' : 'error';
    iconEmoji = type === 'success' ? '✓' : '✕';
    html = `
      <div class="toast-modal toast-modal--info${modalClass}">
        <div class="toast-icon ${iconClass}">${iconEmoji}</div>
        <h2 class="toast-title">${escapeHtml(title || (type === 'success' ? '操作成功' : '操作失败'))}</h2>
        ${message ? `<p class="toast-msg">${escapeHtml(message)}</p>` : ''}
        <div class="toast-actions">
          <button class="btn btn-primary" id="toast-ok-btn">确定</button>
        </div>
      </div>`;
  }
  modal.classList.add('compact-toast');
  overlay.classList.add('toast-overlay');
  modal.innerHTML = html;
  overlay.classList.remove('hidden');
  const okBtn = document.getElementById('toast-ok-btn');
  const cancelBtn = document.getElementById('toast-cancel-btn');
  const closeAndClean = () => {
    closeModal();
    modal.classList.remove('compact-toast');
    overlay.classList.remove('toast-overlay');
  };
  const handleOk = () => {
    closeAndClean();
    if (typeof onOk === 'function') onOk();
  };
  const handleCancel = () => {
    closeAndClean();
    if (typeof onCancel === 'function') onCancel();
  };
  if (okBtn) okBtn.addEventListener('click', handleOk);
  if (cancelBtn) cancelBtn.addEventListener('click', handleCancel);
  if (autoClose > 0) {
    setTimeout(() => {
      closeAndClean();
      if (typeof onOk === 'function') onOk();
    }, autoClose);
  }
}

function confirmCustom(message, title) {
  return new Promise(function (resolve) {
    showToastModal({
      type: 'confirm',
      title: title || '确认操作',
      message: message,
      onOk: function () { resolve(true); },
      onCancel: function () { resolve(false); }
    });
  });
}

window.alert = function (msg) {
  var type = 'error';
  var text = String(msg || '');
  if (/✅|成功|完成|导入|添加成功|保存成功|批量完成|导入成功/.test(text)) type = 'success';
  showToastModal({
    type: type,
    title: type === 'success' ? '操作成功' : '提示',
    message: text
  });
};

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeAttr(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function cssEscape(str) {
  if (!str) return '';
  return String(str).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
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
    try {
      const player = document.getElementById('video-player');
      if (player) { player.pause(); player.removeAttribute('src'); try { player.load(); } catch (_) {} }
    } catch (_) {}
    this.classList.add('hidden');
    try { _sweepVideoMemory(); } catch (_) {}
  }
});

// ── 全局模态框自动聚焦 ──
// 使用 MutationObserver 监听模态框打开，自动聚焦第一个文本输入框
// 注意：不再拦截 mousedown/click，浏览器原生行为即可正常显示光标
(function () {
  var container = document.getElementById('modal-container');
  if (!container) return;

  var isModalOpen = false;
  var fixTimer = 0;

  function isTextInput(el) {
    if (!el || !el.tagName) return false;
    var tag = el.tagName.toUpperCase();
    if (tag === 'TEXTAREA') return true;
    if (tag !== 'INPUT') return false;
    var type = (el.type || 'text').toLowerCase();
    return type === 'text' || type === 'password' || type === 'number' ||
           type === 'email' || type === 'url' || type === 'search' || type === 'tel' || type === '';
  }

  function applyFocusFix() {
    if (!isModalOpen) return;
    try {
      // 确保渲染进程窗口有焦点（Electron 中窗口焦点可能丢失）
      if (window.focus) window.focus();
    } catch (_) {}
    var inputs = container.querySelectorAll('input, textarea');
    var firstTextInput = null;
    for (var i = 0; i < inputs.length; i++) {
      var el = inputs[i];
      if (isTextInput(el)) {
        if (!firstTextInput) firstTextInput = el;
      }
    }
    // 自动聚焦第一个文本输入框
    if (firstTextInput) {
      [0, 80, 250, 450].forEach(function (t) {
        setTimeout(function () {
          try {
            if (isModalOpen && firstTextInput && document.activeElement !== firstTextInput) {
              firstTextInput.focus();
            }
          } catch (_) {}
        }, t);
      });
    }
  }

  // 监听模态框打开/关闭
  var overlay = document.getElementById('modal-overlay');
  if (overlay) {
    var observer = new MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var m = mutations[i];
        if (m.type === 'attributes' && m.attributeName === 'class') {
          isModalOpen = !overlay.classList.contains('hidden');
          if (isModalOpen) {
            // 延迟执行，等待模态框内容渲染完成
            if (fixTimer) clearTimeout(fixTimer);
            fixTimer = setTimeout(applyFocusFix, 50);
            fixTimer = setTimeout(applyFocusFix, 200);
          }
        } else if (m.type === 'childList' && isModalOpen) {
          if (fixTimer) clearTimeout(fixTimer);
          fixTimer = setTimeout(applyFocusFix, 50);
        }
      }
    });
    observer.observe(overlay, { attributes: true, attributeFilter: ['class'] });
    observer.observe(container, { childList: true, subtree: true });
    // 初始状态
    isModalOpen = !overlay.classList.contains('hidden');
  }
})();

// ── 无边框窗口控制 ──
(function () {
  var api = window.electronAPI;
  if (!api) return;

  var btnMin = document.getElementById('btn-minimize');
  var btnMax = document.getElementById('btn-maximize');
  var btnClose = document.getElementById('btn-close');
  var maxIcon = document.getElementById('maximize-icon');

  function updateMaxIcon(isMax) {
    if (!maxIcon) return;
    if (isMax) {
      maxIcon.innerHTML = '<path d="M959.72 0H294.216a63.96 63.96 0 0 0-63.96 63.96v127.92H64.28A63.96 63.96 0 0 0 0.32 255.84V959.4a63.96 63.96 0 0 0 63.96 63.96h703.56a63.96 63.96 0 0 0 63.96-63.96V792.465h127.92a63.96 63.96 0 0 0 63.96-63.96V63.96A63.96 63.96 0 0 0 959.72 0zM767.84 728.505V959.4H64.28V255.84h703.56z m189.322 0H831.8V255.84a63.96 63.96 0 0 0-63.96-63.96H294.216V63.96H959.72z" fill="currentColor"/>';
      maxIcon.setAttribute('viewBox', '0 0 1024 1024');
      btnMax.title = '还原';
    } else {
      maxIcon.innerHTML = '<rect x="2.5" y="2.5" width="7" height="7" rx="1" fill="none" stroke="currentColor" stroke-width="1"/>';
      maxIcon.setAttribute('viewBox', '0 0 12 12');
      btnMax.title = '最大化';
    }
  }

  if (btnMin) btnMin.addEventListener('click', function () { try { api.windowMinimize(); } catch (_) {} });
  if (btnMax) btnMax.addEventListener('click', function () { try { api.windowMaximize(); } catch (_) {} });
  if (btnClose) btnClose.addEventListener('click', function () { try { api.windowClose(); } catch (_) {} });

  // 登录页窗口控制
  var loginMin = document.getElementById('login-btn-minimize');
  var loginClose = document.getElementById('login-btn-close');
  if (loginMin) loginMin.addEventListener('click', function () { try { api.windowMinimize(); } catch (_) {} });
  if (loginClose) loginClose.addEventListener('click', function () { try { api.windowClose(); } catch (_) {} });

  // 初始化最大化状态
  try {
    api.isWindowMaximized().then(function (isMax) { updateMaxIcon(!!isMax); }).catch(function () {});
  } catch (_) {}

  // 监听最大化状态变化
  try {
    if (typeof api.onWindowMaximizeChange === 'function') {
      api.onWindowMaximizeChange(function (isMax) { updateMaxIcon(!!isMax); });
    }
  } catch (_) {}
})();