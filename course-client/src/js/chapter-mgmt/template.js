// ============================================================
//  template.js — 章节管理：所有 HTML 模板与图标，统一在此做 escape 处理
// ============================================================

// 上移 / 下移按钮 SVG 图标
function _iconArrowUp() {
  return '<svg viewBox="0 0 1024 1024" width="18" height="18" xmlns="http://www.w3.org/2000/svg"><path d="M893.1584 480.4864L538.6752 63.5136a34.8928 34.8928 0 0 0-53.2224 0L130.8672 480.4864a35.4304 35.4304 0 0 0 26.6752 58.4704h167.3472v358.2464A75.2896 75.2896 0 0 0 399.744 972.8h224.5376a75.2896 75.2896 0 0 0 74.8544-75.5968v-358.144h167.4752a35.5072 35.5072 0 0 0 26.5472-58.5728z" fill="#1296db"></path></svg>';
}

function _iconArrowDown() {
  return '<svg viewBox="0 0 1024 1024" width="18" height="18" xmlns="http://www.w3.org/2000/svg" style="transform:rotate(180deg);"><path d="M893.1584 480.4864L538.6752 63.5136a34.8928 34.8928 0 0 0-53.2224 0L130.8672 480.4864a35.4304 35.4304 0 0 0 26.6752 58.4704h167.3472v358.2464A75.2896 75.2896 0 0 0 399.744 972.8h224.5376a75.2896 75.2896 0 0 0 74.8544-75.5968v-358.144h167.4752a35.5072 35.5072 0 0 0 26.5472-58.5728z" fill="#1296db"></path></svg>';
}

// ==== 表格相关 ====

function _tmplTableHeader() {
  return `
    <thead>
      <tr style="background:#f8fafc;border-bottom:1px solid #e5e7eb;">
        <th style="padding:10px 16px;text-align:center;font-weight:600;color:#475569;width:60px;">序号</th>
        <th style="padding:10px 16px;text-align:center;font-weight:600;color:#475569;">名称</th>
        <th style="padding:10px 16px;text-align:center;font-weight:600;color:#475569;">链接/路径</th>
        <th style="padding:10px 16px;text-align:center;font-weight:600;color:#475569;width:160px;">操作</th>
      </tr>
    </thead>`;
}

function _tmplLessonRow(ch, chIdx, l, lIdx, runningNum) {
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

function _tmplPdfRow(ch, chIdx, p, pIdx) {
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

// 章根区域（数据放入此处会归为未分组）
function _tmplSectionRootArea(chIdx, secLessonRows, ungroupedPdfRows) {
  if (secLessonRows || ungroupedPdfRows) {
    return `
                <div data-drop-root="${chIdx}" style="padding:4px 0;border-radius:6px;transition:background 0.15s;">
                  <table style="width:100%;border-collapse:collapse;font-size:13px;">
                    ${_tmplTableHeader()}
                    <tbody>
                      ${secLessonRows}
                      ${ungroupedPdfRows}
                    </tbody>
                  </table>
                </div>`;
  }
  return `
                <div data-drop-root="${chIdx}" style="padding:14px;text-align:center;color:#94a3b8;font-size:12px;border:2px dashed #e2e8f0;border-radius:6px;transition:background 0.15s;">
                  章根区域（拖拽课时/资料到此处可放回未分组）
                </div>`;
}

// 节区块：标题 + 上传/编辑按钮 + 内容表格
function _tmplSectionBlock(chIdx, secIdx, secTitle, secLessonsCount, secDur, secPdfCount, secLessonRows, secPdfRows, secEmpty) {
  return `
              <div data-section-block="${chIdx}-${secIdx}" data-drop-section="${escapeAttr(secTitle)}" style="margin:10px 18px;border:1px solid #e0e7ff;border-radius:8px;overflow:hidden;background:#fafbff;transition:box-shadow 0.15s,border-color 0.15s;">
                <div style="padding:10px 14px;background:linear-gradient(135deg,#f0f9ff 0%,#eef2ff 100%);display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;border-bottom:1px solid #e0e7ff;">
                  <div style="display:flex;align-items:center;gap:10px;flex:1;min-width:0;">
                    <span style="width:22px;height:22px;border-radius:5px;background:linear-gradient(135deg,#0ea5e9,#6366f1);color:#fff;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex-shrink:0;">${secIdx}</span>
                    <div style="min-width:0;">
                      <div style="font-size:13px;font-weight:600;color:#1e3a8a;">📖 ${escapeHtml(secTitle)}</div>
                      <div style="font-size:11px;color:#64748b;margin-top:1px;">🎬 ${secLessonsCount} 个课时 · 📄 ${secPdfCount} 份资料 · ⏱ ${secDur}</div>
                    </div>
                  </div>
                  <div style="display:flex;gap:4px;flex-wrap:wrap;">
                    <button class="btn btn-sm" data-act="batch-upload-to-section" data-ch="${chIdx}" data-sec="${escapeAttr(secTitle)}" style="padding:4px 8px;font-size:11px;background:linear-gradient(135deg,#10b981,#059669);color:#fff;border:none;">📦 批量上传</button>
                    <button class="btn btn-sm" data-act="folder-upload-to-section" data-ch="${chIdx}" data-sec="${escapeAttr(secTitle)}" style="padding:4px 8px;font-size:11px;background:linear-gradient(135deg,#f59e0b,#d97706);color:#fff;border:none;">📁 上传文件夹</button>
                    <button class="btn btn-sm" data-act="add-pdf-to-section" data-ch="${chIdx}" data-sec="${escapeAttr(secTitle)}" style="padding:4px 8px;font-size:11px;background:linear-gradient(135deg,#06b6d4,#0891b2);color:#fff;border:none;">📄 添加资料</button>
                    <button class="btn btn-sm" data-act="edit-section" data-ch="${chIdx}" data-sec="${escapeAttr(secTitle)}" style="padding:4px 8px;font-size:11px;background:linear-gradient(135deg,#64748b,#475569);color:#fff;border:none;">✏️ 编辑</button>
                    <button class="btn btn-sm" data-act="move-section-up" data-ch="${chIdx}" data-sec="${escapeAttr(secTitle)}" style="padding:4px 6px;background:transparent;border:none;box-shadow:none;" title="上移">${_iconArrowUp()}</button>
                    <button class="btn btn-sm" data-act="move-section-down" data-ch="${chIdx}" data-sec="${escapeAttr(secTitle)}" style="padding:4px 6px;background:transparent;border:none;box-shadow:none;" title="下移">${_iconArrowDown()}</button>
                    <button class="btn btn-sm btn-danger-outline" data-act="del-section" data-ch="${chIdx}" data-sec="${escapeAttr(secTitle)}" style="padding:4px 8px;font-size:11px;">🗑 删除</button>
                  </div>
                </div>
                <div style="overflow-x:auto;">
                  <table style="width:100%;border-collapse:collapse;font-size:13px;">
                    ${_tmplTableHeader()}
                    <tbody>
                      ${secLessonRows}
                      ${secPdfRows}
                      ${secEmpty ? `<tr><td colspan="4" style="padding:14px;text-align:center;color:#94a3b8;font-size:12px;">该节暂无内容，拖拽课时/资料到此处，或点击上方「📦 批量上传」开始创建</td></tr>` : ''}
                    </tbody>
                  </table>
                </div>
              </div>`;
}

// 整个章节块
function _tmplChapterBlock(chIdx, ch, sectionHtmlParts, lessons, pdfs, sectionCount, totalDur) {
  const emptyTip = !sectionHtmlParts
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
                <button class="btn btn-sm" data-act="add-pdf" data-ch="${chIdx}" style="padding:6px 12px;font-size:12px;background:linear-gradient(135deg,#06b6d4,#0891b2);color:#fff;border:none;">📄 添加资料</button>
                <button class="btn btn-sm" data-act="edit-chapter" data-ch="${chIdx}" style="padding:6px 12px;font-size:12px;background:linear-gradient(135deg,#64748b,#475569);color:#fff;border:none;">✏️ 编辑</button>
                <button class="btn btn-sm" data-act="move-chapter-up" data-ch="${chIdx}" style="padding:4px 6px;background:transparent;border:none;box-shadow:none;" title="上移">${_iconArrowUp()}</button>
                <button class="btn btn-sm" data-act="move-chapter-down" data-ch="${chIdx}" style="padding:4px 6px;background:transparent;border:none;box-shadow:none;" title="下移">${_iconArrowDown()}</button>
                <button class="btn btn-sm btn-danger-outline" data-act="del-chapter" data-ch="${chIdx}" style="padding:6px 12px;font-size:12px;">🗑 删除章节</button>
              </div>
            </div>
            ${emptyTip ? `<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:13px;">${_tmplTableHeader()}<tbody>${emptyTip}</tbody></table></div>` : ''}
            ${sectionHtmlParts}
          </div>`;
}

function _tmplEmptyChapterState() {
  return `<div class="empty-state"><p style="text-align:center;color:#94a3b8;padding:60px 20px 20px;">该课程暂无章节</p>
          <div style="text-align:center;padding-bottom:40px;"><button id="btn-add-chapter-empty" class="btn btn-primary">＋ 添加第一个章节</button></div>
        </div>`;
}

function _tmplTipBox(T) {
  return `
        <div style="padding:18px 24px;border:2px dashed #cbd5e1;border-radius:12px;background:#fafbff;margin-bottom:24px;display:flex;gap:12px;flex-wrap:wrap;align-items:center;justify-content:space-between;">
          <div>
            <div style="font-weight:700;color:#334155;margin-bottom:4px;">💡 提示</div>
            <div style="font-size:12px;color:#64748b;">修改完成后，请点击页面右上角「💾 保存修改」将章节（章/节/课时/资料）写入数据库。</div>
          </div>
          <div style="font-size:12px;color:#64748b;text-align:right;">
            <div style="margin-bottom:2px;">当前草稿</div>
            <div style="font-weight:600;color:#334155;">📚 ${T.chapters} 章 · 🎬 ${T.lessons} 课时 · 📄 ${T.pdfs} 资料</div>
          </div>
        </div>`;
}

// ==== 弹窗模板 ====

function _tmplChapterModal(chIdx, title) {
  return `
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
}

function _tmplSectionModal(isEdit, oldTitle) {
  return `
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
}

// 课时/资料弹窗中的「归属」只读标签
function _tmplSectionTagHtml(fixedSec, ch) {
  if (fixedSec) {
    return `<div class="form-group">
             <div style="display:block;font-size:13px;font-weight:600;margin-bottom:4px;color:#475569;">归属</div>
             <div style="display:inline-flex;align-items:center;gap:6px;padding:8px 12px;border:1px solid #e2e8f0;border-radius:8px;background:#eff6ff;color:#1d4ed8;font-size:13px;font-weight:600;">📖 ${escapeHtml(fixedSec)}</div>
           </div>`;
  }
  return `<div class="form-group">
             <div style="display:block;font-size:13px;font-weight:600;margin-bottom:4px;color:#475569;">归属</div>
             <div style="display:inline-flex;align-items:center;gap:6px;padding:8px 12px;border:1px solid #e2e8f0;border-radius:8px;background:#f8fafc;color:#334155;font-size:13px;font-weight:600;">📚 章级（${escapeHtml(ch.title || '')}）</div>
           </div>`;
}

function _tmplLessonModal(item, lessonIdx, defaultTitle, sectionTagHtml, fixedSec) {
  return `
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
}

function _tmplPdfModal(item, pdfIdx, defaultName, sectionTagHtml) {
  return `
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
}

// ==== 批量上传相关模板 ====

function _tmplBatchFileItem(idx, name, sizeMb, tag) {
  return `<div class="batch-file-item" data-idx="${idx}" style="padding:8px 12px;border-radius:8px;background:#f8fafc;border:1px solid #e2e8f0;margin-bottom:6px;font-size:12px;">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
              <span class="batch-file-status" style="font-size:14px;">⏳</span>
              <span class="batch-file-name" style="flex:1;color:#334155;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${tag || ''}${escapeHtml(name)}</span>
              <span style="color:#64748b;flex-shrink:0;">${sizeMb}MB</span>
            </div>
            <div class="batch-file-bar" style="height:4px;background:#e2e8f0;border-radius:2px;overflow:hidden;">
              <div class="batch-file-bar-fill" style="height:100%;width:0%;background:#94a3b8;border-radius:2px;transition:width .2s;"></div>
            </div>
            <div class="batch-file-msg" style="margin-top:3px;font-size:11px;color:#94a3b8;">等待中...</div>
          </div>`;
}