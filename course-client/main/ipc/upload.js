// ===== IPC 处理器：上传视频 + 上传配置 + Token 管理 =====
const { ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const uploadConfigMod = require('../../database/upload-config');
const { getMediaProxyPort } = require('../media-proxy');

const MIME_MAP = {
  '.mp4':'video/mp4','.m4v':'video/x-m4v','.mov':'video/quicktime',
  '.avi':'video/x-msvideo','.mkv':'video/x-matroska','.webm':'video/webm',
  '.flv':'video/x-flv','.wmv':'video/x-ms-wmv','.3gp':'video/3gpp',
  '.ts':'video/MP2T','.rmvb':'application/vnd.rn-realmedia-vbr',
  '.mp3':'audio/mpeg','.wav':'audio/wav','.aac':'audio/aac',
  '.flac':'audio/flac','.m4a':'audio/mp4','.ogg':'audio/ogg'
};

function _guessMime(fileName) {
  const ext = path.extname(fileName).toLowerCase();
  return MIME_MAP[ext] || 'application/octet-stream';
}

function register() {
  ipcMain.handle('upload-video-file', async (event, localPath, token, baseURL) => {
    try {
      if (!localPath || !fs.existsSync(localPath)) return { success: false, error: '文件不存在' };
      if (!token) return { success: false, error: 'Token 未配置，请先在 📤 上传配置 中填写上传 Token' };

      const WEB = (baseURL && /^https?:\/\//i.test(baseURL)) ? baseURL : 'https://dev-mac.eyesnews.cn';
      const uploadPath = '/api/admin/mediaFile/uploadMediaFile';
      const fullURL = WEB.replace(/\/+$/, '') + uploadPath;
      const fileName = path.basename(localPath);
      const { size } = fs.statSync(localPath);
      const mime = _guessMime(fileName);
      console.log('[上传] 开始 → url=%s 文件=%s 大小=%sMB token前12位=%s',
        fullURL, fileName, (size / 1024 / 1024).toFixed(2), token.slice(0, 12));
      const sendProgress = (stage, info = {}) => {
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

      return new Promise((resolve) => {
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
      });
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
}

module.exports = { register };