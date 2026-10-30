// ============================================================
//  upload.js — 章节管理：批量上传、文件夹上传（串行）逻辑
// ============================================================

// 批量上传视频
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
      return _tmplBatchFileItem(i, f.name, mb, '');
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

// 文件夹上传（按目录结构自动分组为节）
async function _folderUploadFlow({ chIdx, sectionTitle = null } = {}) {
  const ch = chapterMgmtDraft[chIdx];
  if (!ch) return;

  function _addSectionIfMissing(c, secName) {
    if (!secName) return;
    const secArr = _ensureSectionsArr(c);
    if (secArr.indexOf(secName) === -1) secArr.push(secName);
    if (!Array.isArray(c.sectionOrders)) c.sectionOrders = ['', ...secArr];
    else if (c.sectionOrders.indexOf(secName) === -1) c.sectionOrders.push(secName);
  }

  try {
    const pickR = await api.pickFolderVideos();
    if (!pickR || pickR.canceled) return;
    if (!pickR || !pickR.success || !pickR.files || pickR.files.length === 0) {
      alert('该文件夹下没有找到视频文件');
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

    const folderName = pickR.folderName || '';
    const allFiles = pickR.files;

    const targetMap = new Map();
    if (sectionTitle) {
      targetMap.set(sectionTitle, allFiles);
    } else {
      const rootName = folderName || '未命名';
      const rootVideos = [];
      const sectionMap = new Map();
      for (const f of allFiles) {
        const pf = f.parentFolder || '';
        if (!pf) rootVideos.push(f);
        else {
          if (!sectionMap.has(pf)) sectionMap.set(pf, []);
          sectionMap.get(pf).push(f);
        }
      }
      if (rootVideos.length > 0) targetMap.set(rootName, rootVideos);
      for (const [secName, arr] of sectionMap) targetMap.set(secName, arr);
    }

    const uploadPlan = [];
    for (const [secName, files] of targetMap) {
      for (const f of files) uploadPlan.push({ file: f, targetSection: secName });
    }
    const totalFiles = uploadPlan.length;
    if (totalFiles === 0) { alert('没有需要上传的视频'); return; }

    let doneCount = 0, successCount = 0, failCount = 0;
    let totalSize = uploadPlan.reduce((s, item) => s + (item.file.size || 0), 0);

    const modal = document.getElementById('modal-container');
    const overlay = document.getElementById('modal-overlay');
    const fileItemsHtml = uploadPlan.map((item, i) => {
      const f = item.file;
      const mb = ((f.size || 0) / 1048576).toFixed(1);
      const tag = sectionTitle
        ? (item.targetSection ? `<span style="color:#0ea5e9;margin-right:4px;">📖${escapeHtml(item.targetSection)}</span>` : '')
        : (item.targetSection ? `<span style="color:#f59e0b;margin-right:4px;">📁${escapeHtml(item.targetSection)}</span>` : '');
      return _tmplBatchFileItem(i, f.name, mb, tag);
    }).join('');

    const structurePreview = sectionTitle
      ? `<div style="font-size:12px;color:#1d4ed8;background:#eff6ff;padding:4px 10px;border-radius:6px;display:inline-block;margin-bottom:12px;">📚 将添加到「${escapeHtml(ch.title || '')}」 → 📖 「${escapeHtml(sectionTitle)}」（${folderName ? '来源文件夹：' + escapeHtml(folderName) : ''}）</div>`
      : `<div style="font-size:12px;color:#64748b;background:#f1f5f9;padding:4px 10px;border-radius:6px;display:inline-block;margin-bottom:12px;">📚 章「${escapeHtml(ch.title || '')}」 ← 📁 文件夹「${escapeHtml(folderName || '')}」（${targetMap.size} 个分组）</div>`;

    modal.innerHTML = `
          <div class="modal-box" style="max-width:640px;">
            <h2 style="margin:0 0 8px 0;font-size:18px;">📁 文件夹上传（${folderName || ''} · ${totalFiles} 个文件）</h2>
            ${structurePreview}
            <div style="padding:12px 16px;background:linear-gradient(135deg,#fef3c7 0%,#f0f9ff 100%);border-radius:10px;margin-bottom:14px;border:1px solid #fbbf24;">
              <div style="display:flex;justify-content:space-between;margin-bottom:8px;font-size:13px;">
                <span class="batch-summary-text" style="font-weight:600;color:#334155;">总进度</span>
                <span class="batch-summary-num" style="font-weight:700;color:#334155;">0 / ${totalFiles}</span>
              </div>
              <div style="height:8px;background:#e2e8f0;border-radius:4px;overflow:hidden;">
                <div class="batch-total-bar" style="height:100%;width:0%;background:linear-gradient(90deg,#f59e0b,#d97706);border-radius:4px;transition:width .25s;"></div>
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
        if (!(await confirmCustom('确定取消？已上传的视频会自动添加为课时。'))) return;
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
        else barFill.style.background = '#f59e0b';
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

    for (let i = 0; i < uploadPlan.length; i++) {
      if (canceled) {
        updateItem(i, '⏸', 0, '已取消');
        doneCount++;
        updateSummary();
        continue;
      }
      const { file, targetSection } = uploadPlan[i];
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
          if (info.stage === 'uploading') {
            let stage = '📤 上传中';
            if (info.bytesTotal) {
              const mbSent = (info.bytesSent / 1048576).toFixed(1);
              const mbTotal = (info.bytesTotal / 1048576).toFixed(1);
              stage = `📤 上传中 ${mbSent}/${mbTotal}MB`;
            }
            updateItem(i, '📤', pct, stage);
          } else if (info.stage === 'processing') {
            updateItem(i, '🗂️', pct, '🗂️ 服务端处理中...');
          } else if (info.stage === 'done') {
            updateItem(i, '✅', 100, '上传成功');
          } else {
            updateItem(i, '⏳', pct, '处理中');
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
                if (info.stage === 'uploading') updateItem(i, '📤', pct, `📤 重新上传中 ${pct}%`);
                else if (info.stage === 'processing') updateItem(i, '🗂️', pct, '🗂️ 服务端处理中...');
                else if (info.stage === 'done') updateItem(i, '✅', 100, '上传成功');
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

          let finalSection = targetSection || '';
          if (finalSection) _addSectionIfMissing(ch, finalSection);

          const lessonId = 'l_' + Date.now() + '_' + Math.floor(Math.random() * 1e6);
          const lesson = {
            id: lessonId,
            title: nameNoExt || fileName,
            videoUrl: videoUrl,
            path: videoUrl,
            videoUrlLocal: file.localPath,
            duration: 0,
            free: false,
            sectionTitle: finalSection,
          };
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
      cancelBtn2.onclick = () => { closeModal(); _render(); };
    }
    updateSummary();

    if (failCount === 0 && !canceled) {
      setTimeout(() => {
        alert(`✅ 文件夹上传完成！\n${successCount} 个视频全部上传成功\n已按文件夹结构添加到章节「${ch.title || ''}」\n（${targetMap.size} 个分组）`);
      }, 300);
    } else if (canceled) {
      setTimeout(() => {
        alert(`⏸ 上传已停止\n已完成：${successCount} 成功 / ${failCount} 失败`);
      }, 300);
    } else {
      setTimeout(() => {
        alert(`⚠️ 文件夹上传完成\n成功：${successCount} 个\n失败：${failCount} 个\n已自动添加成功的视频到章节`);
      }, 300);
    }
  } catch (e) {
    alert('文件夹上传失败：' + (e.message || e));
  }
}