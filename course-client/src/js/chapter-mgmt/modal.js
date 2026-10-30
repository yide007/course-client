// ============================================================
//  modal.js — 章节管理：添加章/节/课时/资料 弹窗逻辑
// ============================================================

// 添加 / 编辑章
function _openChapterModal({ title = '', chIdx = null } = {}) {
  const modal = document.getElementById('modal-container');
  const overlay = document.getElementById('modal-overlay');
  modal.innerHTML = _tmplChapterModal(chIdx, title);
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

// 添加 / 编辑节
function _openSectionModal({ chIdx, oldTitle = null } = {}) {
  const ch = chapterMgmtDraft[chIdx];
  if (!ch) return;
  const isEdit = oldTitle != null;
  const sectionsArr = _ensureSectionsArr(ch);
  const modal = document.getElementById('modal-container');
  const overlay = document.getElementById('modal-overlay');
  modal.innerHTML = _tmplSectionModal(isEdit, oldTitle);
  overlay.classList.remove('hidden');
  document.getElementById('modal-section-ok').onclick = async () => {
    const newTitle = document.getElementById('modal-section-title').value.trim();
    if (!newTitle) { alert('请输入节名称'); return; }
    const lessons = ch.lessons || [];
    if (!isEdit) {
      if (_sectionExistsByName(ch, newTitle)) { alert('该节名称已存在，请使用其他名称'); return; }
      if (!(await confirmCustom(`确认添加新节「${newTitle}」？\n（后续可通过「📦 批量上传」或「📁 上传文件夹」向该节添加视频）`))) return;
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

// 选择单个视频后进入「添加课时」弹窗
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

// 添加 / 编辑课时
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
  const sectionTagHtml = _tmplSectionTagHtml(fixedSec, ch);
  const modal = document.getElementById('modal-container');
  const overlay = document.getElementById('modal-overlay');
  modal.innerHTML = _tmplLessonModal(item, lessonIdx, defaultTitle, sectionTagHtml, fixedSec);
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
      setBtnState('⏳ 准备中...', true);
      try {
        let localPath = null;
        const preset = pickVideoBtn && pickVideoBtn.dataset ? pickVideoBtn.dataset.presetPath : null;
        if (preset) {
          try { delete pickVideoBtn.dataset.presetPath; } catch(_) { try { pickVideoBtn.dataset.presetPath = ''; } catch(_) {} }
          localPath = preset;
        } else {
          const r = await api.pickVideoFile();
          if (!r || r.canceled) { setBtnState('📁 选择视频', false, 'pointer'); return; }
          if (!r || !r.success || !r.localPath) { alert('选择视频失败：' + (r?.error || '未知原因')); setBtnState('📁 选择视频', false, 'pointer'); return; }
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

        const doUpload = async (tk, bURL) => {
          return await api.uploadVideoFile(localPath, tk, bURL);
        };

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
            setBtnState('🔑 Token过期，重新登录中...', true);
            const loginR = await api.loginAndGetToken(uploadCfg.baseURL, uploadCfg.username, uploadCfg.password);
            if (loginR && loginR.success && loginR.token) {
              token = loginR.token;
              if (uploadCfgId) api.saveUploadToken(uploadCfgId, token).catch(() => {});
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
              alert('Token已过期，自动登录失败：' + (loginR?.error || '未知原因') + '\n请检查 ⚙️ 配置管理 中的用户名和密码');
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

        setBtnState('🔑 登录中...', true);
        const loginR = await api.loginAndGetToken(uploadCfg.baseURL, uploadCfg.username, uploadCfg.password);
        if (loginR && loginR.success && loginR.token) {
          token = loginR.token;
          if (uploadCfgId) api.saveUploadToken(uploadCfgId, token).catch(() => {});
        } else {
          alert('自动登录失败：' + (loginR?.error || '未知原因') + '\n请检查 ⚙️ 配置管理 中的用户名和密码');
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

// 添加 / 编辑资料
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
  const sectionTagHtml = _tmplSectionTagHtml(fixedSec, ch);
  const modal = document.getElementById('modal-container');
  const overlay = document.getElementById('modal-overlay');
  modal.innerHTML = _tmplPdfModal(item, pdfIdx, defaultName, sectionTagHtml);
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