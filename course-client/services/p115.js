// ============================================================
//  115 网盘直连服务 — 扫码登录（开放平台 token） + 目录浏览
// ============================================================
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// access_token 有效期（秒），官方默认 7200
const ACCESS_TOKEN_TTL = 7200;
// refresh_token 有效期（秒），官方 1 年
const REFRESH_TOKEN_TTL = 365 * 24 * 3600;

// 刷新接口终态错误码：用同一个 refresh_token 重试永远不会成功，必须停止重试并引导重新授权
const FROZEN_CODES = new Set([40140116, 40140119, 40140120, 40140137]);
// 收到这些码时不应使用原 access_token 重试，应先读取最新凭证或刷新
const AUTH_INVALID_CODES = new Set([40140125, 40140126]);

function normalizeCode(raw) {
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

function isFrozenCode(code) {
  return FROZEN_CODES.has(normalizeCode(code));
}

function isAuthInvalidCode(code) {
  return AUTH_INVALID_CODES.has(normalizeCode(code));
}

/**
 * 判断响应体是否为"未授权时返回的 HTML 登录/提示页"。
 * access_token 失效时，115 会返回 HTML 页面而非 JSON。
 * 输入: body (原始响应字符串)
 * 输出: boolean
 */
function isHtmlAuthPage(body) {
  if (!body || typeof body !== 'string') return false;
  const head = body.slice(0, 3000).toLowerCase();
  // JSON API 返回 HTML 说明会话/凭证已失效（登录页、风控、验证码等）
  // 不再用关键词白名单过滤——只要是 HTML 就触发 token 自动刷新
  return head.includes('<!doctype html') ||
    head.includes('<html') ||
    head.includes('<!doctypehtml');
}

/**
 * 统一归类 115 开放平台错误响应。
 * 输入: data (原始 JSON 对象) | rawErrMsg (兜底字符串)
 * 输出: { code, errMsg, tokenExpired, authInvalid, frozen }
 */
function classifyError(data, rawErrMsg) {
  const code = normalizeCode(data && (data.code ?? data.errno ?? data.error_code));
  const errMsg = (data && (data.message || data.error || data.errmsg)) || rawErrMsg || `请求失败（code=${code}）`;
  const tokenExpired =
    (data && data.state === false) ||
    /token|401|未授权|已失效|expired|重新登录/i.test(errMsg);
  return {
    code,
    errMsg,
    tokenExpired,
    authInvalid: isAuthInvalidCode(code),
    frozen: isFrozenCode(code),
  };
}

function _defaultHeaders() {
  return {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/javascript, */*; q=0.01',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'sec-ch-ua': '"Not=A?Brand";v="99", "Google Chrome";v="151", "Chromium";v="151"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin',
  };
}

// 简单的 HTTP 请求封装
function _request(url, opts = {}, postData = null) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const isHttps = u.protocol === 'https:';
    const mod = isHttps ? https : http;

    const headers = Object.assign(_defaultHeaders(), opts.headers || {});

    const options = {
      hostname: u.hostname,
      port: u.port || (isHttps ? 443 : 80),
      path: u.pathname + u.search,
      method: opts.method || 'GET',
      headers,
      timeout: 15000,
    };
    if (postData) {
      options.headers['Content-Length'] = Buffer.byteLength(postData);
    }
    const req = mod.request(options, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('请求超时')); });
    if (postData) req.write(postData);
    req.end();
  });
}

// ============================================================
//  获取当前授权用户信息（开放平台接口）
//  调用 GET https://proapi.115.com/open/user/info
//  Header: Authorization: Bearer <ACCESS_TOKEN>
// ============================================================
async function get115UserInfo(accessToken) {
  if (!accessToken) return { success: false, error: '缺少 access_token' };
  try {
    const url = `https://proapi.115.com/open/user/info`;
    const headers = {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
    };
    const res = await _request(url, { headers });
    let data;
    try { data = JSON.parse(res.body); } catch (e) {
      if (isHtmlAuthPage(res.body)) {
        return {
          success: false,
          error: 'access_token 已失效，接口返回登录页',
          code: 0,
          tokenExpired: true,
          authInvalid: true,
          frozen: false,
        };
      }
      return { success: false, error: '响应解析失败: ' + (e && e.message) };
    }
    if (data && data.code === 0 && data.data) {
      const d = data.data;
      return {
        success: true,
        user: {
          user_id: d.user_id || d.uid || d.id || '',
          user_name: d.user_name || d.nickname || d.name || '',
          avatar: d.avatar || d.head_img || '',
          mobile: d.mobile || d.phone || '',
          email: d.email || '',
          vip: d.vip != null ? d.vip : (d.is_vip ? 1 : 0),
          vip_expire_time: d.vip_expire_time || d.vip_end || 0,
          space_total: Number(d.space_total || d.total_space || 0),
          space_used: Number(d.space_used || d.used_space || 0),
        },
        raw: d,
      };
    }
    return { success: false, error: (data && data.message) || `请求失败（code=${data && data.code}, HTTP ${res.status}）` };
  } catch (e) {
    return { success: false, error: e.message || String(e) };
  }
}

// ============================================================
//  基于 access_token 的目录浏览（开放平台接口）
//  GET https://proapi.115.com/open/ufile/files
//  Header: Authorization: Bearer <ACCESS_TOKEN>
// ============================================================
async function list115DirectoryByToken(accessToken, dirId = '0') {
  if (!accessToken) return { success: false, error: '未登录（缺少 access_token）', items: [] };
  const cid = dirId || '0';
  try {
    const url = `https://proapi.115.com/open/ufile/files?cid=${encodeURIComponent(cid)}&o=user_ptime&asc=0&offset=0&limit=1000&show_dir=1`;
    const headers = {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/json, text/plain, */*',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
    };
    const res = await _request(url, { headers });

    let data = null;
    try { data = JSON.parse(res.body); } catch (e) {
      // access_token 失效时 115 会返回 HTML 登录页而非 JSON，需标记为鉴权失效以便自动刷新
      if (isHtmlAuthPage(res.body)) {
        return {
          success: false,
          error: 'access_token 已失效，接口返回登录页',
          code: 0,
          tokenExpired: true,
          authInvalid: true,
          frozen: false,
          items: [],
        };
      }
      return { success: false, error: 'JSON解析失败: ' + e.message, items: [] };
    }

    if (data && data.state === false) {
      const cls = classifyError(data);
      return {
        success: false,
        error: cls.errMsg,
        code: cls.code,
        tokenExpired: cls.tokenExpired,
        authInvalid: cls.authInvalid,
        frozen: cls.frozen,
        items: [],
      };
    }

    if (data && data.code !== 0 && data.state !== true) {
      const cls = classifyError(data);
      return {
        success: false,
        error: cls.errMsg,
        code: cls.code,
        tokenExpired: cls.tokenExpired,
        authInvalid: cls.authInvalid,
        frozen: cls.frozen,
        items: [],
      };
    }

    const arr = (data && Array.isArray(data.data)) ? data.data : [];
    const items = [];

    for (const f of arr) {
      // SDK 短字段: fc=分类(0文件夹/1文件), fn=文件名, cid, pc=提取码, sha1, fs=大小
      const isDir = String(f.fc) === '0';
      if (isDir) {
        items.push({
          name: f.fn || f.name || '未命名文件夹',
          isDir: true,
          cid: String(f.cid || f.id || f.fid || ''),
        });
      } else {
        items.push({
          name: f.fn || f.name || '未命名文件',
          isDir: false,
          size: Number(f.fs || f.size || 0),
          sha: f.sha1 || f.sha || '',
          cid: String(f.cid || f.id || f.fid || ''),
          pickCode: f.pc || f.pick_code || f.pickcode || f.pickCode || '',
        });
      }
    }

    // 按名称排序：文件夹在前，文件在后
    items.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return (a.name || '').localeCompare(b.name || '', 'zh');
    });

    return { success: true, items };
  } catch (e) {
    return { success: false, error: e.message || String(e), items: [] };
  }
}

// ============================================================
//  新建文件夹（开放平台接口）
//  POST https://proapi.115.com/open/folder/add
//  form: pid=<父目录id>&filename=<文件夹名>
//  Header: Authorization: Bearer <ACCESS_TOKEN>
// ============================================================
async function create115Folder(accessToken, parentId, folderName) {
  if (!accessToken) return { success: false, error: '未登录（缺少 access_token）' };
  if (!folderName) return { success: false, error: '缺少文件夹名称' };
  const pid = parentId || '0';
  try {
    const url = 'https://proapi.115.com/open/folder/add';
    const boundary = '----WebKitFormBoundary' + Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2);
    const fields = { pid, file_name: folderName };
    const body = _buildMultipart(fields, boundary);
    const headers = {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/json, text/plain, */*',
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Origin': 'https://115.com',
      'Referer': 'https://115.com/',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
    };
    console.log('[p115-create-folder] POST', url, 'body=', fields);
    const res = await _request(url, { headers, method: 'POST' }, body);
    console.log('[p115-create-folder] HTTP', res.status, 'body=', (res.body || '').slice(0, 1000));

    let data;
    try { data = JSON.parse(res.body); } catch (e) {
      if (isHtmlAuthPage(res.body)) {
        return {
          success: false,
          error: 'access_token 已失效，接口返回登录页',
          code: 0,
          tokenExpired: true,
          authInvalid: true,
          frozen: false,
        };
      }
      return { success: false, error: '响应解析失败: ' + (e && e.message) };
    }

    if (data && data.state === true && (data.data || data.code === 0)) {
      const d = data.data || {};
      return {
        success: true,
        cid: String(d.file_id || d.cid || d.id || ''),
        name: d.file_name || d.name || folderName,
        raw: d,
      };
    }
    // 错误码归类
    const cls = classifyError(data);
    return {
      success: false,
      error: cls.errMsg,
      code: cls.code,
      tokenExpired: cls.tokenExpired,
      authInvalid: cls.authInvalid,
      frozen: cls.frozen,
    };
  } catch (e) {
    return { success: false, error: e.message || String(e) };
  }
}

// ============================================================
//  上传文件到指定目录（开放平台 /upload/init 协议）
//  流程：计算 SHA1/preid → 调用 /upload/init 做秒传判定
//   - status=2 秒传成功，返回 data.file_id
//   - code 700/701/702  需二次认证：按 sign_check 计算大写 SHA1 重试
//   - status=1 非秒传：按 data.endpoint+data.object 做对象存储直传
// ============================================================
const UPLOAD_INIT_URL = 'https://proapi.115.com/open/upload/init';

// 整文件 SHA1
function _computeFileSha1(filePath, rangeStart = 0, rangeEnd = Infinity) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha1');
    const opts = {};
    if (rangeStart > 0 || Number.isFinite(rangeEnd)) {
      if (rangeStart > 0) opts.start = rangeStart;
      if (Number.isFinite(rangeEnd)) opts.end = rangeEnd;
    }
    const stream = fs.createReadStream(filePath, opts);
    stream.on('data', (c) => hash.update(c));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

// 计算文件指定字节范围 [start,end]（含起止）内容的 SHA1（转大写）
async function _computeRangeSha1(filePath, range) {
  if (!range) return '';
  const m = /^\s*(\d+)\s*-\s*(\d+)\s*$/.exec(String(range));
  if (!m) return '';
  const start = parseInt(m[1], 10);
  const end = parseInt(m[2], 10);
  return (await _computeFileSha1(filePath, start, end)).toUpperCase();
}

// 前 128 KiB 内容的 SHA1（preid 字段）
async function _computePreidSha1(filePath) {
  try {
    return await _computeFileSha1(filePath, 0, 128 * 1024 - 1);
  } catch (e) {
    return '';
  }
}

// 构造 multipart/form-data 请求体
function _buildMultipart(fields, boundary) {
  const chunks = [];
  const CRLF = '\r\n';
  for (const key of Object.keys(fields)) {
    const val = String(fields[key] == null ? '' : fields[key]);
    chunks.push(Buffer.from(`--${boundary}${CRLF}`));
    chunks.push(Buffer.from(`Content-Disposition: form-data; name="${key}"${CRLF}${CRLF}`));
    chunks.push(Buffer.from(val, 'utf8'));
    chunks.push(Buffer.from(`${CRLF}`));
  }
  chunks.push(Buffer.from(`--${boundary}--${CRLF}`));
  return Buffer.concat(chunks);
}

// 调用 /upload/init
async function _postUploadInit(accessToken, fields) {
  const boundary = '----WebKitFormBoundary' + Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2);
  const body = _buildMultipart(fields, boundary);
  const headers = {
    'Authorization': `Bearer ${accessToken}`,
    'Accept': 'application/json, text/plain, */*',
    'Content-Type': `multipart/form-data; boundary=${boundary}`,
    'Origin': 'https://115.com',
    'Referer': 'https://115.com/',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
  };
  const res = await _request(UPLOAD_INIT_URL, { headers, method: 'POST' }, body);
  let data = null;
  try { data = JSON.parse(res.body); } catch (e) { data = null; }
  return { data, httpStatus: res.status };
}

// 获取对象存储临时上传凭证（开放平台接口）
// GET https://proapi.115.com/open/upload/get_token
const UPLOAD_GET_TOKEN_URL = 'https://proapi.115.com/open/upload/get_token';
// 凭证可复用到 Expiration；做短时缓存减少对配额接口的无效请求
let _uploadTokenCache = null;

async function _getUploadToken(accessToken) {
  if (!accessToken) return { success: false, error: '缺少 access_token' };
  // 缓存命中且未过期则复用，避免每次重试都刷一次配额
  if (_uploadTokenCache && _uploadTokenCache.accessToken === accessToken &&
      _uploadTokenCache.expiresAt > Date.now() + 60 * 1000) {
    const c = _uploadTokenCache;
    return {
      success: true,
      cached: true,
      endpoint: c.endpoint,
      accessKeyId: c.accessKeyId,
      accessKeySecret: c.accessKeySecret,
      securityToken: c.securityToken,
      expiration: c.expiration,
      transferConfig: c.transferConfig,
    };
  }
  try {
    const headers = {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/json, text/plain, */*',
      'Origin': 'https://115.com',
      'Referer': 'https://115.com/',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
    };
    const res = await _request(UPLOAD_GET_TOKEN_URL + '?upload_v2=1', { headers });
    console.log('[p115-upload][step:get_token] HTTP', res.status, 'bodyHead=', ((res.body || '').slice(0, 300)));
    let data = null;
    try { data = JSON.parse(res.body); } catch (e) { data = null; }
    if (!data || (data.state !== true && data.code !== 0) || !data.data) {
      const cls = classifyError(data, `获取上传凭证失败（HTTP ${res.status}）`);
      console.log('[p115-upload][step:get_token] FAIL code=', cls.code, 'msg=', cls.errMsg);
      return {
        success: false,
        error: cls.errMsg,
        code: cls.code,
        tokenExpired: cls.tokenExpired,
        authInvalid: cls.authInvalid,
        frozen: cls.frozen,
      };
    }
    const d = data.data;
    console.log('[p115-upload][step:get_token] OK endpoint=', d.endpoint, 'hasAKId=', !!(d.AccessKeyId || d.access_key_id),
      'hasAKSecret=', !!(d.AccessKeySecret || d.access_key_secret), 'hasSt=', !!(d.SecurityToken || d.security_token),
      'expiration=', d.Expiration, 'transfer_config=', JSON.stringify(d.transfer_config || null));
    // 记录缓存：Expiration 为凭证过期时间，提前 60s 作废
    const expiresAt = d.Expiration ? new Date(d.Expiration).getTime() : Date.now() + 15 * 60 * 1000;
    const entry = {
      accessToken,
      endpoint: d.endpoint || '',
      accessKeyId: d.AccessKeyId || d.access_key_id || '',
      accessKeySecret: d.AccessKeySecret || d.access_key_secret || '',
      securityToken: d.SecurityToken || d.security_token || '',
      expiration: d.Expiration || '',
      transferConfig: d.transfer_config || null,
      expiresAt: Number.isFinite(expiresAt) ? expiresAt : Date.now() + 15 * 60 * 1000,
    };
    _uploadTokenCache = entry;
    return {
      success: true,
      cached: false,
      endpoint: entry.endpoint,
      accessKeyId: entry.accessKeyId,
      accessKeySecret: entry.accessKeySecret,
      securityToken: entry.securityToken,
      expiration: entry.expiration,
      transferConfig: entry.transferConfig,
    };
  } catch (e) {
    return { success: false, error: e.message || String(e) };
  }
}

// 阿里云 OSS PutObject 授权头（STS 临时凭证）
// extraOssHeaders: { 'x-oss-callback': '...', 'x-oss-callback-var': '...' } 需参与签名
function _ossAuthHeader(resource, method, contentType, accessKeyId, accessKeySecret, securityToken, extraOssHeaders) {
  // 参考阿里云 OSS 签名：StringToSign = VERB + "\n" + Content-MD5 + "\n" + Content-Type + "\n" + Date + "\n" + CanonicalizedOSSHeaders + CanonicalizedResource
  const date = new Date().toUTCString();
  const md5 = ''; // 未使用 Content-MD5
  const heads = {};
  if (securityToken) heads['x-oss-security-token'] = securityToken;
  if (extraOssHeaders) Object.assign(heads, extraOssHeaders);
  // CanonicalizedOSSHeaders：所有 x-oss- 开头的头，小写，按名排序，格式 name:value\n
  const sorted = Object.keys(heads).sort();
  let ossHeaders = '';
  for (const k of sorted) {
    const nk = k.toLowerCase();
    if (!nk.startsWith('x-oss-')) continue;
    ossHeaders += `${nk}:${String(heads[k]).trim()}\n`;
  }
  const stringToSign = [
    method,
    md5,
    contentType,
    date,
    ossHeaders + resource,
  ].join('\n');
  const signature = crypto.createHmac('sha1', accessKeySecret).update(stringToSign, 'utf8').digest('base64');
  const auth = `OSS ${accessKeyId}:${signature}`;
  return Object.assign({ Authorization: auth, Date: date }, heads, { 'x-oss-security-token': securityToken || undefined });
}

// 非秒传：按 endpoint + object 直传文件内容（阿里云 OSS PutObject）
// callbackObj: { callback: '<json>', callback_var: '<json>' }
function _putObject(endpoint, object, filePath, oss, bucket, callbackObj) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(endpoint); }
    catch (e) { return reject(new Error('非法上传端点：' + endpoint)); }
    // 区分两种访问风格（决定 CanonicalizedResource）：
    // 1) 自定义域名（如 https://up-file.115.com，115 原生返回，已绑定 bucket）→ 虚拟主机风格，resource=/<object>
    // 2) 阿里云区域裸域名（如 https://oss-cn-shenzhen.aliyuncs.com）→ 请求 host 补 bucket 前缀，
    //    但 CanonicalizedResource 仍为 /<bucket>/<object>（OSS 签名要求）
    const isRegionEndpoint = /\.aliyuncs\.com$/i.test(u.hostname) &&
      !u.hostname.toLowerCase().startsWith((bucket || '').toLowerCase() + '.');
    const objKey = object.startsWith('/') ? object : '/' + object;
    let signResource;
    if (bucket && isRegionEndpoint) {
      // 阿里云区域裸域名使用虚拟主机风格（bucket 放进 host 的三级域名）：
      // https://<bucket>.oss-cn-<region>.aliyuncs.com/<object>
      // 因为 oss-cn-<region>.aliyuncs.com 是二级域名，路径风格访问会被
      // SecondLevelDomainForbidden 拒绝，必须用带 bucket 的三级域名。
      u.hostname = bucket + '.' + u.hostname;
      u.pathname = objKey;
      signResource = '/' + bucket + objKey;
    } else {
      // 虚拟主机/自定义域名风格：https://<host>/<object>
      u.pathname = objKey;
      signResource = u.pathname;
    }
    console.log('[p115-upload] putObject url=', u.href, 'pathname=', u.pathname, 'signResource=', signResource);
    const isHttps = u.protocol === 'https:';
    const mod = isHttps ? https : http;
    const fstat = fs.statSync(filePath);
    const contentType = 'application/octet-stream';
    // 上传完成回调（阿里云 OSS 要求 x-oss-callback / x-oss-callback-var 做 Base64 编码）
    const extraOssHeaders = {};
    if (typeof callbackObj === 'object' && callbackObj) {
      if (callbackObj.callback) extraOssHeaders['x-oss-callback'] = Buffer.from(callbackObj.callback, 'utf8').toString('base64');
      if (callbackObj.callback_var) extraOssHeaders['x-oss-callback-var'] = Buffer.from(callbackObj.callback_var, 'utf8').toString('base64');
    }

    let headers = {
      'Content-Length': fstat.size,
      'Content-Type': contentType,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
    };
    // 若提供了 OSS 临时凭证，则附加签名
    if (oss && oss.AccessKeyId && oss.AccessKeySecret) {
      const sig = _ossAuthHeader(
        signResource,
        'PUT',
        contentType,
        oss.AccessKeyId,
        oss.AccessKeySecret,
        oss.SecurityToken,
        Object.keys(extraOssHeaders).length ? extraOssHeaders : null
      );
      headers = Object.assign(headers, sig, extraOssHeaders);
      console.log('[p115-upload][step:sign] method=PUT path=', u.pathname, 'contentType=', contentType,
        'AKId=', oss.AccessKeyId ? (String(oss.AccessKeyId).slice(0, 6) + '***') : '(空)',
        'AKSecretLen=', oss.AccessKeySecret ? String(oss.AccessKeySecret).length : 0,
        'hasSt=', !!(oss.SecurityToken),
        'callbackHeader=', Object.keys(extraOssHeaders).length ? 'yes' : 'no',
        'auth=', String(sig.Authorization || '').slice(0, 40) + '...');
    } else {
      console.log('[p115-upload][step:sign] 未提供 OSS 临时凭证，请求不带签名（直传模式）');
    }

    const req = mod.request({
      hostname: u.hostname,
      port: u.port || (isHttps ? 443 : 80),
      path: u.pathname + u.search,
      method: 'PUT',
      headers,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        let data = null;
        try { data = JSON.parse(body); } catch (e) { data = null; }
        if (!data && body) data = { rawBody: body.slice(0, 2000) }; // OSS 错误响应常为 XML
        console.log('[p115-upload] putObject end', 'statusCode=', res.statusCode, 'data=', JSON.stringify(data));
        resolve({ httpStatus: res.statusCode, data });
      });
      res.on('error', (e) => { console.log('[p115-upload] putObject res error', e && e.message); reject(e); });
    });
    req.on('error', (e) => { console.log('[p115-upload] putObject req error', e && e.message); reject(e); });
    fs.createReadStream(filePath).pipe(req);
  });
}

async function upload115File(accessToken, dirId, filePath, fileName) {
  if (!accessToken) return { success: false, error: '未登录（缺少 access_token）' };
  if (!filePath) return { success: false, error: '缺少本地文件路径' };
  const name = fileName || path.basename(filePath);
  const target = `U_1_${String(dirId || '0')}`;
  try {
    let fstat;
    try {
      fstat = fs.statSync(filePath);
    } catch (e) {
      return { success: false, error: '无法读取本地文件：' + (e && e.message) };
    }
    if (!fstat.isFile()) return { success: false, error: '所选内容不是文件' };
    const fileSize = fstat.size;

    const fileid = await _computeFileSha1(filePath);
    const preid = await _computePreidSha1(filePath);

    let extra = {}; // 二次认证附加字段 sign_key/sign_val
    // 最多重试 3 轮（处理二次认证）
    for (let round = 0; round < 4; round++) {
      const fields = {
        file_name: name,
        file_size: String(fileSize),
        target,
        fileid,
        topupload: '0',
        upload_v2: '1',
      };
      if (preid) fields.preid = preid;
      Object.assign(fields, extra);

      const { data, httpStatus } = await _postUploadInit(accessToken, fields);
      if (!data) return { success: false, error: `上传初始化响应解析失败（HTTP ${httpStatus}）` };

      // 二次认证：按 sign_check 计算签名后带 sign_key/sign_val 重试
      const code = normalizeCode(data.code);
      if ([700, 701, 702].includes(code) && data.data && data.data.sign_check) {
        const signVal = await _computeRangeSha1(filePath, data.data.sign_check);
        extra = { sign_key: data.data.sign_key || '', sign_val: signVal };
        continue;
      }

      if (data.state !== true && data.code !== 0) {
        const cls = classifyError(data);
        return {
          success: false,
          error: cls.errMsg,
          code: cls.code,
          tokenExpired: cls.tokenExpired,
          authInvalid: cls.authInvalid,
          frozen: cls.frozen,
        };
      }

      const d = data.data || {};
      const status = Number(d.status);

      // 秒传成功
      if (status === 2) {
        return {
          success: true,
          file_id: String(d.file_id || ''),
          file_name: name,
          rapid: true,
          raw: d,
        };
      }

      // 非秒传：需要 object + endpoint；endpoint 以 get_token 返回的正确域名为准
      if (status === 1) {
        const endpoint = d.endpoint || '';
        const object = d.object || '';
        if (!object) {
          return {
            success: false,
            error: `上传初始化未返回对象存储上传对象（object）。原始返回：${JSON.stringify(d).slice(0, 400)}`,
            code: normalizeCode(d.code),
            rapidHit: false,
          };
        }
        // 获取 OSS 临时上传凭证
        const token = await _getUploadToken(accessToken);
        if (!token.success) {
          console.log('[p115-upload][step:get_token] 调用后失败：', token.error);
          if (token.tokenExpired) return { success: false, tokenExpired: true, error: token.error, rapidHit: false };
          return { success: false, error: '获取上传凭证失败：' + token.error, rapidHit: false };
        }
        console.log('[p115-upload][step:get_token] 返回值', {
          cached: token.cached || false,
          endpoint: token.endpoint,
          expiration: token.expiration,
          hasAKId: !!token.accessKeyId,
          hasAKSecret: !!token.accessKeySecret,
          hasSt: !!token.securityToken,
          AccessKeyId: token.accessKeyId ? (String(token.accessKeyId).slice(0, 6) + '***') : '',
        });
        // 上传域名优先用初始化响应返回的 endpoint（与 bucket 绑定）；否则用凭证返回的 endpoint
        const finalEndpoint = (endpoint && /\S/.test(endpoint)) ? endpoint : token.endpoint;
        if (!finalEndpoint) {
          return { success: false, error: '未获取到对象存储上传地址（endpoint）', rapidHit: false };
        }
        const oss = {
          AccessKeyId: token.accessKeyId,
          AccessKeySecret: token.accessKeySecret,
          SecurityToken: token.securityToken,
        };
        console.log('[p115-upload] init d=', JSON.stringify(d), 'finalEndpoint=', finalEndpoint, 'object=', object, 'bucket=', d.bucket, 'token=', { akId: !!oss.AccessKeyId, akSecret: !!oss.AccessKeySecret, st: !!oss.SecurityToken });
        const upRes = await _putObject(finalEndpoint, object, filePath, oss, d.bucket, d.callback);
        if (upRes.httpStatus >= 200 && upRes.httpStatus < 300) {
          return {
            success: true,
            file_id: String((upRes.data && (upRes.data.file_id || upRes.data.id)) || ''),
            file_name: name,
            rapid: false,
            httpStatus: upRes.httpStatus,
            raw: upRes.data,
          };
        }
        const upResRaw = (() => { try { return JSON.stringify(upRes && upRes.data); } catch (e) { return String(e); } })();
        const upBody = (upRes && upRes.data && upRes.data.rawBody) || '';
        const diag = `[init=${JSON.stringify(d)} | ep=${finalEndpoint} | object=${object} | bucket=${d.bucket}]`;
        const upMsg = (upRes && upRes.data && (upRes.data.message || upRes.data.error || upRes.data.Code)) || (upBody || `对象上传失败（HTTP ${upRes && upRes.httpStatus}, raw=${upResRaw}）`);
        return {
          success: false,
          error: diag + '\n' + upMsg,
          tokenExpired: /401|token/i.test(upMsg),
          rapidHit: false,
          httpStatus: upRes && upRes.httpStatus,
        };
      }

      return { success: false, error: `上传初始化返回未知状态（status=${status}）`, code: normalizeCode(data.code), rapidHit: true };
    }

    return { success: false, error: '二次认证签名重试次数过多，请重试' };
  } catch (e) {
    return { success: false, error: e.message || String(e) };
  }
}

// ============================================================
//  刷新 access_token（开放平台接口）
//  POST https://passportapi.115.com/open/refreshToken
//  form: refresh_token
// ============================================================
async function refresh115Token(refreshToken) {
  if (!refreshToken) return { success: false, error: '缺少 refresh_token' };
  try {
    const url = 'https://passportapi.115.com/open/refreshToken';
    const headers = {
      'Accept': 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
    };
    console.log('[115刷新] 请求 refresh_token=' + refreshToken + ' len=' + refreshToken.length);
    const body = `refresh_token=${encodeURIComponent(refreshToken)}`;
    const res = await _request(url, { headers, method: 'POST' }, body);

    console.log('[115刷新] HTTP', res.status, 'body=', res.body.slice(0, 500));
    let data;
    try { data = JSON.parse(res.body); } catch (e) {
      return { success: false, error: '响应解析失败: ' + (e && e.message) + ' 原始: ' + res.body.slice(0, 200) };
    }
    if (res.status !== 200) {
      return { success: false, error: 'HTTP ' + res.status + ' 非200', httpStatus: res.status, body: res.body.slice(0, 300) };
    }
    if (data && data.code === 0 && data.data) {
      const d = data.data;
      console.log('[115刷新] 成功 ✓' +
        '\n  access_token=' + (d.access_token || '(无)') +
        '\n  expires_in=' + (d.expires_in || 'N/A') +
        '\n  新 refresh_token=' + (d.refresh_token || '(未返回)'));
      const refreshExpiresIn = Number(d.refresh_token_expires_in || d.refreshTokenExpiresIn || 0) || REFRESH_TOKEN_TTL;
      return {
        success: true,
        accessToken: d.access_token,
        refreshToken: d.refresh_token || refreshToken,
        expiresIn: Number(d.expires_in || 0) || ACCESS_TOKEN_TTL,
        refreshTokenExpiresIn: refreshExpiresIn,
      };
    }
    const errCode = normalizeCode(data && (data.code ?? data.errno ?? data.error_code));
    const errMsg = (data && (data.message || data.error || data.errmsg)) || `刷新 token 失败（code=${errCode}）`;
    console.log('[115刷新] 失败 code=' + errCode + ' msg=' + errMsg, '完整=', JSON.stringify(data).slice(0, 300));
    return {
      success: false,
      error: errMsg,
      code: errCode,
      // 仅 FROZEN_CODES 表示 refresh_token 终态失效，其他错误码（限流/服务端繁忙等）是临时故障，允许重试
      frozen: isFrozenCode(errCode),
      authInvalid: AUTH_INVALID_CODES.has(errCode),
    };
  } catch (e) {
    console.log('[115刷新] 异常（网络/超时，非 frozen）:', e && e.message);
    return { success: false, error: e.message || String(e), frozen: false };
  }
}

// ============================================================
//  获取 115 视频播放地址（开放平台接口）
//  GET https://proapi.115.com/open/video/play?pick_code=XXX
//  Header: Authorization: Bearer <ACCESS_TOKEN>
// ============================================================
async function get115VideoUrl(accessToken, pickCode, opts) {
  opts = opts || {};
  const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;
  // 转码慢时自动提交一次 VIP 加速（video_push），缩短等待
  const _autoPushEnabled = !!opts.autoPush;
  let _autoPushSubmitted = false;
  const _autoPushAfterMs = Number(opts.autoPushAfterMs) > 0 ? Number(opts.autoPushAfterMs) : 15000;
  if (!accessToken) return { success: false, error: '未登录（缺少 access_token）' };
  if (!pickCode) return { success: false, error: '缺少 pick_code' };
  const url = `https://proapi.115.com/open/video/play?pick_code=${encodeURIComponent(pickCode)}`;
  const headers = {
    'Authorization': `Bearer ${accessToken}`,
    'Accept': 'application/json, text/plain, */*',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
  };

  const MAX_ATTEMPTS = 90;
  const INTERVAL_MS = 2000;
  let startedAt = 0;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const res = await _request(url, { headers });
      let data;
      try { data = JSON.parse(res.body); } catch (e) {
        // access_token 过期时 115 返回 HTML 登录页而非 JSON → 标记 authInvalid 以触发自动续期
        if (isHtmlAuthPage(res.body)) {
          return { success: false, error: 'access_token 无效（返回登录页）', authInvalid: true, code: 40140125 };
        }
        return { success: false, error: `响应解析失败: ${(e && e.message) || ''} | body: ${res.body.slice(0, 200)}` };
      }

      if (data && data.state === true && data.data) {
        const d = data.data;
        const videoUrlList = d.video_url || [];
        if (!Array.isArray(videoUrlList) || videoUrlList.length === 0) {
          return { success: false, error: '响应中无 video_url 列表', raw: JSON.stringify(d).slice(0, 300) };
        }
        const userDef = d.user_def ?? 100;
        let selected = videoUrlList.find(v => v.definition_n === userDef) || videoUrlList[0];
        if (!selected || !selected.url) {
          selected = videoUrlList.find(v => v && v.url);
        }
        if (selected && selected.url) {
          console.log('[115播放接口] 清晰度列表=', videoUrlList.map(v => ({ def: v.definition_n || v.definition, title: v.title })));
          console.log('[115播放接口] 选中 definition_n=', selected.definition_n, 'url前缀=', selected.url.slice(0, 80));
          return {
            success: true,
            bestUrl: selected.url,
            urls: videoUrlList.map(v => ({ url: v.url, definition: v.title || v.definition, definition_n: v.definition_n })),
            definition: selected.title || selected.definition || '',
          };
        }
        return { success: false, error: '未找到有效的播放地址' };
      }

      const isTranscoding = data && !data.state && data.code !== 0 &&
        (data.data && Object.prototype.hasOwnProperty.call(data.data, 'video_push_state'));
      if (isTranscoding) {
        if (attempt === 0) {
          startedAt = Date.now();
          console.log('[115播放接口] 视频正在转码，等待中... code=', data.code, 'push_state=', data.data && data.data.video_push_state, '完整=', JSON.stringify(data).slice(0, 300));
        }
        const pushState = !!(data.data && data.data.video_push_state);
        const elapsed = attempt * INTERVAL_MS;
        // 转码偏慢时自动提交一次 VIP 加速，缩短等待（仅一次）
        if (_autoPushEnabled && !_autoPushSubmitted && elapsed >= _autoPushAfterMs) {
          _autoPushSubmitted = true;
          console.log('[115播放接口] 转码已等待 ' + Math.round(elapsed / 1000) + 's，自动提交 VIP 转码加速...');
          try {
            const pushRes = await submitVideoPush(accessToken, pickCode, 'vip_push');
            console.log('[115播放接口] 自动加速提交结果: success=' + (pushRes && pushRes.success) + ' err=' + (pushRes && pushRes.error));
            if (onProgress) { try { onProgress({ autoPushed: !!(pushRes && pushRes.success) }); } catch (_) {} }
          } catch (_) {}
        }
        if (onProgress) {
          try { onProgress({ waiting: true, elapsedMs: elapsed, pushState }); } catch (_) {}
        }
        if ((attempt + 1) % 10 === 0) console.log('[115播放接口] 已等待 ' + ((attempt + 1) * 2) + 's push_state=' + pushState);
        await new Promise(r => setTimeout(r, INTERVAL_MS));
        continue;
      }

      const cls = classifyError(data, `获取失败 code=${data && data.code}`);
      return {
        success: false,
        error: cls.errMsg,
        code: cls.code,
        tokenExpired: cls.tokenExpired,
        authInvalid: cls.authInvalid,
        frozen: cls.frozen,
      };
    } catch (e) {
      return { success: false, error: e.message || String(e) };
    }
  }
  return { success: false, error: '视频转码超时（已等待 3 分钟），请稍后重试或在网页端开启转码加速' };
}

// ============================================================
//  提交视频加速转码（开放平台接口）
//  POST https://proapi.115.com/open/video/video_push
//  Content-Type: multipart/form-data
//  说明：按 VIP 等级(vip_push)或消耗枫币(pay_push)加速转码，
//        适合在 get115VideoUrl 返回 409 /video_push_state=false 时主动调用，
//        让系统重新排队以缩短转码等待。
// ============================================================
// ============================================================
//  获取文件原画下载直链（开放平台接口）
//  POST https://proapi.115.com/open/ufile/downurl
//  multipart: pick_code
//  返回的是原始文件字节直链，无需转码即可边下边播（原画清晰度）
// ============================================================
async function get115DownUrl(accessToken, pickCode) {
  if (!accessToken) return { success: false, error: '未登录（缺少 access_token）' };
  if (!pickCode) return { success: false, error: '缺少 pick_code' };
  try {
    const boundary = '----WebKitFormBoundary' + Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2);
    const body = _buildMultipart({ pick_code: pickCode }, boundary);
    const headers = {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/json, text/plain, */*',
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Origin': 'https://proapi.115.com',
      'Referer': 'https://proapi.115.com/',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
    };
    const url = 'https://proapi.115.com/open/ufile/downurl';
    const res = await _request(url, { headers, method: 'POST' }, body);
    let data = null;
    try { data = JSON.parse(res.body); } catch (e) {
      // access_token 过期时 115 返回 HTML 登录页而非 JSON → 标记 authInvalid 以触发自动续期
      if (isHtmlAuthPage(res.body)) {
        return { success: false, error: 'access_token 无效（返回登录页）', authInvalid: true, code: 40140125 };
      }
      return { success: false, error: '响应解析失败: ' + (e && e.message), raw: res.body.slice(0, 200) };
    }
    if (!data) return { success: false, error: '空响应' };
    if (data.state === true && data.data) {
      const ids = Object.keys(data.data);
      for (let i = 0; i < ids.length; i++) {
        const f = data.data[ids[i]] || {};
        const direct = f && f.url && f.url.url;
        if (direct) {
          console.log('[115-downurl] 原画直链 pickCode=' + pickCode + '\nURL=' + direct);
          return { success: true, url: direct, file_name: f.file_name || '', file_size: f.file_size || 0, pickCode };
        }
      }
      return { success: false, error: '响应中未返回下载地址', raw: JSON.stringify(data).slice(0, 200) };
    }
    const cls = classifyError(data, '获取文件下载地址失败');
    const errMsg = (data && data.message) || (data && typeof data.error === 'string' ? data.error : cls.errMsg) || cls.errMsg;
    return { success: false, error: errMsg, code: cls.code, tokenExpired: cls.tokenExpired, authInvalid: cls.authInvalid, frozen: cls.frozen };
  } catch (e) {
    return { success: false, error: e.message || String(e) };
  }
}

async function submitVideoPush(accessToken, pickCode, op) {
  if (!accessToken) return { success: false, error: '未登录（缺少 access_token）' };
  if (!pickCode) return { success: false, error: '缺少 pick_code' };
  const pushOp = op === 'pay_push' ? 'pay_push' : 'vip_push';
  try {
    const boundary = '----WebKitFormBoundary' + Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2);
    const body = _buildMultipart({ pick_code: pickCode, op: pushOp }, boundary);
    const headers = {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/json, text/plain, */*',
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Origin': 'https://proapi.115.com',
      'Referer': 'https://proapi.115.com/',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
    };
    const url = `https://proapi.115.com/open/video/video_push`;
    const res = await _request(url, { headers, method: 'POST' }, body);
    let data = null;
    try { data = JSON.parse(res.body); } catch (e) {
      // access_token 过期时 115 返回 HTML 登录页而非 JSON → 标记 authInvalid 以触发自动续期
      if (isHtmlAuthPage(res.body)) {
        return { success: false, error: 'access_token 无效（返回登录页）', authInvalid: true, code: 40140125 };
      }
      return { success: false, error: '响应解析失败: ' + (e && e.message), raw: res.body.slice(0, 200) };
    }
    if (data && data.state === true) {
      return { success: true, message: data.message || '', code: data.code };
    }
    const cls = classifyError(data, '提交加速转码失败');
    return {
      success: false,
      error: cls.errMsg,
      code: cls.code,
      tokenExpired: cls.tokenExpired,
      authInvalid: cls.authInvalid,
      frozen: cls.frozen,
    };
  } catch (e) {
    return { success: false, error: e.message || String(e) };
  }
}

module.exports = {
  list115DirectoryByToken,
  create115Folder,
  upload115File,
  refresh115Token,
  get115UserInfo,
  get115VideoUrl,
  get115DownUrl,
  submitVideoPush,
};