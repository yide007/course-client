// ===== 登录状态管理（加密存储） =====
const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const LOGIN_KEY = crypto.scryptSync('course-client-login-auth-v1', 'login-salt-2026', 32);
const LOGIN_ALGO = 'aes-256-gcm';
const ROLE_ADMIN = 'admin';
const ROLE_USER = 'user';

function loginEncrypt(plain) {
  if (!plain) return '';
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(LOGIN_ALGO, LOGIN_KEY, iv);
  let enc = cipher.update(String(plain), 'utf8', 'base64');
  enc += cipher.final('base64');
  const tag = cipher.getAuthTag().toString('base64');
  return iv.toString('base64') + ':' + tag + ':' + enc;
}
function loginDecrypt(cipherStr) {
  if (!cipherStr || typeof cipherStr !== 'string' || cipherStr.indexOf(':') === -1) return '';
  const parts = cipherStr.split(':');
  if (parts.length < 3) return '';
  try {
    const iv = Buffer.from(parts[0], 'base64');
    const tag = Buffer.from(parts[1], 'base64');
    const decipher = crypto.createDecipheriv(LOGIN_ALGO, LOGIN_KEY, iv);
    decipher.setAuthTag(tag);
    let dec = decipher.update(parts[2], 'base64', 'utf8');
    dec += decipher.final('utf8');
    return dec;
  } catch (_) { return ''; }
}
function loginFilePath() {
  return path.join(app.getPath('userData'), 'app-login.json');
}
function readLoginFile() {
  try {
    const f = loginFilePath();
    if (!fs.existsSync(f)) return null;
    const raw = fs.readFileSync(f, 'utf8');
    const obj = JSON.parse(raw || '{}');
    const enc = obj && obj.data ? obj.data : '';
    const dec = loginDecrypt(enc);
    if (!dec) return null;
    return JSON.parse(dec);
  } catch (_) { return null; }
}
function writeLoginFile(data) {
  try {
    const f = loginFilePath();
    const raw = loginEncrypt(JSON.stringify(data));
    fs.writeFileSync(f, JSON.stringify({ data: raw }), 'utf8');
    return true;
  } catch (_) { return false; }
}
function clearLoginFile() {
  try {
    const f = loginFilePath();
    if (fs.existsSync(f)) fs.unlinkSync(f);
    return true;
  } catch (_) { return false; }
}

const BUILTIN_USERS = {
  admin: { username: 'admin', password: 'admin123', role: ROLE_ADMIN, nickname: '管理员' },
  user:  { username: 'user',  password: 'user123',  role: ROLE_USER,  nickname: '普通用户' },
};

function usersFilePath() {
  return path.join(app.getPath('userData'), 'app-users.json');
}
function readUsersFile() {
  try {
    const f = usersFilePath();
    if (!fs.existsSync(f)) return null;
    const raw = fs.readFileSync(f, 'utf8');
    const obj = JSON.parse(raw || '{}');
    const enc = obj && obj.data ? obj.data : '';
    const dec = loginDecrypt(enc);
    if (!dec) return null;
    return JSON.parse(dec);
  } catch (_) { return null; }
}
function writeUsersFile(users) {
  try {
    const f = usersFilePath();
    const raw = loginEncrypt(JSON.stringify(users));
    fs.writeFileSync(f, JSON.stringify({ data: raw }), 'utf8');
    return true;
  } catch (_) { return false; }
}
function ensureUsersFile() {
  let users = readUsersFile();
  if (!users || !Array.isArray(users) || users.length === 0) {
    users = Object.values(BUILTIN_USERS).map(u => ({ ...u }));
    writeUsersFile(users);
  } else {
    let changed = false;
    Object.values(BUILTIN_USERS).forEach(bu => {
      if (!users.find(u => u.username === bu.username)) {
        users.push({ ...bu });
        changed = true;
      }
    });
    if (changed) writeUsersFile(users);
  }
  return users;
}
function findUserInList(username) {
  const users = ensureUsersFile();
  return users.find(u => u.username === username);
}
function _guessRoleByUsername(username, saved) {
  if (saved && saved.role) return saved.role;
  const u = findUserInList(username);
  if (u && u.role) return u.role;
  if (username === 'admin') return ROLE_ADMIN;
  return ROLE_USER;
}

module.exports = {
  ROLE_ADMIN, ROLE_USER, BUILTIN_USERS,
  loginEncrypt, loginDecrypt,
  readLoginFile, writeLoginFile, clearLoginFile,
  readUsersFile, writeUsersFile, ensureUsersFile,
  findUserInList, _guessRoleByUsername,
};