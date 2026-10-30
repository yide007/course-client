const p115Service = require('./p115');

const _cache = new Map();
const _inflight = new Map();

const DEFAULT_TTL = 7200 * 1000;
const LEAD_TIME = 5 * 60 * 1000;

function parseTtl(expiresIn) {
  const t = Number(expiresIn);
  // 0 或未提供表示「未知/已过期」，不应视为还有效。
  // 若回退到 DEFAULT_TTL，会把已过期的 token 缓存成 2 小时后才过期，
  // 导致 ensureToken 命中缓存、自动续期永不真正触发（手动刷新才成功）。
  if (!Number.isFinite(t) || t <= 0) return 0;
  return t * 1000;
}

function classify(r) {
  if (!r || !r.success) {
    return {
      frozen: !!(r && r.frozen),
      authInvalid: !!(r && r.authInvalid),
      code: (r && r.code) || 0,
    };
  }
  return { frozen: false, authInvalid: false, code: 0 };
}

function dropCfg(cfgId) {
  const c = _cache.get(String(cfgId));
  if (c) _cache.delete(String(cfgId));
}

function invalidateToken(cfgId) {
  const key = String(cfgId || '');
  const c = _cache.get(key);
  if (!c) return;
  console.log('[token] invalidate 收到 401 authInvalid → 清除缓存中的 accessToken' +
    '\n  旧 accessToken=' + c.accessToken +
    '\n  保留 refreshToken 以便重新刷新');
  c.accessToken = '';
  c.expiresAt = 0;
  c._loggedCacheHit = false;
}

async function refreshSingle(refreshToken) {
  if (!refreshToken) {
    console.log('[token] refreshSingle 失败 → 缺少 refresh_token');
    return { success: false, error: '缺少 refresh_token', frozen: true, code: 0 };
  }
  if (_inflight.has(refreshToken)) {
    console.log('[token] refreshSingle 复用进行中的刷新请求');
    return _inflight.get(refreshToken);
  }
  console.log('[token] refreshSingle 发起刷新请求 refreshToken=' + refreshToken);
  const p = p115Service.refresh115Token(refreshToken).finally(() => {
    _inflight.delete(refreshToken);
  });
  _inflight.set(refreshToken, p);
  const res = await p;
  console.log('[token] refreshSingle 完成 success=' + !!res.success +
    ' accessToken=' + (res.accessToken ? res.accessToken : '(无)') +
    ' refreshToken=' + (res.refreshToken ? res.refreshToken : '(无)'));
  return res;
}

function registerCfg(opts) {
  const cfgId = String(opts && opts.cfgId || '');
  if (!cfgId) return;
  const record = {
    accessToken: opts.accessToken || '',
    refreshToken: opts.refreshToken || '',
    expiresAt: opts.accessToken ? Date.now() + parseTtl(opts.expiresIn || 0) : 0,
    refreshTokenExpiresAt: Number(opts.refreshTokenExpiresAt) || 0,
    onRefreshed: opts.onRefreshed || null,
  };
  const prev = _cache.get(cfgId);
  if (prev && prev.refreshPromise) prev.refreshPromise = null;
  _cache.set(cfgId, record);
}

function tokenStillValid(c) {
  if (!c || !c.accessToken) return false;
  return (c.expiresAt - Date.now()) > LEAD_TIME;
}

async function refreshAndNotify(cfgId) {
  const key = String(cfgId);
  const c = _cache.get(key);
  if (!c) return null;
  if (c.refreshPromise) return c.refreshPromise;

  console.log('[token] refreshAndNotify 开始 refreshToken=' + c.refreshToken +
    ' accessToken=' + c.accessToken);

  const r = refreshSingle(c.refreshToken);
  c.refreshPromise = (async () => {
    let res;
    try { res = await r; }
    catch (e) { return { success: false, error: (e && e.message) || '刷新异常' }; }

    const cls = classify(res);
    if (res.success) {
      const prevAT = c.accessToken;
      const prevRT = c.refreshToken;
      c.accessToken = res.accessToken;
      c.refreshToken = res.refreshToken || c.refreshToken;
      c.expiresAt = Date.now() + parseTtl(res.expiresIn);
      if (res.refreshTokenExpiresIn) {
        c.refreshTokenExpiresAt = Date.now() + parseTtl(res.refreshTokenExpiresIn);
      }
      console.log('[token] refreshAndNotify 刷新成功 ✓' +
        '\n  旧 accessToken=' + prevAT +
        '\n  新 accessToken=' + c.accessToken +
        '\n  旧 refreshToken=' + prevRT +
        '\n  新 refreshToken=' + c.refreshToken);

      if (c.onRefreshed && typeof c.onRefreshed === 'function') {
        try {
          await c.onRefreshed({
            accessToken: c.accessToken,
            refreshToken: c.refreshToken,
            expiresIn: res.expiresIn,
            refreshTokenExpiresIn: res.refreshTokenExpiresIn,
          });
          console.log('[token] refreshAndNotify DB 写回完成');
        } catch (e) {
          console.error('[token] refreshAndNotify DB 写回失败:', e && e.message);
        }
      }
      return { success: true, accessToken: c.accessToken, refreshToken: c.refreshToken };
    }

    if (cls.frozen || cls.authInvalid) {
      console.log('[token] refreshAndNotify 刷新失败（终态） frozen=' + cls.frozen +
        ' authInvalid=' + cls.authInvalid + ' code=' + cls.code +
        ' error=' + (res && res.error));
      dropCfg(key);
      return { success: false, frozen: true, code: cls.code,
        error: res.error || (cls.authInvalid ? 'refresh_token 已失效' : 'token 已冻结') };
    }
    console.log('[token] refreshAndNotify 临时错误 code=' + cls.code + ' error=' + (res && res.error));
    return { success: false, code: cls.code, error: res.error };
  })().finally(() => { c.refreshPromise = null; });

  return c.refreshPromise;
}

async function ensureToken(cfgId, fallback) {
  const key = String(cfgId || '');
  let c = _cache.get(key);

  if (!c) {
    if (fallback && fallback.refreshToken) {
      console.log('[token] ensureToken 缓存未命中，从 fallback 注册 refreshToken=' +
        fallback.refreshToken + ' accessToken=' + (fallback.accessToken || '(无)'));
      registerCfg({
        cfgId: key,
        accessToken: fallback.accessToken || '',
        refreshToken: fallback.refreshToken,
        expiresIn: fallback.expiresIn,
        refreshTokenExpiresAt: fallback.refreshTokenExpiresAt,
        onRefreshed: fallback.onRefreshed || null,
      });
      c = _cache.get(key);
    }
  } else if (fallback) {
    const wasInvalidated = !c.accessToken;
    if (fallback.accessToken && fallback.accessToken !== c.accessToken && !wasInvalidated) {
      console.log('[token] ensureToken 用 DB 覆盖 accessToken 旧=' + c.accessToken + ' 新=' + fallback.accessToken);
      c.accessToken = fallback.accessToken;
      c.expiresAt = Date.now() + parseTtl(fallback.expiresIn);
      c._loggedCacheHit = false;
    }
    if (wasInvalidated && fallback.accessToken) {
      console.log('[token] ensureToken 缓存已被 invalidate → 跳过 fallback accessToken=' + fallback.accessToken + ' 回填');
    }
    if (fallback.refreshToken && fallback.refreshToken !== c.refreshToken) {
      console.log('[token] ensureToken 用 DB 覆盖 refreshToken 旧=' + c.refreshToken + ' 新=' + fallback.refreshToken);
      c.refreshToken = fallback.refreshToken;
    }
    if (fallback.refreshTokenExpiresAt && fallback.refreshTokenExpiresAt !== c.refreshTokenExpiresAt) {
      c.refreshTokenExpiresAt = fallback.refreshTokenExpiresAt;
    }
    if (fallback.onRefreshed && !c.onRefreshed) c.onRefreshed = fallback.onRefreshed;
  }

  if (tokenStillValid(c)) {
    const remainMin = Math.max(0, Math.round((c.expiresAt - Date.now()) / 60000));
    if (!c._loggedCacheHit) {
      console.log('[token] ensureToken 缓存命中 ✓ accessToken=' + c.accessToken +
        ' 剩余约 ' + remainMin + ' 分钟');
      c._loggedCacheHit = true;
    }
    return { success: true, accessToken: c.accessToken, refreshToken: c.refreshToken, fromCache: true };
  }

  if (c) {
    c._loggedCacheHit = false;
    const remainMin = c.expiresAt > 0 ? Math.round((c.expiresAt - Date.now()) / 60000) : '未知';
    console.log('[token] ensureToken 触发刷新 accessToken=' + c.accessToken +
      ' 剩余 ' + remainMin + ' 分钟');
  }

  if (!c || !c.refreshToken) {
    console.log('[token] ensureToken 失败 → 无可用 refresh_token');
    return { success: false, code: (fallback && fallback.code) || 0,
      error: '无可用刷新凭证，请重新扫码登录', frozen: true };
  }

  if (c.refreshTokenExpiresAt > 0 && c.refreshTokenExpiresAt <= Date.now()) {
    console.log('[token] ensureToken 失败 → refresh_token 已过期 expiresAt=' +
      c.refreshTokenExpiresAt + ' now=' + Date.now());
    return { success: false, frozen: true,
      error: '登录凭证已过期（refresh_token 已失效），请重新扫码登录' };
  }

  const res = await refreshAndNotify(key);
  if (res && res.success) {
    console.log('[token] ensureToken 刷新成功返回 accessToken=' + res.accessToken +
      ' refreshToken=' + res.refreshToken);
    return { success: true, accessToken: res.accessToken, refreshToken: res.refreshToken, fromCache: false };
  }
  console.log('[token] ensureToken 刷新失败 返回 res=' + JSON.stringify(res));
  return res || { success: false, error: '刷新 token 失败', frozen: false };
}

async function manualRefresh(cfgId, refreshToken, onRefreshed) {
  if (cfgId) registerCfg({ cfgId, refreshToken, expiresIn: 0, onRefreshed });
  const key = String(cfgId || '');
  console.log('[token] manualRefresh cfgId=' + key + ' refreshToken=' + refreshToken);
  if (key && _cache.has(key)) return refreshAndNotify(key);
  const r = await refreshSingle(refreshToken);
  const cls = classify(r);
  if (r.success && onRefreshed) { try { await onRefreshed(r); } catch (e) {} }
  return r;
}

module.exports = { registerCfg, ensureToken, invalidateToken, manualRefresh, refreshSingle, dropCfg, DEFAULT_TTL, parseTtl, classify };