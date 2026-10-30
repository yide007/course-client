// ============================================================
//  events.js — 章节管理：点击事件、拖拽排序事件处理
// ============================================================

// 拖拽排序相关常量
var DRAG_ROW_SEL = 'tr[data-chapter-lesson], tr[data-chapter-pdf]';
var DRAG_ZONE_SEL = '[data-drop-section], [data-drop-root]';
var ALL_DROP_SEL = DRAG_ROW_SEL + ', ' + DRAG_ZONE_SEL;
// 当前拖拽源（每次渲染后重置）
var _dragSrc = null;

function _findDropTarget(e) {
  const container = document.getElementById('course-management');
  var el = e.target;
  while (el && el !== container) {
    if (el.matches && el.matches(ALL_DROP_SEL)) return el;
    el = el.parentNode;
  }
  return null;
}

function _clearDropHighlight() {
  const container = document.getElementById('course-management');
  if (!container) return;
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

// 课时拖拽落点处理
function _doMoveLesson(dstCh, dstSection, dstIdx, beforeInsert) {
  var src = _dragSrc; _dragSrc = null;
  if (!src || src.kind !== 'lesson' || src.chIdx !== dstCh) { _render(); return; }
  const lessons = chapterMgmtDraft[dstCh].lessons;
  if (!lessons || src.idx < 0 || src.idx >= lessons.length) { _render(); return; }
  const srcLesson = lessons[src.idx];
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
    const sameSectionIdx = _collectBySection(lessons, srcLesson.sectionTitle || '');
    if (sameSectionIdx.length <= 1) { _render(); return; }
    if (sameSectionIdx[0] === newIdx) { _render(); return; }
    var item2 = lessons.splice(newIdx, 1)[0];
    const firstOfSection = _collectBySection(lessons, srcLesson.sectionTitle || '');
    var insertAt2 = firstOfSection.length ? firstOfSection[firstOfSection.length - 1] + 1 : lessons.length;
    lessons.splice(insertAt2, 0, item2);
  }
  _render();
}

// 资料拖拽落点处理
function _doMovePdf(dstCh, dstSection, dstIdx, beforeInsert) {
  var src = _dragSrc; _dragSrc = null;
  if (!src || src.kind !== 'pdf' || src.chIdx !== dstCh) { _render(); return; }
  const pdfs = chapterMgmtDraft[dstCh].pdfs;
  if (!pdfs || src.idx < 0 || src.idx >= pdfs.length) { _render(); return; }
  const srcPdf = pdfs[src.idx];
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
    const sameSectionIdx = _collectBySection(pdfs, srcPdf.sectionTitle || '');
    if (sameSectionIdx.length <= 1) { _render(); return; }
    var item2 = pdfs.splice(newIdx, 1)[0];
    const list = _collectBySection(pdfs, srcPdf.sectionTitle || '');
    var insertAt2 = list.length ? list[list.length - 1] + 1 : pdfs.length;
    pdfs.splice(insertAt2, 0, item2);
  }
  _render();
}

// 绑定章节列表的点击 & 拖拽事件（_render 后调用）
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

  _dragSrc = null;

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
        const lessons = chapterMgmtDraft[parts[0]].lessons;
        const arr = kind === 'lesson' ? lessons : chapterMgmtDraft[parts[0]].pdfs;
        const dstItem = arr[parts[1]];
        const dstSec = (dstItem && dstItem.sectionTitle) || '';
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
}