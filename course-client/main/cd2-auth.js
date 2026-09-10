// ===== 注册 webRequest 拦截器，为 CloudDrive2 文件请求动态添加认证头 =====
const { app, session } = require('electron');
const path = require('path');
const fs = require('fs');
const configMod = require('../database/config');

function registerCd2AuthInterceptor() {
  let _cachedAuthMap = null;
  let _courseAuthMapCache = null;
  let _courseAuthPath = null;
  let _courseAuthFileMtime = -1;
  const AUTH_LOG_LIMIT = new Set();

  function buildCourseAuthMapFast() {
    try {
      if (_courseAuthPath === null) {
        const candidates = [];
        try {
          if (app && app.isPackaged && typeof app.getPath === 'function') {
            candidates.push(path.join(app.getPath('userData'), 'courses_data.json'));
          }
        } catch (_) {}
        candidates.push(path.join(__dirname, '..', 'database', 'courses_data.json'));
        try {
          if (typeof process !== 'undefined' && process.resourcesPath) {
            candidates.push(path.join(process.resourcesPath, 'courses_data.json'));
          }
        } catch (_) {}
        for (const p of candidates) {
          try { if (fs.existsSync(p)) { _courseAuthPath = p; break; } } catch (_) {}
        }
        if (_courseAuthPath === null) _courseAuthPath = '';
      }
      if (!_courseAuthPath) return new Map();
      let mtime = -1;
      try { mtime = fs.statSync(_courseAuthPath).mtimeMs || -1; } catch (_) {}
      if (_courseAuthMapCache && mtime === _courseAuthFileMtime) return _courseAuthMapCache;
      const authMap = new Map();
      try {
        const raw = JSON.parse(fs.readFileSync(_courseAuthPath, 'utf-8'));
        const courses = raw.courses || [];
        for (const c of courses) {
          const domain = (c.domain || '').trim();
          const token = (c.token || '').trim();
          if (!domain || !token) continue;
          let host = domain.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
          if (!host.includes(':')) host += ':19798';
          if (!authMap.has(host)) authMap.set(host, token);
        }
      } catch (e) {
        console.error('[auth] 读取课程认证信息失败:', e.message);
      }
      _courseAuthFileMtime = mtime;
      _courseAuthMapCache = authMap;
      return authMap;
    } catch (_) { return new Map(); }
  }

  function buildAuthMapFast(forceRebuild) {
    if (_cachedAuthMap && !forceRebuild) return _cachedAuthMap;
    const authMap = new Map();
    try {
      const sources = configMod.allSources();
      if (sources && sources.length > 0) {
        for (const s of sources) {
          if (s.enabled === false) continue;
          const cfg = s.config || {};
          const endpoint = cfg.endpoint || s.endpoint || '127.0.0.1:19798';
          const token = cfg.token || s.token || '';
          if (!token) continue;
          let host = endpoint.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
          if (!host.includes(':')) host += ':19798';
          authMap.set(host, token);
        }
      }
    } catch (_) {}
    try {
      const courseAuth = buildCourseAuthMapFast();
      for (const [host, token] of courseAuth) {
        if (!authMap.has(host)) authMap.set(host, token);
      }
    } catch (_) {}
    _cachedAuthMap = authMap;
    return authMap;
  }
  try { global.__invalidateAuthCache = () => { _cachedAuthMap = null; }; } catch (_) {}

  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    let headers = details.requestHeaders;
    try {
      const url = new URL(details.url);
      const hostPort = url.host;
      const authMap = buildAuthMapFast(false);
      if (authMap.has(hostPort)) {
        headers = Object.assign({}, headers, { 'Authorization': 'Bearer ' + authMap.get(hostPort) });
        if (!AUTH_LOG_LIMIT.has(hostPort)) {
          AUTH_LOG_LIMIT.add(hostPort);
          console.log('[auth] 为 %s 添加认证头', hostPort);
        }
      }
    } catch (_) {}
    callback({ requestHeaders: headers });
  });

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    try {
      const url = new URL(details.url);
      const hostPort = url.host;
      const authMap = buildAuthMapFast(false);
      const isMedia = /\.(mp4|mkv|mov|avi|flv|wmv|m4v|webm|ts|mp3|wav|flac|aac|ogg|pdf|jpg|jpeg|png|webp)$/i.test(url.pathname);
      if (authMap.has(hostPort) || isMedia) {
        const responseHeaders = Object.assign({}, details.responseHeaders, {
          'Access-Control-Allow-Origin': ['*'],
          'Access-Control-Allow-Methods': ['GET, HEAD, OPTIONS, POST'],
          'Access-Control-Allow-Headers': ['Authorization, Range, Content-Type'],
          'Access-Control-Expose-Headers': ['Content-Length, Content-Range, Accept-Ranges, Cache-Control'],
          'Accept-Ranges': ['bytes'],
        });
        if (isMedia) {
          responseHeaders['Cache-Control'] = ['public, max-age=604800, immutable'];
          delete responseHeaders['Vary'];
          responseHeaders['X-Cache-Hint'] = ['prefer-disk-cache'];
        }
        callback({ responseHeaders });
        return;
      }
    } catch (_) {}
    callback({ responseHeaders: details.responseHeaders });
  });

  console.log('[auth] CD2 请求拦截器已注册（含 CORS 头注入）');
}

module.exports = { registerCd2AuthInterceptor };