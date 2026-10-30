// ===== IPC 处理器：上传视频 + 上传配置 + Token 管理 =====
const { ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const os = require('os');
const uploadConfigMod = require('../../database/upload-config');
const p115ConfigMod = require('../../database/p115-config');
const p115Service = require('../../services/p115');
const p115QrLogin = require('../../services/p115-qr-login');
const p115TokenManager = require('../../services/p115-token-manager');
const { getMediaProxyPort } = require('../media-proxy');
const { spawn, spawnSync } = require('child_process');
const crypto = require('crypto');
let _ffmpegPath = '';
try {
  const ff = require('ffmpeg-static');
  if (typeof ff === 'string') _ffmpegPath = ff;
} catch (_) { _ffmpegPath = ''; }

// Electron 打包(asar)下 __dirname 指向 app.asar 内，即使 asarUnpack 了也需用真实解包路径
if (_ffmpegPath && _ffmpegPath.indexOf('app.asar' + path.sep) !== -1) {
  const unpacked = _ffmpegPath.replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);
  if (fs.existsSync(unpacked)) _ffmpegPath = unpacked;
}
if (!_ffmpegPath || !fs.existsSync(_ffmpegPath)) {
  try {
    const rp = path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'ffmpeg-static', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
    if (fs.existsSync(rp)) _ffmpegPath = rp;
  } catch (_) {}
}
console.log('[115remux] ffmpeg 路径 = ' + _ffmpegPath);

const MIME_MAP = {
  '.mp4':'video/mp4','.m4v':'video/x-m4v','.mov':'video/quicktime',
  '.avi':'video/x-msvideo','.mkv':'video/x-matroska','.webm':'video/webm',
  '.flv':'video/x-flv','.wmv':'video/x-ms-wmv','.3gp':'video/3gpp',
  '.ts':'video/MP2T','.rmvb':'application/vnd.rn-realmedia-vbr',
  '.mp3':'audio/mpeg','.wav':'audio/wav','.aac':'audio/aac',
  '.flac':'audio/flac','.m4a':'audio/mp4','.ogg':'audio/ogg',
  '.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png',
  '.gif':'image/gif','.bmp':'image/bmp','.webp':'image/webp',
};

function _guessMime(fileName) {
  const ext = path.extname(fileName).toLowerCase();
  return MIME_MAP[ext] || 'application/octet-stream';
}

function _uploadSingleFile(event, localPath, token, baseURL) {
  return new Promise((resolve) => {
    try {
      if (!localPath || !fs.existsSync(localPath)) return resolve({ success: false, error: '文件不存在' });
      if (!token) return resolve({ success: false, error: 'Token 未配置，请先在 📤 上传配置 中填写上传 Token' });

      const WEB = (baseURL && /^https?:\/\//i.test(baseURL)) ? baseURL : 'https://dev-mac.eyesnews.cn';
      const uploadPath = '/api/admin/mediaFile/uploadMediaFile';
      const fullURL = WEB.replace(/\/+$/, '') + uploadPath;
      const fileName = path.basename(localPath);
      const { size } = fs.statSync(localPath);
      const mime = _guessMime(fileName);
      console.log('[上传] 开始 → url=%s 文件=%s 大小=%sMB token前12位=%s',
        fullURL, fileName, (size / 1024 / 1024).toFixed(2), token.slice(0, 12));
      const sendProgress = (stage, info = {}) => {
        if (!event) return;
        try { event.sender.send('upload-video-progress', { stage, size, fileName, ...info }); } catch (_) {}
      };

      const BOUNDARY = '----CourseClientBoundary' + Date.now().toString(36);
      const safeName = fileName.replace(/[\r\n"]/g, '');
      const asciiName = safeName.replace(/[^\x20-\x7E]/g, c => '_');
      const encodedRfc5987 = encodeURIComponent(safeName).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
      const preBuf = Buffer.from(
        '--' + BOUNDARY + '\r\n' +
        'Content-Disposition: form-data; name="file"; filename="' + asciiName + '"; filename*=UTF-8\'\'' + encodedRfc5987 + '\r\n' +
        'Content-Type: ' + mime + '\r\n\r\n'
      );
      const postBuf = Buffer.from('\r\n--' + BOUNDARY + '--\r\n');
      const totalLen = preBuf.length + size + postBuf.length;

      const parsedUrl = new URL(fullURL);
      const isHttps = parsedUrl.protocol === 'https:';
      const httpMod = isHttps ? https : http;

      const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'POST',
        headers: {
          'Token': token,
          'Accept': 'application/json, text/plain, */*',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Content-Type': 'multipart/form-data; boundary=' + BOUNDARY,
          'Content-Length': totalLen,
        },
        timeout: 30 * 60 * 1000,
      };
      console.log('[上传] 请求目标 Host=%s Path=%s 认证头 Token=%s...',
        options.hostname, options.path, token.slice(0, 10));

      const req = httpMod.request(options, (res) => {
        console.log('[上传] 响应 HTTP=%d headers=%j',
          res.statusCode, {
            'content-type': res.headers['content-type'],
            'set-cookie': res.headers['set-cookie'] ? `[${res.headers['set-cookie'].length}条]` : undefined,
          });
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          console.log('[上传] 响应 HTTP=%d 完整body:\n%s', res.statusCode, body.slice(0, 800));
          let data, isJson = true;
          try { data = JSON.parse(body); } catch (_) { data = null; isJson = false; }
          const errDetail = [
            'HTTP状态码: ' + res.statusCode,
            '请求地址: ' + fullURL,
            '响应类型: ' + (isJson ? 'JSON' : '非JSON(可能是HTML/文本)'),
            '服务器返回: ' + (isJson ? JSON.stringify(data).slice(0, 300) : body.slice(0, 300)),
          ].join('\n');
          if (res.statusCode !== 200) {
            return resolve({
              success: false,
              error: (data && (data.msg || data.message)) || body.slice(0, 200) || ('HTTP ' + res.statusCode),
              detail: errDetail,
            });
          }
          if (data && data.success === false) {
            return resolve({
              success: false,
              error: (data.msg || data.message || '上传失败') + (data.code != null ? '（错误码: ' + data.code + '）' : ''),
              code: data.code,
              detail: errDetail,
            });
          }
          if (!data || !data.success) {
            return resolve({ success: false, error: '服务器返回异常', detail: errDetail });
          }
          sendProgress('done', { percent: 100, data: data.data });
          resolve({ success: true, data: data.data, fileName });
        });
      });

      req.on('error', (e) => {
        console.log('[上传] 请求异常:', e && e.message);
        resolve({ success: false, error: (e && e.message) || String(e) });
      });
      req.on('timeout', () => { try { req.destroy(new Error('上传超时（超过30分钟未响应）')); } catch (_) {} });

      const CHUNK = 512 * 1024;
      let bytesSent = 0;
      let lastPct = -1;
      const sendPct = (force) => {
        const pct = Math.min(98, totalLen <= 0 ? 98 : Math.round((bytesSent / totalLen) * 100));
        if (force || pct !== lastPct) {
          lastPct = pct;
          sendProgress('uploading', { percent: pct, bytesSent, bytesTotal: totalLen });
        }
      };
      sendPct(true);

      const writeFixedBuf = (buf, onDone) => {
        let off = 0;
        const step = () => {
          try {
            while (off < buf.length) {
              const end = Math.min(off + CHUNK, buf.length);
              const piece = buf.subarray(off, end);
              const ok = req.write(piece);
              off += piece.length;
              bytesSent += piece.length;
              sendPct(false);
              if (!ok) { req.once('drain', step); return; }
            }
            onDone();
          } catch (e) { resolve({ success: false, error: (e && e.message) || String(e) }); }
        };
        step();
      };

      const writeFileStream = (onDone) => {
        const stream = fs.createReadStream(localPath, { highWaterMark: CHUNK });
        let flowing = true;
        let closed = false;
        stream.on('data', (chunk) => {
          try {
            const ok = req.write(chunk);
            bytesSent += chunk.length;
            sendPct(false);
            if (!ok) {
              flowing = false;
              stream.pause();
              req.once('drain', () => { flowing = true; try { stream.resume(); } catch (_) {} });
            }
          } catch (e) {
            try { stream.destroy(); } catch (_) {}
            resolve({ success: false, error: (e && e.message) || String(e) });
          }
        });
        stream.on('error', (e) => resolve({ success: false, error: (e && e.message) || String(e) }));
        stream.on('end', () => {
          if (closed) return;
          closed = true;
          const finish = () => {
            if (flowing) onDone();
            else setImmediate(finish);
          };
          finish();
        });
      };

      try {
        writeFixedBuf(preBuf, () => {
          writeFileStream(() => {
            writeFixedBuf(postBuf, () => {
              sendProgress('processing', { percent: 99 });
              try { req.end(); } catch (_) {}
            });
          });
        });
      } catch (e) {
        resolve({ success: false, error: (e && e.message) || String(e) });
      }
    } catch (e) {
      resolve({ success: false, error: (e && e.message) || String(e) });
    }
  });
}

// ===== 方案A：FLV 边下边转边播（实时增长文件 watch serve）=====
// ffmpeg 以本地 /stream 代理为输入（已带 115 指纹头，支持 Range 探完整），
// 边下载边 remux 成可渐进播放的 fMP4 实时写入临时文件；
// watchServer 把"正在变大"的 fMP4 以已知 total 的 Range 响应喂给 <video>，
// 使 Chromium 能边缓冲边播放，首帧数秒内出现，时长/seek 由 fMP4 保证。
const _watchSessions = new Map(); // key -> { file, total, done, clients:Set, lastSize }
let _watchServer = null;
let _watchPort = 0;

function _watchKey(pickCode) { return 'w:' + pickCode; }

function _ensureWatchServer() {
  if (_watchServer) return _watchPort;
  return new Promise((resolve) => {
    const srv = http.createServer(async (req, res) => {
      try {
        const u = new URL(req.url, 'http://127.0.0.1');
        if (u.pathname !== '/watch') {
          res.writeHead(404, { 'Access-Control-Allow-Origin': '*' });
          return res.end('not found');
        }
        const key = u.searchParams.get('key') || '';
        const s = _watchSessions.get(key);
        if (!s) {
          res.writeHead(404, { 'Access-Control-Allow-Origin': '*' });
          return res.end('no session');
        }
        // 解析 Range（seek）
        let start = 0;
        const rangeHdr = req.headers['range'] || '';
        const rm = /bytes=(\d+)-/.exec(rangeHdr);
        if (rm) start = Number(rm[1]) || 0;
        const total = s.total > 0 ? s.total : undefined;
        // ⏳ 就绪门控：等 ffmpeg 先写出"可解码"的首个分片（moov+moof），
        //    再回 206 响应头。否则浏览器在文件头还残缺时就收到完整 Content-Length，
        //    拿到不完整的 moov/moof 会立刻触发 MEDIA_ERR 解码失败（这正是之前 5s 内降级的根因）。
        await _waitSeekableData(s, start);
        // 转码已失败（s.ok=false）且无有效数据：直接终止，让渲染器走 Layer3 兜底
        if (!s.ok && s.done && !_fileHasBytes(s)) {
          try { res.writeHead(500, { 'Access-Control-Allow-Origin': '*' }); res.end('remux failed'); } catch (_) {}
          return;
        }
        // 先尝试同步读当前已有内容；不足部分等文件继续增长后再补发
        const client = { res, offset: start, closed: false };
        s.clients.add(client);
        if (total !== undefined) {
          res.writeHead(206, {
            'Content-Type': 'video/mp4',
            'Accept-Ranges': 'bytes',
            'Content-Length': String(total - start),
            'Content-Range': 'bytes ' + start + '-' + (total - 1) + '/' + total,
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'no-cache',
          });
        } else {
          res.writeHead(206, {
            'Content-Type': 'video/mp4',
            'Accept-Ranges': 'bytes',
            'Content-Length': String(s.lastSize > start ? s.lastSize - start : 0),
            'Content-Range': 'bytes ' + start + '-' + ((s.lastSize || 1) - 1) + '/' + (s.lastSize || 1),
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'no-cache',
          });
        }
        res.on('close', () => { client.closed = true; s.clients.delete(client); });
        req.on('close', () => { client.closed = true; s.clients.delete(client); });
        _pushToClient(s, client);
      } catch (e) {
        try { res.writeHead(500, { 'Access-Control-Allow-Origin': '*' }); res.end('err ' + (e && e.message)); } catch (_) {}
      }
    });
    srv.on('error', (e) => { console.error('[115watch] server error', e); });
    srv.listen(0, '127.0.0.1', () => {
      _watchPort = srv.address().port;
      _watchServer = srv;
      console.log('[115watch] watch server on ' + _watchPort);
      resolve(_watchPort);
    });
  });
}

function _pushToClient(s, client) {
  if (client.closed) return;
  const file = s.file;
  if (!fs.existsSync(file)) return _schedulePush(s, client);
  let size = 0;
  try { size = fs.statSync(file).size; } catch (_) { size = 0; }
  s.lastSize = size;
  try {
    if (client.offset < size) {
      const fd = fs.openSync(file, 'r');
      const buf = Buffer.alloc(size - client.offset);
      fs.readSync(fd, buf, 0, buf.length, client.offset);
      fs.closeSync(fd);
      client.offset = size;
      if (!client.res.writableEnded) client.res.write(buf);
    }
  } catch (e) { /* 文件可能正在写入，下次再读 */ }
  // 转码完成：把已写字节推完后，若 < 声明的 total，则用 0 补齐到 total（尾随零字节不影响 fMP4 解析）
  if (s.done) {
    const endTarget = s.total > 0 ? s.total : s.lastSize;
    if (client.offset < endTarget) {
      let remain = endTarget - client.offset;
      // 分块补齐，避免一次分配过大
      while (remain > 0 && !client.closed && !client.res.writableEnded) {
        const chunk = Math.min(remain, 1024 * 1024);
        const zbuf = Buffer.alloc(chunk);
        try { client.res.write(zbuf); } catch (_) { client.closed = true; break; }
        client.offset += chunk;
        remain -= chunk;
      }
      if (remain > 0) return _schedulePush(s, client); // 仍有大量补齐，下轮继续
    }
    client.closed = true;
    s.clients.delete(client);
    if (!client.res.writableEnded) client.res.end();
    return;
  }
  _schedulePush(s, client);
}

function _schedulePush(s, client) {
  if (client.closed || client._timer) return;
  client._timer = setTimeout(() => {
    client._timer = null;
    _pushToClient(s, client);
  }, 200);
}

// 文件当前有效字节数（不存在/读取失败返回 0）
function _fileHasBytes(s) {
  if (!s.file) return false;
  try { if (!fs.existsSync(s.file)) return false; return fs.statSync(s.file).size > 0; } catch (_) { return false; }
}

// ⏳ 休眠等待：直到 ffmpeg 已写出足够"可播放首分片"（moov+moof 之后一般 >512KB），
//    或转码已结束、或超过超时。等待期间并不向浏览器发头，避免拿到残缺 MP4。
//    start > 0（seek）时需等到文件覆盖到目标区间，否则继续等。
const _PLAYABLE_MIN_BYTES = 512 * 1024;
function _waitSeekableData(s, start, timeoutMs) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const check = () => {
      if (s.done) return resolve();                       // 转码结束（成或败）都放行
      let size = 0;
      try { if (s.file && fs.existsSync(s.file)) size = fs.statSync(s.file).size; } catch (_) { size = 0; }
      if (size > start + _PLAYABLE_MIN_BYTES) return resolve(); // 已覆盖到需要的位置 + 首分片
      if (timeoutMs && Date.now() - t0 > timeoutMs) return resolve();
      setTimeout(check, 150);
    };
    check();
  });
}

function _terminateWatch(key) {
  const s = _watchSessions.get(key);
  if (!s) return;
  s.done = true;
  s.clients.forEach((c) => { c.closed = true; if (c._timer) clearTimeout(c._timer); if (!c.res.writableEnded) c.res.end(); });
  s.clients.clear();
}

function _startStreamingRemux(key, inputSrc, destFile, total) {
  return new Promise((resolve, reject) => {
    if (!_ffmpegPath || !fs.existsSync(_ffmpegPath)) return reject(new Error('ffmpeg 未就绪'));
    const s = { file: destFile, total, done: false, ok: false, clients: new Set(), lastSize: 0 };
    _watchSessions.set(key, s);
    const args = [
      '-y',
      '-i', inputSrc,
      '-map', '0:v?',
      '-map', '0:a?',
      '-c:v', 'copy',
      '-c:a', 'copy',
      '-err_detect', 'ignore_err',
      '-ignore_unknown',
      '-max_muxing_queue_size', '9999',
      '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
      '-avoid_negative_ts', 'make_zero',
      destFile,
    ];
    const child = spawn(_ffmpegPath, args, { windowsHide: true });
    let stderrBuf = '';
    child.stderr.on('data', (c) => { stderrBuf += String(c); });
    child.on('error', (e) => { s.done = true; s.ok = false; resolve({ error: e }); });
    child.on('close', (code) => {
      s.done = true;
      s.ok = (code === 0);
      const tail = stderrBuf.slice(-600);
      if (code !== 0) console.error('[115watch] ffmpeg 异常 exit=' + code + ' stderr=' + tail);
      else console.log('[115watch] ffmpeg 完成 stderr=' + tail);
      if (code !== 0) resolve({ error: new Error('remux exit=' + code + ' ' + tail) });
      else resolve({ done: true });
    });
  });
}

function register() {
  ipcMain.handle('upload-video-file', async (event, localPath, token, baseURL) => {
    return _uploadSingleFile(event, localPath, token, baseURL);
  });

  ipcMain.handle('upload-cover-image', async (event) => {
    try {
      const res = await dialog.showOpenDialog({
        title: '选择课程封面图片',
        properties: ['openFile'],
        filters: [
          { name: '图片文件', extensions: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'] },
        ],
      });
      if (!res || res.canceled || !res.filePaths || !res.filePaths[0]) {
        return { success: false, canceled: true };
      }
      const localPath = res.filePaths[0];
      if (!fs.existsSync(localPath)) return { success: false, error: '文件不存在' };

      const uploads = uploadConfigMod.allUploads();
      if (!uploads || !uploads.length) {
        return { success: false, error: '请先在 📤 上传配置 中配置上传服务器' };
      }
      const cfg = uploads[0];
      let token = cfg.token;
      const baseURL = cfg.baseURL;
      if (!token) return { success: false, error: '上传 Token 未配置，请先在 📤 上传配置 中填写' };

      const _isTokenExpired = (r) => r && (r.code === 5001 || r.code === 401 || (r.error && /过期|expired|token/i.test(r.error)));

      let r = await _uploadSingleFile(event, localPath, token, baseURL);

      if ((!r || !r.success) && _isTokenExpired(r) && cfg.username && cfg.password && baseURL) {
        console.log('[封面上传] Token 过期，尝试自动重新登录...');
        const WEB = /^https?:\/\//i.test(baseURL) ? baseURL : 'https://' + baseURL;
        const loginURL = WEB.replace(/\/+$/, '') + '/api/admin/login';
        const body = JSON.stringify({ username: cfg.username, password: cfg.password });
        const parsedUrl = new URL(loginURL);
        const isHttps = parsedUrl.protocol === 'https:';
        const httpMod = isHttps ? https : http;
        token = await new Promise((resolveToken) => {
          const req = httpMod.request({
            hostname: parsedUrl.hostname,
            port: parsedUrl.port || (isHttps ? 443 : 80),
            path: parsedUrl.pathname + parsedUrl.search,
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(body),
              'Accept': 'application/json, text/plain, */*',
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            },
            timeout: 15000,
          }, (res2) => {
            const chunks = [];
            res2.on('data', (c) => chunks.push(c));
            res2.on('end', () => {
              const respBody = Buffer.concat(chunks).toString('utf8');
              let newToken = null;
              const setCookie = res2.headers['set-cookie'];
              if (setCookie) {
                const cookies = Array.isArray(setCookie) ? setCookie : [setCookie];
                for (const c of cookies) {
                  const m = c.match(/boot\.admin\.cookie\.token=([^;]+)/);
                  if (m) { newToken = m[1]; break; }
                }
              }
              if (!newToken) {
                let data; try { data = JSON.parse(respBody); } catch (_) {}
                if (data && data.success && data.data && data.data.token) newToken = data.data.token;
              }
              console.log('[封面上传] 重新登录 %s', newToken ? '成功，获取新 token' : '失败');
              resolveToken(newToken);
            });
          });
          req.on('error', () => resolveToken(null));
          req.on('timeout', () => { try { req.destroy(new Error('登录超时')); } catch (_) {} resolveToken(null); });
          req.write(body);
          req.end();
        });

        if (token) {
          try { uploadConfigMod.updateToken(cfg.id, token); } catch (_) {}
          r = await _uploadSingleFile(event, localPath, token, baseURL);
        }
      }

      if (!r || !r.success) return r;

      const d = r.data || {};
      const remoteUrl = d.ossUrl || d.url || (baseURL && baseURL.replace(/\/+$/, '') + (d.path || ''));
      console.log('[封面上传] 成功 → remoteUrl=%s', remoteUrl);
      return { success: true, fileUrl: remoteUrl, data: d, fileName: r.fileName, localPath };
    } catch (e) {
      return { success: false, error: (e && e.message) || String(e) };
    }
  });

  ipcMain.handle('get-media-proxy-port', async () => ({ port: getMediaProxyPort() || 0 }));

  ipcMain.handle('get-upload-token', async () => {
    try {
      const uploads = uploadConfigMod.allUploads();
      console.log('[上传配置] 读取到 %d 条配置', uploads && uploads.length ? uploads.length : 0);
      if (uploads && uploads.length > 0) {
        const u = uploads[0];
        console.log('[上传配置] 使用第1条: name=%s baseURL=%s',
          u.name || '', u.baseURL || '(空)');
        return {
          id: u.id || null,
          token: u.token || null,
          baseURL: u.baseURL || null,
          name: u.name || null,
          username: u.username || null,
          password: u.password || null,
        };
      }
      console.log('[上传配置] ⚠️ 未找到任何配置');
      return { token: null, baseURL: null, name: null, username: null, password: null };
    } catch (e) {
      console.log('[上传配置] 读取异常:', e && e.message);
      return { token: null, baseURL: null, name: null, username: null, password: null };
    }
  });

  ipcMain.handle('login-and-get-token', async (_event, baseURL, username, password) => {
    try {
      if (!baseURL || !username || !password) {
        return { success: false, error: '缺少登录参数（域名/用户名/密码）' };
      }
      const WEB = /^https?:\/\//i.test(baseURL) ? baseURL : 'https://' + baseURL;
      const loginURL = WEB.replace(/\/+$/, '') + '/api/admin/login';
      const body = JSON.stringify({ username, password });
      console.log('[登录] POST %s body=%s', loginURL, body);

      const parsedUrl = new URL(loginURL);
      const isHttps = parsedUrl.protocol === 'https:';
      const httpMod = isHttps ? https : http;

      const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'Accept': 'application/json, text/plain, */*',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
        timeout: 15000,
      };

      return new Promise((resolve) => {
        const req = httpMod.request(options, (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            const respBody = Buffer.concat(chunks).toString('utf8');
            console.log('[登录] 响应 HTTP=%d\nset-cookie: %s\nbody: %s',
              res.statusCode,
              res.headers['set-cookie'] || '(无)',
              respBody.slice(0, 300));

            const setCookie = res.headers['set-cookie'];
            let token = null;
            if (setCookie) {
              const cookies = Array.isArray(setCookie) ? setCookie : [setCookie];
              for (const c of cookies) {
                const m = c.match(/boot\.admin\.cookie\.token=([^;]+)/);
                if (m) { token = m[1]; break; }
              }
            }

            if (res.statusCode !== 200) {
              let data; try { data = JSON.parse(respBody); } catch (_) { data = null; }
              return resolve({
                success: false,
                error: (data && (data.msg || data.message)) || ('HTTP ' + res.statusCode + ': ' + respBody.slice(0, 100)),
              });
            }

            if (token) {
              console.log('[登录] 成功，获取到 token: %s...', token.slice(0, 15));
              return resolve({ success: true, token });
            }

            let data; try { data = JSON.parse(respBody); } catch (_) { data = null; }
            if (data && data.success && data.data && data.data.token) {
              console.log('[登录] 成功，token来自响应body');
              return resolve({ success: true, token: data.data.token });
            }

            return resolve({ success: false, error: '登录响应中未找到 token（set-cookie 和 body 中均无）' });
          });
        });
        req.on('error', (e) => resolve({ success: false, error: (e && e.message) || String(e) }));
        req.on('timeout', () => { try { req.destroy(new Error('登录超时')); } catch (_) {} });
        req.write(body);
        req.end();
      });
    } catch (e) {
      return { success: false, error: (e && e.message) || String(e) };
    }
  });

  ipcMain.handle('get-all-upload-configs', async () => {
    return uploadConfigMod.allUploads();
  });

  ipcMain.handle('save-upload-config', async (_event, item) => {
    return uploadConfigMod.upsertUpload(item);
  });

  ipcMain.handle('delete-upload-config', async (_event, id) => {
    return uploadConfigMod.deleteUpload(id);
  });

  ipcMain.handle('save-upload-token', async (_event, id, token) => {
    return uploadConfigMod.updateToken(id, token);
  });

  // ===== 115 配置 =====
  ipcMain.handle('get-all-p115-configs', async () => {
    return p115ConfigMod.allP115();
  });

  ipcMain.handle('save-p115-config', async (_event, item) => {
    return p115ConfigMod.upsertP115(item);
  });

  ipcMain.handle('delete-p115-config', async (_event, id) => {
    return p115ConfigMod.deleteP115(id);
  });

  function _makeWriteBack(cfgId) {
    return async (r) => {
      if (!cfgId) return;
      try {
        const now = Date.now();
        const ttl = Number(r.expiresIn || 0);
        const rttl = Number(r.refreshTokenExpiresIn || 0);
        const payload = {
          id: cfgId,
          authToken: r.accessToken,
          refreshToken: r.refreshToken || '',
          tokenExpiresAt: ttl > 0 ? now + ttl * 1000 : 0,
          refreshTokenExpiresAt: rttl > 0 ? now + rttl * 1000 : 0,
        };
        await p115ConfigMod.upsertP115(payload);
        console.log('[115] writeBack DB 写回 cfgId=' + cfgId +
          ' accessToken=' + payload.authToken +
          ' refreshToken=' + payload.refreshToken);
      } catch (e) { console.error('[115] writeBack 失败:', e.message); }
    };
  }

const _authRetryBackoff = new Map();

function _backoffDelayMs(cfgId) {
  const key = String(cfgId || 'default');
  const e = _authRetryBackoff.get(key);
  if (!e) return 0;
  return Math.max(0, e.until - Date.now());
}

function _recordAuthBackoff(cfgId) {
  const key = String(cfgId || 'default');
  const e = _authRetryBackoff.get(key) || { count: 0, until: 0 };
  e.count += 1;
  const delay = Math.min(1000 * Math.pow(2, Math.min(e.count - 1, 6)), 60000);
  e.until = Date.now() + delay;
  _authRetryBackoff.set(key, e);
  console.log('[115] 鉴权重试退避 #' + e.count + ' cfg=' + key + ' → ' + (delay / 1000).toFixed(1) + ' 秒后允许下一次重试');
  return delay;
}

function _resetAuthBackoff(cfgId) {
  _authRetryBackoff.delete(String(cfgId || 'default'));
}

async function _callWithAutoRefresh(cfgId, accessToken, fn) {
  let r;
  try { r = await fn(accessToken); }
  catch (e) { return { success: false, error: e.message || String(e) }; }
  if (!r || r.success || !r.authInvalid || r.frozen) {
    if (r && r.success) _resetAuthBackoff(cfgId);
    return r;
  }

  const wait = _backoffDelayMs(cfgId);
  if (wait > 0) {
    console.log('[115] 鉴权退避中 cfg=' + (cfgId || '(无)') + ' → 等待 ' + (wait / 1000).toFixed(1) + ' 秒');
    return {
      ...r,
      refreshFailed: true,
      refreshFrozen: false,
      refreshBackoff: true,
      refreshBackoffSec: Math.round(wait / 1000),
      refreshError: '鉴权失败过于频繁，请稍后重试（' + Math.round(wait / 1000) + ' 秒）',
    };
  }

  console.log('[115] 收到 401 authInvalid → 清除缓存并开始自动刷新' +
    '\n  cfgId=' + (cfgId || '(无)') +
    '\n  当前请求 accessToken=' + accessToken);

  p115TokenManager.invalidateToken(cfgId);

  const cfg = cfgId ? p115ConfigMod.getP115(cfgId) : null;
  const dbAccessToken = cfg && cfg.authToken ? cfg.authToken : '';
  const dbRefreshToken = cfg && cfg.refreshToken ? cfg.refreshToken : '';
  const savedRefreshExpiresAt = cfg ? Number(cfg.refreshTokenExpiresAt) || 0 : 0;

  console.log('[115] DB 状态：' +
    '\n  dbAccessToken=' + dbAccessToken +
    '\n  dbRefreshToken=' + dbRefreshToken +
    '\n  savedRefreshExpiresAt=' + savedRefreshExpiresAt + ' now=' + Date.now());

  let newAccessToken = '';
  let newRefreshToken = '';

  if (dbAccessToken && dbAccessToken !== accessToken) {
    console.log('[115] DB 中已有更新的 accessToken → 直接用 DB token' +
      '\n  DB accessToken=' + dbAccessToken);
    newAccessToken = dbAccessToken;
    if (dbRefreshToken) newRefreshToken = dbRefreshToken;
  } else {
    console.log('[115] DB token 与请求一致 → 调 ensureToken 走 refresh_token 刷新' +
      '\n  refreshToken=' + dbRefreshToken);
    const ensureResult = await p115TokenManager.ensureToken(cfgId, {
      accessToken: '',
      refreshToken: dbRefreshToken || '',
      expiresIn: 0,
      refreshTokenExpiresAt: savedRefreshExpiresAt,
      onRefreshed: _makeWriteBack(cfgId),
    });
    if (ensureResult && ensureResult.success && ensureResult.accessToken) {
      newAccessToken = ensureResult.accessToken;
      if (ensureResult.refreshToken) newRefreshToken = ensureResult.refreshToken;
      console.log('[115] ensureToken 刷新成功 fromCache=' + !!ensureResult.fromCache +
        '\n  newAccessToken=' + newAccessToken +
        '\n  newRefreshToken=' + newRefreshToken);
    } else {
      const reason = (ensureResult && ensureResult.error) || '未知刷新错误';
      const code = Number((ensureResult && ensureResult.code)) || (r && r.code) || 0;
      const isFrozen = !!(ensureResult && ensureResult.frozen);
      console.log('[115] ensureToken 刷新失败 → frozen=' + isFrozen +
        '\n  code=' + code +
        '\n  error=' + reason);
      _recordAuthBackoff(cfgId);
      return {
        ...r,
        refreshFailed: true,
        refreshFrozen: isFrozen,
        refreshCode: code,
        refreshError: isFrozen
          ? 'refresh_token 已失效，请重新扫码登录 115 网盘'
          : '自动刷新失败：' + reason,
      };
    }
  }

  if (!newAccessToken) {
    console.log('[115] newAccessToken 仍为空 → 返回原始错误');
    _recordAuthBackoff(cfgId);
    return r;
  }

  console.log('[115] 准备用新 token 重试 fn' +
    '\n  新 accessToken=' + newAccessToken +
    '\n  新 refreshToken=' + newRefreshToken);
  let r2;
  try { r2 = await fn(newAccessToken); }
  catch (e) { return { success: false, error: e.message || String(e) }; }

  console.log('[115] 重试完成 success=' + !!(r2 && r2.success) + ' authInvalid=' + !!(r2 && r2.authInvalid));
  if (r2 && r2.success) {
    _resetAuthBackoff(cfgId);
  }
  if (r2 && newAccessToken && newAccessToken !== accessToken) {
    r2.__newAccessToken = newAccessToken;
    if (newRefreshToken && newRefreshToken !== dbRefreshToken) {
      r2.__newRefreshToken = newRefreshToken;
    }
    console.log('[115] 附加 __newAccessToken 给前端 = ' + newAccessToken +
      (r2.__newRefreshToken ? '\n附加 __newRefreshToken 给前端 = ' + r2.__newRefreshToken : ''));
  }

  if (r2 && !r2.success && r2.authInvalid) {
    const code = r2.code || (r && r.code) || 0;
    console.log('[115] 换新 token 后仍 authInvalid → 判定 refresh_token 失效' +
      '\n  code=' + code + ' error=' + (r2.error || r.error || ''));
    _recordAuthBackoff(cfgId);
    return {
      ...r2,
      refreshFailed: true,
      refreshFrozen: true,
      refreshCode: code,
      refreshError: '已自动刷新并重试，接口仍返回 access_token 无效，refresh_token 可能已失效，请重新扫码登录',
    };
  }
  return r2;
}

// ===== 115 网盘直连 =====
  ipcMain.handle('login-115-qr-init', async () => {
    return p115QrLogin.login115QrInit();
  });
  ipcMain.handle('check-115-qr-status', async (_event, uid, time, sign) => {
    return p115QrLogin.check115QrStatus(uid, time, sign);
  });
  ipcMain.handle('exchange-115-qr-token', async (_event, uid) => {
    return p115QrLogin.exchange115QrToken(uid);
  });

  ipcMain.handle('list-115-directory-by-token', async (_event, cfgId, accessToken, dirId) => {
    return _callWithAutoRefresh(cfgId, accessToken, (at) => p115Service.list115DirectoryByToken(at, dirId));
  });

  ipcMain.handle('create-115-folder', async (_event, cfgId, accessToken, parentId, folderName) => {
    return _callWithAutoRefresh(cfgId, accessToken, (at) => p115Service.create115Folder(at, parentId, folderName));
  });

  ipcMain.handle('upload-115-file', async (_event, cfgId, accessToken, dirId, filePath, fileName) => {
    return _callWithAutoRefresh(cfgId, accessToken, (at) => p115Service.upload115File(at, dirId, filePath, fileName));
  });

  ipcMain.handle('refresh-115-token', async (_event, cfgId, refreshToken) => {
    const existing = cfgId ? p115ConfigMod.getP115(cfgId) : null;
    const writeBack = async (r) => {
      if (!cfgId) return;
      try {
        const cfg = existing || p115ConfigMod.getP115(cfgId);
        if (cfg) {
          const now = Date.now();
          const ttl = Number(r.expiresIn || 0);
          const rttl = Number(r.refreshTokenExpiresIn || 0);
          await p115ConfigMod.upsertP115({
            id: cfgId,
            authToken: r.accessToken,
            refreshToken: r.refreshToken || refreshToken,
            tokenExpiresAt: ttl > 0 ? now + ttl * 1000 : 0,
            refreshTokenExpiresAt: rttl > 0 ? now + rttl * 1000 : 0,
          });
        }
      } catch (e) { console.error('[115token] 写回失败:', e.message); }
    };
    const finalRefreshToken = existing && existing.refreshToken ? existing.refreshToken : (refreshToken || '');
    const source = existing && existing.refreshToken ? 'DB' : (refreshToken ? 'FRONTEND' : 'NONE');
    console.log('[115manualRefresh] cfgId=' + cfgId +
      ' refreshToken=' + finalRefreshToken + ' (src=' + source + ')');
    const res = await p115TokenManager.manualRefresh(cfgId, finalRefreshToken, writeBack);
    return res;
  });

  ipcMain.handle('p115-warm-token', async (_event, cfgId, accessToken, refreshToken) => {
    const writeBack = async (r) => {
      if (!cfgId) return;
      try {
        const c = p115ConfigMod.getP115(cfgId);
        if (c) {
          const now = Date.now();
          const ttl = Number(r.expiresIn || 0);
          const rttl = Number(r.refreshTokenExpiresIn || 0);
          await p115ConfigMod.upsertP115({
            id: cfgId,
            authToken: r.accessToken,
            refreshToken: r.refreshToken || refreshToken,
            tokenExpiresAt: ttl > 0 ? now + ttl * 1000 : 0,
            refreshTokenExpiresAt: rttl > 0 ? now + rttl * 1000 : 0,
          });
        }
      } catch (e) { console.error('[115token] 写回失败:', e.message); }
    };
    // 规范：优先从数据库读取已保存的最新凭证（权威数据源）
    const existing = p115ConfigMod.getP115(cfgId);
    const dbAccessToken = existing && existing.authToken ? existing.authToken : '';
    const dbRefreshToken = existing && existing.refreshToken ? existing.refreshToken : '';
    const savedExpiresAt = existing ? Number(existing.tokenExpiresAt) || 0 : 0;
    const savedRefreshExpiresAt = existing ? Number(existing.refreshTokenExpiresAt) || 0 : 0;
    const finalAccessToken = dbAccessToken || accessToken || '';
    const finalRefreshToken = dbRefreshToken || refreshToken || '';
    const source = dbAccessToken ? 'DB' : (accessToken ? 'FRONTEND' : 'NONE');
    console.log('[115warm] cfgId=' + cfgId +
      '\n  accessToken=' + finalAccessToken + ' (src=' + source + ')' +
      '\n  refreshToken=' + finalRefreshToken +
      '\n  savedExpiresAt=' + savedExpiresAt + ' now=' + Date.now());
    const remainingMs = savedExpiresAt > Date.now() ? savedExpiresAt - Date.now() : 0;
    const expiresInSec = remainingMs > 0 ? Math.floor(remainingMs / 1000) : 0;
    p115TokenManager.registerCfg({
      cfgId,
      accessToken: finalAccessToken,
      refreshToken: finalRefreshToken,
      expiresIn: expiresInSec,
      refreshTokenExpiresAt: savedRefreshExpiresAt,
      onRefreshed: writeBack,
    });
    return { success: true };
  });

  // 静默确保 token 有效：缓存命中直接返回，否则刷新并写回
  // 入参: (cfgId, accessToken, refreshToken)
  ipcMain.handle('p115-ensure-token', async (_event, cfgId, accessToken, refreshToken) => {
    const writeBack = async (r) => {
      if (!cfgId) return;
      try {
        const c = p115ConfigMod.getP115(cfgId);
        if (c) {
          const now = Date.now();
          const ttl = Number(r.expiresIn || 0);
          const rttl = Number(r.refreshTokenExpiresIn || 0);
          await p115ConfigMod.upsertP115({
            id: cfgId,
            authToken: r.accessToken,
            refreshToken: r.refreshToken || refreshToken,
            tokenExpiresAt: ttl > 0 ? now + ttl * 1000 : 0,
            refreshTokenExpiresAt: rttl > 0 ? now + rttl * 1000 : 0,
          });
        }
      } catch (e) { console.error('[115token] 写回失败:', e.message); }
    };
    const existing = p115ConfigMod.getP115(cfgId);
    const dbAccessToken = existing && existing.authToken ? existing.authToken : '';
    const dbRefreshToken = existing && existing.refreshToken ? existing.refreshToken : '';
    const savedExpiresAt = existing ? Number(existing.tokenExpiresAt) || 0 : 0;
    const savedRefreshExpiresAt = existing ? Number(existing.refreshTokenExpiresAt) || 0 : 0;
    const finalAccessToken = dbAccessToken || accessToken || '';
    const finalRefreshToken = dbRefreshToken || refreshToken || '';
    const source = dbAccessToken ? 'DB' : (accessToken ? 'FRONTEND' : 'NONE');
    console.log('[115ensure] cfgId=' + cfgId +
      '\n  accessToken=' + finalAccessToken + ' (src=' + source + ')' +
      '\n  refreshToken=' + finalRefreshToken +
      '\n  savedExpiresAt=' + savedExpiresAt + ' now=' + Date.now());
    const remainingMs = savedExpiresAt > Date.now() ? savedExpiresAt - Date.now() : 0;
    const expiresInSec = remainingMs > 0 ? Math.floor(remainingMs / 1000) : 0;
    const result = await p115TokenManager.ensureToken(cfgId, {
      accessToken: finalAccessToken,
      refreshToken: finalRefreshToken,
      expiresIn: expiresInSec,
      refreshTokenExpiresAt: savedRefreshExpiresAt,
      onRefreshed: writeBack,
    });
    console.log('[115ensure] 返回 success=' + !!(result && result.success) +
      ' fromCache=' + !!(result && result.fromCache) +
      (result && result.success ? '\n  accessToken=' + result.accessToken + '\n  refreshToken=' + (result.refreshToken || '') :
        '\n  error=' + (result && result.error) + ' frozen=' + !!(result && result.frozen)));
    return result;
  });

  ipcMain.handle('get-115-user-info', async (_event, cfgId, accessToken) => {
    return _callWithAutoRefresh(cfgId, accessToken, (at) => p115Service.get115UserInfo(at));
  });

  ipcMain.handle('get-115-video-url', async (_event, cfgId, accessToken, pickCode) => {
    const sendProgress = (payload) => {
      try { _event.sender.webContents.send('115-transcode-progress', payload); } catch (_) {}
    };
    const onProgress = (info) => {
      sendProgress({
        waiting: true,
        elapsedSec: Math.round(info.elapsedMs / 1000),
        pushState: info.pushState,
      });
    };

    // 直链优先：先取原画下载直链，拿到就直接返回（不再等待转码）
    const downR0 = await p115Service.get115DownUrl(accessToken, pickCode).catch(() => ({ success: false }));
    if (downR0 && downR0.success && downR0.url) {
      sendProgress({ done: true, success: true });
      console.log('[115播放] 网盘播放使用原画直链 pickCode=' + pickCode + '\nURL=' + downR0.url);
      return { success: true, bestUrl: _directProxyUrl(downR0.url) || downR0.url, directUrl: downR0.url, proxyUrl: _directProxyUrl(downR0.url), originating: true };
    }
    let makeRequest = (at) => p115Service.get115VideoUrl(at, pickCode, { onProgress, autoPush: true });
    let r = await makeRequest(accessToken);

    if (r && !r.success && r.authInvalid && !r.frozen) {
      const cfg = cfgId ? p115ConfigMod.getP115(cfgId) : null;
      const dbAT = cfg && cfg.authToken ? cfg.authToken : '';
      let newAT = '';
      if (dbAT && dbAT !== accessToken) {
        newAT = dbAT;
      } else {
        const dbRT = cfg && cfg.refreshToken ? cfg.refreshToken : '';
        const savedRefreshExpiresAt = cfg ? Number(cfg.refreshTokenExpiresAt) || 0 : 0;
        p115TokenManager.invalidateToken(cfgId);
        const ensureResult = await p115TokenManager.ensureToken(cfgId, {
          accessToken: '',
          refreshToken: dbRT || '',
          expiresIn: 0,
          refreshTokenExpiresAt: savedRefreshExpiresAt,
          onRefreshed: _makeWriteBack(cfgId),
        });
        if (ensureResult && ensureResult.success && ensureResult.accessToken) {
          newAT = ensureResult.accessToken;
        } else if (ensureResult) {
          r = {
            ...r,
            refreshFailed: true,
            refreshFrozen: !!(ensureResult.frozen),
            refreshCode: Number(ensureResult.code) || 0,
            refreshError: ensureResult.error || '未知刷新错误',
          };
        }
      }
      if (newAT && newAT !== accessToken) {
        sendProgress({ retryAfterRefresh: true });
        r = await makeRequest(newAT);
      }
    }
    sendProgress({ done: true, success: !!(r && r.success) });
    return r;
  });

  ipcMain.handle('video-push-115', async (_event, cfgId, accessToken, pickCode, op) => {
    const doPush = (at) => p115Service.submitVideoPush(at, pickCode, op);
    return _callWithAutoRefresh(cfgId, accessToken, doPush);
  });

  // ===== 115 课时播放地址预热缓存（短效，仅用于"点开即播"二次命中）=====
  const lessonUrlCache = new Map(); // pickCode -> { url, ts }
  const LESSON_URL_CACHE_TTL = 5 * 60 * 1000; // 5 分钟
  const lessonWarmInflight = new Set(); // 防止同一课时重复预热

  // 后台预热：提前调开放平台播放接口，触发转码/排队，让用户点开时已就绪
  ipcMain.handle('warm-115-lesson', async (_event, cfgId, pickCode) => {
    try {
      if (!cfgId || !pickCode) return { success: false, error: '缺少参数' };
      const cached = lessonUrlCache.get(pickCode);
      if (cached && Date.now() - cached.ts < LESSON_URL_CACHE_TTL) {
        return { success: true, cached: true };
      }
      if (lessonWarmInflight.has(pickCode)) return { success: true, inflight: true };
      const cfg = p115ConfigMod.getP115(cfgId);
      const dbAT = (cfg && cfg.authToken) || '';
      if (!dbAT) return { success: false, error: '115 未登录' };
      lessonWarmInflight.add(pickCode);
      try {
        // 暂只用原画直链预热，转码流取流已禁用
        const downR = await _callWithAutoRefresh(cfgId, dbAT, (at) => p115Service.get115DownUrl(at, pickCode));
        const directUrl = (downR && downR.success && downR.url) ? downR.url : '';
        const prev = lessonUrlCache.get(pickCode) || {};
        if (directUrl) {
          lessonUrlCache.set(pickCode, { url: '', directUrl, fileName: (downR && downR.file_name) || '', ts: Date.now() });
          console.log('[115预热] 完成 pickCode=' + pickCode + ' (原画直链)');
        } else {
          console.log('[115预热] 取原画直链失败 pickCode=' + pickCode + ' err=' + (downR && downR.error));
        }
        return { success: !!directUrl };
      } finally {
        lessonWarmInflight.delete(pickCode);
      }
    } catch (e) { return { success: false, error: e.message || String(e) }; }
  });

  // 课程课时播放专用：仅需 cfgId + pickCode，token 由后端从 DB 读取并自动续期
  ipcMain.handle('get-115-lesson-url', async (_event, cfgId, pickCode) => {
    if (!cfgId) return { success: false, error: '缺少 115 配置ID' };
    if (!pickCode) return { success: false, error: '缺少 pick_code' };
    const cached = lessonUrlCache.get(pickCode);
    if (cached && cached.directUrl && Date.now() - cached.ts < LESSON_URL_CACHE_TTL) {
      // 暂只用原画直链
      console.log('[115播放] 命中预热缓存 pickCode=' + pickCode + ' (原画)');
      return { success: true, bestUrl: '', directUrl: cached.directUrl, fileName: cached.fileName || '', proxyUrl: _directProxyUrl(cached.directUrl), streamUrl: _streamProxyUrl(cached.directUrl), fromCache: true };
    }
    const cfg = p115ConfigMod.getP115(cfgId);
    if (!cfg) return { success: false, error: '115 配置不存在' };
    const dbAccessToken = cfg.authToken || '';
    if (!dbAccessToken) return { success: false, error: '115 未登录' };
    console.log('[115播放] get-115-lesson-url cfgId=' + cfgId + ' pickCode=' + pickCode);

    // 暂禁用转码流，只使用原画直链播放
    const downR = await _callWithAutoRefresh(cfgId, dbAccessToken, (at) => p115Service.get115DownUrl(at, pickCode));
    if (!downR || !downR.success || !downR.url) {
      return downR || { success: false, error: '获取原画直链失败' };
    }
    const directUrl = downR.url;
    const merged = lessonUrlCache.get(pickCode) || {};
    lessonUrlCache.set(pickCode, { url: '', directUrl, fileName: downR.file_name || '', ts: Date.now() });
    console.log('[115播放] 原画直链就绪 pickCode=' + pickCode + '\nURL=' + directUrl);
    return { success: true, bestUrl: '', directUrl, fileName: downR.file_name || '', proxyUrl: _directProxyUrl(directUrl), streamUrl: _streamProxyUrl(directUrl), originating: true };
  });

  // ===== 新方案：把直链下载到临时文件，返回 file:// 路径给前端播（彻底绕开 media-proxy）=====
  const _DL_DEFAULT_CONC = 1; // 临时测试单线程带宽对比（测完改回 2）。并行下载分段数，2 并发实测零 403 且稳定
  function _httpModFor(u) { return /^https:/i.test(u) ? https : http; }
  function _dlCommonHeaders() {
    return {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
      'Accept': '*/*',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'Connection': 'keep-alive',
    };
  }
  // 探测直链：跟随重定向并用 Range:bytes=0-0 确认是否能分段 + 总大小；支持则返回 total，否则 0（走单线程兜底）
  function _probeDirect(url) {
    return new Promise((resolve) => {
      let follow = 0;
      const attempt = (curUrl) => {
        let u; try { u = new URL(curUrl); } catch (_) { return resolve({ url: curUrl, total: 0 }); }
        const mod = _httpModFor(url);
        const req = mod.request({
          method: 'GET',
          hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80),
          path: u.pathname + u.search,
          headers: Object.assign(_dlCommonHeaders(), { Range: 'bytes=0-1' }),
          timeout: 20000,
        }, (res) => {
          if ((res.statusCode >= 300 && res.statusCode < 400) && res.headers.location && follow++ < 6) {
            res.resume();
            try { return attempt(new URL(res.headers.location, curUrl).href); } catch (_) { return resolve({ url: curUrl, total: 0 }); }
          }
          // 必须返回 206 Partial Content 才算真正支持 Range；200 表示服务器忽略了 Range，不可分段
          if (res.statusCode !== 206) {
            res.resume();
            console.log('[115下载] 探测 status=' + res.statusCode + ' 不支持分段，回退单线程');
            return resolve({ url: curUrl, total: 0 });
          }
          const cr = res.headers['content-range'] || '';
          const m = /\/\s*(\d+)\s*$/.exec(cr);
          const total = m ? Number(m[1]) : 0;
          console.log('[115下载] 探测成功 status=206 total=' + total + ' content-range=' + cr);
          resolve({ url: curUrl, total });
        });
        req.on('error', (e) => { console.log('[115下载] 探测请求异常:', e && e.message); resolve({ url: curUrl, total: 0 }); });
        req.on('timeout', () => { try { req.destroy(); } catch (_) {} resolve({ url: curUrl, total: 0 }); });
        req.end();
      };
      attempt(url);
    });
  }
  // 并发 Range 分段下载（115 单连接限速，多连接并行显著提速）：每段写临时文件 → 顺序拼合成整文件
  function _downloadParallelToFile(url, destPath, total, onProgress) {
    return new Promise((resolve, reject) => {
      let u; try { u = new URL(url); } catch (_) { return reject(new Error('bad url')); }
      const mod = _httpModFor(url);
      const CONC = Math.max(1, Math.min(_DL_DEFAULT_CONC, Math.ceil(total / (8 * 1024 * 1024)) || 1));
      const segSize = Math.ceil(total / CONC);
      const segs = [];
      for (let i = 0; i < CONC; i++) {
        const s = i * segSize, e = Math.min(total - 1, (i + 1) * segSize - 1);
        if (s > e) break;
        segs.push({ s, e, i });
      }
      const partFiles = [];
      let received = 0;
      const report = () => { if (onProgress) { try { onProgress(received, total); } catch (_) {} } };
      const progTimer = setInterval(report, 200);
      const cleanup = () => {
        clearInterval(progTimer);
        partFiles.forEach((p) => { try { fs.unlinkSync(p); } catch (_) {} });
        try { fs.unlinkSync(destPath); } catch (_) {}
      };
      const dlSeg = (seg) => new Promise((okc, badc) => {
        const part = destPath + '.part' + seg.i;
        try { if (fs.existsSync(part)) fs.unlinkSync(part); } catch (_) {}
        if (!partFiles.includes(part)) partFiles.push(part);
        const req = mod.request({
          method: 'GET',
          hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80),
          path: u.pathname + u.search,
          headers: Object.assign(_dlCommonHeaders(), { Range: 'bytes=' + seg.s + '-' + seg.e }),
          timeout: 1200000,
        }, (res) => {
          if (res.statusCode === 200) {
            // 服务器忽略 Range 直接返回整文件（有城市 CDN 或限流策略），分段会内容重复 → 视为不支持分段
            res.resume();
            console.error('[115下载] 段' + seg.i + ' 返回 200 而非 206，服务器不支持/忽略 Range，分段失败');
            return badc(new Error('server ignores range (200), cannot shard'));
          }
          if (res.statusCode !== 206) { badc(new Error('seg' + seg.i + ' http ' + res.statusCode)); return; }
          const out = fs.createWriteStream(part);
          res.on('data', (c) => { received += c.length; });
          res.on('error', (e) => badc(e));
          out.on('error', (e) => badc(e));
          out.on('finish', () => out.close(() => okc(part)));
          res.pipe(out);
        });
        req.on('error', (e) => badc(e));
        req.end();
      });
      // 并发下载所有段；每段按段号错峰(段号*200ms)建立连接，错开连接时刻以规避 115 并发风控；全部落地后对失败段逐个串行重试
      Promise.all(segs.map((s) => {
        // 错峰启动：段 i 在 i*200ms 后才发起请求，避免同时刻涌过多连接触发 403
        const backoff = s.i * 200;
        const delayTask = backoff > 0 ? new Promise((r) => setTimeout(r, backoff)) : Promise.resolve();
        return delayTask.then(() => dlSeg(s).then((p) => ({ ok: true, s, p })).catch((e) => ({ ok: false, s, err: e && e.message })));
      }))
        .then(async (results) => {
          const failed = results.filter((r) => !r.ok);
          for (let fi = 0; fi < failed.length; fi++) {
            const r = failed[fi];
            console.error('[115下载] 段' + r.s.i + ' 首次并发失败(' + r.err + ')，延时后串行单连接重试...');
            // 退避延迟，给 115 CDN 释放连接配额，提升单连接重试成功率
            await new Promise((rs) => setTimeout(rs, 600 * (fi + 1)));
            try {
              await dlSeg(r.s);
              r.ok = true;
              r.p = destPath + '.part' + r.s.i; // 补上 part 路径，校验/拼合才能找到文件
              console.log('[115下载] 段' + r.s.i + ' 重试成功');
            } catch (e2) {
              console.error('[115下载] 段' + r.s.i + ' 重试仍失败: ' + (e2 && e2.message));
              throw e2;
            }
          }
          // 校验各段大小是否覆盖预期区间，防止服务器返回 200 整文件导致拼出重复内容
          for (const r of results) {
            const _ps = fs.statSync(r.p).size;
            const expect = r.s.e - r.s.s + 1;
            if (_ps !== expect) throw new Error('段' + r.s.i + ' 大小不符 expect=' + expect + ' got=' + _ps);
          }
          return results;
        })
        .then((results) => {
        clearInterval(progTimer);
        if (onProgress) { try { onProgress(total, total); } catch (_) {} }
        // 顺序拼合：Node 可写流对连续 write 按调用序 FIFO，上一段 'end' 后再排入下一段即保序
        const out = fs.createWriteStream(destPath);
        let idx = 0;
        out.on('error', (e) => { cleanup(); reject(e); });
        const next = () => {
          if (idx >= partFiles.length) { out.end(() => resolve({ size: total })); return; }
          const p = partFiles[idx++];
          if (!fs.existsSync(p)) return cleanup(), reject(new Error('缺段 ' + p));
          const rs = fs.createReadStream(p);
          rs.on('error', (e) => { cleanup(); reject(e); });
          rs.pipe(out, { end: false });
          rs.on('end', () => setImmediate(next));
        };
        next();
      }).catch((e) => { cleanup(); reject(e); });
    });
  }
  // 单线程全量下载（服务器不支持 Range / 无法探测总长时的兜底）
  function _downloadSingleToFile(url, destPath, onProgress) {
    return new Promise((resolve, reject) => {
      if (!url) return reject(new Error('empty url'));
      const mod = _httpModFor(url);
      const follow = { n: 0 };
      const attempt = (curUrl) => {
        const cu = new URL(curUrl);
        const req = mod.request({
          method: 'GET',
          hostname: cu.hostname, port: cu.port || (cu.protocol === 'https:' ? 443 : 80),
          path: cu.pathname + cu.search, headers: _dlCommonHeaders(), timeout: 600000,
        }, (res) => {
          if ((res.statusCode >= 300 && res.statusCode < 400) && res.headers.location && follow.n++ < 6) {
            try { attempt(new URL(res.headers.location, curUrl).href); } catch (e) { reject(e); }
            return;
          }
          if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) { reject(new Error('upstream ' + res.statusCode)); return; }
          const contentLength = parseInt(res.headers['content-length'] || '0', 10) || 0;
          let received = 0;
          res.on('data', (chunk) => {
            received += chunk.length;
            if (onProgress) { try { onProgress(received, contentLength); } catch (_) {} }
          });
          const out = fs.createWriteStream(destPath);
          out.on('finish', () => out.close(() => resolve({ size: out.bytesWritten, statusCode: res.statusCode })));
          out.on('error', (e) => { try { fs.unlinkSync(destPath); } catch (_) {} reject(e); });
          res.on('error', (e) => { try { fs.unlinkSync(destPath); } catch (_) {} reject(e); });
          res.pipe(out);
        });
        req.on('timeout', () => { try { req.destroy(); } catch (_) {} reject(new Error('timeout')); });
        req.on('error', reject);
        req.end();
      };
      attempt(url);
    });
  }
  function _downloadDirectToFile(url, destPath, onProgress) {
    return new Promise((resolve, reject) => {
      if (!url) return reject(new Error('empty url'));
      // 支持 Range 且文件较大（>1MB）→ 并发分段加速；任何失败/不支持 → 自动回退单线程，绝不让用户看到失败
      _probeDirect(url).then((p) => {
        if (p && p.total > 1024 * 1024 && p.supportsRange !== false) {
          const segN = Math.max(1, Math.min(_DL_DEFAULT_CONC, Math.ceil(p.total / (8 * 1024 * 1024)) || 1));
          console.log('[115下载] 并发分段下载 total=' + p.total + ' 段数=' + segN + ' ...开始计时');
          const t0 = Date.now();
          return _downloadParallelToFile(url, destPath, p.total, onProgress)
            .then((r) => {
              const sec = ((Date.now() - t0) / 1000).toFixed(1);
              console.log('[115下载] 并发' + segN + '路耗时 ' + sec + 's（Mbps≈' + (p.total / 1024 / 1024 / (Date.now() - t0) * 8000).toFixed(0) + '）');
              return r;
            })
            .catch((e) => {
              console.error('[115下载] 分段下载失败，回退单线程:', e && e.message);
              return _downloadSingleToFile(url, destPath, onProgress);
            });
        }
        const t0 = Date.now();
        console.log('[115下载] 单线程全量下载 ...开始计时');
        return _downloadSingleToFile(url, destPath, onProgress).then((r) => {
          const sec = ((Date.now() - t0) / 1000).toFixed(1);
          const want = p && p.total ? p.total : (r && r.size) || 0;
          console.log('[115下载] 单线程耗时 ' + sec + 's（Mbps≈' + (want / 1024 / 1024 / (Date.now() - t0) * 8000).toFixed(0) + '）');
          return r;
        });
      }).then(resolve, (e) => {
        console.error('[115下载] 走单线程兜底:', e && e.message);
        _downloadSingleToFile(url, destPath, onProgress).then(resolve, reject);
      });
    });
  }

  const _lessonFileCache = new Map(); // pickCode -> { file, ts }
  const LESSON_FILE_TTL = 30 * 60 * 1000;
  ipcMain.handle('download-115-lesson-to-file', async (_event, cfgId, pickCode) => {
    if (!cfgId || !pickCode) return { success: false, error: '缺少参数' };
    const cached = _lessonFileCache.get(pickCode);
    if (cached && cached.file && Date.now() - cached.ts < LESSON_FILE_TTL && fs.existsSync(cached.file)) {
      console.log('[115下载] 命中文件缓存 pickCode=' + pickCode + ' file=' + cached.file);
      const fp = cached.file.replace(/\\/g, '/');
      return { success: true, filePath: 'file:///' + fp };
    }
    const cfg = p115ConfigMod.getP115(cfgId);
    if (!cfg) return { success: false, error: '115 配置不存在' };
    const dbAT = cfg.authToken || '';
    if (!dbAT) return { success: false, error: '115 未登录' };
    const urlR = await _callWithAutoRefresh(cfgId, dbAT, (at) => p115Service.get115DownUrl(at, pickCode));
    if (!urlR || !urlR.success || !urlR.url) {
      return { success: false, error: (urlR && urlR.error) || '获取直链失败' };
    }
    const ext = (urlR.file_name && /\.(\w+)$/.exec(urlR.file_name)) ? RegExp.$1.toLowerCase() : 'mp4';
    const destDir = path.join(os.tmpdir(), 'courseclient-115');
    try { fs.mkdirSync(destDir, { recursive: true }); } catch (_) {}
    const destFile = path.join(destDir, pickCode + '.' + ext);
    console.log('[115下载] 开始下载 pickCode=' + pickCode + ' -> ' + destFile);
    try {
      const info = await _downloadDirectToFile(urlR.url, destFile);
      console.log('[115下载] 下载完成 pickCode=' + pickCode + ' size=' + info.size);
      _lessonFileCache.set(pickCode, { file: destFile, ts: Date.now() });
      const fp = destFile.replace(/\\/g, '/');
      return { success: true, filePath: 'file:///' + fp, size: info.size };
    } catch (e) {
      console.error('[115下载] 下载失败:', e && e.message);
      return { success: false, error: (e && e.message) || '下载失败' };
    }
  });

  // ===== FLV 播放：下载 FLV → ffmpeg 快速 remux 成 fMP4（-c copy 不重编码）→ 返回 file:// 给原生 <video> =====
  // 解决 FLV 头部 onMetaData 损坏导致 <video>/mpegts 时长无法解析、进度条崩坏的问题。
  // remux 只换封装不重编码（秒级完成），输出 fMP4 支持流式加载 + seek，时长天然正确。
  const _remuxCache = new Map(); // pickCode -> { file, ts }
  const _remuxInflight = new Map(); // pickCode -> Promise
  const REMUX_TTL = 60 * 60 * 1000;

  function _sendRemux(event, payload) {
    try { if (event && event.sender && typeof event.sender.send === 'function') event.sender.send('remux-115-progress', payload); } catch (_) {}
  }

  // 执行一次 ffmpeg，返回 Promise；子进程 stderr 保留做诊断
  function _spawnFfmpeg(args) {
    return new Promise((resolve, reject) => {
      const child = spawn(_ffmpegPath, args, { windowsHide: true });
      let stderrBuf = '';
      child.stderr.on('data', (c) => { stderrBuf += String(c); });
      child.on('error', (e) => reject(e));
      child.on('close', (code) => {
        const tail = (stderrBuf || '').slice(-600);
        const outFile = args[args.length - 1];
        if (code === 0 && outFile && fs.existsSync(outFile)) {
          console.log('[115remux] ffmpeg 完成 stderr=' + tail);
          resolve();
        } else {
          console.error('[115remux] ffmpeg 异常 exit=' + code + ' stderr=' + tail);
          reject(new Error('ffmpeg remux exit=' + code + ' ' + tail));
        }
      });
    });
  }

  // 三级转封装：①快路径(全copy，秒级) → ②音频 copy 不了则只转音频 → ③视频 copy 不了则 libx264 真编码兜底
  function _runFfmpeg(inputFile, outputFile) {
    return new Promise(async (resolve, reject) => {
      if (!_ffmpegPath || !fs.existsSync(_ffmpegPath)) {
        return reject(new Error('ffmpeg 未就绪'));
      }
      const base = [
        '-y',
        '-i', inputFile,
        '-map', '0:v?',
        '-map', '0:a?',
        '-ignore_unknown',
        '-err_detect', 'ignore_err',
        '-max_muxing_queue_size', '9999',
        '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
        '-avoid_negative_ts', 'make_zero',
      ];
      // 候选转码链（依次尝试，第一个成功的生效）：
      //   ① 快路径：全 copy，秒级（115 FLV 音频本就 AAC，直拷即可）
      //   ② copy 音视频头写不出（如视频缺宽高 / 音频非 MP4 容器格式）→ 硬件编码优先(nvenc→qsv→libx264)，真编码/转码
      //   说明：-err_detect ignore_err 已在 base 中；libx264 默认即多线程全核
      const candidates = [
        { name: 'copy(秒级)', args: ['-c:v', 'copy', '-c:a', 'copy'], encoded: false },
        { name: 'copy视频+aac音频', args: ['-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k'], encoded: false },
        { name: 'NVIDIA nvenc', args: ['-c:v', 'h264_nvenc', '-preset', 'p1', '-cq', '23', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k'], encoded: true },
        { name: 'Intel qsv', args: ['-c:v', 'h264_qsv', '-preset', 'veryfast', '-global_quality', '23', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k'], encoded: true },
        { name: 'libx264(CPU全核)', args: ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-threads', '0', '-c:a', 'aac', '-b:a', '192k'], encoded: true },
      ];
      for (let i = 0; i < candidates.length; i++) {
        const c = candidates[i];
        const t0 = Date.now();
        try {
          try { if (fs.existsSync(outputFile)) fs.unlinkSync(outputFile); } catch (_) {}
          await _spawnFfmpeg(base.concat(c.args, [outputFile]));
          console.log('[115remux] 走 ' + c.name + ' 成功，耗时 ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
          return resolve({ file: outputFile, encoded: c.encoded, encoder: c.name });
        } catch (e) {
          try { if (fs.existsSync(outputFile)) fs.unlinkSync(outputFile); } catch (_) {}
          console.log('[115remux] 候选 ' + c.name + ' 失败(' + ((Date.now() - t0) / 1000).toFixed(1) + 's)，降级: ' + (e && e.message));
        }
      }
      return reject(new Error('ffmpeg remux 全部失败: ' + outputFile));
    });
  }

  ipcMain.handle('remux-115-flv-to-mp4', async (event, cfgId, pickCode) => {
    if (!cfgId || !pickCode) return { success: false, error: '缺少参数' };
    const cached = _remuxCache.get(pickCode);
    if (cached && cached.file && Date.now() - cached.ts < REMUX_TTL && fs.existsSync(cached.file)) {
      const _csize = fs.statSync(cached.file).size;
      if (_csize < 102400) {
        console.log('[115remux] 缓存损坏（' + _csize + ' bytes），清除并重新下载转码');
        _remuxCache.delete(pickCode);
        try { fs.unlinkSync(cached.file); } catch (_) {}
      } else {
        console.log('[115remux] 命中缓存 pickCode=' + pickCode + ' size=' + _csize);
        return { success: true, filePath: 'file://' + cached.file.replace(/\\/g, '/'), duration: cached.duration || 0 };
      }
    }
    if (_remuxInflight.has(pickCode)) return _remuxInflight.get(pickCode);
    const p = (async () => {
      try {
        const cfg = p115ConfigMod.getP115(cfgId);
        if (!cfg) return { success: false, error: '115 配置不存在' };
        const dbAT = cfg.authToken || '';
        if (!dbAT) return { success: false, error: '115 未登录' };
        _sendRemux(event, { stage: 'url', pickCode });
        const urlR = await _callWithAutoRefresh(cfgId, dbAT, (at) => p115Service.get115DownUrl(at, pickCode));
        if (!urlR || !urlR.success || !urlR.url) {
          return { success: false, error: (urlR && urlR.error) || '获取直链失败' };
        }
        const destDir = path.join(os.tmpdir(), 'courseclient-115');
        try { fs.mkdirSync(destDir, { recursive: true }); } catch (_) {}
        const flvFile = path.join(destDir, pickCode + '.flv');
        const mp4File = path.join(destDir, pickCode + '.fmp4.mp4');

        if (!fs.existsSync(flvFile) || fs.statSync(flvFile).size === 0) {
          _sendRemux(event, { stage: 'download', pickCode, value: 0 });
          const info = await _downloadDirectToFile(urlR.url, flvFile, (received, totalLen) => {
            let v = 0;
            if (totalLen > 0) v = Math.min(99, Math.floor((received / totalLen) * 100));
            _sendRemux(event, { stage: 'download', pickCode, value: v });
          });
          _sendRemux(event, { stage: 'download', pickCode, value: 100, size: info.size });
        }
        _sendRemux(event, { stage: 'remux', pickCode, value: 0 });
        await _runFfmpeg(flvFile, mp4File);
        _sendRemux(event, { stage: 'remux', pickCode, value: 100 });

        const duration = (() => {
          try {
            const { spawnSync } = require('child_process');
            // 用 `ffmpeg -i` 探测元数据：-i 无输出文件时 ffmpeg 会非零退出，
            // 且关键信息(Duration/Stream)打印在 stderr，故合并流并容忍非零退出码。
            const meta = spawnSync(_ffmpegPath, ['-i', mp4File], { encoding: 'utf8' });
            const out = (meta.stderr || '') + (meta.stdout || '');
            const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(out);
            if (m) return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
          } catch (_) {}
          return 0;
        })();

        _remuxCache.set(pickCode, { file: mp4File, duration, ts: Date.now() });
        console.log('[115remux] 完成 pickCode=' + pickCode + ' mp4=' + mp4File + ' duration=' + duration);
        return { success: true, filePath: 'file://' + mp4File.replace(/\\/g, '/'), duration };
      } catch (e) {
        console.error('[115remux] 失败:', e && e.message);
        return { success: false, error: (e && e.message) || 'remux 失败' };
      } finally {
        _remuxInflight.delete(pickCode);
      }
    })();
    _remuxInflight.set(pickCode, p);
    return p;
  });

  // ===== 方案A：FLV 边下边转边播（流式）=====
  // 返回一个 watchUrl，前端 <video> 直接 src=watchUrl 即可边播边缓存。
  ipcMain.handle('remux-115-flv-stream', async (event, cfgId, pickCode) => {
    if (!cfgId || !pickCode) return { success: false, error: '缺少参数' };
    const cfg = p115ConfigMod.getP115(cfgId);
    if (!cfg) return { success: false, error: '115 配置不存在' };
    const dbAT = cfg.authToken || '';
    if (!dbAT) return { success: false, error: '115 未登录' };
    try {
      // 已有整份缓存 → 直接 serve 完成文件（不重启 ffmpeg）
      const cached = _remuxCache.get(pickCode);
      if (cached && cached.file && Date.now() - cached.ts < REMUX_TTL && fs.existsSync(cached.file)) {
        const total = fs.statSync(cached.file).size;
        // 损坏保护：fMP4 至少要有 ftyp+moov+moof+mdat，< 10KB 几乎一定是损坏文件
        if (total < 10240) {
          console.log('[115watch] 缓存损坏（' + total + ' bytes），清除并重新转码');
          _remuxCache.delete(pickCode);
          try { fs.unlinkSync(cached.file); } catch (_) {}
        } else {
          const key = _watchKey(pickCode);
          let s = _watchSessions.get(key);
          if (!s || s.file !== cached.file) {
            _watchSessions.set(key, { file: cached.file, total, done: true, ok: true, clients: new Set(), lastSize: total });
          }
          const port = await _ensureWatchServer();
          console.log('[115watch] 用已完成缓存 key=' + key + ' total=' + total);
          return { success: true, watchUrl: 'http://127.0.0.1:' + port + '/watch?key=' + key, fromCache: true };
        }
      }
      if (_remuxInflight.has(pickCode)) return _remuxInflight.get(pickCode);

      const p = (async () => {
        try {
          const urlR = await _callWithAutoRefresh(cfgId, dbAT, (at) => p115Service.get115DownUrl(at, pickCode));
          if (!urlR || !urlR.success || !urlR.url) {
            return { success: false, error: (urlR && urlR.error) || '获取直链失败' };
          }
          // 构造本地 /stream 代理输入（带指纹 + Range 支持）→ total 从代理 Content-Range 探测
          const portMo = getMediaProxyPort();
          if (!portMo) return { success: false, error: '媒体代理未就绪' };
          const streamSrc = 'http://127.0.0.1:' + portMo + '/stream?src=' + encodeURIComponent(urlR.url);

          // 探测直链总长（供 <video> 建立 seekable + 判断 buffered 上限）
          let total = 0;
          try {
            const probeRst = await new Promise((resolvePr) => {
              const mod = /^https:/i.test(urlR.url) ? https : http;
              const pu = new URL(urlR.url);
              const reqP = mod.request({
                method: 'GET',
                hostname: pu.hostname, port: pu.port || (pu.protocol === 'https:' ? 443 : 80),
                path: pu.pathname + pu.search,
                headers: {
                  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
                  'Accept': '*/*', 'Accept-Language': 'zh-CN,zh;q=0.9', 'Range': 'bytes=0-0', 'Origin': 'https://proapi.115.com',
                },
                timeout: 20000,
              }, (respPr) => {
                try {
                  const cr = (respPr.headers['content-range'] || '');
                  const m = cr.match(/\/(\d+)$/);
                  resolvePr(m ? Number(m[1]) : 0);
                } catch (_) { resolvePr(0); }
                finally { try { respPr.destroy(); } catch (_) {} }
              });
              reqP.on('error', () => resolvePr(0));
              reqP.on('timeout', () => { try { reqP.destroy(); } catch (_) {} resolvePr(0); });
              reqP.end();
            });
            total = probeRst > 0 ? probeRst : 0;
          } catch (_) { total = 0; }

          const destDir = path.join(os.tmpdir(), 'courseclient-115');
          try { fs.mkdirSync(destDir, { recursive: true }); } catch (_) {}
          const mp4File = path.join(destDir, pickCode + '.fmp4.mp4');
          const key = _watchKey(pickCode);

          const port = await _ensureWatchServer();
          console.log('[115watch] 开始流式 remux key=' + key + ' total=' + total + '\nsrc=' + streamSrc);
          // 以 /stream 为输入边下载边转（ffmpeg 自己会持续写 mp4File）
          _startStreamingRemux(key, streamSrc, mp4File, total); // fire-and-forget，ffmpeg 完成后 _terminateWatch 由 close 回调置 done
          // ffmpeg close 后把状态同步进缓存
          const watcher = setInterval(() => {
            const s = _watchSessions.get(key);
            if (s && s.done && !s._cached) {
              s._cached = true;
              // 仅转码成功（exit 0）才入缓存，避免把失败的坏文件污染给 Layer3 复用
              if (s.ok) {
                const dur = (() => {
                  try {
                    const meta = spawnSync(_ffmpegPath, ['-i', mp4File], { encoding: 'utf8' });
                    const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec((meta.stderr || '') + (meta.stdout || ''));
                    if (m) return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
                  } catch (_) {}
                  return 0;
                })();
                if (fs.existsSync(mp4File) && dur > 0) {
                  _remuxCache.set(pickCode, { file: mp4File, duration: dur, ts: Date.now() });
                  console.log('[115watch] 流式转码完成并入缓存 pickCode=' + pickCode + ' duration=' + dur);
                }
              }
            }
            if (s && s.done) clearInterval(watcher);
          }, 2000);
          setTimeout(() => { const s2 = _watchSessions.get(key); if (s2 && s2.done) clearInterval(watcher); }, 2 * 60 * 1000);

          return { success: true, watchUrl: 'http://127.0.0.1:' + port + '/watch?key=' + key, total, streaming: true };
        } catch (e) {
          console.error('[115watch] 流式启动失败:', e && e.message);
          return { success: false, error: (e && e.message) || '启动失败' };
        } finally {
          _remuxInflight.delete(pickCode);
        }
      })();
      _remuxInflight.set(pickCode, p);
      return p;
    } catch (e) {
      return { success: false, error: (e && e.message) || 'remux 失败' };
    }
  });

  function _directProxyUrl(u) {
  if (!u) return '';
  if (/^https?:\/\/(127\.0\.0\.1|localhost)/i.test(u)) return u;
  const port = getMediaProxyPort();
  if (!port) return '';
  return 'http://127.0.0.1:' + port + '/direct?src=' + encodeURIComponent(u);
}

  // 流式代理地址（边下边播用）：经 /stream 完整指纹 + Range 直达 CDN 透传，不落盘、支持 seek
  function _streamProxyUrl(u) {
    if (!u) return '';
    if (/^https?:\/\/(127\.0\.0\.1|localhost)/i.test(u)) return u;
    const port = getMediaProxyPort();
    if (!port) return '';
    return 'http://127.0.0.1:' + port + '/stream?src=' + encodeURIComponent(u);
  }

  // 单独获取原画下载直链（可用于课程资料预览/下载）
  ipcMain.handle('get-115-downurl', async (_event, cfgId, pickCode) => {
    if (!cfgId) return { success: false, error: '缺少 115 配置ID' };
    if (!pickCode) return { success: false, error: '缺少 pick_code' };
    const cached = lessonUrlCache.get(pickCode);
    if (cached && cached.directUrl && Date.now() - cached.ts < LESSON_URL_CACHE_TTL) {
      return { success: true, url: cached.directUrl, proxyUrl: _directProxyUrl(cached.directUrl), streamUrl: _streamProxyUrl(cached.directUrl), fromCache: true };
    }
    const cfg = p115ConfigMod.getP115(cfgId);
    const at = (cfg && cfg.authToken) || '';
    if (!at) return { success: false, error: '115 未登录' };
    const r = await _callWithAutoRefresh(cfgId, at, (_at) => p115Service.get115DownUrl(_at, pickCode));
    if (r && r.success && r.url) {
      const prev = lessonUrlCache.get(pickCode) || {};
      lessonUrlCache.set(pickCode, { url: prev.url || '', directUrl: r.url, ts: Date.now() });
      r.proxyUrl = _directProxyUrl(r.url);
      r.streamUrl = _streamProxyUrl(r.url);
    }
    return r;
  });

  ipcMain.handle('list-115-picker-dir', async (_event, cfgId, dirId) => {
    const cfg = p115ConfigMod.getP115(cfgId);
    if (!cfg) return { success: false, error: '配置不存在' };
    const dir = dirId || '0';
    const doList = (at) => p115Service.list115DirectoryByToken(at, dir);
    return _callWithAutoRefresh(cfgId, cfg.authToken, doList);
  });

  ipcMain.handle('scan-115-picker-folder', async (_event, cfgId, dirId, folderName) => {
    const cfg = p115ConfigMod.getP115(cfgId);
    if (!cfg) return { success: false, error: '配置不存在' };
    const ROOT = dirId || '0';
    const VIDEO_EXT = /\.(mp4|m4v|mov|avi|mkv|webm|flv|wmv|mts|ts|rmvb)$/i;
    console.log('[115Picker] scan-115-picker-folder cfgId=' + cfgId + ' dirId=' + dirId + ' folderName=' + folderName);

    async function _listDir(cid) {
      const doList = (at) => p115Service.list115DirectoryByToken(at, cid);
      return _callWithAutoRefresh(cfgId, cfg.authToken, doList);
    }

    // 递归构建章节：子文件夹=章节；文档(非视频)归入最近的有视频章节的 pdfs，并按原层级保留 path
    async function _walk(cid, folderTitle, depth) {
      if (depth > 8) return { chapters: [], danglingDocs: [] };
      const r = await _listDir(cid);
      if (!r || !r.success) {
        console.log('[115Picker] _listDir FAILED cid=' + cid + ' err=' + (r && r.error));
        return { chapters: [], danglingDocs: [] };
      }
      const dirs = (r.items || []).filter(i => i.isDir);
      const videoFiles = (r.items || []).filter(i => !i.isDir && VIDEO_EXT.test(i.name || ''));
      const docFiles = (r.items || []).filter(i => !i.isDir && String(i.name || '').trim() && !VIDEO_EXT.test(i.name || ''));
      console.log('[115Picker] cid=' + cid + ' dirs=' + dirs.length + ' videoFiles=' + videoFiles.length + ' docs=' + docFiles.length);
      const lessons = videoFiles.map(f => ({
        title: f.name.replace(/\.[^.]+$/, ''),
        fileName: f.name,
        pickCode: f.pickCode,
        cid: f.cid,
        duration: '',
      }));
      const localDocs = docFiles.map(f => ({
        name: f.name,
        path: (folderTitle ? folderTitle + '/' : '') + f.name,
        sectionTitle: '',
        kind: 'p115',
        cfgId: String(cfgId || ''),
        pickCode: f.pickCode || '',
        cid: f.cid || '',
        url: '',
      }));
      let chapters = [];
      let danglingDocs = [];
      for (const d of dirs) {
        const sub = await _walk(d.cid, (folderTitle ? folderTitle + '/' : '') + d.name, depth + 1);
        chapters.push(...sub.chapters);
        danglingDocs.push(...sub.danglingDocs);
      }
      if (lessons.length > 0) {
        chapters.unshift({ title: folderTitle || (cid === ROOT ? (folderName || '主目录') : ''), lessons, pdfs: [...localDocs, ...danglingDocs] });
      } else {
        danglingDocs = [...localDocs, ...danglingDocs];
      }
      return { chapters, danglingDocs };
    }

    try {
      const result = await _walk(ROOT, folderName || '', 0);
      const chapters = result.chapters;
      if (result.danglingDocs.length > 0 && chapters.length === 0) {
        chapters.push({ title: folderName || (ROOT === '0' ? '115网盘' : ''), lessons: [], pdfs: result.danglingDocs });
      }
      const chCount = chapters.length;
      const lsCount = chapters.reduce((s, c) => s + ((c.lessons && c.lessons.length) || 0), 0);
      const pdfCount = chapters.reduce((s, c) => s + ((c.pdfs && c.pdfs.length) || 0), 0);
      console.log('[115Picker] scan DONE chapters=' + chCount + ' lessons=' + lsCount + ' pdfs=' + pdfCount);
      for (let i = 0; i < chapters.length; i++) {
        console.log('[115Picker] chapter[' + i + '] title="' + chapters[i].title + '" lessons=' + ((chapters[i].lessons || []).length));
      }
      return { success: true, data: { chapters, title: folderName || (ROOT === '0' ? '115网盘' : '') } };
    } catch (e) {
      console.log('[115Picker] scan ERROR: ' + (e.message || e));
      return { success: false, error: e.message || String(e) };
    }
  });

  // ===== 临时文件清理：应用退出时删除 courseclient-115 目录下载/转档产物 =====
  function _clean115Temp() {
    const destDir = path.join(os.tmpdir(), 'courseclient-115');
    try {
      if (!fs.existsSync(destDir)) return;
      console.log('[115清理] 删除临时目录 ' + destDir);
      fs.rmSync(destDir, { recursive: true, force: true });
    } catch (e) {
      console.warn('[115清理] 清理临时目录失败: ' + (e && e.message));
    }
  }

  // 退出钩子：仅注册一次
  if (!global.__p115TempCleanupRegistered__) {
    global.__p115TempCleanupRegistered__ = true;
    try {
      const { app } = require('electron');
      if (app) app.on('will-quit', () => { try { _clean115Temp(); } catch (_) {} });
    } catch (_) {}
    process.on('exit', () => { try { _clean115Temp(); } catch (_) {} });
  }
}

module.exports = { register };