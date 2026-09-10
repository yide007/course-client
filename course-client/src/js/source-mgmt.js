// ============================================================
//  ⚡ 只输入 Token 的快速添加向导（最简流程）
//  步骤：1. 填 Token（默认 115网盘 + 默认端口）
//       2. 浏览云盘选文件夹（可以双击目录进入）
//       3. 点「选这个」或「选择当前文件夹作为课程」
//       4. 文件夹名自动成课程名 → 填详情保存
// ============================================================
let _quickConn = null;

async function showQuickTokenWizard() {
  _quickConn = null;
  const modal = document.getElementById('modal-container');
  modal.innerHTML = `
    <h2>⚡ 输入 Token 快速添加课程</h2>
    <div class="scan-step-tip">
      🎯 <strong>4 步完成课程添加：</strong>① 填入 API Token → ② 连接后浏览云盘并进入想要添加的课程文件夹 → ③ 点击「✅ 选择当前文件夹作为课程」或「选这个」 → ④ 完善详情后保存。文件夹名称将自动作为课程名！
    </div>
    <div class="form-group">
      <label>① 云盘类型</label>
      <select id="q-type">
        <option value="115" selected>115 网盘（通过 CloudDrive2 连接）</option>
        <option value="cd2">CloudDrive2 通用</option>
      </select>
    </div>
    <div class="form-group">
      <label>② Endpoint（CloudDrive2 本地服务地址）</label>
      <input id="q-endpoint" value="127.0.0.1:19799" placeholder="127.0.0.1:19799 或 127.0.0.1:19798">
      <div style="font-size:12px;color:#94a3b8;margin-top:4px;">💡 115 常用端口 19799；CloudDrive2 标准版常用 19798</div>
    </div>
    <div class="form-group">
      <label>③ API Token *</label>
      <input id="q-token" placeholder="粘贴 CloudDrive2 API Token，如 b2d284cd-xxxx-xxxx...">
    </div>
    <div id="q-browser-box"></div>
    <div class="form-actions">
      <button class="btn btn-secondary" onclick="closeModal()">取消</button>
      <button class="btn btn-primary" id="q-connect-btn">🔗 连接并进入根目录</button>
    </div>`;
  document.getElementById('modal-overlay').classList.remove('hidden');

  document.getElementById('q-connect-btn').addEventListener('click', async () => {
    const token = document.getElementById('q-token').value.trim();
    if (!token) { alert('请输入 API Token'); return; }
    const type = document.getElementById('q-type').value;
    const endpoint = document.getElementById('q-endpoint').value.trim() || '127.0.0.1:19799';
    _quickConn = { type, endpoint, token };
    await _quickRenderListDir('/');
  });
}

async function _quickRenderListDir(path) {
  if (!_quickConn) return;
  const box = document.getElementById('q-browser-box');
  if (!box) return;
  box.innerHTML = `<p style="text-align:center;padding:20px;color:#64748b;">⏳ 正在读取目录：${escapeHtml(path)}</p>`;
  const btn = document.getElementById('q-connect-btn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ 读取中...'; }
  try {
    const r = await api.listCloudDirectory({ ..._quickConn, path });
    if (r && typeof r === 'object' && r.success === false) throw new Error(r.error || '读取失败');
    const items = Array.isArray(r) ? r : [];
    let crumbs;
    if (path && path !== '/') {
      const parts = path.split('/').filter(Boolean);
      const trails = parts.map((p, i) => {
        const pPath = '/' + parts.slice(0, i + 1).join('/');
        return `<a style="cursor:pointer;color:var(--primary);" data-nav="${escapeAttr(pPath)}">${escapeHtml(p)}</a>`;
      });
      trails.unshift('<a style="cursor:pointer;color:var(--primary);" data-nav="/">🏠 根目录</a>');
      crumbs = trails.join(' <span style="color:#94a3b8;">/</span> ');
    } else {
      crumbs = '<span style="color:#64748b;">🏠 根目录</span>';
    }

    const dirs = items.filter(i => i.isDir);
    const files = items.filter(i => !i.isDir);
    box.innerHTML = `
      <div style="margin-top:12px;padding:12px;border:1px solid var(--border);border-radius:8px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;gap:8px;flex-wrap:wrap;">
          <div style="font-size:13px;color:#475569;">📁 当前位置：${crumbs}</div>
          <button class="btn btn-sm" style="background:#0ea5e9;color:#fff;" id="q-use-this-folder">✅ 选择当前文件夹作为课程</button>
        </div>
        <div style="max-height:50vh;overflow-y:auto;border-top:1px solid var(--border);padding-top:8px;">
          ${dirs.length === 0 && files.length === 0 ? '<p style="color:#94a3b8;text-align:center;padding:30px;">（空文件夹）</p>' : ''}
          ${dirs.map(d => `
            <div class="q-dir-item" data-path="${escapeAttr(d.fullPath)}">
              📂 <span class="q-dir-name">${escapeHtml(d.name)}</span>
              <span style="font-size:12px;color:#94a3b8;margin-left:6px;">（双击进入浏览，或直接点右侧「选这个」）</span>
              <button class="btn btn-sm btn-primary" data-pick="${escapeAttr(d.fullPath)}">选这个</button>
            </div>
          `).join('')}
          ${files.length > 0 ? `
            <div style="font-size:12px;color:#94a3b8;margin:14px 4px 6px;padding-left:4px;border-left:3px solid var(--primary);">当前文件夹下的文件（导入时自动识别视频为章节/课时）：</div>
            ${files.slice(0, 40).map(f => `
              <div class="q-file-item">
                🎬 <span>${escapeHtml(f.name)}</span>
                <span style="margin-left:auto;font-size:11px;color:#94a3b8;">${_fmtSize(f.size)}</span>
              </div>`).join('')}
            ${files.length > 40 ? `<div style="font-size:11px;color:#94a3b8;text-align:center;padding:4px;">... 还有 ${files.length - 40} 个文件</div>` : ''}
          ` : ''}
        </div>
      </div>`;

    box.querySelectorAll('a[data-nav]').forEach(a => a.addEventListener('click', () => _quickRenderListDir(a.dataset.nav)));
    box.querySelectorAll('div.q-dir-item').forEach(row => {
      row.addEventListener('dblclick', () => _quickRenderListDir(row.dataset.path));
    });
    box.querySelectorAll('button[data-pick]').forEach(b => {
      b.addEventListener('click', () => _quickPickFolder(b.dataset.pick));
    });
    const useBtn = document.getElementById('q-use-this-folder');
    if (useBtn) useBtn.addEventListener('click', () => _quickPickFolder(path));
  } catch (e) {
    box.innerHTML = `<div style="padding:14px;background:#fef2f2;border:1px solid #fecaca;border-radius:6px;color:#991b1b;">❌ 连接/读取失败：${escapeHtml(e.message || String(e))}<br><span style="font-size:12px;">请确认：① CloudDrive2 正在运行 ② Token 正确 ③ 端口号：115 挂载一般是 19799，CD2 标准端口是 19798</span></div>`;
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🔗 重新连接'; }
  }
}

async function _quickPickFolder(folderPath) {
  if (!_quickConn) return;
  const folderName = folderPath.split('/').filter(Boolean).pop() || '未命名课程';
  if (!(await confirmCustom(`📌 确认选择「${folderName}」？\n\n路径：${folderPath}\n\n✅ 文件夹名会作为课程名，子文件夹=章节，视频=课时。是否继续？`))) return;

  const modal = document.getElementById('modal-container');
  modal.innerHTML = `
    <h2>📂 扫描中：${escapeHtml(folderName)}</h2>
    <div class="scan-step-tip">正在扫描文件夹中的视频和子文件夹，构建章节结构，请稍候...</div>
    <div id="q-scan-status" style="text-align:center;padding:40px;color:#64748b;">⏳ 扫描中，请稍候...</div>`;

  try {
    const draft = await api.quickScanOneCourse({ ..._quickConn, folderPath });
    if (!draft) throw new Error('未扫描到结果');
    showDraftEditModalOneShot(draft, folderPath);
  } catch (e) {
    modal.innerHTML = `
      <h2>❌ 扫描失败</h2>
      <div class="scan-step-tip">${escapeHtml(e.message || String(e))}</div>
      <div class="form-actions">
        <button class="btn btn-secondary" onclick="showQuickTokenWizard()">← 返回浏览</button>
        <button class="btn btn-primary" onclick="closeModal()">关闭</button>
      </div>`;
  }
}

async function showDraftEditModalOneShot(draft, folderPath) {
  draft = JSON.parse(JSON.stringify(draft || {}));
  const categories = await api.getCategories();
  const modal = document.getElementById('modal-container');
  const chCount = (draft.chapters || []).length;
  const lsCount = (draft.chapters || []).reduce((s, c) => s + ((c.lessons && c.lessons.length) || 0), 0);

  modal.innerHTML = `
    <h2>编辑课程详情并保存</h2>
    <div class="scan-step-tip">✅ 已扫描：<strong>${chCount} 章 / ${lsCount} 集</strong>。文件夹名已自动填入"课程名称"，完善下面信息后保存。</div>
    <div class="form-group"><label>📂 文件夹（来源路径）</label><input value="${escapeAttr(folderPath || '')}" disabled style="background:#f1f5f9;"></div>
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
      <label>章节与课时（${chCount}章 / ${lsCount}集，点击展开查看）</label>
      <div style="max-height:200px;overflow-y:auto;border:1px solid var(--border);border-radius:6px;padding:4px;">
        ${(draft.chapters || []).map((ch, ci) => `
          <details style="padding:4px 6px;">
            <summary style="font-size:13px;cursor:pointer;padding:2px 0;">📂 第${ci+1}章：${escapeHtml(ch.title)}（${(ch.lessons||[]).length} 集）</summary>
            <ul style="padding-left:18px;margin:4px 0;">
              ${(ch.lessons || []).map(l => `<li style="font-size:12px;color:#475569;padding:2px 0;">🎬 ${escapeHtml(l.title || '未命名视频')} <span style="color:#94a3b8;">(${l.duration || '--'})</span></li>`).join('')}
            </ul>
          </details>`).join('') || '<p style="color:#94a3b8;padding:10px;text-align:center;">（这个文件夹里没有扫描到视频文件）</p>'}
      </div>
    </div>
    <div class="form-actions">
      <button class="btn btn-secondary" onclick="showQuickTokenWizard()">← 重新选文件夹</button>
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
      sourceKey: 'quick::' + (draft.sourceType || '115') + '::' + (folderPath || '') + '::' + Date.now(),
    };
    const btn = document.getElementById('e-save-btn');
    btn.disabled = true; btn.textContent = '💾 保存中...';
    try {
      const r = await api.addCourseWithChapters(data);
      if (r && r.success === false) throw new Error(r.error || '保存失败');
      alert('✅ 课程添加成功：' + title);
      closeModal();
      loadCourses();
    } catch (e) {
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
