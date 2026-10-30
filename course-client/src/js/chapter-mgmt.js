// ============================================================
//  章节管理：openChapterMgmt 及相关状态与工具函数 (chapter-mgmt.js)
// ============================================================
// ============================================================
//  章节管理
// ============================================================
// ===== 章节管理状态封装 =====
// 集中管理章节管理模式下的全部状态；进入/离开时通过 reset() 清空，避免残留上次操作
class ChapterMgmtState {
  constructor() {
    this.courseId = null;          // 当前正在编辑章节的课程 id
    this.draft = null;             // 章节草稿（可编辑副本）
    this.originalDetail = null;    // 原始课程详情（用于重置/保存）
    this.clickHandler = null;      // 章节列表的点击事件委托
    this.dragHandlers = null;      // 章节/小节/资料的拖拽排序事件
  }
  reset() {
    this.courseId = null;
    this.draft = null;
    this.originalDetail = null;
    this.clickHandler = null;
    this.dragHandlers = null;
  }
}
const chapterMgmtState = new ChapterMgmtState();

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
          _manual: !!detail._manual,
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
    chapterMgmtState.courseId = courseId;

    navigateTo('course-mgmt', true);

    // 进入章节管理页隐藏侧边栏
    const sidebar = document.getElementById('sidebar');
    if (sidebar) sidebar.classList.add('hidden');

    // 把返回/主页按钮放到顶部工具栏左侧
    if (typeof _renderTopbarNav === 'function') {
      _renderTopbarNav('courses', () => {
        chapterMgmtDraft = null;
        chapterMgmtOrigDetail = null;
        chapterMgmtState.courseId = null;
        loadCourseMgmt();
      });
    }

    const cleanHeader = document.querySelector('#page-course-mgmt > .page-header');
    if (cleanHeader) {
      cleanHeader.style.display = '';
      cleanHeader.querySelector('#chapters-mgmt-back')?.remove();
      cleanHeader.querySelector('#chapters-mgmt-home')?.remove();
      cleanHeader.querySelector('#chapters-mgmt-stats')?.remove();
      cleanHeader.querySelector('h2').style.display = 'none';
      cleanHeader.querySelector('.header-actions').style.display = 'none';
    }

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
        <td style="max-width:280px;">
          <strong style="display:inline-block;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;vertical-align:middle;" title="${safeTitle}">${safeTitle}</strong>
          ${isFree ? `<span style="margin-left:8px;padding:1px 8px;border-radius:10px;background:#fef3c7;color:#b45309;font-size:11px;vertical-align:middle;">免费</span>` : ''}
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
        <td style="max-width:280px;">
          <span style="display:inline-block;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;vertical-align:middle;" title="${pname}">📄 <strong>${pname}</strong></span> <span style="color:#94a3b8;font-size:11px;vertical-align:middle;">（资料）</span>
        </td>
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
      <div style="padding:0 20px 20px 20px;flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;">
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
                    <button class="btn btn-sm" data-act="batch-upload-to-section" data-ch="${chIdx}" data-sec="${escapeAttr(secTitle)}" style="padding:4px 8px;font-size:11px;background:linear-gradient(135deg,#10b981,#059669);color:#fff;border:none;">📦 批量上传</button>
                    <button class="btn btn-sm" data-act="folder-upload-to-section" data-ch="${chIdx}" data-sec="${escapeAttr(secTitle)}" style="padding:4px 8px;font-size:11px;background:linear-gradient(135deg,#f59e0b,#d97706);color:#fff;border:none;">📁 上传文件夹</button>
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
                      ${secEmpty ? `<tr><td colspan="4" style="padding:14px;text-align:center;color:#94a3b8;font-size:12px;">该节暂无内容，拖拽课时/资料到此处，或点击上方「📦 批量上传」开始创建</td></tr>` : ''}
                    </tbody>
                  </table>
                </div>
              </div>`;
            }
          });

          const hasContent = sectionHtmlParts;
          const emptyTip = !hasContent
            ? `<tr><td colspan="4" style="padding:24px;text-align:center;color:#94a3b8;">该章节暂无课时和资料，点击上方「📖 添加节」或「📦 批量上传」开始创建</td></tr>`
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
                <button class="btn btn-sm" data-act="batch-upload" data-ch="${chIdx}" style="padding:6px 12px;font-size:12px;background:linear-gradient(135deg,#10b981,#059669);color:#fff;border:none;">📦 批量上传</button>
                <button class="btn btn-sm" data-act="folder-upload" data-ch="${chIdx}" style="padding:6px 12px;font-size:12px;background:linear-gradient(135deg,#f59e0b,#d97706);color:#fff;border:none;">📁 上传文件夹</button>
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

    async function _folderUploadFlow({ chIdx, sectionTitle = null } = {}) {
      const ch = chapterMgmtDraft[chIdx];
      if (!ch) return;

      function _ensureSectionsArr(c) {
        if (!c.sections) c.sections = [];
        if (!Array.isArray(c.sections)) c.sections = [];
        return c.sections;
      }

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
          return `<div class="batch-file-item" data-idx="${i}" style="padding:8px 12px;border-radius:8px;background:#f8fafc;border:1px solid #e2e8f0;margin-bottom:6px;font-size:12px;">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
              <span class="batch-file-status" style="font-size:14px;">⏳</span>
              <span class="batch-file-name" style="flex:1;color:#334155;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${tag}${escapeHtml(f.name)}</span>
              <span style="color:#64748b;flex-shrink:0;">${mb}MB</span>
            </div>
            <div class="batch-file-bar" style="height:4px;background:#e2e8f0;border-radius:2px;overflow:hidden;">
              <div class="batch-file-bar-fill" style="height:100%;width:0%;background:#94a3b8;border-radius:2px;transition:width .2s;"></div>
            </div>
            <div class="batch-file-msg" style="margin-top:3px;font-size:11px;color:#94a3b8;">等待中...</div>
          </div>`;
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

            // 无缓存 token，首次登录
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

    function _bindChapterMgmtEvents() {
      const container = document.getElementById('course-management');
      if (!container) return;
      if (chapterMgmtClickHandler) {
        container.removeEventListener('click', chapterMgmtClickHandler);
        chapterMgmtClickHandler = null;
      }
      if (chapterMgmtDragHandlers) {
        container.removeEventListener('dragstart', chapterMgmtDragHandlers.dragstart);
        container.removeEventListener('dragend', chapterMgmtDragHandlers.dragend);
        container.removeEventListener('dragover', chapterMgmtDragHandlers.dragover);
        container.removeEventListener('dragleave', chapterMgmtDragHandlers.dragleave);
        container.removeEventListener('drop', chapterMgmtDragHandlers.drop);
        chapterMgmtDragHandlers = null;
      }
      chapterMgmtClickHandler = async (ev) => {
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
              chapterMgmtOrigDetail = await api.getCourseDetail(chapterMgmtState.courseId);
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
        } else if (act === 'folder-upload') {
          _folderUploadFlow({ chIdx });
        } else if (act === 'folder-upload-to-section') {
          _folderUploadFlow({ chIdx, sectionTitle: secTitleRaw });
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
      container.addEventListener('click', chapterMgmtClickHandler);

      let _dragSrc = null;
    if (chapterMgmtDragHandlers) {
      const c = document.getElementById('course-management');
      if (c) {
        c.removeEventListener('dragstart', chapterMgmtDragHandlers.dragstart);
        c.removeEventListener('dragend', chapterMgmtDragHandlers.dragend);
        c.removeEventListener('dragover', chapterMgmtDragHandlers.dragover);
        c.removeEventListener('dragleave', chapterMgmtDragHandlers.dragleave);
        c.removeEventListener('drop', chapterMgmtDragHandlers.drop);
      }
      chapterMgmtDragHandlers = null;
    }
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

      chapterMgmtDragHandlers = {
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

      container.addEventListener('dragstart', chapterMgmtDragHandlers.dragstart);
      container.addEventListener('dragend', chapterMgmtDragHandlers.dragend);
      container.addEventListener('dragover', chapterMgmtDragHandlers.dragover);
      container.addEventListener('dragleave', chapterMgmtDragHandlers.dragleave);
      container.addEventListener('drop', chapterMgmtDragHandlers.drop);

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
      pageHeader.style.marginBottom = '0';
      pageHeader.style.borderBottomLeftRadius = '0';
      pageHeader.style.borderBottomRightRadius = '0';
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
            <div style="height:24px;width:1px;background:#e2e8f0;margin:0 4px;"></div>
            <button id="btn-add-chapter-top" class="btn btn-primary" style="padding:8px 18px;font-size:13px;">+ 添加章</button>
            <button id="btn-reset-chapters-top" class="btn btn-secondary" style="padding:8px 14px;font-size:13px;">↺ 撤销修改</button>
            <button id="btn-save-chapters-top" class="btn btn-primary" style="padding:8px 18px;font-size:13px;">💾 保存修改</button>
          </div>
        `;
        const refNode = pageHeader.querySelector('h2') || pageHeader.firstChild;
        pageHeader.insertBefore(statsBar, refNode);
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
              chapterMgmtOrigDetail = await api.getCourseDetail(chapterMgmtState.courseId);
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
      const addChapterTop = document.getElementById('btn-add-chapter-top');
      if (addChapterTop) {
        addChapterTop.onclick = function() {
          _openChapterModal({});
        };
      }
    }

    _render();
  } catch (e) {
    console.error('[chapters-mgmt]', e);
    alert('加载章节失败: ' + (e.message || '未知错误'));
  }
}