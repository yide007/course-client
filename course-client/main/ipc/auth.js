// ===== IPC 处理器：登录 / 登出 / 用户管理 =====
const { ipcMain } = require('electron');
const {
  ROLE_ADMIN, ROLE_USER, BUILTIN_USERS,
  readLoginFile, writeLoginFile, clearLoginFile,
  ensureUsersFile, writeUsersFile, findUserInList, _guessRoleByUsername,
} = require('../auth-manager');

function register() {
  ipcMain.handle('check-login-status', async () => {
    const saved = readLoginFile();
    if (!saved) return { loggedIn: false };
    const now = Date.now();
    const expireDays = 7;
    if (saved.loginAt && (now - saved.loginAt) > expireDays * 24 * 3600 * 1000) {
      clearLoginFile();
      return { loggedIn: false, expired: true };
    }
    const role = _guessRoleByUsername(saved.username, saved);
    return {
      loggedIn: true,
      username: saved.username || '',
      loginAt: saved.loginAt || 0,
      nickname: saved.nickname || '',
      avatar: saved.avatar || '',
      role,
    };
  });

  ipcMain.handle('do-login', async (_event, username, password) => {
    const u = String(username || '').trim();
    const p = String(password || '').trim();
    if (!u || !p) return { success: false, error: '请输入账号和密码' };

    const saved = readLoginFile();
    let ok = false;
    let storedPwd = '';
    let nickname = '';
    let avatar = '';
    let role = ROLE_USER;

    const listUser = findUserInList(u);
    if (listUser) {
      storedPwd = listUser.password || '';
      nickname = listUser.nickname || u;
      avatar = listUser.avatar || '';
      role = listUser.role || ROLE_USER;
      ok = (storedPwd === p);
      if (!ok) return { success: false, error: '密码错误' };
    } else if (!saved || saved.isRegistered !== true) {
      const builtin = BUILTIN_USERS[u];
      if (builtin && builtin.password === p) {
        ok = true;
        nickname = builtin.nickname || u;
        avatar = builtin.avatar || '';
        role = builtin.role || ROLE_USER;
        const users = ensureUsersFile();
        users.push({ ...builtin });
        writeUsersFile(users);
      } else {
        return { success: false, error: '账号或密码错误' };
      }
    } else {
      return { success: false, error: '账号不存在' };
    }

    const data = {
      username: u,
      password: ok ? (storedPwd || p) : '',
      nickname,
      avatar,
      role,
      loginAt: Date.now(),
      isRegistered: true,
    };
    writeLoginFile(data);
    return { success: true, username: u, nickname, avatar, loginAt: data.loginAt, role };
  });

  ipcMain.handle('do-logout', async () => {
    const saved = readLoginFile();
    if (saved) {
      const keep = {
        username: saved.username || '',
        password: saved.password || '',
        nickname: saved.nickname || '',
        avatar: saved.avatar || '',
        role: saved.role || '',
        isRegistered: saved.isRegistered || false,
      };
      writeLoginFile(keep);
    }
    return { success: true };
  });

  ipcMain.handle('change-password', async (_event, oldPwd, newPwd, newNickname) => {
    const saved = readLoginFile();
    if (!saved) return { success: false, error: '未登录' };
    const listUser = findUserInList(saved.username);
    const curPwd = listUser ? listUser.password : (BUILTIN_USERS[saved.username] ? BUILTIN_USERS[saved.username].password : '');
    if (curPwd !== String(oldPwd || '')) return { success: false, error: '原密码错误' };
    const np = String(newPwd || '').trim();
    if (!np || np.length < 6) return { success: false, error: '新密码至少6位' };
    const nickname = (newNickname !== undefined && newNickname !== null) ? String(newNickname) : (saved.nickname || '');
    const role = listUser ? listUser.role : _guessRoleByUsername(saved.username, saved);

    if (listUser) {
      const users = ensureUsersFile();
      const idx = users.findIndex(u => u.username === saved.username);
      if (idx >= 0) {
        users[idx].password = np;
        users[idx].nickname = nickname;
        writeUsersFile(users);
      }
    }

    const data = {
      username: saved.username,
      password: np,
      nickname,
      avatar: saved.avatar || '',
      role,
      loginAt: Date.now(),
      isRegistered: true,
    };
    writeLoginFile(data);
    return { success: true };
  });

  ipcMain.handle('list-users', async () => {
    const users = ensureUsersFile();
    return users.map(u => ({
      username: u.username,
      nickname: u.nickname || u.username,
      avatar: u.avatar || '',
      role: u.role || ROLE_USER,
    }));
  });

  ipcMain.handle('add-user', async (_event, params) => {
    const { username, password, nickname, role, avatar } = params || {};
    const u = String(username || '').trim();
    const p = String(password || '').trim();
    if (!u || !p) return { success: false, error: '用户名和密码不能为空' };
    if (p.length < 6) return { success: false, error: '密码至少6位' };
    if (!/^[a-zA-Z0-9_]+$/.test(u)) return { success: false, error: '用户名只能包含字母、数字、下划线' };

    const users = ensureUsersFile();
    if (users.find(x => x.username === u)) {
      return { success: false, error: '用户名已存在' };
    }
    users.push({
      username: u,
      password: p,
      nickname: String(nickname || u),
      avatar: avatar ? String(avatar) : '',
      role: role === ROLE_ADMIN ? ROLE_ADMIN : ROLE_USER,
    });
    writeUsersFile(users);
    return { success: true };
  });

  ipcMain.handle('update-user', async (_event, params) => {
    const { username, password, nickname, role, avatar } = params || {};
    const u = String(username || '').trim();
    if (!u) return { success: false, error: '用户名不能为空' };

    const users = ensureUsersFile();
    const idx = users.findIndex(x => x.username === u);
    if (idx < 0) return { success: false, error: '用户不存在' };

    if (password !== undefined && password !== null && String(password).trim() !== '') {
      const p = String(password).trim();
      if (p.length < 6) return { success: false, error: '密码至少6位' };
      users[idx].password = p;
    }
    if (nickname !== undefined && nickname !== null) {
      users[idx].nickname = String(nickname).trim() || u;
    }
    if (role !== undefined && role !== null) {
      users[idx].role = role === ROLE_ADMIN ? ROLE_ADMIN : ROLE_USER;
    }
    if (avatar !== undefined && avatar !== null) {
      users[idx].avatar = avatar ? String(avatar) : '';
    }
    writeUsersFile(users);

    // 若修改的是当前登录用户，同步更新登录态文件中的头像
    const saved = readLoginFile();
    if (saved && saved.username === u) {
      const keep = {
        username: saved.username,
        password: saved.password || '',
        nickname: users[idx].nickname || saved.nickname || '',
        avatar: users[idx].avatar || '',
        role: users[idx].role || saved.role || '',
        loginAt: saved.loginAt || Date.now(),
        isRegistered: saved.isRegistered !== false,
      };
      writeLoginFile(keep);
    }
    return { success: true };
  });

  ipcMain.handle('delete-user', async (_event, username) => {
    const u = String(username || '').trim();
    if (!u) return { success: false, error: '用户名不能为空' };
    if (u === 'admin') return { success: false, error: '不能删除管理员' };

    const users = ensureUsersFile();
    const idx = users.findIndex(x => x.username === u);
    if (idx < 0) return { success: false, error: '用户不存在' };
    users.splice(idx, 1);
    writeUsersFile(users);
    return { success: true };
  });
}

module.exports = { register };