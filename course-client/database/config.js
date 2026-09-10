const path = require('path');
const fs = require('fs');

let _config = null;

function getConfigPath() {
  try {
    const { app } = require('electron');
    if (app && typeof app.getPath === 'function') {
      return path.join(app.getPath('userData'), 'course-sources.json');
    }
  } catch (e) {}
  const fallback = path.join(__dirname, '_data');
  if (!fs.existsSync(fallback)) fs.mkdirSync(fallback, { recursive: true });
  return path.join(fallback, 'course-sources.json');
}

const DEFAULT_CONFIG = {
  version: 1,
  sources: [],
};

function loadConfig() {
  if (_config) return _config;
  const cfgPath = getConfigPath();
  if (fs.existsSync(cfgPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
      _config = Object.assign({ version: 1, sources: [] }, raw);
      if (!Array.isArray(_config.sources)) _config.sources = [];
      return _config;
    } catch (e) {
      console.error('解析课程源配置失败:', e);
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

function allSources() {
  return loadConfig().sources;
}

function getSource(id) {
  return loadConfig().sources.find(s => String(s.id) === String(id)) || null;
}

function upsertSource(source) {
  loadConfig();
  if (!source || typeof source !== 'object') {
    return { success: false, error: '参数错误' };
  }
  // autoSync 顶层/配置内两种写法都兼容
  const autoSync = source.autoSync === true || (source.config && source.config.autoSync === true)
    ? true
    : (source.autoSync === false || (source.config && source.config.autoSync === false) ? false : true);

  const baseCfg = {
    endpoint: '127.0.0.1:19798',
    token: '',
    defaultCategoryId: 1,
    defaultLevel: '初级',
    defaultInstructor: '系统导入',
    defaultRating: 4.6,
    defaultCoverColor: 'linear-gradient(135deg, #667eea, #764ba2)',
    rootPath: '/',
    autoSync,
  };

  if (source.id) {
    const idx = _config.sources.findIndex(s => String(s.id) === String(source.id));
    if (idx >= 0) {
      const prev = _config.sources[idx];
      const prevCfg = prev.config || {};
      const mergedCfg = Object.assign({}, baseCfg, prevCfg, source.config || {}, { autoSync });
      _config.sources[idx] = Object.assign({}, prev, source, {
        enabled: source.enabled === false ? false : true,
        autoSync,
        note: (source.note != null) ? source.note : (prev.note || ''),
        config: mergedCfg,
      });
      saveConfig();
      return { success: true, source: _config.sources[idx] };
    }
  }
  const cfg = Object.assign({}, baseCfg, source.config || {}, { autoSync });
  const newSource = {
    id: source.id || ('src_' + Date.now() + '_' + Math.floor(Math.random() * 1000)),
    name: source.name || '',
    type: source.type || 'cd2',
    enabled: source.enabled === false ? false : true,
    autoSync,
    note: source.note || '',
    config: cfg,
  };
  _config.sources.push(newSource);
  saveConfig();
  return { success: true, source: newSource };
}

function deleteSource(id) {
  loadConfig();
  const idx = _config.sources.findIndex(s => String(s.id) === String(id));
  if (idx < 0) return { success: false, error: '源不存在' };
  _config.sources.splice(idx, 1);
  saveConfig();
  return { success: true };
}

module.exports = {
  loadConfig, saveConfig, allSources, getSource, upsertSource, deleteSource,
};