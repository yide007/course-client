const { createClient } = require('@andie/cd2');
const configMod = require('./config');
const db = require('./database');

// ============================================================
//  从 CloudDrive2 动态拉取章节
//  结构约定（适配用户提供的示例）：
//    rootPath 下第一层文件夹 = 章节（例：01.第一章计算机系统概述）
//    章节下第一层文件夹     = 小节/知识点（例：1.1操作系统的基本概念）
//    小节下：
//      - .mp4/.mkv/.avi/.flv/.mov = 视频 = lesson（一个小节如果有多个视频，按多个 lesson 建）
//      - .pdf/.doc/.docx/.ppt/.pptx/.txt = 资料 = lesson.attachments（挂在该小节下每个视频上）
// ============================================================
function _isDir(f) {
  if (!f) return false;
  if (typeof f.isDir === 'boolean') return f.isDir;
  if (typeof f.folder === 'boolean') return f.folder;
  if (typeof f.type === 'string') return f.type === 'folder' || f.type === 'dir';
  if (f.kind) return f.kind === 'folder';
  return false;
}
function _fileName(f) {
  return f.name || f.title || f.fileName || '';
}
function _fileSize(f) {
  const s = f.size != null ? f.size : f.fileSize != null ? f.fileSize : f.length;
  return Number(s) || 0;
}
function _directUrl(f) {
  return f.directUrl || f.url || f.download_url || f.downloadUrl || f.href || '';
}
function _directUrlDomain(f) {
  return f.directUrlDomain || f.directUrl || f.url || f.download_url || f.downloadUrl || f.href || '';
}
function _directUrlLocal(f) {
  return f.directUrlLocal || f.directUrl || f.url || f.download_url || f.downloadUrl || f.href || '';
}
function _videoExt(name) {
  return /\.(mp4|mkv|avi|flv|mov|wmv|webm|m4v|ts|mpg|mpeg)$/i.test(name || '');
}
function _docExt(name) {
  return /\.(pdf|doc|docx|ppt|pptx|txt|md|xls|xlsx|rtf|zip|rar|7z)$/i.test(name || '');
}

/** 自然排序：把文件名里的数字按数值大小比较（让 1,2,...,9,10,11 正确排列，而非字典序 1,10,11,2） */
function _naturalCmpStr(a, b) {
  const sa = String(a || ''), sb = String(b || '');
  const reA = /(\d+)|(\D+)/g; // A、B 各用一个独立正则，避免 JS 正则 g 标志的 lastIndex 共享导致的 bug
  const reB = /(\d+)|(\D+)/g;
  let ma, mb;
  while (true) {
    ma = reA.exec(sa);
    mb = reB.exec(sb);
    if (!ma && !mb) return 0;
    if (!ma) return -1;
    if (!mb) return 1;
    if (ma[1] && mb[1]) { // 两边都是数字
      const na = parseInt(ma[1], 10), nb = parseInt(mb[1], 10);
      if (na !== nb) return na - nb;
    } else {
      const ca = ma[0].toLowerCase(), cb = mb[0].toLowerCase();
      if (ca !== cb) return ca < cb ? -1 : 1;
    }
  }
}
/** 对 CD2 ls 返回的文件数组，按文件名自然排序（原地修改并返回） */
function _sortByFileName(arr) {
  if (!Array.isArray(arr) || arr.length < 2) return arr;
  return arr.sort((x, y) => _naturalCmpStr(_fileName(x), _fileName(y)));
}

function _cd2Timeout(p, ms, tip) {
  return new Promise((resolve, reject) => {
    let done = false;
    const t = setTimeout(() => {
      if (!done) {
        done = true;
        reject(new Error((tip || 'CloudDrive2 连接超时') + `（超过 ${Math.round(ms/1000)} 秒，请检查：1) CD2 本地服务是否已启动；2) endpoint 地址端口是否正确；3) Token 是否有效）`));
      }
    }, ms);
    Promise.resolve(p).then(r => { if (!done) { done = true; clearTimeout(t); resolve(r); } })
                     .catch(e => { if (!done) { done = true; clearTimeout(t); reject(e); } });
  });
}

/** 把路径拼起来（避免双斜杠） */
function _joinPath(base, name) {
  if (!base || base === '/') return '/' + name;
  return (base.endsWith('/') ? base.slice(0, -1) : base) + '/' + name;
}

async function fetchChaptersFromCd2(endpoint, token, rootPath = '/') {
  console.log('\n[cd2-A] ===== fetchChaptersFromCd2 开始 =====');
  if (!endpoint || !token) throw new Error('CloudDrive2 endpoint 或 token 为空');
  console.log('[cd2-A.1] 创建 CD2 客户端 → endpoint=%s token=%s', endpoint, token.slice(0,6)+'***');
  const client = createClient({ endpoint, token });
  const root = (rootPath && rootPath.startsWith('/') ? rootPath : '/' + (rootPath || '')).replace(/\/+$/, '') || '/';

  // 从 endpoint 解析出"当前用户登录的 CD2 主机端口"。注意这只是"入口主机"，
  // 我们另外强制把"云端域名主机"单独保存 —— 因为 /static/http/{内部目标}
  // 里的内部目标永远应该是"远端真实数据源头"，不能是 127.0.0.1，否则域名模式也会
  // 把播放请求指到"本机 CD2 再去本机找文件"，外网无法使用。
  let entryHost = endpoint.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  let cd2Port = 19798;
  if (entryHost.includes(':')) {
    const parts = entryHost.split(':');
    entryHost = parts[0];
    cd2Port = parseInt(parts[1]) || 19798;
  }

  // 【关键】：决定"CD2 代理路径 /static/http/<inner>/false/..."里 inner 到底写哪个主机
  // 1) 如果入口就是远端域名/公网IP（非 127.0.0.1 非 localhost 非 内网网段），
  //    说明用户直接从公网入口登录 → inner 就用这个入口主机（保持和旧格式兼容）。
  // 2) 如果入口是 127.0.0.1 / localhost（用户本机装了 CD2 从 IP 模式入口登录），
  //    inner 必须强制写成配置的远端主机（config.DOMAIN_CD2_HOST），否则域名模式的
  //    播放 URL 也会把 CD2 指去它自己的 127.0.0.1，导致外网播放不到。
  const _cfg = (typeof configMod.getConfig === 'function') ? configMod.getConfig() : (configMod || {});
  const DEFAULT_REMOTE_HOST = (_cfg.DOMAIN_CD2_HOST || 'yide2099.de5.net').replace(/^https?:\/\//i,'').split(':')[0];
  const isLocalEntry = /^(127\.0\.0\.1|localhost)$/i.test(entryHost);
  const innerHost = isLocalEntry ? DEFAULT_REMOTE_HOST : entryHost;

  // 域名模式前缀（云端域名访问）；IP 模式前缀（本机 127.0.0.1 访问本地 CD2）
  const cd2PrefixDomain = 'http://' + innerHost + ':' + cd2Port;
  const cd2PrefixLocal  = 'http://127.0.0.1:' + cd2Port;
  console.log('[cd2-A.2] CD2 URL前缀解析 → entryHost=%s(入口) innerHost=%s(代理内层) cd2Port=%s 域名模式前缀=%s IP模式前缀=%s', entryHost, innerHost, cd2Port, cd2PrefixDomain, cd2PrefixLocal);

  // 从文件对象的 fullPath 字段构造"代理路径段"
  //  格式：/static/http/{内部目标}/false/{URL编码的云盘文件路径}
  //  注意：外层主机名改变时（yide2099.de5.net ↔ 127.0.0.1），这一段路径保持完全一致，
  //        而且内部目标永远是远端数据源头（不是 127.0.0.1）
  function _cd2ProxyPath(f) {
    if (!f || !f.fullPath) return '';
    var segments = f.fullPath.split('/');
    var encodedSegments = [];
    for (var i = 0; i < segments.length; i++) {
      encodedSegments.push(encodeURIComponent(segments[i]));
    }
    var encodedPath = encodedSegments.join('/');
    if (encodedPath.indexOf('%2F') === 0) {
      encodedPath = '/' + encodedPath.substring(3);
    }
    // 兼容旧格式：如果 fullPath 已经是 /static/http/... 的形式，把里面的 inner host
    // 强行替换成我们最终确定的 innerHost，避免把 127.0.0.1 带进域名模式 URL
    if (encodedPath.indexOf('/static/http/') === 0) {
      return encodedPath.replace(/^\/static\/http\/([^\/]+)\//, '/static/http/' + encodeURIComponent(innerHost) + ':' + cd2Port + '/');
    }
    var innerTarget = innerHost + ':' + cd2Port;
    if (!encodedPath.startsWith('/')) encodedPath = '/' + encodedPath;
    return '/static/http/' + innerTarget + '/false' + encodedPath;
  }
  // domain 模式（video_url）：走云端域名前缀
  function _cd2UrlDomain(f) {
    var p = _cd2ProxyPath(f);
    return p ? (cd2PrefixDomain + p) : '';
  }
  // local/IP 模式（video_url_local）：走本机 127.0.0.1 前缀 + 相同代理路径
  function _cd2UrlLocal(f) {
    var p = _cd2ProxyPath(f);
    return p ? (cd2PrefixLocal + p) : '';
  }

  // 辅助函数：获取视频URL — 域名版（video_url）和 IP 本机版（video_url_local）彻底分道
  function _videoUrl(f) {
    return _directUrlDomain(f) || _cd2UrlDomain(f) || '';
  }
  function _videoUrlLocal(f) {
    return _directUrlLocal(f) || _cd2UrlLocal(f) || '';
  }
  // 辅助函数：获取文档URL（PDF 等，文档一般用域名模式即可）
  function _docUrl(f) {
    return _directUrl(f) || _cd2UrlDomain(f) || '';
  }

  console.log('[cd2-A.3] 调用 client.ls("%s") 拉取根目录列表（超时20s）...', root);
  const tLs0 = Date.now();
  const rootItems = await _cd2Timeout(client.ls(root === '/' ? '/' : root), 20000, 'CloudDrive2 连接/认证失败');
  console.log('[cd2-A.3] ✓ 根目录读取完成，耗时 %ss，共 %d 个条目', ((Date.now()-tLs0)/1000).toFixed(2), rootItems && rootItems.length);
  console.log('[cd2-A.3] 条目样例=', JSON.stringify((rootItems || []).slice(0, 5).map(f => ({
    name: _fileName(f), isDir: _isDir(f), size: _fileSize(f),
  }))));
  // 调试：打印第一个文件的完整信息
  if (rootItems && rootItems.length > 0) {
    const first = rootItems[0];
    console.log('[cd2-A.3] 第1个条目完整字段 → keys=%j', Object.keys(first || {}));
  }

  const rootFolders = _sortByFileName(rootItems.filter(f => _isDir(f)));
  const rootFiles   = _sortByFileName(rootItems.filter(f => !_isDir(f)));
  console.log('[cd2-A.4] 根目录分类 → 文件夹 %d 个，文件 %d 个（已按文件名自然排序）', rootFolders.length, rootFiles.length);

  const chapters = [];

  // 兼容 A：根目录直接有视频 或 只有 PDF 文档（用户没有按"章/节"组织的情况） → 建一个「默认章节 / 默认小节」兜底
  const rootVideos = rootFiles.filter(f => _videoExt(_fileName(f)));
  const rootDocsRaw = rootFiles.filter(f => _docExt(_fileName(f)));
  console.log('[cd2-B] ===== 兼容模式A检测：根目录直接放视频/文档 =====');
  console.log('[cd2-B] 根目录视频数=%d，文档数=%d', rootVideos.length, rootDocsRaw.length);
  if (rootVideos.length > 0 || rootDocsRaw.length > 0) {
    console.log('[cd2-B] ✓ 触发兼容A：创建「默认章节」，包含 %d 个课时，%d 份资料', rootVideos.length, rootDocsRaw.length);
    const vs = _sortByFileName(rootVideos);
    const docs = _sortByFileName(rootDocsRaw).map(f => ({
      name: _fileName(f), url: _docUrl(f), path: f.fullPath || '',
    }));
    const lessons = vs.map((f, idx) => ({
      title: _fileName(f).replace(/\.[^/.]+$/, ''),
      duration: formatDuration(_fileSize(f)),
      videoUrl: _videoUrl(f),
      videoUrlLocal: _videoUrlLocal(f),
      videoType: 'direct',
      isFree: idx === 0 ? 1 : 0,
      sortOrder: idx + 1,
      path: f.fullPath || '',
      sectionTitle: '',
    }));
    if (lessons.length > 0) {
      console.log('[cd2-B] 默认章节 课时1: title=%s duration=%s videoUrl=%s', lessons[0].title, lessons[0].duration, lessons[0].videoUrl);
    } else {
      console.log('[cd2-B] 默认章节：无视频课时，仅 %d 份PDF资料', docs.length);
    }
    chapters.push({
      title: '默认章节',
      sortOrder: 1,
      lessons,
      pdfs: docs.length ? docs : undefined,
    });
  } else {
    console.log('[cd2-B] ✗ 不触发兼容A，跳过');
  }

  // 兼容 B：根目录下一层直接是视频文件夹（老式两级）→ 每一个文件夹当章，章下的视频当小节
  const singleLevelChapterDirs = rootFolders;
  console.log('\n[cd2-C] ===== 开始遍历章文件夹（共 %d 个）=====', singleLevelChapterDirs.length);

  // 标准三级结构：章 → 节 → 视频/资料
  for (let ci = 0; ci < singleLevelChapterDirs.length; ci++) {
    const chDir = singleLevelChapterDirs[ci];
    const chName = _fileName(chDir);
    if (!chName) continue;
    const chPath = _joinPath(root, chName);
    console.log('\n[cd2-C.%d] 处理章 "%s" → 路径=%s', ci+1, chName, chPath);

    let sectionItems;
    try {
      const t0 = Date.now();
      sectionItems = await _cd2Timeout(client.ls(chPath), 15000, `读取章节「${chName}」超时`);
      console.log('[cd2-C.%d.1] 章目录读取完成，耗时 %ss，条目数=%d', ci+1, ((Date.now()-t0)/1000).toFixed(2), sectionItems.length);
    } catch (e) {
      console.error('[cd2-C.%d.1] ✗ 读取章失败: %s', ci+1, e.message);
      continue;
    }

    const secDirs = _sortByFileName(sectionItems.filter(f => _isDir(f)));
    const directVideosRaw = sectionItems.filter(f => !_isDir(f) && _videoExt(_fileName(f)));
    const directDocsRaw = sectionItems.filter(f => !_isDir(f) && _docExt(_fileName(f)));
    const directVideos = _sortByFileName(directVideosRaw);
    const directDocs = _sortByFileName(directDocsRaw);
    console.log('[cd2-C.%d.2] 章内分类 → 节文件夹=%d 直接视频=%d 直接文档=%d（已按文件名自然排序）', ci+1, secDirs.length, directVideos.length, directDocs.length);

    const lessons = [];
    const chapterPdfs = []; // 收集本章所有PDF文档

    // 章级直接文档：无论章下是否有视频，统统收集（防止"只有PDF没有视频"的章被当成空章节丢弃）
    if (directDocs.length > 0) {
      directDocs.forEach(f => chapterPdfs.push({ name: _fileName(f), url: _docUrl(f), path: f.fullPath || '' }));
      console.log('[cd2-C.%d.2b] 收集章级直接文档 %d 份', ci+1, directDocs.length);
    }

    // --- 情况 1：章下直接是视频（老式两级） ---
    console.log('[cd2-C.%d.3] 检查老式两级结构（章→视频）...', ci+1);
    if (directVideos.length > 0) {
      console.log('[cd2-C.%d.3] ✓ 触发老式两级：章下有 %d 个视频，%d 个文档附件（已收集）', ci+1, directVideos.length, directDocs.length);
      directVideos.forEach((f, idx) => {
        lessons.push({
          title: _fileName(f).replace(/\.[^/.]+$/, ''),
          duration: formatDuration(_fileSize(f)),
          videoUrl: _videoUrl(f),
      videoUrlLocal: _videoUrlLocal(f),
          videoType: 'direct',
          isFree: lessons.length === 0 ? 1 : 0,
          sortOrder: lessons.length + 1,
          path: f.fullPath || '',
          sectionTitle: '',
        });
      });
      if (lessons.length > 0) {
        console.log('[cd2-C.%d.3] 老式两级 第1个课时: title=%s duration=%s', ci+1, lessons[0].title, lessons[0].duration);
      }
    } else {
      console.log('[cd2-C.%d.3] ✗ 章下无直接视频（文档已单独收集，不影响章节创建）', ci+1);
    }

    // --- 情况 2：章下有节文件夹（新三级结构，用户要求的） ---
    console.log('[cd2-C.%d.4] 开始遍历节文件夹（共 %d 个）...', ci+1, secDirs.length);
    for (let si = 0; si < secDirs.length; si++) {
      const sd = secDirs[si];
      const secName = _fileName(sd);
      if (!secName) continue;
      const secPath = _joinPath(chPath, secName);
      console.log('[cd2-C.%d.4.si%d] 处理节 "%s" → 路径=%s', ci+1, si+1, secName, secPath);

      let items;
      try {
        const t0 = Date.now();
        items = await _cd2Timeout(client.ls(secPath), 12000, `读取小节「${chName}/${secName}」超时`);
        console.log('[cd2-C.%d.4.si%d] 节目录读取完成，耗时 %ss，条目数=%d', ci+1, si+1, ((Date.now()-t0)/1000).toFixed(2), items.length);
      } catch (e) {
        console.error('[cd2-C.%d.4.si%d] ✗ 读取小节失败: %s', ci+1, si+1, e.message);
        continue;
      }

      const videos = _sortByFileName(items.filter(f => !_isDir(f) && _videoExt(_fileName(f))));
      const docsRaw = _sortByFileName(items.filter(f => !_isDir(f) && _docExt(_fileName(f))));
      const docs = docsRaw.map(f => ({
        name: _fileName(f), url: _docUrl(f), path: f.fullPath || '',
      }));
      console.log('[cd2-C.%d.4.si%d] 节内 → 视频=%d 文档=%d（已按文件名自然排序）', ci+1, si+1, videos.length, docs.length);

      // 调试：打印第一个视频的完整信息
      if (videos.length > 0) {
        const firstVideo = videos[0];
        console.log('[cd2-C.%d.4.si%d] 第1个视频 → name=%s size=%d directUrl=%s',
          ci+1, si+1, _fileName(firstVideo), _fileSize(firstVideo), _directUrl(firstVideo));
      }

      // 收集本节的PDF文档到章级别
      docs.forEach(d => chapterPdfs.push(d));

      // 兼容：小节里没视频，但是再下一层还有文件夹（四级：章→节→单元→视频）→ 继续往下挖一层
      if (videos.length === 0) {
        const subDirs = _sortByFileName(items.filter(f => _isDir(f)));
        console.log('[cd2-C.%d.4.si%d] 节内无视频，尝试兼容四级结构 → 子文件夹数=%d（已按文件名自然排序）', ci+1, si+1, subDirs.length);
        for (const sub of subDirs) {
          try {
            const p2 = _joinPath(secPath, _fileName(sub));
            console.log('[cd2-C.%d.4.si%d]   → 深挖子目录 "%s"', ci+1, si+1, _fileName(sub));
            const subItems = await _cd2Timeout(client.ls(p2), 12000, `读取「${secName}/${_fileName(sub)}」超时`);
            const v2 = _sortByFileName(subItems.filter(f => !_isDir(f) && _videoExt(_fileName(f))));
            const d2Raw = _sortByFileName(subItems.filter(f => !_isDir(f) && _docExt(_fileName(f))));
            const d2 = d2Raw.map(f => ({ name: _fileName(f), url: _docUrl(f), path: f.fullPath || '' }));
            console.log('[cd2-C.%d.4.si%d]     子目录内 → 视频=%d 文档=%d（已按文件名自然排序）', ci+1, si+1, v2.length, d2.length);
            // 子目录PDF文档收集到章级别
            d2.forEach(d => chapterPdfs.push(d));
            if (v2.length > 0) {
              v2.forEach((f, idx) => {
                lessons.push({
                  title: `${secName} - ${_fileName(f).replace(/\.[^/.]+$/, '')}`,
                  duration: formatDuration(_fileSize(f)),
                  videoUrl: _videoUrl(f),
                  videoUrlLocal: _videoUrlLocal(f),
                  videoType: 'direct',
                  isFree: lessons.length === 0 ? 1 : 0,
                  sortOrder: lessons.length + 1,
                  path: f.fullPath || '',
                  sectionTitle: secName,
                });
              });
            }
          } catch (e) {
            console.error('[cd2-C.%d.4.si%d] ✗ 小节子目录读取失败: %s', ci+1, si+1, _fileName(sub), e.message);
          }
        }
      }

      // 正常三级：章→节→视频
      videos.forEach((f, idx) => {
        const videoUrl = _videoUrl(f);
        const videoUrlLocal = _videoUrlLocal(f);
        if (!videoUrl) {
          console.warn('[cd2-C.%d.4.si%d] ⚠ 视频 "%s" 的URL为空!', ci+1, si+1, _fileName(f));
        }
        lessons.push({
          title: _fileName(f).replace(/\.[^/.]+$/, ''),
          duration: formatDuration(_fileSize(f)),
          videoUrl: videoUrl,
          videoUrlLocal: videoUrlLocal,
          videoType: 'direct',
          isFree: lessons.length === 0 ? 1 : 0,
          sortOrder: lessons.length + 1,
          path: f.fullPath || '',
          sectionTitle: secName,
        });
      });
      if (videos.length > 0) {
        console.log('[cd2-C.%d.4.si%d] ✓ 标准三级结构 加入 %d 个课时（累计章内课时=%d）', ci+1, si+1, videos.length, lessons.length);
      }
    }

    // 去重PDF（按URL去重，可能同一个PDF被多个节引用）
    const seenUrls = new Set();
    const uniquePdfs = chapterPdfs.filter(p => {
      if (!p.url || seenUrls.has(p.url)) return false;
      seenUrls.add(p.url);
      return true;
    });

    if (lessons.length > 0 || uniquePdfs.length > 0) {
      console.log('[cd2-C.%d] ✓ 章处理完成 → 课时数=%d PDF数=%d', ci+1, lessons.length, uniquePdfs.length);
      chapters.push({
        title: chName,
        sortOrder: chapters.length + 1,
        lessons,
        pdfs: uniquePdfs,
      });
    } else {
      console.log('[cd2-C.%d] ✗ 章处理完成 → 无任何课时和PDF，跳过', ci+1);
    }
  }

  const finalLessonCount = chapters.reduce((s, c) => s + (c.lessons || []).length, 0);
  console.log('\n[cd2-Z] ===== fetchChaptersFromCd2 完成 =====');
  console.log('[cd2-Z] 最终产出 → chapters=%d 个，lessons=%d 个，PDF文档组=%d 个，明细：', chapters.length, finalLessonCount, chapters.reduce((s,c) => s+(c.pdfs||[]).length, 0));
  chapters.forEach((ch, i) => console.log('[cd2-Z]   章%d: "%s" → %d 集, %d 个PDF', i+1, ch.title, (ch.lessons||[]).length, (ch.pdfs||[]).length));
  return chapters;
}

function formatDuration(size) {
  if (!size || size <= 0) return '00:00';
  const minutes = Math.round(size / (2 * 1024 * 1024));
  if (minutes <= 0) return '00:00';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:00`;
  return `${String(m).padStart(2, '0')}:00`;
}

// ============================================================
//  同步单个源：拉取 -> upsert 到数据库
// ============================================================
async function syncSource(sourceId) {
  const src = configMod.getSource(sourceId);
  if (!src) return { success: false, error: '源不存在' };
  if (!src.enabled) return { success: true, skipped: true, reason: '源已禁用' };

  const cfg = src.config || {};
  let chapters = [];
  try {
    if (src.type === 'cd2' || src.type === '115') {
      chapters = await fetchChaptersFromCd2(cfg.endpoint, cfg.token, cfg.rootPath || '/');
    } else {
      return { success: false, error: '不支持的源类型: ' + src.type };
    }
  } catch (e) {
    return { success: false, error: '拉取失败: ' + (e && e.message || e) };
  }

  if (!chapters || chapters.length === 0) {
    return { success: true, skipped: true, reason: '没有拉取到任何章节' };
  }

  // 统计分集数 和 资料数（允许纯PDF课程）
  const totalLessons = chapters.reduce((s, c) => s + ((c.lessons && c.lessons.length) || 0), 0);
  const totalDocs = chapters.reduce((s, c) => s + ((c.pdfs && c.pdfs.length) || 0), 0);
  if (totalLessons <= 0 && totalDocs <= 0) {
    return { success: true, skipped: true, reason: '拉到的章节里既没有分集也没有资料' };
  }

  // 源级课程名：优先用 src.name，否则 "默认章节" 的父目录名
  const courseTitle = (src.name && src.name.trim()) || '云端同步课程';
  const subtitlePart = totalLessons > 0 ? `${chapters.length}章${totalLessons}集` : `${chapters.length}章${totalDocs}份资料`;
  const subtitle = `[${src.type.toUpperCase()} 自动同步] 共 ${subtitlePart}`;

  // 分类
  let categoryId = cfg.defaultCategoryId;
  if (!categoryId || isNaN(parseInt(categoryId))) categoryId = null;

  // 课程持久化
  try {
    const created = db.upsertCourseFromSource({
      sourceId: src.id,
      sourceKey: String(src.id) + '::' + (cfg.rootPath || '/'),
      categoryId,
      title: courseTitle,
      subtitle,
      description: `自动同步课程。\n源：${src.name}\n类型：${src.type}\n地址：${cfg.endpoint}\n同步时间：${new Date().toLocaleString()}`,
      instructor: cfg.defaultInstructor || '系统导入',
      level: cfg.defaultLevel || '初级',
      duration: subtitlePart,
      rating: Number(cfg.defaultRating) || 4.5,
      students: 0,
      coverColor: cfg.defaultCoverColor || 'linear-gradient(135deg, #667eea, #764ba2)',
      chapters,
    });
    return {
      success: true,
      created,
      chapters: chapters.length,
      lessons: totalLessons,
    };
  } catch (e) {
    return { success: false, error: '写数据库失败: ' + (e && e.message || e) };
  }
}

async function syncAll() {
  const all = configMod.allSources().filter(s => s.enabled && (s.autoSync !== false && !(s.config && s.config.autoSync === false)));
  const result = { total: all.length, success: 0, failed: 0, details: [] };
  for (const src of all) {
    try {
      const r = await syncSource(src.id);
      result.details.push({ id: src.id, name: src.name, result: r });
      if (r.success && !r.skipped) result.success++;
      else if (r.success && r.skipped) result.success++; // skip 也不算失败
      else result.failed++;
    } catch (e) {
      result.failed++;
      result.details.push({ id: src.id, name: src.name, result: { success: false, error: String(e) } });
    }
  }
  return result;
}

async function _scanCourseDraft({ type, endpoint, token, rootPath }) {
  let client;
  if (type === '115' || type === 'cd2') {
    client = createClient({ endpoint, token });
  } else {
    throw new Error('不支持的源类型: ' + type);
  }
  const root = (rootPath && rootPath.startsWith('/') ? rootPath : '/' + (rootPath || '')).replace(/\/+$/, '') || '/';
  const chapters = await fetchChaptersFromCd2(endpoint, token, root);
  // rootPath 可能是课程总目录，根下第一层文件夹=课程名（用户要求的"读取某个文件夹名称作为课程名"，每个子文件夹是一门课程）
  const listRoot = root;
  let rootItems;
  try {
    rootItems = await _cd2Timeout(client.ls(listRoot), 20000, '连接云盘失败');
  } catch (e) {
    throw new Error('扫描根目录失败: ' + (e.message || e));
  }
  const subDirs = (rootItems || []).filter(f => _isDir(f));
  if (subDirs.length === 0) {
    // 没有子文件夹 -> 当前 root 本身就是课程（root 名当课程名，chapters 直接使用上面的结果）
    const courseTitle = _stripTrailing(rootPath || root).split('/').pop() || '未命名课程';
    const lessonsCount = chapters.reduce((s, c) => s + ((c.lessons && c.lessons.length) || 0), 0);
    return [{
      folderName: courseTitle,
      title: courseTitle,
      subtitle: `[${type.toUpperCase()}] 共 ${chapters.length} 章 ${lessonsCount} 集`,
      description: `自动扫描：源类型 ${type.toUpperCase()}\n路径：${root}\n章节数：${chapters.length}，视频数：${lessonsCount}`,
      instructor: '系统导入',
      level: '初级',
      duration: `${chapters.length}章${lessonsCount}集`,
      rating: 4.5,
      coverColor: 'linear-gradient(135deg, #667eea, #764ba2)',
      categoryId: 1,
      chapters,
      sourcePath: root,
      sourceType: type,
      sourceEndpoint: endpoint,
    }];
  }
  // 有子文件夹 -> 每个子文件夹是一门课程
  const results = [];
  for (const d of subDirs) {
    const courseName = _fileName(d);
    const subPath = _joinPath(listRoot, courseName);
    let subChapters = [];
    try {
      subChapters = await fetchChaptersFromCd2(endpoint, token, subPath);
    } catch (e) {
      console.warn('[scan-draft] 子目录扫描失败:', courseName, e.message);
    }
    const lessonsCount = subChapters.reduce((s, c) => s + ((c.lessons && c.lessons.length) || 0), 0);
    results.push({
      folderName: courseName,
      title: courseName,
      subtitle: `[${type.toUpperCase()}] 共 ${subChapters.length} 章 ${lessonsCount} 集`,
      description: `自动扫描：源类型 ${type.toUpperCase()}\n路径：${subPath}\n章节数：${subChapters.length}，视频数：${lessonsCount}`,
      instructor: '系统导入',
      level: '初级',
      duration: `${subChapters.length}章${lessonsCount}集`,
      rating: 4.5,
      coverColor: 'linear-gradient(135deg, #667eea, #764ba2)',
      categoryId: 1,
      chapters: subChapters,
      sourcePath: subPath,
      sourceType: type,
      sourceEndpoint: endpoint,
    });
  }
  return results;
}

function _stripTrailing(s) {
  return String(s || '').replace(/\/+$/, '');
}

async function scanCourseDrafts({ sourceId, type, endpoint, token, rootPath }) {
  // 传 sourceId 优先从配置取
  if (sourceId) {
    const src = configMod.getSource(sourceId);
    if (!src) throw new Error('源不存在');
    const cfg = src.config || {};
    return await _scanCourseDraft({
      type: src.type || 'cd2',
      endpoint: cfg.endpoint,
      token: cfg.token,
      rootPath: cfg.rootPath || '/',
    });
  }
  return await _scanCourseDraft({ type, endpoint, token, rootPath });
}

async function listCloudDirectory({ type, endpoint, token, path }) {
  const client = createClient({ endpoint, token });
  const p = (path && path.startsWith('/') ? path : '/' + (path || '')).replace(/\/+$/, '') || '/';
  const items = await _cd2Timeout(client.ls(p), 20000, '连接失败');
  return (items || []).map(f => ({
    name: _fileName(f),
    isDir: _isDir(f),
    fullPath: _joinPath(p, _fileName(f)),
    size: Number(f.size || 0),
    updated: f.updated || f.UpdatedAt || '',
  }));
}

async function quickScanOneCourse({ type, endpoint, token, folderPath }) {
  console.log('\n[quickScan] ===== quickScanOneCourse 入口 =====');
  console.log('[quickScan] 入参 → type=%s endpoint=%s token=%s folderPath=%s',
    type, endpoint, token?'('+token.slice(0,6)+'***)':'(空)', folderPath);
  // folderPath 是某一门课程的根目录（就是用户选中的那个文件夹）
  const root = (folderPath && folderPath.startsWith('/') ? folderPath : '/' + (folderPath || '')).replace(/\/+$/, '') || '/';
  const courseName = root.split('/').filter(Boolean).pop() || '未命名课程';
  console.log('[quickScan] 路径规范化 → root=%s  courseName=%s', root, courseName);
  const t0 = Date.now();
  const chapters = await fetchChaptersFromCd2(endpoint, token, root);
  const lessonsCount = chapters.reduce((s, c) => s + ((c.lessons && c.lessons.length) || 0), 0);
  console.log('[quickScan] fetchChaptersFromCd2 完成，耗时 %ss → 章节%d 课时%d',
    ((Date.now()-t0)/1000).toFixed(2), chapters.length, lessonsCount);
  const result = {
    folderName: courseName,
    title: courseName,
    subtitle: `[${(type || '115').toUpperCase()}] 共 ${chapters.length} 章 ${lessonsCount} 集`,
    description: `自动扫描：源类型 ${(type || '115').toUpperCase()}\n路径：${root}\n章节数：${chapters.length}，视频数：${lessonsCount}`,
    instructor: '系统导入',
    level: '初级',
    duration: `${chapters.length}章${lessonsCount}集`,
    rating: 4.5,
    coverColor: 'linear-gradient(135deg, #667eea, #764ba2)',
    categoryId: 1,
    chapters,
    sourcePath: root,
    sourceType: type || '115',
    sourceEndpoint: endpoint,
  };
  console.log('[quickScan] 返回课程草稿 → title=%s duration=%s', result.title, result.duration);
  return result;
}

module.exports = {
  syncSource, syncAll, fetchChaptersFromCd2, scanCourseDrafts, listCloudDirectory, quickScanOneCourse,
};