async function _renderTopbarNav(targetPage, onBack, title) {
  const topbarLeft = document.getElementById('topbar-left');
  if (!topbarLeft) return;
  const topbar = topbarLeft.closest('.topbar');
  if (topbar) topbar.style.display = 'flex';
  const titleHtml = title
    ? '<span style="font-size:16px;font-weight:700;color:#0f172a;margin-left:8px;vertical-align:middle;max-width:480px;display:inline-block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + escapeAttr(title) + '">' + escapeHtml(title) + '</span>'
    : '';
  topbarLeft.innerHTML =
    '<button type="button" class="icon-btn" id="topbar-back-btn" title="返回"><span class="icon-btn-icon">⬅</span></button>' +
    '<button type="button" class="icon-btn" id="topbar-home-btn" title="主页"><span class="icon-btn-icon">🏠</span></button>' +
    titleHtml;
  const backBtn = topbarLeft.querySelector('#topbar-back-btn');
  const homeBtn = topbarLeft.querySelector('#topbar-home-btn');
  if (backBtn) {
    backBtn.addEventListener('click', () => {
      if (typeof onBack === 'function') onBack();
      else if (typeof navigateTo === 'function') navigateTo(targetPage);
    });
  }
  if (homeBtn) {
    homeBtn.addEventListener('click', () => {
      if (typeof navigateTo === 'function') navigateTo('courses');
    });
  }
}

function _clearTopbarNav() {
  const topbarLeft = document.getElementById('topbar-left');
  if (topbarLeft) topbarLeft.innerHTML = '';
}

function _renderTopbarTitle(title, actionHtml) {
  const topbarLeft = document.getElementById('topbar-left');
  if (!topbarLeft) return;
  const topbar = topbarLeft.closest('.topbar');
  if (topbar) topbar.style.display = 'flex';
  let html = '<span style="font-size:18px;font-weight:700;color:#0f172a;margin-right:12px;">' + escapeHtml(title) + '</span>';
  if (actionHtml) html += actionHtml;
  topbarLeft.innerHTML = html;
}

async function viewCourseDetail(courseId) {
  try {
    // 切换课程前：保存旧课程播放进度，避免进度丢失
    if (typeof _saveCurrentProgress === 'function') {
      try { _saveCurrentProgress(); } catch (_) {}
    }
    // 重置当前播放课时 ID，避免旧课程残留导致上一集/下一集定位错乱
    currentVideoLessonId = null;
    currentCourseId = courseId;
    currentPage = 'detail';
    const detail = await api.getCourseDetail(courseId);
    if (!detail) {
      console.error('[detail] 课程不存在:', courseId);
      alert('课程不存在或已被删除');
      navigateTo('courses');
      return;
    }

    // 调试：打印数据库返回的原始数据
    console.log('[detail] 课程详情:', detail.title, '章节数:', (detail.chapters || []).length);
    if (detail.chapters && detail.chapters.length > 0) {
      const firstCh = detail.chapters[0];
      if (firstCh.lessons && firstCh.lessons.length > 0) {
        const firstL = firstCh.lessons[0];
        console.log('[detail] 第1个课时: title=%s videoUrl=%s videoUrlLocal=%s', firstL.title, firstL.videoUrl, firstL.videoUrlLocal);
      } else {
        console.log('[detail] 警告: 第1章没有课时');
      }
    }

    const [progress, categories] = await Promise.all([
      api.getCourseProgress(courseId).catch(() => []),
      _getCachedCategories(),
    ]);

    // 防止异步返回时用户已切换到其他页面，覆盖顶部工具栏
    if (currentPage !== 'detail') return;

    // 切换到详情页
    document.querySelectorAll('.page').forEach((p) => p.classList.remove('active'));
    const pageEl = document.getElementById('page-detail');
    pageEl.classList.add('active');

    // 进入详情页隐藏侧边栏
    const sidebar = document.getElementById('sidebar');
    if (sidebar) sidebar.classList.add('hidden');

    // 隐藏详情页的 page-header，把返回/主页按钮移到顶部工具栏左侧
    const detailHeader = pageEl.querySelector('.page-header');
    if (detailHeader) detailHeader.style.display = 'none';
    _renderTopbarNav('courses', null, detail.title);

    // 取消侧边栏高亮
    document.querySelectorAll('.nav-item').forEach((n) => n.classList.remove('active'));

    document.getElementById('detail-title').textContent = detail.title;
    // 暂时关闭预热：改为点击哪个就下载哪个，避免预热与播放冲突
    // _startP115LessonWarmup(detail);

    const progressMap = {};
    (progress || []).forEach((p) => { progressMap[p.lessonId] = p; });

    const catId = detail.categoryId || detail.category_id;
    const catName = (categories.find(c => String(c.id) === String(catId)) || {}).name || '未分类';

    // ===== 左上：同步提示 =====
    const lessonTotal = (detail.chapters || []).reduce((s, c) => s + ((c.lessons || []).length), 0);
    // 手动模式识别：_manual=true；或者【没有有效 token 且非 netdisk 网盘课程】
    const hasRealToken = Boolean(String(detail.token || '').trim() && String(detail.token || '').trim().toLowerCase() !== 'null');
    const isNetdiskCourse = detail.courseMode === 'netdisk';
    const isManualCourse = Boolean(detail._manual) || (!hasRealToken && !isNetdiskCourse);
    const showActionBtn = _currentLoginUser && _currentLoginUser.role === 'admin';

    // ===== 左下：课程目录 =====
    const chaptersEl = document.getElementById('detail-chapters');
    const chaptersHtml = (detail.chapters || []).map((ch, idx) => {
      const safeChTitle = escapeHtml(ch.title || '');
      // 按名称（标题优先，缺省用路径）从上到下自然排序展示
      const lessons = (ch.lessons || []).slice().sort(function(a, b) {
        var na = (a && (a.title || a.path || '')) || '';
        var nb = (b && (b.title || b.path || '')) || '';
        return _naturalCmpStr(na, nb);
      });

      // ===== 按 sectionTitle 分组课时 =====
      const sectionMap = {};
      var sectionOrder = [];
      lessons.forEach(function(l) {
        var sec = l.sectionTitle || '';
        if (!sectionMap[sec]) {
          sectionMap[sec] = [];
          sectionOrder.push(sec);
        }
        sectionMap[sec].push(l);
      });
      // ===== 把 sections 数组中定义的空节也加入顺序（保证无课时空节也能显示）=====
      if (Array.isArray(ch.sections)) {
        ch.sections.forEach(function(s) {
          if (!s) return;
          if (!sectionMap[s]) {
            sectionMap[s] = [];
            sectionOrder.push(s);
          }
        });
      }

      // ===== 章节PDF资料：按目录（文件路径前缀）归属到每个节 =====
      // 优先使用 PDF.sectionTitle（用户在管理端明确指定的），否则回退到路径推断
      var allPdfs = _sortByName(ch.pdfs || [], function(p) { return p.path || p.name || ''; });
      var usedPdfIdx = {};
      var pdfByExplicitSec = {}; // key = sectionTitle ('' 代表章级无分组), value = [pdf,...]
      allPdfs.forEach(function(pdf, pi) {
        var es = pdf.sectionTitle;
        if (es !== undefined && es !== null && String(es).trim() !== '') {
          var k = String(es).trim();
          if (!pdfByExplicitSec[k]) pdfByExplicitSec[k] = [];
          pdfByExplicitSec[k].push({ pdf: pdf, origIdx: pi });
          usedPdfIdx[pi] = true; // 已明确归属，不再走路径推断
        }
      });
      // 确保显式设置了节的节名也出现在 sectionOrder 中
      Object.keys(pdfByExplicitSec).forEach(function(sName) {
        if (!sectionMap[sName]) {
          sectionMap[sName] = [];
          sectionOrder.push(sName);
        }
      });
      var pdfCount = allPdfs.length;

      // 规范化路径（统一用 /，去掉结尾 /）
      function _normP(p) { return String(p || '').replace(/\\/g, '/').replace(/\/+$/, ''); }
      // 取父目录
      function _parent(p) { var n = _normP(p); var i = n.lastIndexOf('/'); return i > 0 ? n.substring(0, i) : ''; }

      // ===== 生成每个分组的 HTML =====
      var sectionGroupsHtml = '';
      sectionOrder.forEach(function(secTitle, sIdx) {
        var secLessons = sectionMap[secTitle];

        // ---- 收集本节"所有权属标识"：
        //      1) 课时文件所在的父目录路径（兼容原逻辑）
        //      2) 节名（secTitle，即二级目录名）本身，PDF 路径中只要包含 "/节名/" 片段就算归属到本节
        var secDirs = [];
        secLessons.forEach(function(l) {
          var d = _parent(l.path || '');
          if (d && secDirs.indexOf(d) === -1) secDirs.push(d);
        });
        secDirs.sort(_naturalCmpStr);
        // 额外兼容：secTitle 非空时，把 "/secTitle/" 作为路径片段匹配维度
        var secTitleNorm = (secTitle || '').trim();

        var secLessonsHtml = secLessons.map(function(l) {
          var lp = progressMap[l.id];
          var completed = lp && lp.completed;
          var prog = lp ? Math.round(lp.progress) : 0;
          var safeTitle = escapeHtml(l.title || '');
          var safeVideoUrl = escapeAttr(l.videoUrl || '');
          var safeVideoUrlLocal = escapeAttr(l.videoUrlLocal || '');
          var safeVideoSource = escapeAttr(l.videoSource ? (typeof l.videoSource === 'string' ? l.videoSource : JSON.stringify(l.videoSource)) : '');
          var duration = l.duration || '00:00';
          var sourcePath = l.path || '';
          var iconHtml = completed ? '✅' : '🎬';
          return '<li class="lesson-item ' + (completed ? 'completed' : '') + '" data-lesson-id="' + l.id + '" data-video-url="' + safeVideoUrl + '" data-video-url-local="' + safeVideoUrlLocal + '" data-video-source="' + safeVideoSource + '" data-course-id="' + detail.id + '" data-title="' + safeTitle + '">' +
            '<span>' + iconHtml + '</span>' +
            '<span>' + safeTitle + '</span>' +
            (l.isFree ? '<span class="lesson-free-badge">免费</span>' : '') +
            '<span class="lesson-duration">' + duration + '</span>' +
            (prog > 0 ? '<span class="lesson-progress">' + prog + '%</span>' : '') +
            '</li>';
        }).join('');

        // ===== 当前节对应的 PDF：只要 PDF 在二级目录里，就归属到该节下 =====
        //      匹配维度（任一命中即可）：
        //        0️⃣ PDF.sectionTitle === secTitle（管理端明确指定，最高优先级）
        //        ① PDF 父目录 / 爷爷目录 是该节课时所在目录（原有精确匹配）
        //        ② PDF 路径中包含 "/节目录名/" 片段（只要位于该节目录层级下就匹配，子目录也算）
        //        ③ 目录前缀匹配（PDF 在该目录的任意深层子文件夹里都算）
        var secPdfs = [];
        // 先把显式归属到本节的 PDF 全部加入（优先级最高）
        if (secTitle && pdfByExplicitSec[secTitle]) {
          pdfByExplicitSec[secTitle].forEach(function(e) {
            secPdfs.push(e.pdf);
            usedPdfIdx[e.origIdx] = true;
          });
        }
        if (secDirs.length > 0 || secTitleNorm) {
          allPdfs.forEach(function(pdf, pi) {
            if (usedPdfIdx[pi]) return;
            var pdfFull = _normP(pdf.path || pdf.name || '');
            var pdfParent = _parent(pdfFull);
            var pdfGrandParent = pdfParent ? _parent(pdfParent) : '';
            var matched = false;
            for (var di = 0; di < secDirs.length; di++) {
              var sd = secDirs[di];
              if (!sd) continue;
              // ① 同目录 / 爷爷目录
              if (pdfParent === sd || pdfGrandParent === sd) { matched = true; break; }
              // ③ 目录前缀匹配（该目录下任意层级）
              if (pdfParent && pdfParent.indexOf(sd + '/') === 0) { matched = true; break; }
              if (pdfFull.indexOf(sd + '/') === 0) { matched = true; break; }
            }
            // ② 按节名（二级目录名）作为路径片段匹配
            if (!matched && secTitleNorm) {
              var seg = '/' + secTitleNorm + '/';
              if (pdfFull.indexOf(seg) !== -1) matched = true;
              // 兼容：PDF 直接挂在节名下面（路径结尾 "/节名/xxx.pdf" 里节名就是 pdfParent 的最后一段）
              if (!matched && pdfParent) {
                var pp = _normP(pdfParent);
                var li = pp.lastIndexOf('/');
                var parentName = li >= 0 ? pp.substring(li + 1) : pp;
                if (parentName === secTitleNorm) matched = true;
              }
            }
            if (matched) { secPdfs.push(pdf); usedPdfIdx[pi] = true; }
          });
        }


        var secPdfsHtml = '';
        if (secPdfs.length > 0) {
          _sortByName(secPdfs, function(p) { return p.path || p.name || ''; });
          var token = detail.token || '';
          var pdfItems = secPdfs.map(function(p) {
            var pName = escapeHtml(p.name || '文档');
            var pUrl = escapeAttr(p.url || '');
            var pPath = p.path || '';
            return '<div class="pdf-item">' +
              '<span class="pdf-name">📄 ' + pName + '</span>' +
              '<div class="pdf-actions">' +
              '<button class="pdf-btn pdf-btn-open" data-url="' + pUrl + '" data-filename="' + escapeAttr(p.name) + '" data-token="' + escapeAttr(token) + '" title="本地预览">👁 预览</button>' +
              '<button class="pdf-btn pdf-btn-download" data-url="' + pUrl + '" data-filename="' + escapeAttr(p.name) + '" data-token="' + escapeAttr(token) + '">⬇ 下载</button>' +
              '</div></div>';
          }).join('');
          secPdfsHtml = '<div class="chapter-pdfs section-pdfs"><div class="chapter-pdfs-title">📎 资料</div><div class="chapter-pdfs-list">' + pdfItems + '</div></div>';
        }

        // 始终用 section-content 包裹，保证所有章节的缩进一致；仅当有 sectionTitle 时显示分组标题栏
        var secHeaderHtml = '';
        var secOpen = true;
        if (secTitle) {
          var secTitleEscaped = escapeHtml(secTitle);
          var secCount = secLessons.length + secPdfs.length;
          secHeaderHtml = '<div class="section-group-title" data-section-toggle="1">' +
            '<span class="section-arrow">' + (secOpen ? '▼' : '▶') + '</span>' +
            '<span class="section-group-icon">📖</span> ' + secTitleEscaped +
            '<span style="margin-left:auto;font-size:12px;color:#94a3b8;font-weight:normal;">' + secCount + ' 项</span>' +
            '</div>';
        }

        sectionGroupsHtml += '<div class="section-group">' +
          secHeaderHtml +
          '<div class="section-content" style="display:' + (secOpen ? '' : 'none') + ';">' +
          (secLessonsHtml ? '<ul class="lesson-list">' + secLessonsHtml + '</ul>' : '') +
          secPdfsHtml +
          '</div>' +
          '</div>';
      });

      // ===== 新增：PDF-only 分组 =====
      // 剩余 PDF 按父目录分组，为「只有 PDF 没有课时」的目录创建独立 section，
      // 避免这些 PDF 全部堆在「章节资料」里丢失层级。
      var _sectionTitlesFromLessons = {};
      sectionOrder.forEach(function(s) { _sectionTitlesFromLessons[s] = true; });

      var pdfLeftoverGroups = {}; // key = 父目录路径，value = [{pdf, origIdx}]
      allPdfs.forEach(function(pdf, pi) {
        if (usedPdfIdx[pi]) return;
        var pdfFull = _normP(pdf.path || pdf.name || '');
        var parentDir = _parent(pdfFull) || '__root__';
        if (!pdfLeftoverGroups[parentDir]) pdfLeftoverGroups[parentDir] = [];
        pdfLeftoverGroups[parentDir].push({ pdf: pdf, origIdx: pi });
      });

      var _pdfGroupKeys = Object.keys(pdfLeftoverGroups);
      _pdfGroupKeys.sort(_naturalCmpStr);
      // 取直接目录名作为 section 标题的辅助函数（去掉前后斜杠，避免显示成 "/讲义"）
      function _lastDir(p) {
        var n = _normP(p);
        // 连续去掉开头/结尾的斜杠
        n = n.replace(/^\/+|\/+$/g, '');
        if (!n) return '';
        var i = n.lastIndexOf('/');
        var seg = i >= 0 ? n.substring(i + 1) : n;
        // 再做一次去首尾斜杠兜底
        return seg.replace(/^\/+|\/+$/g, '');
      }
      // 归一化目录名用于比较（忽略大小写、空格、前后斜杠）
      function _normCmpName(a) {
        return String(a || '').replace(/^\/+|\/+$/g, '').trim().toLowerCase();
      }
      // 检查"目录名"是不是已经命中了章节名或任一已存在的节名
      function _isDupWithExisting(dirName, dirFullPath) {
        if (!dirName) return true;
        var na = _normCmpName(dirName);
        if (!na) return true;
        if (_normCmpName(ch.title || '') === na) return true;
        var hit = false;
        Object.keys(_sectionTitlesFromLessons).forEach(function(s) {
          if (_normCmpName(s) === na) hit = true;
        });
        if (hit) return true;
        // 再兜底：dirFullPath 的结尾是 /章节名 或 /节目录 也算命中
        if (dirFullPath) {
          var np = _normP(dirFullPath).replace(/^\/+|\/+$/g, '');
          Object.keys(_sectionTitlesFromLessons).forEach(function(s) {
            var ns = _normCmpName(s);
            if (!ns) return;
            if (np === ns || np.endsWith('/' + ns)) hit = true;
          });
          if (_normCmpName(ch.title || '')) {
            var nc = _normCmpName(ch.title || '');
            if (np === nc || np.endsWith('/' + nc)) return true;
          }
          return hit;
        }
        return false;
      }

      var _curToken = detail.token || '';
      // 如果只有根目录一个分组且其他分组全无（= 整个章节就几份零散 PDF 没有任何子目录），
      // 就不额外建 section 了，留给下方「章节资料」显示，避免出现只有一个空壳 section
      var _onlyRoot = (_pdfGroupKeys.length === 1 && _pdfGroupKeys[0] === '__root__');

      if (!_onlyRoot) {
        _pdfGroupKeys.forEach(function(dirKey) {
          var group = pdfLeftoverGroups[dirKey];
          if (!group || group.length === 0) return;

          var parentDir = (dirKey === '__root__') ? '' : dirKey;
          var secTitle = parentDir ? _lastDir(parentDir) : '';

          // 如果这个目录名 和当前章节名 / 已有节目录 / 父目录路径的末段 重名，
          // 就不要再额外包一层壳子，直接平铺一层「📎 资料」。
          var dupAsChapterOrSection = _isDupWithExisting(secTitle, parentDir);

          var secPdfs = group.map(function(g) { return g.pdf; });
          _sortByName(secPdfs, function(p) { return p.path || p.name || ''; });
          // 标记：已被 PDF-only section 使用（后续章节资料排除它们）
          group.forEach(function(g) { usedPdfIdx[g.origIdx] = true; });

          var pdfItems = secPdfs.map(function(p) {
            var pName = escapeHtml(p.name || '文档');
            var pUrl = escapeAttr(p.url || '');
            return '<div class="pdf-item">' +
              '<span class="pdf-name">📄 ' + pName + '</span>' +
              '<div class="pdf-actions">' +
              '<button class="pdf-btn pdf-btn-open" data-url="' + pUrl + '" data-filename="' + escapeAttr(p.name) + '" data-token="' + escapeAttr(_curToken) + '" title="本地预览">👁 预览</button>' +
              '<button class="pdf-btn pdf-btn-download" data-url="' + pUrl + '" data-filename="' + escapeAttr(p.name) + '" data-token="' + escapeAttr(_curToken) + '">⬇ 下载</button>' +
              '</div></div>';
          }).join('');

          if (dupAsChapterOrSection || !secTitle) {
            // 和章节/节重名 或 根目录零散 PDF：直接平铺「📎 资料」，不加额外 section 标题和缩进
            sectionGroupsHtml += '<div class="chapter-pdfs section-pdfs" style="margin-left:0;padding-left:0;"><div class="chapter-pdfs-title">📎 资料</div><div class="chapter-pdfs-list">' + pdfItems + '</div></div>';
          } else {
            // 不同名的独立目录：显示「📁 目录名」+ PDF 列表，但不包 .section-group / .section-content（避免多加一级缩进）
            var secTitleEscaped = escapeHtml(secTitle);
            sectionGroupsHtml += '<div class="section-group-title pdf-only-dir-title" style="cursor:default;">' +
              '<span class="section-group-icon">📁</span> ' + secTitleEscaped +
              '<span style="margin-left:auto;font-size:12px;color:#94a3b8;font-weight:normal;">' + secPdfs.length + ' 份资料</span>' +
              '</div>' +
              '<div class="chapter-pdfs section-pdfs" style="margin-left:0;padding-left:0;"><div class="chapter-pdfs-title">📎 资料</div><div class="chapter-pdfs-list">' + pdfItems + '</div></div>';
          }
        });
      }

      // ===== 章级资料：匹配不到具体节 / 也没有独立目录的零散 PDF，统一显示在整个章节目录下方 =====
      var chapterPdfsHtml = '';
      var leftoverPdfs = allPdfs.filter(function(_, i) { return !usedPdfIdx[i]; });
      if (leftoverPdfs.length > 0) {
        _sortByName(leftoverPdfs, function(p) { return p.path || p.name || ''; });
        var cToken = detail.token || '';
        var cPdfItems = leftoverPdfs.map(function(p) {
          var pName = escapeHtml(p.name || '文档');
          var pUrl = escapeAttr(p.url || '');
          return '<div class="pdf-item">' +
            '<span class="pdf-name">📄 ' + pName + '</span>' +
            '<div class="pdf-actions">' +
            '<button class="pdf-btn pdf-btn-open" data-url="' + pUrl + '" data-filename="' + escapeAttr(p.name) + '" data-token="' + escapeAttr(cToken) + '" title="本地预览">👁 预览</button>' +
            '<button class="pdf-btn pdf-btn-download" data-url="' + pUrl + '" data-filename="' + escapeAttr(p.name) + '" data-token="' + escapeAttr(cToken) + '">⬇ 下载</button>' +
            '</div></div>';
        }).join('');
        chapterPdfsHtml = '<div class="chapter-pdfs chapter-level-pdfs" style="margin-top:8px;"><div class="chapter-pdfs-title">📎 章节资料</div><div class="chapter-pdfs-list">' + cPdfItems + '</div></div>';
      }

      var lessonCount = lessons.length;
      var metaParts = [];
      if (lessonCount > 0) metaParts.push(lessonCount + ' 集');
      if (pdfCount > 0) metaParts.push(pdfCount + ' 份资料');

      const open = idx === 0;
      return '<li class="chapter-item" data-chapter-idx="' + idx + '">' +
        '<div class="chapter-header">' +
        '<span><span class="chapter-icon">' + (open ? '📂' : '📁') + '</span> ' + safeChTitle + '</span>' +
        '<span style="font-size:12px;color:#94a3b8;">' + metaParts.join(' · ') + '</span>' +
        '</div>' +
        '<div class="chapter-content" style="display:' + (open ? '' : 'none') + ';">' +
        sectionGroupsHtml +
        chapterPdfsHtml +
        '</div>' +
        '</li>';
    }).join('');

    const chaptersHeaderEl = document.getElementById('detail-chapters-header');
    let actionBtnHtml = '';
    if (showActionBtn) {
      if (isManualCourse) {
        actionBtnHtml = `<button id="btn-manage-content" class="btn btn-xs" style="background:linear-gradient(135deg,#8b5cf6,#6366f1);color:#fff;border:none;box-shadow:0 2px 6px rgba(139,92,246,0.3);">✏️ 课程编辑</button>`;
      } else {
        actionBtnHtml = `<button id="btn-rebuild-chapters" class="btn btn-xs btn-rebuild-chapters">🔄 更新课程</button>`;
      }
    }
    chaptersHeaderEl.innerHTML =
      `<div class="detail-chapters-header">
        <h3 class="detail-chapters-title">课程目录</h3>
        ${actionBtnHtml}
      </div>`;
    chaptersEl.innerHTML =
      (detail.chapters && detail.chapters.length > 0
        ? `<ul class="chapter-list">${chaptersHtml}</ul>`
        : (isManualCourse
          ? `<div style="padding:36px 20px;text-align:center;">
              <div style="font-size:40px;margin-bottom:10px;">📝</div>
              <p style="color:#64748b;font-size:13px;margin-bottom:14px;">暂无章节内容，点击右上角「课程编辑」开始创建</p>
            </div>`
          : '<p style="color:#94a3b8;padding:20px 0;">暂无课程章节内容</p>'));

    // ===== 手动模式：「课程编辑」按钮 → 跳课程管理章节管理页 =====
    const contentBtn = document.getElementById('btn-manage-content');
    if (contentBtn) {
      contentBtn.addEventListener('click', () => {
        openChapterMgmt(detail.id);
      });
    }

    // ===== 网盘课程：「更新课程」按钮 → 打开 115 网盘选择器，同步文件夹到当前课程 =====
    const rebuildBtn = document.getElementById('btn-rebuild-chapters');
    if (rebuildBtn) {
      rebuildBtn.addEventListener('click', () => {
        if (typeof showP115UpdateWizard === 'function') {
          showP115UpdateWizard(detail.id);
        } else {
          console.error('[detail] showP115UpdateWizard 未定义，请检查脚本加载顺序');
        }
      });
    }

    // ===== 右下：课程简介 =====
    const descEl = document.getElementById('detail-description');
    if (descEl) descEl.textContent = detail.description || '暂无课程简介';

    // ===== 播放器重置 + 课程封面图显示 =====
    const player = document.getElementById('detail-player');
    if (player) {
      player.pause();
      player.removeAttribute('src');
      player.load();
    }
    try { _sweepVideoMemory(); } catch (_) {}
    const subTitleEl = document.getElementById('detail-player-subtitle');
    if (subTitleEl) subTitleEl.textContent = '';
    const _s = document.getElementById('detail-progress-slider');
    if (_s) { _s.value = 0; _s.disabled = true; }
    const _t = document.getElementById('detail-progress-text');
    if (_t) _t.textContent = '0%';

    // 进入详情页默认显示课程封面图
    const coverEl = document.getElementById('detail-player-cover');
    const coverImgEl = document.getElementById('detail-player-cover-img');
    if (coverEl && coverImgEl) {
      const coverImage = detail.coverImage;
      const coverColor = detail.coverColor || 'linear-gradient(135deg, #667eea, #764ba2)';
      if (coverImage && String(coverImage).trim()) {
        coverImgEl.src = escapeAttr(coverImage);
        coverImgEl.style.background = '';
      } else {
        coverImgEl.removeAttribute('src');
        coverImgEl.style.background = coverColor;
      }
      coverEl.style.display = 'block';
      if (player) player.style.display = 'none';
    }

    // ===== 事件绑定：章节展开/收起 =====
    chaptersEl.querySelectorAll('.chapter-header').forEach((header) => {
      header.addEventListener('click', () => {
        const li = header.parentElement;
        const content = li.querySelector('.chapter-content');
        const icon = header.querySelector('.chapter-icon');
        if (!content) return;
        if (content.style.display === 'none') {
          content.style.display = '';
          if (icon) icon.textContent = '📂';
        } else {
          content.style.display = 'none';
          if (icon) icon.textContent = '📁';
        }
      });
    });

    // ===== 事件绑定：节标题展开/收起（资料随视频一起折叠） =====
    chaptersEl.querySelectorAll('.section-group-title[data-section-toggle]').forEach((secHeader) => {
      secHeader.addEventListener('click', (e) => {
        // 阻止冒泡，避免触发行点击
        e.stopPropagation();
        var group = secHeader.parentElement;
        var secContent = group.querySelector(':scope > .section-content');
        var arrow = secHeader.querySelector('.section-arrow');
        if (!secContent) return;
        if (secContent.style.display === 'none') {
          secContent.style.display = '';
          if (arrow) arrow.textContent = '▼';
        } else {
          secContent.style.display = 'none';
          if (arrow) arrow.textContent = '▶';
        }
      });
    });

    // ===== 事件绑定：课时点击播放 =====
    chaptersEl.querySelectorAll('.lesson-item').forEach((item) => {
      item.addEventListener('click', () => {
        const lessonId = parseInt(item.dataset.lessonId);
        const videoUrl = item.dataset.videoUrl || '';
        const videoUrlLocal = item.dataset.videoUrlLocal || '';
        const videoSource = item.dataset.videoSource || '';
        const title = item.dataset.title || '';
        // 切新课前先保存当前课时的进度到 DB + 更新 progressMap
        if (currentVideoLessonId) {
          const dp = document.getElementById('detail-player');
          if (dp && dp.currentTime > 0 && dp.duration) {
            const cur = dp.currentTime;
            const pct = (cur / dp.duration) * 100;
            progressMap[currentVideoLessonId] = {
              ...progressMap[currentVideoLessonId],
              progress: pct,
              completed: pct >= 95,
              lastPosition: cur,
              updatedAt: new Date().toISOString(),
            };
          }
        }
        _saveCurrentProgress();
        if (!videoUrl && !videoUrlLocal) {
          if (videoSource) {
            // 115 存储网盘课时：元数据在 videoSource 里，需要异步获取播放地址
            playP115Lesson(lessonId, title, videoSource, detail.id, item);
          } else {
            // 既无直接地址、也无网盘源：说明是旧数据，需要重新从 115 网盘添加
            console.warn('[课时播放] 课时无视频源: lessonId=' + lessonId + ' title="' + title + '"');
            alert('该课时没有可播放的视频源。\n请删除该课程并在 115 网盘中重新添加（旧课程缺少播放元数据）。');
          }
        } else {
          playVideo(lessonId, title, videoUrl, videoUrlLocal, detail.id, item);
        }
        // 恢复该课时的播放进度（从 progressMap 中取 lastPosition）
        const saved = progressMap[lessonId];
        if (saved && !saved.completed && saved.lastPosition > 2) {
          const player = document.getElementById('detail-player');
          if (player) {
            const seekPos = Number(saved.lastPosition) || 0;
            const checkAndSeek = () => {
              if (player.readyState >= 1 && player.duration > 0) {
                try {
                  if (seekPos < player.duration - 5) {
                    player.currentTime = seekPos;
                    console.log('[恢复课时] 已恢复到播放位置: ' + seekPos.toFixed(1) + 's');
                  }
                } catch (_) {}
              } else {
                setTimeout(checkAndSeek, 200);
              }
            };
            setTimeout(checkAndSeek, 100);
          }
        }
      });
    });

    function _scrollIntoViewAllAncestors(el) {
      if (!el) return;
      const scrollables = [];
      let parent = el.parentElement;
      while (parent && parent !== document.body) {
        const style = window.getComputedStyle(parent);
        const overflowY = style.overflowY;
        if (overflowY === 'auto' || overflowY === 'scroll') {
          scrollables.push(parent);
        }
        parent = parent.parentElement;
      }
      scrollables.reverse().forEach(sc => {
        const pRect = sc.getBoundingClientRect();
        const elRect = el.getBoundingClientRect();
        const offset = (elRect.top - pRect.top) + sc.scrollTop
          - (sc.clientHeight / 2) + (elRect.height / 2);
        sc.scrollTo({ top: offset, behavior: 'smooth' });
      });
    }

    function _navigateLesson(direction) {
      const allLessons = Array.from(chaptersEl.querySelectorAll('.lesson-item'));
      if (allLessons.length === 0) return;
      let currentIdx = -1;
      if (currentVideoLessonId != null) {
        currentIdx = allLessons.findIndex(el => parseInt(el.dataset.lessonId) === currentVideoLessonId);
      }
      let targetIdx;
      if (currentIdx === -1) {
        // 没有当前播放的课时：下一集从第1集开始，上一集无效
        targetIdx = direction > 0 ? 0 : -1;
      } else {
        targetIdx = currentIdx + direction;
      }
      if (targetIdx < 0 || targetIdx >= allLessons.length) return;
      const targetLesson = allLessons[targetIdx];
      targetLesson.click();
      _scrollIntoViewAllAncestors(targetLesson);
    }
    const prevBtn = document.getElementById('btn-prev-lesson');
    const nextBtn = document.getElementById('btn-next-lesson');
    // 常驻按钮：先移除旧监听再绑定新的，避免多次进入详情页后监听器累积（导致点一次触发多次）
    if (prevBtn) {
      if (prevBtn._prevLessonHandler) prevBtn.removeEventListener('click', prevBtn._prevLessonHandler);
      prevBtn._prevLessonHandler = () => _navigateLesson(-1);
      prevBtn.addEventListener('click', prevBtn._prevLessonHandler);
    }
    if (nextBtn) {
      if (nextBtn._nextLessonHandler) nextBtn.removeEventListener('click', nextBtn._nextLessonHandler);
      nextBtn._nextLessonHandler = () => _navigateLesson(1);
      nextBtn.addEventListener('click', nextBtn._nextLessonHandler);
    }

    // ===== 事件绑定：PDF预览按钮（带鉴权下载到本地后用系统默认阅读器打开） =====
    chaptersEl.querySelectorAll('.pdf-btn-open').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const url = btn.dataset.url;
        const filename = btn.dataset.filename;
        const token = btn.dataset.token;
        if (!url) return;
        const originalText = btn.textContent;
        btn.textContent = '加载中…';
        btn.disabled = true;
        try {
          const result = await api.previewFile({ url, filename, authToken: token });
          if (result && result.success) {
            btn.textContent = '✅ 已打开';
          } else {
            btn.textContent = '❌ 失败';
            console.error('[PDF预览] 失败:', result && result.error);
            alert('预览失败：' + (result && result.error ? result.error : '未知错误'));
          }
        } catch (e) {
          btn.textContent = '❌ 失败';
          console.error('[PDF预览] 异常:', e);
          alert('预览异常：' + (e.message || e));
        }
        setTimeout(() => {
          btn.textContent = originalText;
          btn.disabled = false;
        }, 2500);
      });
    });

    // ===== 事件绑定：PDF下载按钮 =====
    chaptersEl.querySelectorAll('.pdf-btn-download').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const url = btn.dataset.url;
        const filename = btn.dataset.filename;
        const token = btn.dataset.token;
        if (!url) return;
        btn.textContent = '下载中…';
        btn.disabled = true;
        try {
          const result = await api.downloadFile({ url, filename, authToken: token });
          if (result && result.success) {
            btn.textContent = '✅ 已下载';
          } else if (result && result.canceled) {
            btn.textContent = '⬇ 下载';
          } else {
            btn.textContent = '❌ 失败';
            console.error('[PDF下载] 失败:', result && result.error);
          }
        } catch (e) {
          btn.textContent = '❌ 失败';
          console.error('[PDF下载] 异常:', e);
        }
        setTimeout(() => {
          btn.textContent = '⬇ 下载';
          btn.disabled = false;
        }, 3000);
      });
    });

    // ===== 自动恢复：回到详情页时跳转到上一次播放的课时 + 恢复播放进度 =====
    setTimeout(() => {
      try {
        // 找到最新播放的未完成课时（用 updatedAt 排序，progress 做 tiebreaker）
        let bestLesson = null;
        let bestUpdatedAt = -1;
        Object.keys(progressMap || {}).forEach((lidStr) => {
          const p = progressMap[lidStr];
          if (!p || p.completed) return; // 跳过已完成，恢复到正在看的
          if (!bestLesson || (p.updatedAt || 0) > bestUpdatedAt) {
            bestUpdatedAt = (p.updatedAt || 0);
            bestLesson = { lessonId: Number(p.lessonId), lastPosition: Number(p.lastPosition) || 0 };
          }
        });
        if (bestLesson && bestLesson.lessonId) {
          // 展开对应章节并点击播放
          const lessonItem = chaptersEl.querySelector('.lesson-item[data-lesson-id="' + bestLesson.lessonId + '"]');
          if (lessonItem) {
            let chapterLi = lessonItem.closest('.chapter-item');
            if (chapterLi && chapterLi.querySelector('.chapter-content').style.display === 'none') {
              chapterLi.querySelector('.chapter-header').click();
            }
            setTimeout(() => {
              lessonItem.click();
              const player = document.getElementById('detail-player');
              const seekPos = bestLesson.lastPosition;
              if (player && seekPos > 2) {
                const checkAndSeek = () => {
                  if (player.readyState >= 1 && player.duration > 0) {
                    try {
                      if (seekPos < player.duration - 5) {
                        player.currentTime = seekPos;
                        console.log('[恢复] 已恢复到播放位置: ' + seekPos.toFixed(1) + 's');
                      }
                    } catch (_) {}
                  } else {
                    setTimeout(checkAndSeek, 200);
                  }
                };
                checkAndSeek();
              }
            }, 150);
          }
        }
      } catch (e) {
        console.warn('[自动恢复播放] 失败:', e);
      }
    }, 300);
  } catch (e) {
    console.error('[detail] 加载课程详情失败:', e);
    alert('加载课程详情失败: ' + (e.message || '未知错误'));
    navigateTo('courses');
  }
}

// 后台预热本课程的 115 课时：串行提前调一次播放接口，把转码/排队顶上去，
// 之后用户点开对应课时时命中后端预热缓存，即点即播（接近边下边播）。
let _warmupAborted = false;
function _startP115LessonWarmup(detail) {
  if (!api || typeof api.warm115Lesson !== 'function') return;
  const tasks = [];
  (detail.chapters || []).forEach((c) => {
    (c.lessons || []).forEach((l) => {
      let src = null;
      try { src = typeof l.videoSource === 'object' ? l.videoSource : JSON.parse(l.videoSource || 'null'); } catch (_) { src = null; }
      const cfgId = src && src.cfgId;
      const pickCode = src && src.pickCode;
      if (cfgId && pickCode) tasks.push({ cfgId, pickCode });
    });
  });
  if (!tasks.length) return;
  _warmupAborted = false;
  const MAX = 12; // 每个课程最多预热前若干个，避免无谓消耗
  let idx = 0, done = 0;
  const run = () => {
    if (_warmupAborted || currentPage !== 'detail') return;
    if (idx >= tasks.length || done >= MAX) return;
    const t = tasks[idx++];
    api.warm115Lesson(t.cfgId, t.pickCode)
      .then((r) => { if (r && r.success) done++; })
      .catch(() => {})
      .finally(() => setTimeout(run, 300));
  };
  setTimeout(run, 800);
}

// 115 存储网盘课时：解析 video_source 元数据，从后端读取播放地址后再交给 playVideo 播放
async function playP115Lesson(lessonId, title, videoSource, courseId, lessonEl) {
  currentVideoLessonId = lessonId;
  currentCourseId = courseId;

  let cfgId = '';
  let pickCode = '';
  try {
    const src = typeof videoSource === 'string' ? JSON.parse(videoSource) : videoSource;
    cfgId = src && src.cfgId;
    pickCode = src && src.pickCode;
  } catch (_) {}
  if (!cfgId || !pickCode) {
    alert('课时缺少 115 播放信息（cfgId/pickCode）');
    return;
  }

  // 标记当前课时为"播放中"
  if (lessonEl && document.getElementById('page-detail').classList.contains('active')) {
    const chaptersEl = document.getElementById('detail-chapters');
    if (chaptersEl) chaptersEl.querySelectorAll('.lesson-item').forEach((li) => li.classList.remove('playing'));
    lessonEl.classList.add('playing');
  }

  const titleEl = document.getElementById('detail-player-subtitle');
  const playerArea = document.getElementById('detail-player-area');
  const player = document.getElementById('detail-player');
  const coverEl = document.getElementById('detail-player-cover');
  let spinner = null;
  const _rmSpinner = () => {
    if (spinner && spinner.parentNode) { try { spinner.parentNode.removeChild(spinner); } catch (_) {} }
    spinner = null;
  };
  if (playerArea) {
    if (coverEl) coverEl.style.display = 'none';
    if (player) player.style.display = 'block';
    spinner = playerArea.parentElement ? playerArea.parentElement.querySelector(':scope > .video-loading-spinner') : null;
    if (!spinner) {
      spinner = document.createElement('div');
      spinner.className = 'video-loading-spinner';
      if (playerArea.parentElement) playerArea.parentElement.appendChild(spinner);
    }
    spinner.style.display = 'inline-flex';
    spinner.textContent = '正在下载视频…（原画直链，请稍候）';
  }
  if (titleEl) titleEl.textContent = title;
  // ===== 切课时立即清掉上一课的画面，避免旧视频残影造成"没跳转"的错觉 =====
  try {
    if (player) {
      player.pause();
      player.removeAttribute('src');
      player.load();
      if (typeof _resetVideoForNext === 'function') { try { _resetVideoForNext(player); } catch (_) {} }
    }
  } catch (_) {}

  try {
    // 🔴 边下边播：取原画直链，不落盘，直接走本地流式代理让 <video> 边下边播
    //    原画直链（/open/ufile/downurl）无需转码即可 Range 分片，是边下边播的前提
    const r = await api.get115LessonUrl(cfgId, pickCode);
    if (!r || !r.success) {
      _rmSpinner();
      const errMsg = (r && r.error) || '未知错误';
      if (titleEl) titleEl.textContent = '⚠️ ' + title + ' - 获取地址失败';
      console.error('[115课程播放] 获取播放地址失败:', errMsg);
      alert('获取播放地址失败：' + errMsg);
      return;
    }
    const directUrl = r.directUrl || r.url || r.bestUrl || '';
    if (!directUrl) {
      _rmSpinner();
      alert('未获取到有效的 115 原画直链');
      return;
    }
    console.log('[115课程播放] 原画直链:', directUrl.slice(0, 120));

    // 构造 /stream 代理地址（mpegts 层 / 方案A 层均需要）
    let streamUrl = directUrl;
    try { streamUrl = await window.P115Play.resolveStreamUrl(directUrl, r.streamUrl); } catch (_) {}
    console.log('[115课程播放] 流式代理地址:', streamUrl.slice(0, 120));

    const fileName = r.fileName || '';
    const _spinnerText = (t) => { if (spinner) { try { spinner.style.display = 'inline-flex'; spinner.textContent = t; } catch (_) {} } };

    // ─── Native-first：MKV 等容器 Chrome 实际支持 H.264+AAC，先尝试 <video> 原生播放 ───
    if (window.P115Play && window.P115Play.canNativeFirst && window.P115Play.canNativeFirst(fileName)) {
      var detailPlayer2 = document.getElementById('detail-player');
      if (detailPlayer2) {
        console.log('[115] 尝试原生播放（MKV 等容器）');
        _spinnerText('正在加载…');
        detailPlayer2.src = streamUrl;
        var _nfErr2 = false;
        var _nfHandler2 = function () { _nfErr2 = true; };
        detailPlayer2.addEventListener('error', _nfHandler2, { once: true });
        await new Promise(function (r) { setTimeout(r, 3000); });
        try { detailPlayer2.removeEventListener('error', _nfHandler2); } catch (_) {}
        if (!_nfErr2 && detailPlayer2.duration && isFinite(detailPlayer2.duration) && detailPlayer2.duration > 0) {
          console.log('[115] 原生播放成功 ✓');
          _rmSpinner();
          playVideo(lessonId, title, streamUrl, '', courseId, lessonEl);
          return;
        }
        console.log('[115] 原生播放失败，降级转封装');
        try { detailPlayer2.pause(); } catch (_) {}
        detailPlayer2.removeAttribute('src');
        detailPlayer2.load();
      }
    }

    // ===== 采用与"网盘课程/选择器"相同的播放策略（判定逻辑隔离在 P115Play 模块，低耦合）=====
    //   三层降级：mpegts.js 直解秒开 → 流式转封装边转边播 → 全量转封装
    //   FLV 直接全量转封装（放弃秒播分层），TS/M2TS/MKV 等才走 mpegts/流式
    if (window.P115Play && window.P115Play.needsRemux(fileName)) {
      var detailPlayer = document.getElementById('detail-player');
      var _isFlv = window.P115Play.isFlv && window.P115Play.isFlv(fileName);

      if (!_isFlv) {
      // ─── Layer 1：mpegts.js 直解（TS/M2TS，零转码真·首播秒开；FLV 跳过）───
      if (!_isFlv && window.P115Play.canMpegts(fileName)) {
        _spinnerText('正在解码…');
        var mpegtsResult = await window.P115Play.tryMpegts(detailPlayer, streamUrl, 15000);
        if (mpegtsResult && mpegtsResult.success) {
          console.log('[115] mpegts 播放中（零转码秒开）');
          _rmSpinner();
          if (detailPlayer) detailPlayer._p115MpegtsReady = true;
          playVideo(lessonId, title, streamUrl, '', courseId, lessonEl);
          return;
        }
        console.log('[115] mpegts 失败，降级到流式转封装（' + ((mpegtsResult && mpegtsResult.error) || 'unknown') + '）');
      }

      // ─── Layer 2：流式转封装（方案A：ffmpeg 边拉边转 fMP4 → /watch 约1-2s出画面；FLV 直接走此层主力）───
      _spinnerText('正在边转边播…');
      var _l2Failed = false;
      var _l2ErrMsg = '';
      try {
        var streamR = await window.P115Play.playStreamingRemux(cfgId, pickCode);
        if (streamR && streamR.success && streamR.watchUrl) {
          console.log('[115] 流式转封装播放 watchUrl=' + String(streamR.watchUrl).slice(0, 100));
          var _l2fallback = false;
          var _l2err = function () { _l2fallback = true; };
          if (detailPlayer) detailPlayer.addEventListener('error', _l2err, { once: true });
          playVideo(lessonId, title, streamR.watchUrl, '', courseId, lessonEl);
          await new Promise(function (r) { setTimeout(r, 5000); });
          try { if (detailPlayer) detailPlayer.removeEventListener('error', _l2err); } catch (_) {}
          if (!_l2fallback) { _rmSpinner(); return; }
          console.log('[115] 流式转封装解码异常，降级到全量转封装');
        } else {
          _l2Failed = true;
          _l2ErrMsg = (streamR && streamR.error) || '返回无 watchUrl';
        }
      } catch (e) {
        _l2Failed = true;
        _l2ErrMsg = (e && e.message) || '异常';
      }
      if (_l2Failed) console.error('[115] 流式转封装失败: ' + _l2ErrMsg + '，降级到全量转封装');
      else console.log('[115] 流式转封装失败，降级到全量转封装');
      if (detailPlayer) { try { _resetVideoForNext(detailPlayer); } catch (_) {} }
      } // end：非 FLV 走 mpegts/流式，FLV 直接跳过到全量

      // ─── Layer 3：全量转封装（整片下载+remux→file://；FLV 直接走此层，放弃秒播分层）───
      _spinnerText('正在下载并转封装…');
      try {
        const rF = await window.P115Play.playFlvAsRemux(cfgId, pickCode, (p) => {
          try {
            if (p.stage === 'download') _spinnerText((p.value == null ? '' : p.value + '% ') + '正在下载视频…');
            else if (p.stage === 'remux') _spinnerText('正在转封装…');
          } catch (_) {}
        });
        if (!rF || !rF.success || !rF.filePath) {
          _rmSpinner();
          if (titleEl) titleEl.textContent = '⚠️ ' + title + ' - 转换失败';
          alert('视频转换失败：' + ((rF && rF.error) || '转换失败'));
          return;
        }
        _rmSpinner();
        console.log('[115课程播放] 全量转封装 filePath=' + rF.filePath + ' duration=' + rF.duration);
        playVideo(lessonId, title, rF.filePath, '', courseId, lessonEl);
        return;
      } catch (e) {
        _rmSpinner();
        if (titleEl) titleEl.textContent = '⚠️ ' + title + ' - 转换异常';
        console.error('[115课程播放] 全量转封装异常:', e && e.message);
        alert('视频播放异常：' + ((e && e.message) || String(e)));
        return;
      }
    }

    // 其它格式：边下边播（streamUrl 已在上方构造）
    _rmSpinner();
    playVideo(lessonId, title, streamUrl, '', courseId, lessonEl);
  } catch (e) {
    _rmSpinner();
    if (titleEl) titleEl.textContent = '⚠️ ' + title + ' - 播放异常';
    console.error('[115课程播放] 异常:', e);
    alert('播放异常：' + (e.message || e));
  }
}

function playVideo(lessonId, title, videoUrl, videoUrlLocal, courseId, lessonEl) {
  currentVideoLessonId = lessonId;
  currentCourseId = courseId;

  // 优先使用云端地址 videoUrl，域名为空时回退到本地地址
  let currentUrl = videoUrl || videoUrlLocal || '';
  originDirectUrl = currentUrl;
  // 🔴 新策略：_toProxyVideoUrl 对 http(s) 公网地址会原样返回（优先直连，跟 PC 浏览器一样）
  //    只有非 http(s)（本地路径/相对路径）才会包一层代理
  currentUrl = _toProxyVideoUrl(currentUrl);

  if (lessonEl && document.getElementById('page-detail').classList.contains('active')) {
    // ===== 详情页内嵌播放器 =====
    const chaptersEl = document.getElementById('detail-chapters');
    if (chaptersEl) {
      chaptersEl.querySelectorAll('.lesson-item').forEach((li) => li.classList.remove('playing'));
      lessonEl.classList.add('playing');
    }

    const player = document.getElementById('detail-player');
    const slider = document.getElementById('detail-progress-slider');
    const textEl = document.getElementById('detail-progress-text');
    const titleEl = document.getElementById('detail-player-subtitle');
    const playerArea = document.getElementById('detail-player-area');
    const coverEl = document.getElementById('detail-player-cover');

    // ===== 切新课前：关键！先重置播放器 + 清理全部旧事件 + 递增 token（防止旧回调干扰新视频）=====
    try {
      if (player) _resetVideoForNext(player);
      _sweepVideoMemory();
    } catch (_) {}
    if (!player) return;
    const tokenRef = { current: Number(player._playToken) || 0 };
    const _check = () => (player._playToken || 0) === tokenRef.current;
    // 🔴 切新课清理 fallback 标记，保证新视频能再次走"直连失败→代理"流程
    delete player._didFallbackProxy;

    // 播放课时：隐藏封面图，显示视频播放器
    if (coverEl) coverEl.style.display = 'none';
    if (player) player.style.display = 'block';

    if (titleEl) titleEl.textContent = title;
    if (slider) { slider.value = 0; slider.disabled = !currentUrl; }
    if (textEl) textEl.textContent = '0%';

    // ===== 加载中 spinner（等 canplay / playing 后自动移除），挂载位置：卡片右上角（和"视频播放"标题同一行）=====
    const spinnerRoot = playerArea ? playerArea.parentElement : null;
    let spinner = spinnerRoot ? spinnerRoot.querySelector(':scope > .video-loading-spinner') : null;
    if (spinnerRoot && currentUrl) {
      if (!spinner) {
        spinner = document.createElement('div');
        spinner.className = 'video-loading-spinner';
        spinner.textContent = '正在缓冲视频…';
        spinnerRoot.appendChild(spinner);
      }
      spinner.style.display = 'inline-flex';
    }
    const removeSpinner = () => {
      if (!_check()) return;
      if (spinner && spinner.parentNode) {
        try { spinner.parentNode.removeChild(spinner); } catch (_) {}
      }
      spinner = null;
    };

    // ===== 先绑定进度条（含 oninput/onchange + seek 延迟应用），再绑定视频事件 =====
    // 🔴 注意：不在这里调 _bindProgressSlider！那个函数会包装 onloadedmetadata，
    //    但后面 playVideo 会重新设置 onloadedmetadata，覆盖掉包装。
    //    _bindProgressSlider 统一放到 onloadedmetadata 设置之后调用。

    // ===== onerror：视频加载失败 → 兜底代理 =====
    player.onerror = function() {
      if (!_check()) return;
      removeSpinner();
      const mediaError = player.error;
      console.error('[视频] 播放失败:');
      console.error('  URL:', player.src);
      console.error('  错误代码:', mediaError ? mediaError.code : 'unknown');
      console.error('  错误信息:', mediaError ? mediaError.message : '');
      let errType = '未知';
      if (mediaError) {
        const errMap = { 1: 'MEDIA_ERR_ABORTED', 2: 'MEDIA_ERR_NETWORK', 3: 'MEDIA_ERR_DECODE', 4: 'MEDIA_ERR_SRC_NOT_SUPPORTED' };
        errType = errMap[mediaError.code] || '未知';
        console.error('  错误类型:', errType);
      }
      // 1) 直连失败 → 代理兜底（仅当原地址不是代理地址时）
      if (!player._didFallbackProxy && /^https?:\/\//i.test(originDirectUrl) && !/^https?:\/\/127\.0\.0\.1:/.test(originDirectUrl)) {
        const tryProxy = _wrapProxyVideoUrl(originDirectUrl);
        if (tryProxy && tryProxy !== originDirectUrl && tryProxy !== currentUrl && player.src !== tryProxy) {
          console.log('[视频] 直连失败，切兜底代理地址:', tryProxy);
          tokenRef.current = Number(player._playToken) + 1;
          player._playToken = tokenRef.current;
          player._seekQueuedTime = undefined;
          player._seekingFromUser = false;
          player._didFallbackProxy = true;
          if (slider) { slider.value = 0; slider.disabled = !tryProxy; }
          if (textEl) textEl.textContent = '0%';
          if (slider) _bindProgressSlider(player, slider, textEl, tokenRef);
          player.src = tryProxy;
          player.load();
          player.play().catch(() => {});
          return;
        }
      }
      // 2) 都失败：显示错误
      console.error('[视频] 地址播放失败');
      const errMsg = '资源异常或网络链接错误！请检查服务器状态';
      if (titleEl) titleEl.textContent = '⚠️ ' + title + ' - 播放失败';
      const playerContainer = player.parentElement;
      if (playerContainer) {
        let errDiv = playerContainer.querySelector('.video-error-msg');
        if (!errDiv) {
          errDiv = document.createElement('div');
          errDiv.className = 'video-error-msg';
          errDiv.style.cssText = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(0,0,0,0.85);color:#f87171;padding:20px 28px;border-radius:12px;font-size:14px;line-height:1.8;text-align:center;z-index:10;white-space:pre-line;max-width:80%;border:1px solid rgba(248,113,113,0.3);';
          playerContainer.style.position = 'relative';
          playerContainer.appendChild(errDiv);
        }
        errDiv.textContent = errMsg;
      }
    };

    // 🔴 关键：先装直连 fallback，再设 src —— 这样 onerror 触发时能拿到 handler
    //    若是 m3u8（115 网盘分片流）则由 _playViaSource 走 Hls.js + 本地代理
    _playViaSource(player, currentUrl, originDirectUrl, tokenRef, () => {
      _installDirectFallback(player, originDirectUrl, tokenRef);
      player.src = currentUrl;
      player.load();
    });

    // ===== onplaying：播放成功时清除错误提示和 spinner =====
    player.onplaying = function() {
      if (!_check()) return;
      removeSpinner();
      const playerContainer = player.parentElement;
      if (playerContainer) {
        const errDiv = playerContainer.querySelector('.video-error-msg');
        if (errDiv) try { errDiv.remove(); } catch (_) {}
      }
      if (titleEl) titleEl.textContent = title;
    };
    // ===== oncanplay：数据可以播放时也移除 spinner =====
    player.oncanplay = function() {
      if (!_check()) return;
      setTimeout(removeSpinner, 400);
    };
    // ===== onloadedmetadata：时长修正 + 延迟 seek 应用 =====
    player.onloadedmetadata = async function() {
      if (!_check()) return;
      if (player.duration && lessonEl) {
        const realDuration = formatDuration(player.duration);
        const durationSpan = lessonEl.querySelector('.lesson-duration');
        if (durationSpan && durationSpan.textContent !== realDuration) {
          console.log('[时长修正] lessonId=' + lessonId + ' 原时长=' + durationSpan.textContent + ' 真实时长=' + realDuration);
          durationSpan.textContent = realDuration;
          try {
            const r = await api.updateLesson({ lessonId, data: { duration: realDuration } });
            if (r && r.success) {
              console.log('[时长修正] 已写入数据库 lessonId=' + lessonId);
            } else {
              console.warn('[时长修正] 写入数据库失败 lessonId=' + lessonId, r && r.error);
            }
          } catch (e) {
            console.warn('[时长修正] 写入数据库异常 lessonId=' + lessonId, e.message);
          }
        }
      }
    };
    // ===== 🔴 进度条绑定：必须在 onloadedmetadata 设置之后调用，
    //    这样 _bindProgressSlider 才能正确包装 onloadedmetadata 实现"排队 seek"
    if (slider) _bindProgressSlider(player, slider, textEl, tokenRef);
    // ===== onwaiting：seek 中 / 缓冲不足时临时显示 spinner =====
    player.onwaiting = function() {
      if (!_check()) return;
      if (!spinnerRoot) return;
      spinner = spinnerRoot.querySelector(':scope > .video-loading-spinner');
      if (!spinner) {
        spinner = document.createElement('div');
        spinner.className = 'video-loading-spinner';
        spinner.textContent = '正在缓冲…';
        spinnerRoot.appendChild(spinner);
      }
      spinner.style.display = 'inline-flex';
    };

    if (currentUrl) {
      const p = player.play();
      if (p && typeof p.then === 'function') {
        p.catch(() => {});
      }
      // ===== 启动下一个课时的预加载（HTTP 层预热，不解码）=====
      try {
        const allLessonItems = Array.from(chaptersEl.querySelectorAll('.lesson-item'));
        const currentIdx = allLessonItems.findIndex((el) => el === lessonEl);
        if (currentIdx !== -1 && currentIdx + 1 < allLessonItems.length) {
          const nextEl = allLessonItems[currentIdx + 1];
          const nextUrl = nextEl.getAttribute('data-video-url') || nextEl.getAttribute('data-video-url-local') || '';
          if (nextUrl) preloadNextVideo(nextUrl);
        }
      } catch (_) {}
    } else {
      setTimeout(() => alert('该课时暂无视频地址'), 50);
    }

    // ===== 进度自动刷新（有自定义进度条 → rAF 节流 + 拖动中暂停刷新）=====
    //       原生 controls（详情页默认）：不刷 UI，改为每 3s 定时写进度 + onpause + onended
    const hasCustomProgress = !!(slider || textEl);
    if (hasCustomProgress) {
      player.ontimeupdate = _makeThrottledTimeupdate(player, slider, textEl, tokenRef);
    }
    // 公共写进度函数
    const _saveNow = (forceCompleted) => {
      if (!_check()) return;
      if (player.currentTime > 0 && player.duration) {
        const pct = (player.currentTime / player.duration) * 100;
        const completed = forceCompleted === true ? true : (pct >= 95);
        try { api.updateProgress({ courseId, lessonId, progress: pct, completed, lastPosition: player.currentTime }); } catch (_) {}
      }
    };
    // 定时保存（3s/次，防止看很久不暂停导致进度丢失）；切视频前 token 失效时自动退出不再写入
    let _progSaveInterval = 0;
    try {
      if (player._progSaveInterval) { try { clearInterval(player._progSaveInterval); } catch (_) {} }
    } catch (_) {}
    _progSaveInterval = setInterval(() => {
      if (!_check()) { clearInterval(_progSaveInterval); return; }
      if (player.paused || player.ended) return; // 暂停/结束不重复写
      _saveNow(false);
    }, 3000);
    try { player._progSaveInterval = _progSaveInterval; } catch (_) {}

    // ===== visibilitychange：切换标签页/最小化窗口时立即保存进度 =====
    // 先移除旧监听防止重复
    if (player._visibilityHandler) {
      document.removeEventListener('visibilitychange', player._visibilityHandler);
    }
    const _onVisibilityChange = () => {
      if (document.hidden && !player.paused && !player.ended) {
        _saveNow(false);
      }
    };
    document.addEventListener('visibilitychange', _onVisibilityChange);
    player._visibilityHandler = _onVisibilityChange;

    // ===== onended：完成时写进度 + 打勾 =====
    player.onended = () => {
      if (!_check()) return;
      try { clearInterval(_progSaveInterval); } catch (_) {}
      try { clearTimeout(_pauseSaveTimer); } catch (_) {}
      try {
        api.updateProgress({ courseId, lessonId, progress: 100, completed: true, lastPosition: player.duration || 0 });
      } catch (_) {}
      const playing = chaptersEl.querySelector('.lesson-item.playing');
      if (playing) {
        playing.classList.remove('playing');
        playing.classList.add('completed');
        const icon = playing.querySelector('span:first-child');
        if (icon) icon.textContent = '✅';
      }
    };
    // ===== onpause：暂停时记录进度（用 400ms 防抖防止拖动 seek 时疯狂写 DB）=====
    let _pauseSaveTimer = 0;
    player.onpause = () => {
      if (!_check()) return;
      if (player.ended) return; // ended 已经单独保存过了
      clearTimeout(_pauseSaveTimer);
      _pauseSaveTimer = setTimeout(() => { _saveNow(false); }, 400);
    };
    return;
  }

  // ===== 模态框播放器（保留备用）=====
  const overlay = document.getElementById('video-overlay');
  const player = document.getElementById('video-player');
  const vTitle = document.getElementById('video-title');
  const vSlider = document.getElementById('video-progress-slider');
  const vText = document.getElementById('video-progress-text');
  // ===== 切新视频前：重置播放器 + 清理旧事件 + 递增 token =====
  try { if (player) _resetVideoForNext(player); _sweepVideoMemory(); } catch (_) {}
  if (!player) return;
  const vTokenRef = { current: Number(player._playToken) || 0 };
  const _vcheck = () => (player._playToken || 0) === vTokenRef.current;
  delete player._didFallbackProxy;

  if (vTitle) vTitle.textContent = title;
  if (vSlider) { vSlider.value = 0; vSlider.disabled = !currentUrl; }
  if (vText) vText.textContent = '0%';
  overlay.classList.remove('hidden');

  // 进度条绑定（安全 seek + 拖动中暂停自动刷新）
  // 🔴 注意：不在这里调 _bindProgressSlider！后面 onloadedmetadata 会被覆盖。
  //    _bindProgressSlider 统一放到 onloadedmetadata 设置之后调用。

  // ===== onerror：直连失败 → 兜底代理 =====
  player.onerror = function() {
    if (!_vcheck()) return;
    const mediaError = player.error;
    console.error('[视频-模态] 播放失败:');
    console.error('  URL:', player.src);
    console.error('  错误代码:', mediaError ? mediaError.code : 'unknown');
    console.error('  错误信息:', mediaError ? mediaError.message : '');
    let errType = '未知';
    if (mediaError) {
      const errMap = { 1: 'MEDIA_ERR_ABORTED', 2: 'MEDIA_ERR_NETWORK', 3: 'MEDIA_ERR_DECODE', 4: 'MEDIA_ERR_SRC_NOT_SUPPORTED' };
      errType = errMap[mediaError.code] || '未知';
      console.error('  错误类型:', errType);
    }
    if (!player._didFallbackProxy && /^https?:\/\//i.test(originDirectUrl)) {
      const tryProxy = _wrapProxyVideoUrl(originDirectUrl);
      if (tryProxy && tryProxy !== originDirectUrl && tryProxy !== currentUrl && player.src !== tryProxy) {
        console.log('[视频-模态] 直连失败，切兜底代理:', tryProxy);
        vTokenRef.current = Number(player._playToken) + 1;
        player._playToken = vTokenRef.current;
        player._seekQueuedTime = undefined;
        player._seekingFromUser = false;
        player._didFallbackProxy = true;
        if (vSlider) { vSlider.value = 0; vSlider.disabled = !tryProxy; }
        if (vText) vText.textContent = '0%';
        if (vSlider) _bindProgressSlider(player, vSlider, vText, vTokenRef);
        player.src = tryProxy;
        player.load();
        player.play().catch(() => {});
        return;
      }
    }
    console.error('[视频-模态] 地址播放失败');
    const errMsg = '资源异常或网络链接错误！请检查服务器状态';
    if (vTitle) vTitle.textContent = '⚠️ 播放失败';
    alert(errMsg);
  };
  // 🔴 先装 fallback，再设 src；若是 m3u8（115 分片流）则走 Hls.js + 本地代理
  _playViaSource(player, currentUrl, originDirectUrl, vTokenRef, () => {
    _installDirectFallback(player, originDirectUrl, vTokenRef);
    player.src = currentUrl;
    player.load();
  });
  player.play().catch(() => {});

  // 模态框播放器：视频元数据加载完成后更新左侧目录时长，并写入数据库
  player.onloadedmetadata = async function() {
    if (!_vcheck()) return;
    if (player.duration && lessonEl) {
      const realDuration = formatDuration(player.duration);
      const durationSpan = lessonEl.querySelector('.lesson-duration');
      if (durationSpan && durationSpan.textContent !== realDuration) {
        console.log('[时长修正-模态] lessonId=' + lessonId + ' 原时长=' + durationSpan.textContent + ' 真实时长=' + realDuration);
        durationSpan.textContent = realDuration;
        try {
          const r = await api.updateLesson({ lessonId, data: { duration: realDuration } });
          if (r && r.success) {
            console.log('[时长修正-模态] 已写入数据库 lessonId=' + lessonId);
          } else {
            console.warn('[时长修正-模态] 写入数据库失败 lessonId=' + lessonId, r && r.error);
          }
        } catch (e) {
          console.warn('[时长修正-模态] 写入数据库异常 lessonId=' + lessonId, e.message);
        }
      }
    }
  };
  // 🔴 进度条绑定：必须在 onloadedmetadata 设置之后，这样包装才能生效
  if (vSlider) _bindProgressSlider(player, vSlider, vText, vTokenRef);

  // rAF 节流的 ontimeupdate
  player.ontimeupdate = _makeThrottledTimeupdate(player, vSlider, vText, vTokenRef);

  // 公共写进度
  const _vSaveNow = (forceCompleted) => {
    if (!_vcheck()) return;
    if (player.currentTime > 0 && player.duration) {
      const pct = (player.currentTime / player.duration) * 100;
      const completed = forceCompleted === true ? true : (pct >= 95);
      try { api.updateProgress({ courseId, lessonId, progress: pct, completed, lastPosition: player.currentTime }); } catch (_) {}
    }
  };
  // 3s 定时保存
  let _mProgSaveInterval = 0;
  try { if (player._progSaveInterval) { clearInterval(player._progSaveInterval); } } catch (_) {}
  _mProgSaveInterval = setInterval(() => {
    if (!_vcheck()) { clearInterval(_mProgSaveInterval); return; }
    if (player.paused || player.ended) return;
    _vSaveNow(false);
  }, 3000);
  try { player._progSaveInterval = _mProgSaveInterval; } catch (_) {}

  let _mpauseSaveTimer = 0;
  player.onended = () => {
    if (!_vcheck()) return;
    try { clearInterval(_mProgSaveInterval); } catch (_) {}
    try { clearTimeout(_mpauseSaveTimer); } catch (_) {}
    try { api.updateProgress({ courseId, lessonId, progress: 100, completed: true, lastPosition: player.duration || 0 }); } catch (_) {}
  };
  // onpause：防抖写进度
  player.onpause = () => {
    if (!_vcheck()) return;
    if (player.ended) return;
    clearTimeout(_mpauseSaveTimer);
    _mpauseSaveTimer = setTimeout(() => { _vSaveNow(false); }, 400);
  };
}

async function loadStats() {
  const stats = await api.getCourseStats();
  if (currentPage !== 'stats') return;
  if (typeof _renderTopbarTitle === 'function') _renderTopbarTitle('学习统计');
  const container = document.getElementById('stats-content');
  container.innerHTML = `
    <div class="stat-card"><div class="stat-value">${stats.totalCourses || 0}</div><div class="stat-label">总课程数</div></div>
    <div class="stat-card"><div class="stat-value">${stats.totalLessons || 0}</div><div class="stat-label">总课时数</div></div>
    <div class="stat-card"><div class="stat-value">${stats.completedCourses || 0}</div><div class="stat-label">已完成课程</div></div>
    <div class="stat-card"><div class="stat-value">${stats.completedLessons || 0}</div><div class="stat-label">已完成课时</div></div>`;
}