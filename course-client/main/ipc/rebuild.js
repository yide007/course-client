// ===== IPC 处理器：重建课程章节 + 从源添加课程 =====
const { ipcMain } = require('electron');
const db = require('../../database/course-db');
const syncService = require('../../services/sync-service');
const { coverPathForDb } = require('../cover-path');

function _safe(p, label) {
  return Promise.resolve(p).catch(e => {
    console.error(`[IPC ${label || '?'}] ERROR:`, e && e.stack || e);
    return { success: false, error: (e && e.message) || String(e) };
  });
}

function register() {
  // ============================================================
  //  单门课程章节重建：从课程自身的 domain/port/token/sourcePath 拉 CD2 并写库
  // ============================================================
  ipcMain.handle('rebuild-course-chapters', async (event, opts) => {
    const tAllStart = Date.now();
    console.log('\n########## [步骤4/9] 主进程收到 IPC: rebuild-course-chapters ##########');
    console.log('[步骤4] 入参 opts →', JSON.stringify(opts, null, 2));
    try {
      console.log('[步骤4.1] 校验 courseId...');
      const courseId = parseInt(opts && opts.courseId);
      if (!courseId || isNaN(courseId)) {
        console.log('[步骤4.1] ✗ 失败：缺少课程ID');
        return { success: false, error: '缺少课程ID' };
      }
      console.log('[步骤4.1] ✓ courseId =', courseId);

      console.log('[步骤4.2] 从 DB 读取课程详情...');
      const detail = db.getCourseDetail(courseId);
      if (!detail) {
        console.log('[步骤4.2] ✗ 失败：课程不存在');
        return { success: false, error: '课程不存在' };
      }
      console.log('[步骤4.2] ✓ 课程存在 → id=%s title=%s 现有章节数=%d', detail.id, detail.title, (detail.chapters||[]).length);

      let domain = String(detail.domain || '').trim();
      let port   = String(detail.port != null ? detail.port : '').trim();
      let token  = String(detail.token != null ? detail.token : '').trim();
      let sourcePath = String((opts && opts.sourcePath != null ? opts.sourcePath : (detail.sourcePath || ''))).trim() || '/';
      console.log('[步骤4.3] 持久化配置（来自DB）→ domain=%s port=%s token=%s sourcePath(原)=%s',
        domain, port||'(空)', token?token.slice(0,6)+'***':'(空)', detail.sourcePath||'(空)');

      let connectDomain = domain;
      let connectPort = port;
      if (opts && opts._connectOverride) {
        console.log('[步骤4.4] 检测到本地同步模式 _connectOverride →', JSON.stringify(opts._connectOverride));
        if (opts._connectOverride.domain) connectDomain = String(opts._connectOverride.domain).trim();
        if (opts._connectOverride.port != null) connectPort = String(opts._connectOverride.port).trim();
        console.log('[步骤4.4] 临时连接地址被修改为 connectDomain=%s connectPort=%s（不会写回DB）', connectDomain, connectPort||'(空)');
      } else {
        if (opts && opts.domain != null) { domain = String(opts.domain).trim(); connectDomain = domain; }
        if (opts && opts.port != null)   { port   = String(opts.port).trim();   connectPort   = port; }
      }
      if (opts && opts.token != null)  { token  = String(opts.token).trim(); console.log('[步骤4.4] token 被调用方显式传入，将写回DB'); }

      console.log('[步骤4.5] 参数校验：connectDomain=%s token=%s', connectDomain, token?'有':'无');
      if (!connectDomain) { console.log('[步骤4.5] ✗ 缺少域名'); return { success: false, error: '缺少域名：请在编辑课程里填写 CloudDrive2 地址' }; }
      if (!token)  { console.log('[步骤4.5] ✗ 缺少 Token'); return { success: false, error: '缺少 Token：请在编辑课程里填写' }; }
      console.log('[步骤4.5] ✓ 参数校验通过');

      let endpoint = connectDomain;
      if (!/^https?:\/\//i.test(endpoint)) {
        endpoint = 'http://' + endpoint + (connectPort ? (':' + connectPort) : '');
      } else if (connectPort) {
        try {
          const u = new URL(endpoint);
          u.port = connectPort;
          endpoint = u.origin;
        } catch (e) {}
      }

      const rawEndpoint = endpoint.replace(/^https?:\/\//i, '');
      console.log('[步骤4.6] endpoint 组装 → 完整URL=%s → rawEndpoint(给@andie/cd2用)=%s', endpoint, rawEndpoint);

      // 1) 拉取
      console.log('\n========== [步骤5/9] 调用 syncService.quickScanOneCourse 开始扫描云盘 ==========');
      const tScan = Date.now();
      const draft = await syncService.quickScanOneCourse({
        type: (opts && opts.type) || 'cd2',
        endpoint: rawEndpoint,
        token,
        folderPath: sourcePath,
      });
      console.log('[步骤5] quickScanOneCourse 返回，耗时 %ss', ((Date.now()-tScan)/1000).toFixed(2));
      if (!draft || !draft.chapters || draft.chapters.length === 0) {
        console.log('[步骤5] ✗ 失败：拉到空章节 draft=', JSON.stringify(draft, null, 2));
        return { success: false, error: `从 ${endpoint} 拉到了空章节，请检查路径「${sourcePath}」下是否有章→节→视频的目录结构` };
      }
      const totalLessons = draft.chapters.reduce((s,c)=>s+(c.lessons?c.lessons.length:0),0);
      console.log('[步骤5] ✓ 扫描完成 → chapters=%d 个，lessons=%d 个，各章详情：', draft.chapters.length, totalLessons);
      draft.chapters.forEach((ch, i) => {
        console.log('    章%d "%s" → %d 集', i+1, ch.title, (ch.lessons||[]).length);
        (ch.lessons||[]).slice(0, 2).forEach((l, j) => console.log('      - 课时%d: %s | URL=%s', j+1, l.title, (l.videoUrl||'').slice(0,80)+((l.videoUrl||'').length>80?'...':'')));
        if ((ch.lessons||[]).length > 2) console.log('      ... (省略剩余 %d 个课时)', (ch.lessons||[]).length - 2);
      });

      const firstCh = draft.chapters[0];
      const firstLesson = firstCh && firstCh.lessons && firstCh.lessons[0];
      if (firstLesson) {
        console.log('[步骤5] 第1个课时详情: title=%s videoUrl=%s videoUrlLocal=%s', firstLesson.title, firstLesson.videoUrl, firstLesson.videoUrlLocal);
      } else {
        console.log('[步骤5] 警告: 第1章没有课时! chapters=%d', draft.chapters.length);
      }

      // 2) 回写
      console.log('\n========== [步骤6/9] 写回数据库 db.updateCourse ==========');
      const isLocalOverride = !!(opts && opts._connectOverride);
      const updatePayload = {
        courseId,
        categoryId: detail.categoryId,
        title: detail.title,
        subtitle: detail.subtitle || '',
        description: detail.description || '',
        instructor: detail.instructor || '',
        level: detail.level || '初级',
        duration: `${draft.chapters.length}章${totalLessons}集`,
        rating: detail.rating || 0,
        students: detail.students || 0,
        coverImage: coverPathForDb(detail.coverImage || ''),
        coverColor: detail.coverColor || '',
        domain: (!isLocalOverride && opts && opts.domain != null) ? opts.domain : detail.domain,
        port:   (!isLocalOverride && opts && opts.port   != null) ? opts.port   : detail.port,
        token:  (opts && opts.token  != null) ? opts.token  : detail.token,
        chapters: draft.chapters,
        sourcePath,
      };
      console.log('[步骤6] updateCourse 入参摘要 → courseId=%s duration=%s chapters数=%d isLocalOverride=%s (domain=%s port=%s 写回?)',
        updatePayload.courseId, updatePayload.duration, draft.chapters.length, isLocalOverride,
        updatePayload.domain, updatePayload.port||'(空)');
      const tDb = Date.now();
      const upr = db.updateCourse(updatePayload);
      console.log('[步骤6] db.updateCourse 返回，耗时 %ss →', ((Date.now()-tDb)/1000).toFixed(2), JSON.stringify(upr));
      if (!upr || !upr.success) {
        console.log('[步骤6] ✗ 写数据库失败');
        return { success: false, error: (upr && upr.error) || '写数据库失败' };
      }
      console.log('[步骤6] ✓ 写数据库成功');

      // 验证
      console.log('\n========== [步骤7/9] 数据库写入验证 ==========');
      const verify = db.getCourseDetail(courseId);
      if (verify && verify.chapters && verify.chapters.length > 0) {
        const vCh = verify.chapters[0];
        const vL = vCh.lessons && vCh.lessons[0];
        const verifyLessons = verify.chapters.reduce((s,c)=>s+(c.lessons?c.lessons.length:0),0);
        console.log('[步骤7] ✓ 验证通过 → 重读后 chapters=%d 个 lessons=%d 个', verify.chapters.length, verifyLessons);
        if (vL) {
          console.log('[步骤7] 第1课时确认: title=%s videoUrl=%s videoUrlLocal=%s', vL.title, vL.videoUrl, vL.videoUrlLocal);
        }
      } else {
        console.log('[步骤7] ✗ 验证失败：重读后仍为空');
      }

      const result = {
        success: true,
        chapters: draft.chapters.length,
        lessons: totalLessons,
        sourcePath,
        endpoint,
      };
      console.log('\n########## [步骤8/9] IPC 返回结果 总耗时 %ss ########## → %s',
        ((Date.now()-tAllStart)/1000).toFixed(2), JSON.stringify(result));
      return result;
    } catch (e) {
      console.error('[rebuild-chapters] ✗ 异常:', e && e.message ? e.message : String(e));
      console.error('[rebuild-chapters] 堆栈:', e && e.stack);
      return { success: false, error: e && e.message ? e.message : String(e) };
    }
  });

  ipcMain.handle('add-course-with-chapters', async (event, courseData) => {
    return _safe(db.upsertCourseFromSource({
      sourceId: courseData.sourceId || null,
      sourceKey: courseData.sourceKey || ('manual::' + Date.now()),
      categoryId: courseData.categoryId,
      title: courseData.title,
      subtitle: courseData.subtitle || '',
      description: courseData.description || '',
      instructor: courseData.instructor || '系统导入',
      level: courseData.level || '初级',
      duration: courseData.duration || '',
      rating: Number(courseData.rating) || 4.5,
      students: Number(courseData.students) || 0,
      coverColor: courseData.coverColor || 'linear-gradient(135deg, #667eea, #764ba2)',
      coverImage: coverPathForDb(courseData.coverImage || ''),
      domain: courseData.domain || 'yide2099.de5.net',
      port: courseData.port || '',
      token: courseData.token || '',
      chapters: courseData.chapters || [],
    }), 'add-course-with-chapters');
  });
}

module.exports = { register };