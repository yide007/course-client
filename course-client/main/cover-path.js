// ===== 课程封面图路径：数据库统一存「项目相对路径」，读写两端做转换 =====
const path = require('path');
const fs = require('fs');

// 取项目根（main.js 所在目录）
const PROJECT_ROOT = path.resolve(__dirname, '..');

function _extraResourcesDir() {
  try {
    if (typeof process !== 'undefined' && process.resourcesPath) {
      return String(process.resourcesPath || '');
    }
  } catch (_) {}
  return path.join(__dirname, '..');
}
function _resolveExtra(relPath) {
  const tryPath = (base) => {
    if (!base) return null;
    const p = path.normalize(path.join(base, relPath));
    return fs.existsSync(p) ? p : null;
  };
  return tryPath(path.join(__dirname, '..')) || tryPath(_extraResourcesDir()) || null;
}

function _isRemoteUrl(u) { return /^https?:\/\//i.test(String(u || '')); }
function _stripFileProtocol(u) {
  var s = String(u || '');
  s = s.replace(/^file:\/+/i, '');
  if (/^\/[A-Za-z]:\//.test(s)) s = s.substring(1);
  return s;
}

// 写库：file:///... / 本地绝对路径 → 项目相对路径（http(s) 原样）
function coverPathForDb(inputUrl) {
  if (!inputUrl) return '';
  if (_isRemoteUrl(inputUrl)) return inputUrl;
  var abs = path.normalize(_stripFileProtocol(inputUrl));
  try {
    var rel = path.relative(PROJECT_ROOT, abs).replace(/\\/g, '/');
    if (rel && rel.substring(0, 2) !== '..') return rel;
  } catch (_) {}
  return abs.replace(/\\/g, '/');
}

// 读库：项目相对路径 / 本地路径 → file:/// 绝对 URL（http(s) 原样）
function coverUrlForDisplay(dbValue) {
  if (!dbValue) return '';
  if (_isRemoteUrl(dbValue)) return dbValue;
  var s = String(dbValue).replace(/\\/g, '/');
  var abs;
  if (path.isAbsolute(s) || /^\/[A-Za-z]:\//.test('/' + s) || /^[A-Za-z]:\//.test(s)) {
    abs = path.normalize(s);
  } else {
    const trys = [
      path.join(PROJECT_ROOT, s),
      path.join(_extraResourcesDir(), s),
      path.join(_extraResourcesDir(), 'src', s),
    ];
    abs = null;
    for (const p of trys) { if (fs.existsSync(p)) { abs = p; break; } }
    if (!abs) abs = trys[0];
  }
  return 'file:///' + abs.replace(/\\/g, '/').replace(/^\/+/, '');
}

module.exports = { coverPathForDb, coverUrlForDisplay };