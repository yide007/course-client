const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

let _config = null;

const ENC_KEY = crypto.scryptSync('p115-config-course-client-v1', 'q5n8r3w9salt', 32);
const ENC_ALGO = 'aes-256-gcm';

function encrypt(plain) {
  if (!plain) return '';
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ENC_ALGO, ENC_KEY, iv);
  let encrypted = cipher.update(String(plain), 'utf8', 'base64');
  encrypted += cipher.final('base64');
  const tag = cipher.getAuthTag().toString('base64');
  return iv.toString('base64') + ':' + tag + ':' + encrypted;
}

function decrypt(cipher) {
  if (!cipher || typeof cipher !== 'string' || cipher.indexOf(':') === -1) return cipher || '';
  const parts = cipher.split(':');
  if (parts.length < 3) return cipher;
  try {
    const iv = Buffer.from(parts[0], 'base64');
    const tag = Buffer.from(parts[1], 'base64');
    const decipher = crypto.createDecipheriv(ENC_ALGO, ENC_KEY, iv);
    decipher.setAuthTag(tag);
    let decrypted = decipher.update(parts[2], 'base64', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (_) {
    return cipher;
  }
}

function getConfigPath() {
  try {
    const { app } = require('electron');
    if (app && typeof app.getPath === 'function') {
      return path.join(app.getPath('userData'), 'p115-config.json');
    }
  } catch (e) {}
  const fallback = path.join(__dirname, '_data');
  if (!fs.existsSync(fallback)) fs.mkdirSync(fallback, { recursive: true });
  return path.join(fallback, 'p115-config.json');
}

const DEFAULT_CONFIG = {
  p115: [],
};

function loadConfig() {
  if (_config) return _config;
  const cfgPath = getConfigPath();
  if (fs.existsSync(cfgPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
      _config = Object.assign({ p115: [] }, raw);
      if (!Array.isArray(_config.p115)) _config.p115 = [];
      return _config;
    } catch (e) {
      console.error('解析 115 配置失败:', e);
      _config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
      return _config;
    }
  }
  _config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  saveConfig();
  return _config;
}

function saveConfig() {
  const cfgPath = getConfigPath();
  const dir = path.dirname(cfgPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(cfgPath, JSON.stringify(_config || DEFAULT_CONFIG, null, 2), 'utf-8');
}

function allP115() {
  return loadConfig().p115.map(u => ({
    ...u,
    username: decrypt(u.username),
    password: decrypt(u.password),
    authToken: decrypt(u.authToken),
    refreshToken: decrypt(u.refreshToken),
    cookie: decrypt(u.cookie),
    tokenExpiresAt: Number(u.tokenExpiresAt) || 0,
    refreshTokenExpiresAt: Number(u.refreshTokenExpiresAt) || 0,
    userInfo: u.userInfo ? (typeof u.userInfo === 'string' ? safeParse(u.userInfo) : u.userInfo) : null,
  }));
}

function safeParse(s) {
  try { return JSON.parse(s); } catch (_) { return null; }
}

function getP115(id) {
  const u = loadConfig().p115.find(u => String(u.id) === String(id));
  if (!u) return null;
  return { ...u, username: decrypt(u.username), password: decrypt(u.password), authToken: decrypt(u.authToken), refreshToken: decrypt(u.refreshToken), cookie: decrypt(u.cookie), tokenExpiresAt: Number(u.tokenExpiresAt) || 0, refreshTokenExpiresAt: Number(u.refreshTokenExpiresAt) || 0, userInfo: u.userInfo ? (typeof u.userInfo === 'string' ? safeParse(u.userInfo) : u.userInfo) : null };
}

function upsertP115(item) {
  loadConfig();
  if (!item || typeof item !== 'object') {
    return { success: false, error: '参数错误' };
  }

  if (item.id) {
    const idx = _config.p115.findIndex(u => String(u.id) === String(item.id));
    if (idx >= 0) {
      _config.p115[idx] = Object.assign({}, _config.p115[idx], {
        name: item.name || _config.p115[idx].name || '',
        baseURL: item.baseURL != null ? String(item.baseURL) : _config.p115[idx].baseURL || '',
        username: item.username != null ? encrypt(item.username) : _config.p115[idx].username || '',
        password: item.password != null ? encrypt(item.password) : _config.p115[idx].password || '',
        authToken: item.authToken != null ? encrypt(item.authToken) : _config.p115[idx].authToken || '',
        refreshToken: item.refreshToken != null ? encrypt(item.refreshToken) : _config.p115[idx].refreshToken || '',
        uid: item.uid != null ? String(item.uid) : _config.p115[idx].uid || '',
        cookie: item.cookie != null ? encrypt(item.cookie) : _config.p115[idx].cookie || '',
        tokenExpiresAt: item.tokenExpiresAt != null ? Number(item.tokenExpiresAt) : (_config.p115[idx].tokenExpiresAt || 0),
        refreshTokenExpiresAt: item.refreshTokenExpiresAt != null ? Number(item.refreshTokenExpiresAt) : (_config.p115[idx].refreshTokenExpiresAt || 0),
        userInfo: item.userInfo != null ? (typeof item.userInfo === 'string' ? item.userInfo : JSON.stringify(item.userInfo)) : _config.p115[idx].userInfo || '',
      });
      saveConfig();
      return { success: true, item: allP115()[idx] };
    }
  }

  const newItem = {
    id: item.id || ('p115_' + Date.now() + '_' + Math.floor(Math.random() * 1000)),
    name: item.name || '',
    baseURL: item.baseURL != null ? String(item.baseURL) : '',
    username: encrypt(item.username || ''),
    password: encrypt(item.password || ''),
    authToken: encrypt(item.authToken || ''),
    refreshToken: encrypt(item.refreshToken || ''),
    uid: item.uid || '',
    cookie: encrypt(item.cookie || ''),
    tokenExpiresAt: Number(item.tokenExpiresAt) || 0,
    refreshTokenExpiresAt: Number(item.refreshTokenExpiresAt) || 0,
    userInfo: item.userInfo != null ? (typeof item.userInfo === 'string' ? item.userInfo : JSON.stringify(item.userInfo)) : '',
  };
  _config.p115.push(newItem);
  saveConfig();
  return { success: true, item: newItem };
}

function deleteP115(id) {
  loadConfig();
  const idx = _config.p115.findIndex(u => String(u.id) === String(id));
  if (idx < 0) return { success: false, error: '配置不存在' };
  _config.p115.splice(idx, 1);
  saveConfig();
  return { success: true };
}

module.exports = {
  loadConfig, saveConfig, allP115, getP115, upsertP115, deleteP115,
};