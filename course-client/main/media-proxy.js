// ============================================================
// 本地媒体代理服务（127.0.0.1，纯内存滑动窗口，不落盘）
// 作用：解决 OSS/CDN 分片存储导致的 Range 请求回源卡顿
//   1. <video> 发 2MB 小 Range → 代理向上游一次要 32MB 大窗口
//      → 跨分片节点次数从 N/2MB 次减少到 N/32MB 次，卡顿概率大幅降低
//   2. 内存滑动窗口（最多 32MB）：保存最近已下载字节，短时间内重复 seek 直接命中
//   3. 完全不写磁盘，不留任何缓存文件，不占用户 C 盘空间
// ============================================================
const http = require('http');
const https = require('https');
const crypto = require('crypto');

// 播放域上游请求头：115 的 videoplay.115.com 会校验收听端指纹，
// 必须使用与浏览器一致的 UA / Accept / Origin / Referer，否则会拒绝分片请求。
const _mediaUpstreamHeaders = (refererUrl) => {
  const h = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
    'Accept': '*/*',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Origin': 'https://proapi.115.com',
    'Connection': 'keep-alive',
    'sec-ch-ua': '"Not=A?Brand";v="99", "Google Chrome";v="151", "Chromium";v="151"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
  };
  if (refererUrl) h['Referer'] = refererUrl;
  return h;
};

let mediaProxyPort = 0;
// urlHash -> { url, contentLength, windowStart, windowBytes, busy, task }
const _mediaProxyCache = new Map();

function _sha1(str) { return crypto.createHash('sha1').update(str || '').digest('hex'); }
function _memEntry(url) {
  const key = _sha1(url);
  let e = _mediaProxyCache.get(key);
  if (!e) {
    e = {
      key, url,
      contentLength: 0,
      windowStart: 0,
      window: Buffer.alloc(0),
      task: null,
    };
    _mediaProxyCache.set(key, e);
    if (_mediaProxyCache.size > 4) {
      const oldest = _mediaProxyCache.keys().next().value;
      const oe = _mediaProxyCache.get(oldest);
      _mediaProxyCache.delete(oldest);
      try { if (oe && oe.window) oe.window = Buffer.alloc(0); } catch (_) {}
    }
  }
  return e;
}
const MAX_WINDOW_BYTES = 32 * 1024 * 1024;

// 发起 HTTP(S) GET，自动跟随 30x 重定向（最多 6 跳），
// 返回最终响应的 { statusCode, headers, stream, finalUrl }
function _followGet(initialUrl, opts) {
  opts = opts || {};
  const maxRedirects = opts.maxRedirects || 6;
  return new Promise((resolve, reject) => {
    let url = initialUrl;
    let redirects = 0;
    function attempt() {
      let u;
      try { u = new URL(url); } catch (e) { return reject(e); }
      const mod = u.protocol === 'https:' ? https : http;
      const req = mod.request({
        method: opts.method || 'GET',
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search,
        headers: opts.headers || _mediaUpstreamHeaders('https://proapi.115.com/'),
        timeout: opts.timeout || 15000,
      }, (res) => {
        const code = res.statusCode || 0;
        if (code >= 301 && code <= 308 && res.headers['location']) {
          try { res.resume(); } catch (_) {}
          if (redirects >= maxRedirects) {
            return reject(new Error('too many redirects'));
          }
          redirects++;
          url = /^https?:\/\//i.test(res.headers['location'])
            ? res.headers['location']
            : (new URL(res.headers['location'], u)).href;
          return attempt();
        }
        resolve({ statusCode: code, headers: res.headers, stream: res, finalUrl: url });
      });
      req.on('error', (e) => reject(e));
      req.on('timeout', () => { try { req.destroy(new Error('timeout')); } catch (_) { reject(new Error('timeout')); } });
      req.end();
    }
    attempt();
  });
}

function _guessContentType(url) {
  try {
    const p = new URL(url).pathname.toLowerCase();
    if (p.endsWith('.mkv')) return 'video/x-matroska';
    if (p.endsWith('.webm')) return 'video/webm';
    if (p.endsWith('.mov') || p.endsWith('.qt')) return 'video/quicktime';
    if (p.endsWith('.avi')) return 'video/x-msvideo';
    if (p.endsWith('.flv')) return 'video/x-flv';
    if (p.endsWith('.wmv')) return 'video/x-ms-wmv';
    if (p.endsWith('.m4v')) return 'video/x-m4v';
    if (p.endsWith('.ts')) return 'video/mp2t';
    if (p.endsWith('.m3u8')) return 'application/vnd.apple.mpegurl';
    if (p.endsWith('.mp3')) return 'audio/mpeg';
    if (p.endsWith('.wav')) return 'audio/wav';
    if (p.endsWith('.flac')) return 'audio/flac';
    if (p.endsWith('.aac')) return 'audio/aac';
    if (p.endsWith('.ogg') || p.endsWith('.ogv')) return 'audio/ogg';
    if (p.endsWith('.pdf')) return 'application/pdf';
  } catch (_) {}
  return 'video/mp4';
}

function _ensureContentLengthUpstream(url) {
  return new Promise((resolve, reject) => {
    try {
      const u = new URL(url);
      const mod = u.protocol === 'https:' ? https : http;
      // 115 CDN 校验浏览器指纹 + Range，需用 GET+Range=0-0 探测，否则 HEAD 403
      const cHeaders = _mediaUpstreamHeaders('https://proapi.115.com/');
      cHeaders['Range'] = 'bytes=0-0';
      const req = mod.request({
        method: 'GET',
        hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search,
        headers: cHeaders,
        timeout: 15000,
      }, (res) => {
        try {
          const cr = res.headers['content-range'] || '';
          const m = cr.match(/\/(\d+)$/);
          if (m && Number(m[1]) > 0) { resolve(Number(m[1])); return; }
          if (res.statusCode === 206 || res.statusCode === 200) {
            const totalFromLen = res.headers['content-length'];
            if (totalFromLen && Number(totalFromLen) > 0) { resolve(Number(totalFromLen)); return; }
          }
          resolve(0);
        } finally { try { res.destroy(); } catch (_) {} }
      });
      req.on('error', (e) => reject(e));
      req.on('timeout', () => { try { req.destroy(new Error('timeout')); } catch (_) { reject(new Error('timeout')); } });
      req.end();
    } catch (e) { reject(e); }
  });
}

function _memPut(entry, start, buf) {
  if (!buf || !buf.length) return;
  if (!entry.window.length) {
    entry.windowStart = start;
    entry.window = Buffer.from(buf);
    return;
  }
  if (start === entry.windowStart + entry.window.length) {
    const newLen = entry.window.length + buf.length;
    if (newLen <= MAX_WINDOW_BYTES) {
      entry.window = Buffer.concat([entry.window, buf], newLen);
    } else {
      const keep = MAX_WINDOW_BYTES - buf.length;
      const tail = keep > 0 ? entry.window.slice(entry.window.length - keep) : Buffer.alloc(0);
      entry.windowStart = entry.windowStart + entry.window.length - keep;
      entry.window = Buffer.concat([tail, buf], tail.length + buf.length);
    }
    return;
  }
  if (buf.length >= MAX_WINDOW_BYTES) {
    entry.windowStart = start;
    entry.window = Buffer.from(buf.slice(buf.length - MAX_WINDOW_BYTES));
    entry.windowStart = start + buf.length - entry.window.length;
  } else {
    entry.windowStart = start;
    entry.window = Buffer.from(buf);
  }
}

function _memGet(entry, start, end) {
  const wEnd = entry.windowStart + entry.window.length;
  if (!entry.window.length) return null;
  if (start < entry.windowStart || end > wEnd) return null;
  const off = start - entry.windowStart;
  const len = end - start + 1;
  return entry.window.slice(off, off + len);
}

function _downloadRange(entry, needStart, needBytes, seq) {
  if (!entry.contentLength) return Promise.resolve(null);
  if (typeof seq === 'number' && entry._lastReqSeq !== seq) return Promise.resolve(null);
  const total = entry.contentLength;
  const realNeedEnd = Math.min(total - 1, needStart + Math.max(needBytes, MAX_WINDOW_BYTES) - 1);
  if (_memGet(entry, needStart, realNeedEnd)) return Promise.resolve();

  if (entry.task && entry.task.active && (needStart >= entry.task.rangeStart && realNeedEnd <= entry.task.rangeEnd)) {
    return entry.task.promise;
  }
  const rangeStart = needStart;
  const rangeEnd = realNeedEnd;
  let resolveT, rejectT;
  const promise = new Promise((res, rej) => { resolveT = res; rejectT = rej; });
  const task = { rangeStart, rangeEnd, active: true, promise, resolve: resolveT, reject: rejectT, _req: null };
  entry.task = task;

  const u = new URL(entry.url);
  const mod = u.protocol === 'https:' ? https : http;
  // 115 CDN 校验浏览器指纹（UA/Origin/Referer），必须用完整头，否则 403 防盗链
  const gHeaders = _mediaUpstreamHeaders('https://proapi.115.com/');
  gHeaders['Range'] = 'bytes=' + rangeStart + '-' + rangeEnd;
  const req = mod.request({
    method: 'GET',
    hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80),
    path: u.pathname + u.search,
    headers: gHeaders,
    timeout: 120000,
  }, (res) => {
    if (res.statusCode !== 206 && res.statusCode !== 200) {
      try { res.destroy(); } catch (_) {}
      task.active = false;
      task.reject(new Error('upstream ' + res.statusCode));
      return;
    }
    let cursor = rangeStart;
    res.on('data', (chunk) => {
      if (!task.active) { try { res.destroy(); } catch (_) {} return; }
      _memPut(entry, cursor, chunk);
      cursor += chunk.length;
      if (task._onData) { try { task._onData(); } catch (_) {} }
    });
    res.on('end', () => { task.active = false; task.resolve(); });
    res.on('error', (e) => { task.active = false; task.reject(e); });
  });
  req.on('timeout', () => { try { req.destroy(new Error('timeout')); } catch (_) {} });
  req.on('error', (e) => { task.active = false; task.reject(e); });
  task._req = req;
  req.end();
  return promise;
}

async function _serveDirect(req, res, src) {
  const entry = _memEntry(src);
  // 首次请求启动后台下载，数据存入 entry._directBuf，后续所有请求都从该 buffer 取。
  if (!entry._directTask || !entry._directTask.active) {
    const hdrs = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
      'Accept': '*/*',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'Connection': 'keep-alive',
    };
    const t = entry._directTask = { active: true, buf: Buffer.alloc(0), finished: false, contentLength: 0, waiters: [], totalChunk: 0 };
    console.log('[media-proxy /direct] 开始下载: ' + src.slice(0, 100));
    _followGet(src, { method: 'GET', timeout: 600000, headers: hdrs }).then((up) => {
      const uh = up.headers || {};
      t.contentLength = parseInt(uh['content-length'] || '0', 10) || 0;
      console.log('[media-proxy /direct] 上游状态码=' + up.statusCode + ' contentLength=' + t.contentLength + ' contentType=' + (uh['content-type'] || '(none)'));
      up.stream.on('data', (c) => {
        t.buf = Buffer.concat([t.buf, c]);
        t.totalChunk++;
        const ws = t.waiters; t.waiters = [];
        for (let i = 0; i < ws.length; i++) { try { ws[i](); } catch (_) {} }
      });
      up.stream.on('end', () => {
        t.finished = true; t.active = false;
        console.log('[media-proxy /direct] 下载完成: 实际=' + t.buf.length + ' 预期=' + t.contentLength + ' chunks=' + t.totalChunk);
        const ws = t.waiters; t.waiters = [];
        for (let i = 0; i < ws.length; i++) { try { ws[i](); } catch (_) {} }
      });
      up.stream.on('error', (e) => {
        console.error('[media-proxy /direct] 上游流错误:', e && e.message);
        t.active = false;
        const ws = t.waiters; t.waiters = [];
        for (let i = 0; i < ws.length; i++) { try { ws[i](); } catch (_) {} }
      });
    }).catch((e) => {
      console.error('[media-proxy /direct] _followGet 异常:', e && e.message);
      const t2 = entry._directTask; if (t2) { t2.active = false; const ws = t2.waiters; t2.waiters = []; for (let i = 0; i < ws.length; i++) { try { ws[i](); } catch (_) {} } }
    });
  }
  const t = entry._directTask;
  let start = 0, end = Infinity, isRange = false;
  const rm = /bytes=(\d+)-(\d*)/.exec(req.headers['range'] || '');
  if (rm) { isRange = true; start = Number(rm[1]) || 0; if (rm[2]) end = Number(rm[2]); }
  const total = t.contentLength || 0;

  // 等待下载完成（Chromium 解封装需要完整 mp4 头，流式推送容易失败）
  const t0 = Date.now();
  await new Promise((resolve) => {
    const check = () => {
      if (t.finished || !t.active) return resolve();
      if (Date.now() - t0 > 600000) return resolve();
      t.waiters.push(() => {
        if (t.finished || !t.active) resolve();
      });
    };
    check();
  });

  if (!t.finished || t.buf.length === 0) {
    if (!res.headersSent) res.writeHead(502, { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'text/plain' });
    return res.end('direct: download incomplete (active=' + t.active + ' finished=' + t.finished + ')');
  }

  const buf = t.buf;
  console.log('[media-proxy /direct] 响应: range=' + (isRange ? start + '-' + (isFinite(end) ? end : '*') : '(全量)') + ' bufLen=' + buf.length + ' total=' + total);

  if (!isRange) {
    const headers = {
      'Access-Control-Allow-Origin': '*',
      'Content-Type': 'video/mp4',
      'Accept-Ranges': 'bytes',
      'Content-Length': String(buf.length),
    };
    if (!res.headersSent) res.writeHead(200, headers);
    return res.end(buf);
  }

  const pieceEnd = Math.min(isFinite(end) ? end : buf.length - 1, buf.length - 1);
  if (pieceEnd < start) {
    if (!res.headersSent) res.writeHead(416, { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'text/plain' });
    return res.end('direct: range not satisfiable');
  }
  const slice = buf.slice(start, pieceEnd + 1);
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'video/mp4',
    'Content-Range': 'bytes ' + start + '-' + pieceEnd + '/' + (total || buf.length),
    'Accept-Ranges': 'bytes',
    'Content-Length': String(slice.length),
  };
  if (!res.headersSent) res.writeHead(206, headers);
  res.end(slice);
}

function startMediaProxy() {
  return new Promise((resolve) => {
    let _globalReqSeq = 0;
    const server = http.createServer(async (req, res) => {
      const mySeq = ++_globalReqSeq;
      try {
        if (req.method === 'OPTIONS') {
          res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
            'Access-Control-Allow-Headers': 'Range, Content-Type',
            'Access-Control-Max-Age': '86400',
          });
          return res.end();
        }
        const u = new URL('http://127.0.0.1' + (req.url || '/'));
        if (u.pathname === '/health') {
          res.writeHead(200, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
          return res.end('ok');
        }
        if (u.pathname === '/direct') {
          const src = u.searchParams.get('src') || '';
          if (!src) { res.writeHead(400, { 'Access-Control-Allow-Origin': '*' }); return res.end('missing src'); }
          // 顺序下载 + 本地内存窗口：seek/Range 由本地窗口切片返回，避免 115 对“跳到中间段”的请求变慢/断流导致黑屏
          _serveDirect(req, res, src);
          return;
        }
        if (u.pathname === '/hls') {
          const origSrc = u.searchParams.get('src') || '';
          if (!origSrc) { res.writeHead(400); return res.end('missing src'); }
          _followGet(origSrc, { timeout: 15000 }).then((hlsRes) => {
            if (!hlsRes || hlsRes.statusCode !== 200) {
              console.log('[115代理] /hls 上游非200:', hlsRes && hlsRes.statusCode, 'src=', origSrc.slice(0, 120));
              res.writeHead(502, { 'Access-Control-Allow-Origin': '*' });
              return res.end('upstream ' + (hlsRes && hlsRes.statusCode));
            }
            const chunks = [];
            hlsRes.stream.on('data', c => chunks.push(c));
            hlsRes.stream.on('end', () => {
              let raw;
              try { raw = Buffer.concat(chunks).toString('utf8'); } catch (e) {
                console.error('[115代理] /hls 解码失败:', e.message);
                res.writeHead(502, { 'Access-Control-Allow-Origin': '*' });
                return res.end('decode error');
              }
              console.log('[115代理] /hls 上游200, 首120字=', raw.slice(0, 120).replace(/\n/g, ' | '));
              const base = origSrc.replace(/[?#].*$/, '').replace(/\/[^/]*$/, '/');
              let rewritten = '';
              try {
                const lines = raw.split(/\r?\n/);
                let nextIsPlaylist = false;
                // 同时处理 #EXT-X-KEY 的 URI 属性中的 URL
                const keyUriRE = /^(#EXT-X-KEY:.*URI=")([^"]+)(".*)$/i;
                const rewrittenLines = lines.map((line) => {
                  const trimmed = line.trim();
                  if (trimmed.startsWith('#')) {
                    nextIsPlaylist = false;
                    if (/^#EXT-X-STREAM-INF/i.test(trimmed) || /^#EXT-X-MEDIA/i.test(trimmed) || /^#EXT-X-I-FRAME-STREAM-INF/i.test(trimmed)) {
                      nextIsPlaylist = true;
                    }
                    // 代理加密密钥 URI（AES-128 等）
                    const km = trimmed.match(keyUriRE);
                    if (km) {
                      try {
                        const keyAbs = /^https?:\/\//i.test(km[2]) ? km[2] : new URL(km[2], base).href;
                        console.log('[115代理] KEY URI => /hls-segment:', keyAbs.slice(0, 100));
                        return km[1] + '/hls-segment?src=' + encodeURIComponent(keyAbs) + km[3];
                      } catch (_) {}
                    }
                    return line;
                  }
                  if (!trimmed) { nextIsPlaylist = false; return line; }
                  try {
                    const abs = /^https?:\/\//i.test(trimmed) ? trimmed : new URL(trimmed, base).href;
                    if (nextIsPlaylist) {
                      nextIsPlaylist = false;
                      console.log('[115代理] 子playlist => /hls:', abs.slice(0, 100));
                      return '/hls?src=' + encodeURIComponent(abs);
                    }
                    console.log('[115代理] 分片 => /hls-segment:', abs.slice(0, 100));
                    return '/hls-segment?src=' + encodeURIComponent(abs);
                  } catch (_) {
                    nextIsPlaylist = false;
                    return line;
                  }
                });
                rewritten = rewrittenLines.join('\n');
                console.log('[115代理] /hls 重写完成, 输出行数=', rewrittenLines.length, '输出首120字=', rewritten.slice(0, 120).replace(/\n/g, ' | '));
              } catch (rewriteErr) {
                console.error('[115代理] /hls 重写异常:', rewriteErr && rewriteErr.message);
                res.writeHead(502, { 'Access-Control-Allow-Origin': '*' });
                return res.end('rewrite error: ' + (rewriteErr && rewriteErr.message));
              }
              res.writeHead(200, {
                'Content-Type': 'application/vnd.apple.mpegurl',
                'Access-Control-Allow-Origin': '*',
                'Cache-Control': 'no-cache',
              });
              res.end(rewritten);
            });
            hlsRes.stream.on('error', (e) => {
              if (!res.headersSent) res.writeHead(502, { 'Access-Control-Allow-Origin': '*' });
              res.end('hls stream error: ' + (e && e.message));
            });
          }).catch((e) => {
            if (!res.headersSent) res.writeHead(502, { 'Access-Control-Allow-Origin': '*' });
            res.end('hls fetch error: ' + (e && e.message));
          });
          return;
        }
        if (u.pathname === '/hls-segment') {
          const segSrc = u.searchParams.get('src') || '';
          if (!segSrc) { res.writeHead(400); return res.end('missing src'); }
          const rangeHdr = req.headers['range'] || '';
          const segHdrs = _mediaUpstreamHeaders('https://videoplay.115.com/');
          if (rangeHdr) segHdrs['Range'] = rangeHdr;
          _followGet(segSrc, {
            method: req.method || 'GET',
            timeout: 120000,
            headers: segHdrs,
          }).then((segRes) => {
            const h = {
              'Access-Control-Allow-Origin': '*',
              'Content-Type': _guessContentType(segSrc),
              'Cache-Control': 'no-cache',
            };
            const sh = segRes.headers || {};
            h['Content-Length'] = sh['content-length'] || sh['content-range'] || undefined;
            if (sh['content-range']) h['Content-Range'] = sh['content-range'];
            if (sh['accept-ranges']) h['Accept-Ranges'] = sh['accept-ranges'];
            console.log('[115代理] /hls-segment 上游 status=', segRes.statusCode, 'type=', _guessContentType(segSrc), 'url=', segSrc.slice(0, 100));
            res.writeHead(segRes.statusCode || 200, h);
            segRes.stream.pipe(res);
            segRes.stream.on('error', (e) => {
              console.error('[115代理] /hls-segment stream error:', e && e.message);
              try { res.destroy(); } catch (_) {}
            });
          }).catch((e) => {
            console.error('[115代理] /hls-segment fetch error:', e && e.message, 'url=', segSrc.slice(0, 100));
            if (!res.headersSent) {
              res.writeHead(502, { 'Access-Control-Allow-Origin': '*' });
            }
            try { res.end('seg error: ' + (e && e.message)); } catch (_) {}
          });
          req.on('close', () => {});
          return;
        }
        if (u.pathname === '/stream') {
          // 纯透传流式路由：完整指纹头 + Range 直达 115 CDN，流式 pipe。
          // 115 是标准 CDN 原生支持 Range seek，无需内存窗口；seek 时每次新 Range 直达 CDN 即秒切。
          let src = u.searchParams.get('src') || '';
          if (!src && /^\/stream\//.test(u.pathname)) {
            try { src = Buffer.from(u.pathname.slice('/stream/'.length), 'base64').toString('utf8'); } catch (_) { src = ''; }
          }
          if (!src) { res.writeHead(400, { 'Access-Control-Allow-Origin': '*' }); return res.end('missing src'); }
          const rangeHdr = req.headers['range'] || '';
          const stHdrs = _mediaUpstreamHeaders('https://videoplay.115.com/');
          if (rangeHdr) stHdrs['Range'] = rangeHdr;
          _followGet(src, {
            method: req.method || 'GET',
            timeout: 120000,
            headers: stHdrs,
          }).then((stRes) => {
            if (stRes.statusCode !== 200 && stRes.statusCode !== 206) {
              console.error('[115代理] /stream 上游失败 status=', stRes.statusCode, 'src=', src.slice(0, 100));
              if (!res.headersSent) res.writeHead(502, { 'Access-Control-Allow-Origin': '*' });
              try { res.end('upstream ' + stRes.statusCode); } catch (_) {}
              try { stRes.stream.destroy(); } catch (_) {}
              return;
            }
            const h = {
              'Access-Control-Allow-Origin': '*',
              'Content-Type': _guessContentType(src),
              'Cache-Control': stRes.statusCode === 206 ? 'no-cache' : 'public, max-age=86400',
            };
            const sh = stRes.headers || {};
            // 206 分段必须把 Content-Length 精确设置为本次 body 的实际字节数，
            // 否则 Chromium 无法正确解封装/播放（可 seek 出帧但进入不了 playing）
            if (sh['content-length'] && !sh['content-range']) {
              h['Content-Length'] = sh['content-length'];
            }
            if (sh['content-range']) {
              h['Content-Range'] = sh['content-range'];
              const cm = /bytes\s+(\d+)-(\d+)\/(\d+)/i.exec(sh['content-range']);
              if (cm) {
                const segLen = Number(cm[2]) - Number(cm[1]) + 1;
                if (segLen > 0) h['Content-Length'] = String(segLen);
              }
            }
            if (sh['accept-ranges']) h['Accept-Ranges'] = sh['accept-ranges'];
            if (sh['content-type']) h['Content-Type'] = sh['content-type'];
            res.writeHead(stRes.statusCode || 200, h);
            console.log('[115代理] /stream status=' + (stRes.statusCode || 200) + ' range=' + rangeHdr + ' CR=' + (h['Content-Range'] || '-') + ' CL=' + (h['Content-Length'] || '-') + ' src=' + src.slice(0, 90));
            stRes.stream.pipe(res);
            // aborted 是正常现象：Chromium 换 Range/seek 时会断开旧连接，静默忽略
            const _onStreamErr = (e) => {
              const msg = (e && e.message) || '';
              if (/aborted/i.test(msg)) {
                try { res.destroy(); } catch (_) {}
                return;
              }
              console.error('[115代理] /stream stream error:', msg);
              try { res.destroy(); } catch (_) {}
            };
            stRes.stream.on('error', _onStreamErr);
            // 客户端断开时主动终止上游，避免泄漏
            req.on('close', () => {
              try { stRes.stream.destroy(); } catch (_) {}
            });
          }).catch((e) => {
            console.error('[115代理] /stream fetch error:', e && e.message, 'src=', src.slice(0, 100));
            if (!res.headersSent) res.writeHead(502, { 'Access-Control-Allow-Origin': '*' });
            try { res.end('stream error: ' + (e && e.message)); } catch (_) {}
          });
          return;
        }
        let src = u.searchParams.get('src') || '';
        if (!src && u.pathname.startsWith('/v1/')) {
          try { src = Buffer.from(u.pathname.slice(4), 'base64').toString('utf8'); } catch (_) { src = ''; }
        }
        if (!src) { res.writeHead(400, { 'Access-Control-Allow-Origin': '*' }); return res.end('missing src'); }
        const entry = _memEntry(src);
        entry._lastReqSeq = mySeq;
        const _isLatest = () => entry._lastReqSeq === mySeq;

        let start = 0; let end = Infinity;
        const rangeHdr = req.headers['range'] || '';
        let isRange = false;
        const rm = /bytes=(\d+)-(\d*)/.exec(rangeHdr);
        if (rm) {
          isRange = true;
          start = Number(rm[1]) || 0;
          if (rm[2]) end = Number(rm[2]);
        }
        if (!entry.contentLength) {
          try { entry.contentLength = await _ensureContentLengthUpstream(entry.url); } catch (_) { entry.contentLength = 0; }
        }
        const total = entry.contentLength || 0;
        if (!total) {
          res.writeHead(502, { 'Content-Type': 'text/plain' });
          return res.end('upstream no length');
        }
        if (isFinite(end) && end >= total) end = total - 1;
        const realEnd = isFinite(end) ? end : Math.min(total - 1, start + 8 * 1024 * 1024 - 1);
        const wantLen = Math.max(1, realEnd - start + 1);

        if (entry.task && entry.task.active) {
          try {
            if (start < entry.task.rangeStart || realEnd > entry.task.rangeEnd + (2 * 1024 * 1024)) {
              entry.task.active = false;
              if (entry.task._req) try { entry.task._req.destroy(new Error('superseded by newer seek ' + mySeq)); } catch (_) {}
              entry.task = null;
            }
          } catch (_) {}
        }

        try { _downloadRange(entry, start, wantLen, mySeq); } catch (_) {}

        const headDeadline = Date.now() + 12000;
        let _didWaitForFirstByte = false;
        while (Date.now() < headDeadline) {
          if (!_isLatest()) {
            try { res.destroy(); } catch (_) {}
            return;
          }
          if (_memGet(entry, start, start)) { _didWaitForFirstByte = true; break; }
          if (entry.task && entry.task.active) {
            await new Promise(r => setTimeout(r, 2));
          } else {
            try { _downloadRange(entry, start, wantLen, mySeq); } catch (_) {}
            await new Promise(r => setTimeout(r, 5));
            if (!_memGet(entry, start, start)) break;
          }
        }
        if (!_didWaitForFirstByte) {
          if (!_isLatest()) {
            try { res.destroy(); } catch (_) {}
            return;
          }
          const pu = new URL(entry.url);
          const mod = pu.protocol === 'https:' ? https : http;
          const upstreamReq = mod.request({
            method: req.method || 'GET',
            hostname: pu.hostname, port: pu.port || (pu.protocol === 'https:' ? 443 : 80),
            path: pu.pathname + pu.search,
            headers: {
              'User-Agent': 'CourseClient/1.0',
              'Range': rangeHdr || ('bytes=0-' + (total > 0 ? total - 1 : '')),
            },
            timeout: 45000,
          }, (upRes) => {
            if (!_isLatest()) { try { upRes.destroy(); } catch (_) {} try { res.destroy(); } catch (_) {} return; }
            try {
              const h = { 'Accept-Ranges': 'bytes', 'Cache-Control': 'public, max-age=604800, immutable', 'Access-Control-Allow-Origin': '*' };
              Object.keys(upRes.headers || {}).forEach(k => {
                const lk = String(k).toLowerCase();
                if (['content-type', 'content-length', 'content-range', 'last-modified', 'etag', 'date'].includes(lk)) h[k] = upRes.headers[k];
              });
              if (!h['ETag'] && !h['etag']) h['ETag'] = '"' + entry._id + '-' + total + '"';
              if (!h['Last-Modified'] && !h['last-modified']) {
                const d = new Date(); d.setTime(d.getTime() - 86400000 * 30);
                h['Last-Modified'] = d.toUTCString();
              }
              if (!h['Content-Type'] && !h['content-type']) h['Content-Type'] = _guessContentType(entry.url);
              res.writeHead(upRes.statusCode || 200, h);
              upRes.on('data', (c) => {
                if (!_isLatest()) {
                  try { upRes.destroy(); } catch (_) {}
                  try { res.destroy(); } catch (_) {}
                  return;
                }
                try {
                  const ok = res.write(c);
                  if (!ok) upRes.pause(), res.once('drain', () => { try { upRes.resume(); } catch (_) {} });
                } catch (_) {}
              });
              upRes.on('end', () => { if (_isLatest()) try { res.end(); } catch (_) {} else try { res.destroy(); } catch (_) {} });
              upRes.on('error', () => { try { res.destroy(); } catch (_) {} });
            } catch (_) { try { res.destroy(); } catch (_) {} }
          });
          upstreamReq.on('timeout', () => { try { upstreamReq.destroy(); } catch (_) {} });
          upstreamReq.on('error', () => { try { if (!res.headersSent) res.writeHead(502); res.destroy(); } catch (_) {} });
          upstreamReq.end();
          req.on('close', () => {
            try { entry._lastReqSeq = (entry._lastReqSeq || 0) + 1; } catch (_) {}
            try { upstreamReq.destroy(); } catch (_) {}
            try { res.destroy(); } catch (_) {}
          });
          return;
        }

        const _modDate = new Date(); _modDate.setTime(_modDate.getTime() - 86400000 * 30);
        const headers = {
          'Content-Type': _guessContentType(entry.url),
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'public, max-age=604800, immutable',
          'Access-Control-Allow-Origin': '*',
          'ETag': '"' + entry._id + '-' + total + '"',
          'Last-Modified': _modDate.toUTCString(),
        };
        const effEnd = start + wantLen - 1;
        if (isRange) {
          headers['Content-Range'] = 'bytes ' + start + '-' + effEnd + '/' + total;
          headers['Content-Length'] = wantLen;
          res.writeHead(206, headers);
        } else {
          headers['Content-Length'] = total;
          res.writeHead(200, headers);
        }
        let pos = start;
        const CHUNK = 512 * 1024;
        const maxLoop = pos + wantLen;
        let _backpressureMs = 0;
        const _deadline = Date.now() + 5 * 60 * 1000;
        req.on('close', () => {
          try { entry._lastReqSeq = (entry._lastReqSeq || 0) + 1; } catch (_) {}
          try { res.destroy(); } catch (_) {}
        });
        const _awaitDrainSafe = () => new Promise(resolve => {
          let done = false;
          const fin = () => { if (done) return; done = true; resolve(); };
          try { res.once('drain', fin); } catch (_) {}
          setTimeout(fin, 3);
        });
        while (pos < maxLoop) {
          if (!_isLatest()) break;
          if (Date.now() > _deadline) break;
          const availEnd = Math.min(maxLoop, (entry.windowStart + entry.window.length) - 1);
          if (availEnd < pos) {
            if (entry.task && entry.task.active) {
              await new Promise(r => setTimeout(r, 15));
              _backpressureMs += 15;
              if (_backpressureMs > 15000 && !(entry.task && entry.task.active)) {
                _backpressureMs = 0;
                try { _downloadRange(entry, pos, Math.min(MAX_WINDOW_BYTES, maxLoop - pos), mySeq); } catch (_) {}
              }
            } else {
              try { _downloadRange(entry, pos, Math.min(MAX_WINDOW_BYTES, maxLoop - pos), mySeq); } catch (_) {}
              await new Promise(r => setTimeout(r, 30));
              const stillAvail = entry.windowStart + entry.window.length - 1;
              if (stillAvail < pos && !(entry.task && entry.task.active)) break;
            }
            continue;
          }
          _backpressureMs = 0;
          if (!_isLatest()) break;
          const endPos = Math.min(availEnd, pos + CHUNK - 1);
          const piece = _memGet(entry, pos, endPos);
          if (!piece || !piece.length) { pos = endPos + 1; continue; }
          if (!_isLatest()) break;
          const ok = res.write(piece);
          pos += piece.length;
          if (!ok) {
            await _awaitDrainSafe();
            if (!_isLatest()) break;
          }
        }
        if (!_isLatest() || Date.now() > _deadline) {
          try { res.destroy(); } catch (_) {}
          return;
        }
        try { res.end(); } catch (_) {}
      } catch (e) {
        try { if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain' }); } catch (_) {}
        try { res.end('ERR ' + (e && e.message || String(e))); } catch (_) {}
      }
    });
    server.on('error', () => resolve(0));
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      mediaProxyPort = addr && addr.port ? addr.port : 0;
      if (mediaProxyPort) console.log('[media-proxy] 纯内存分片代理已就绪 127.0.0.1:' + mediaProxyPort + '（不落盘）');
      resolve(mediaProxyPort);
    });
  });
}

module.exports = { startMediaProxy, getMediaProxyPort: () => mediaProxyPort };