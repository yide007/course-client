// ============================================================
//  index.js — 章节管理：入口，负责初始化状态、构建 header 并首次渲染
// ============================================================

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
      }, '章节管理');
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

    _renderChapterHeader(detail);
    _render();
  } catch (e) {
    console.error('[chapters-mgmt]', e);
    alert('加载章节失败: ' + (e.message || '未知错误'));
  }
}