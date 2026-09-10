const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

let _config = null;

// ── 加密工具 ──
const ENC_KEY = crypto.scryptSync('upload-config-course-client-v1', 'x9k2m7p4salt', 32);
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
      return path.join(app.getPath('userData'), 'upload-config.json');
    }
  } catch (e) {}
  const fallback = path.join(__dirname, '_data');
  if (!fs.existsSync(fallback)) fs.mkdirSync(fallback, { recursive: true });
  return path.join(fallback, 'upload-config.json');
}

const DEFAULT_CONFIG = {
  uploads: [],
};

function loadConfig() {
  if (_config) return _config;
  const cfgPath = getConfigPath();
  if (fs.existsSync(cfgPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
      _config = Object.assign({ uploads: [] }, raw);
      if (!Array.isArray(_config.uploads)) _config.uploads = [];
      return _config;
    } catch (e) {
      console.error('解析上传配置失败:', e);
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

function allUploads() {
  return loadConfig().uploads.map(u => ({
    ...u,
    username: decrypt(u.username),
    password: decrypt(u.password),
  }));
}

function getUpload(id) {
  const u = loadConfig().uploads.find(u => String(u.id) === String(id));
  if (!u) return null;
  return { ...u, username: decrypt(u.username), password: decrypt(u.password) };
}

function upsertUpload(item) {
  loadConfig();
  if (!item || typeof item !== 'object') {
    return { success: false, error: '参数错误' };
  }

  if (item.id) {
    const idx = _config.uploads.findIndex(u => String(u.id) === String(item.id));
    if (idx >= 0) {
      _config.uploads[idx] = Object.assign({}, _config.uploads[idx], {
        name: item.name || _config.uploads[idx].name || '',
        baseURL: item.baseURL != null ? String(item.baseURL) : _config.uploads[idx].baseURL || '',
        username: item.username != null ? encrypt(item.username) : _config.uploads[idx].username || '',
        password: item.password != null ? encrypt(item.password) : _config.uploads[idx].password || '',
        token: item.token != null ? String(item.token) : _config.uploads[idx].token || '',
      });
      saveConfig();
      return { success: true, item: allUploads()[idx] };
    }
  }

  const newItem = {
    id: item.id || ('up_' + Date.now() + '_' + Math.floor(Math.random() * 1000)),
    name: item.name || '',
    baseURL: item.baseURL != null ? String(item.baseURL) : '',
    username: encrypt(item.username || ''),
    password: encrypt(item.password || ''),
    token: item.token != null ? String(item.token) : '',
  };
  _config.uploads.push(newItem);
  saveConfig();
  return { success: true, item: newItem };
}

function deleteUpload(id) {
  loadConfig();
  const idx = _config.uploads.findIndex(u => String(u.id) === String(id));
  if (idx < 0) return { success: false, error: '配置不存在' };
  _config.uploads.splice(idx, 1);
  saveConfig();
  return { success: true };
}

function updateToken(id, token) {
  loadConfig();
  const idx = _config.uploads.findIndex(u => String(u.id) === String(id));
  if (idx < 0) return { success: false, error: '配置不存在' };
  _config.uploads[idx].token = token ? String(token) : '';
  saveConfig();
  return { success: true };
}

module.exports = {
  loadConfig, saveConfig, allUploads, getUpload, upsertUpload, deleteUpload, updateToken,
};