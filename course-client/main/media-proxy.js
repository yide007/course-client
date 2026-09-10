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
      const req = mod.request({
        method: 'HEAD',
        hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search,
        headers: { 'User-Agent': 'CourseClient/1.0' },
        timeout: 15000,
      }, (res) => {
        try {
          if (res.headers['content-length'] && Number(res.headers['content-length']) > 0) {
            resolve(Number(res.headers['content-length']));
            return;
          }
          const cr = res.headers['content-range'] || '';
          const m = cr.match(/\/(\d+)$/);
          if (m) { resolve(Number(m[1])); return; }
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
  const req = mod.request({
    method: 'GET',
    hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80),
    path: u.pathname + u.search,
    headers: {
      'User-Agent': 'CourseClient/1.0',
      'Range': 'bytes=' + rangeStart + '-' + rangeEnd,
    },
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
        let src = decodeURIComponent(u.searchParams.get('src') || '');
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