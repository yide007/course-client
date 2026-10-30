// ============================================================
//  115 网盘 — 扫码登录（开放平台 OAuth 设备码授权 / PKCE）
//  参考 Win115 项目实现
//
//  流程：
//  1. login115QrInit()    生成 code_verifier，请求 authDeviceCode，
//                          得到二维码内容 + uid/time/sign，返回
//  2. check115QrStatus()  用户扫码后轮询二维码状态
//                           status: 1=已扫待确认, 2=登录成功, 0=二维码失效
//  3. exchange115QrToken() 用 uid + code_verifier 兑换 access_token / refresh_token
//
//  接口：
//  - POST https://passportapi.115.com/open/authDeviceCode
//      form: client_id=100195125, code_challenge(<sha256 base64url>), code_challenge_method=sha256
//  - GET  https://qrcodeapi.115.com/get/status/?uid&time&sign
//  - POST https://passportapi.115.com/open/deviceCodeToToken
//      form: uid, code_verifier
//  - POST https://passportapi.115.com/open/refreshToken
//      form: refresh_token
// ============================================================
const crypto = require('crypto');
const https = require('https');
const QRCode = require('qrcode');

const CLIENT_ID = '100195125';

// 当前正在进行的扫码登录会话（单例）
let qrSession = null;

// ============================================================
//  基础 HTTP 工具（Promise 化）
// ============================================================
function _http(url, opts = {}, formData = null) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === 'https:' ? https : require('http');
    const isForm = formData !== null && formData !== undefined;

    const headers = Object.assign({
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/plain, */*',
    }, opts.headers || {});

    let body = null;
    if (isForm) {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(formData)) {
        if (v !== undefined && v !== null) params.set(k, String(v));
      }
      body = params.toString();
      headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
    }

    const options = {
      hostname: u.hostname,
      port: u.port || 443,
      path: u.pathname + u.search,
      method: opts.method || (isForm ? 'POST' : 'GET'),
      headers,
      timeout: opts.timeout || 20000,
    };
    if (body) headers['Content-Length'] = Buffer.byteLength(body);
    if (body) options.headers = headers;

    const req = mod.request(options, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('请求超时')); });
    if (body) req.write(body);
    req.end();
  });
}

async function _postForm(url, formData) {
  const res = await _http(url, { method: 'POST' }, formData);
  return JSON.parse(res.body);
}

async function _getJson(url) {
  const res = await _http(url, { method: 'GET' });
  return JSON.parse(res.body);
}

async function _getJsonWithTimeout(url, timeout) {
  const res = await _http(url, { method: 'GET', timeout });
  return JSON.parse(res.body);
}

// ============================================================
//  step1: 获取设备码 + 二维码
// ============================================================
async function login115QrInit() {
  try {
    // 生成 PKCE code_verifier（随机 base64url，43 字符，符合规范）
    const codeVerifier = crypto.randomBytes(32).toString('base64url');
    // code_challenge = base64(sha256(code_verifier))，与官方 SDK 一致（标准 base64）
    const codeChallenge = crypto.createHash('sha256')
      .update(codeVerifier)
      .digest('base64');

    qrSession = { codeVerifier, uid: '', time: 0, sign: '' };

    const data = await _postForm('https://passportapi.115.com/open/authDeviceCode', {
      client_id: CLIENT_ID,
      code_challenge: codeChallenge,
      code_challenge_method: 'sha256',
    });
    console.log('[115扫码] authDeviceCode 响应:', JSON.stringify(data).slice(0, 600));

    if (data.state !== 1 && data.state !== true) {
      return { success: false, error: data.message || data.error || '获取设备码失败' };
    }
    const d = data.data || {};
    if (!d.uid || !d.qrcode || !d.time || !d.sign) {
      return { success: false, error: '设备码响应字段不完整', raw: JSON.stringify(d).slice(0, 300) };
    }

    qrSession.uid = String(d.uid);
    qrSession.time = Number(d.time || 0);
    qrSession.sign = String(d.sign || '');
    qrSession.qrcodeContent = String(d.qrcode || '');

    // 生成二维码图片（data URL，base64 PNG）
    let qrImage = '';
    try {
      qrImage = await QRCode.toDataURL(d.qrcode, { errorCorrectionLevel: 'M', margin: 1, width: 300 });
    } catch (e) {
      console.log('[115扫码] 二维码生成失败:', e && e.message);
    }

    return {
      success: true,
      uid: qrSession.uid,
      time: qrSession.time,
      sign: qrSession.sign,
      qrcodeContent: qrSession.qrcodeContent,
      qrImage,
    };
  } catch (e) {
    return { success: false, error: e.message || String(e) };
  }
}

// ============================================================
//  step2: 轮询二维码状态（长轮询接口，单次请求最多阻塞约 30s）
//  返回 status:
//    2  登录成功（可换取 token）
//    1  已扫码，待手机确认
//    0  二维码失效 / 过期
//   -1  暂无扫码事件（data 为空，需继续轮询）
//   -2  单次长轮询超时（接口特点，需继续轮询）
// ============================================================
async function check115QrStatus(uid, time, sign) {
  if (!qrSession) return { success: false, error: '未初始化扫码会话' };
  const u = uid || qrSession.uid;
  const t = time || qrSession.time;
  const s = sign || qrSession.sign;
  if (!u || !t || !s) return { success: false, error: '缺少 uid/time/sign' };
  let data;
  try {
    data = await _getJsonWithTimeout(
      `https://qrcodeapi.115.com/get/status/?uid=${encodeURIComponent(u)}&time=${encodeURIComponent(t)}&sign=${encodeURIComponent(s)}`,
      45000
    );
  } catch (e) {
    // 长轮询接口单次等待自然超时（未等到事件），属正常现象，继续轮询即可
    console.log('[115扫码] 状态长轮询超时（继续等待）:', (e && e.message) || '');
    return { success: true, status: -2, msg: '' };
  }
  console.log('[115扫码] 查询二维码状态:', JSON.stringify(data).slice(0, 400));
  if (!data || data.state === 0) {
    // key invalid / 已失效
    return { success: true, status: 0, msg: (data && data.message) || '' };
  }
  const d = data.data || {};
  const status = d.status;
  if (status === 2) return { success: true, status: 2, msg: d.msg || '' };
  if (status === 1) return { success: true, status: 1, msg: d.msg || '' };
  if (status === 0) return { success: true, status: 0, msg: d.msg || '' };
  // data 为空 / 暂无 status 字段 → 仍在等待扫码
  return { success: true, status: -1, msg: d.msg || '' };
}

// ============================================================
//  step3: 用 uid + code_verifier 兑换 access_token
// ============================================================
async function exchange115QrToken(uid) {
  if (!qrSession || !qrSession.codeVerifier) {
    return { success: false, error: '未初始化扫码会话' };
  }
  const u = uid || qrSession.uid;
  try {
    const data = await _postForm('https://passportapi.115.com/open/deviceCodeToToken', {
      uid: u,
      code_verifier: qrSession.codeVerifier,
    });
    console.log('[115扫码] deviceCodeToToken 响应:', JSON.stringify(data).slice(0, 600));
    if (data.state !== 1 && data.state !== true) {
      return { success: false, error: data.message || data.error || '兑换 token 失败' };
    }
    const d = data.data || {};
    if (!d.access_token) {
      return { success: false, error: '响应中无 access_token' };
    }
    return {
      success: true,
      accessToken: d.access_token,
      refreshToken: d.refresh_token || '',
      expiresIn: Number(d.expires_in || 0),
      refreshTokenExpiresIn: Number(d.refresh_token_expires_in || d.refreshTokenExpiresIn || 0) || (365 * 24 * 3600),
    };
  } catch (e) {
    return { success: false, error: e.message || String(e) };
  }
}

module.exports = {
  login115QrInit,
  check115QrStatus,
  exchange115QrToken,
};