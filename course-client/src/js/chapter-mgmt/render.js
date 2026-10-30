// ============================================================
//  render.js — 章节管理：只负责把 state（chapterMgmtDraft）渲染到 DOM
// ============================================================

function _render() {
  const T = _totals();
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
          secLessonRows += _tmplLessonRow(ch, chIdx, secL, origIdx, globalLessonNum);
        });

        if (secTitle === '') {
          const ungroupedPdfs = pdfs.filter(p => !(p.sectionTitle));
          const ungroupedPdfRows = ungroupedPdfs.map(p => {
            const origIdx = pdfs.indexOf(p);
            return _tmplPdfRow(ch, chIdx, p, origIdx);
          }).join('');
          sectionHtmlParts += _tmplSectionRootArea(chIdx, secLessonRows, ungroupedPdfRows);
        } else {
          const secLessonsCount = secLessons.length;
          const secDur = _formatDuration(secLessons.reduce((s, l) => s + (Number(l.duration) || 0), 0));
          const secPdfs = pdfs.filter(p => (p.sectionTitle || '') === secTitle);
          const secPdfRows = secPdfs.map((p) => {
            const origIdx = pdfs.indexOf(p);
            return _tmplPdfRow(ch, chIdx, p, origIdx);
          }).join('');
          const secEmpty = !secLessonRows && !secPdfRows;
          sectionHtmlParts += _tmplSectionBlock(chIdx, secIdx, secTitle, secLessonsCount, secDur, secPdfs.length, secLessonRows, secPdfRows, secEmpty);
        }
      });

      return _tmplChapterBlock(chIdx, ch, sectionHtmlParts, lessons, pdfs, sectionCount, totalDur);
    }).join('') : _tmplEmptyChapterState()}

    ${_tmplTipBox(T)}
  </div>`;

  const container = document.getElementById('course-management');
  if (!container) return;
  container.innerHTML = html;
  _bindChapterMgmtEvents();
  _updateHeaderStats();
}

// 刷新顶部统计数字
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

// 渲染章节管理页的顶部 header（标题 + 统计 + 操作按钮），并绑定保存/撤销/添加事件
function _renderChapterHeader(detail) {
  const pageHeader = document.querySelector('#page-course-mgmt > .page-header');
  if (!pageHeader) return;
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
            <button id="btn-add-chapter-top" class="btn btn-primary" style="padding:8px 18px;font-size:13px;background:linear-gradient(135deg,#6366f1,#8b5cf6);box-shadow:0 2px 8px rgba(139,92,246,0.35);">+ 添加章</button>
            <button id="btn-reset-chapters-top" class="btn btn-primary" style="padding:8px 18px;font-size:13px;background:linear-gradient(135deg,#0ea5e9,#0284c7);box-shadow:0 2px 8px rgba(14,165,233,0.35);">↺ 撤销修改</button>
            <button id="btn-save-chapters-top" class="btn btn-primary" style="padding:8px 18px;font-size:13px;background:linear-gradient(135deg,#10b981,#059669);box-shadow:0 2px 8px rgba(16,185,129,0.35);">💾 保存修改</button>
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