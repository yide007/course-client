const api = window.electronAPI;


// ===== 🔬 播放卡死诊断日志工具 =====
// 统一前缀 [PlayDiag] 方便 F12 过滤；t=相对 playVideo 调用时刻的毫秒数
function _diag(player, tag, extra) {
  try {
    const t0 = player._diagT0 || 0;
    const t = t0 ? (performance.now() - t0).toFixed(0) : '?';
    const rs = player.readyState;
    const ns = player.networkState;
    const buf = player.buffered && player.buffered.length ?
      ('[' + player.buffered.start(player.buffered.length - 1).toFixed(1) + '~' +
       player.buffered.end(player.buffered.length - 1).toFixed(1) + ']') : '[]';
    const info = `[PlayDiag t=${t}ms] ${tag} | rs=${rs} ns=${ns} cur=${(player.currentTime||0).toFixed(1)}s dur=${(player.duration||0).toFixed(1)}s buf=${buf}`;
    if (extra !== undefined) console.log(info, extra);
    else console.log(info);
  } catch (e) { console.log('[PlayDiag] ' + tag, e); }
}
function _installPlayDiag(player, originDirectUrl) {
  if (!player || player._diagInstalled) return;
  player._diagInstalled = true;
  player._diagT0 = performance.now();
  player._diagWaitingSince = 0;
  player._diagStalledCount = 0;
  const EVTS = ['loadstart','progress','suspend','abort','error','emptied',
    'stalled','play','pause','loadedmetadata','loadeddata','canplay',
    'canplaythrough','playing','waiting','seeking','seeked','timeupdate',
    'ended','durationchange','ratechange','volumechange'];
  EVTS.forEach(ev => {
    player.addEventListener(ev, () => {
      if (ev === 'waiting') player._diagWaitingSince = performance.now();
      if (ev === 'playing' && player._diagWaitingSince) {
        const gap = performance.now() - player._diagWaitingSince;
        _diag(player, `waiting→playing 缓冲恢复 gap=${gap.toFixed(0)}ms`);
        player._diagWaitingSince = 0;
      }
      if (ev === 'stalled') {
        player._diagStalledCount++;
        _diag(player, `⚠️ stalled #${player._diagStalledCount} — Chromium 检测到网络停滞超过 3s`);
      }
      if (ev === 'seeking') {
        player._diagSeekingSince = performance.now();
        _diag(player, `▶️ seeking 开始 target=${player._seekQueuedTime?.toFixed(2) || 'cur'}s`);
      }
      if (ev === 'seeked' && player._diagSeekingSince) {
        const gap = performance.now() - player._diagSeekingSince;
        _diag(player, `✅ seeked 完成 gap=${gap.toFixed(0)}ms 新time=${player.currentTime.toFixed(2)}s`);
        player._diagSeekingSince = 0;
      }
      _diag(player, `📡 ${ev}`);
    });
  });
  _diag(player, `🔍 诊断已安装 | 直链=${originDirectUrl} | player.src(即将)=${player.src || '(待设置)'}`);
}

// ===== 本地媒体代理（兜底用，不再强制所有视频走代理）=====
let MEDIA_PROXY_PORT = 0;
const MEDIA_PROXY_READY_P = (async () => {
  try {
    if (!api || typeof api.getMediaProxyPort !== 'function') return 0;
    const r = await api.getMediaProxyPort();
    MEDIA_PROXY_PORT = Number(r && r.port) || 0;
    if (MEDIA_PROXY_PORT) console.log('[media-proxy] 已就绪 127.0.0.1:' + MEDIA_PROXY_PORT + '（仅作为兜底）');
    return MEDIA_PROXY_PORT;
  } catch (_) { return 0; }
})();
// 🔴 新增：把 URL 包装成代理地址（只在直连失败/非 http 时用）
function _wrapProxyVideoUrl(remoteUrl) {
  if (!remoteUrl || typeof remoteUrl !== 'string') return remoteUrl;
  if (!MEDIA_PROXY_PORT) return remoteUrl;
  if (/^blob:|^data:|^file:\/\//i.test(remoteUrl)) return remoteUrl;
  try {
    const b64 = Buffer.from(remoteUrl, 'utf8').toString('base64');
    return 'http://127.0.0.1:' + MEDIA_PROXY_PORT + '/v1/' + b64;
  } catch (_) {
    return 'http://127.0.0.1:' + MEDIA_PROXY_PORT + '/?src=' + encodeURIComponent(remoteUrl);
  }
}
// 🔴 优先直链 + 兜底代理：
//    PC 浏览器打开 URL 流畅 → 说明 URL 有公网 + CORS + Range 支持 → 直接交给 <video>，和 Chrome 完全一样的链路
//    只有当直连触发 error（403/内网/跨域失败/本地路径）时，才自动切到代理，保证一定能看
function _toProxyVideoUrl(remoteUrl) {
  if (!remoteUrl || typeof remoteUrl !== 'string') return remoteUrl;
  // 特殊协议：不处理
  if (/^blob:|^data:|^file:\/\//i.test(remoteUrl)) return remoteUrl;
  // 不是 http(s)（例如本地相对路径 D:\\xxx.mp4、/uploads/xxx.mp4）→ 必须走代理
  if (!/^https?:\/\//i.test(remoteUrl)) return _wrapProxyVideoUrl(remoteUrl);
  // 是 http(s) 公网 URL：优先直连，等 onerror 再 fallback 到代理
  // 这样 PC 浏览器能流畅播放的 OSS/CDN 链接，客户端也完全一样快，不多走一跳
  return remoteUrl;
}
// 🔴 配套：播放前给 <video> 装一层 onerror → 直连失败立刻切代理
//    在 playVideo/playModalVideo 里调用一次即可
function _installDirectFallback(player, originalUrl, tokenRefObj) {
  if (!player || !originalUrl) return;
  // 已经装过的话先把旧 handler 摘掉
  try {
    if (player._fallbackHandler) {
      player.removeEventListener('error', player._fallbackHandler);
      delete player._fallbackHandler;
    }
  } catch (_) {}
  // 已经是代理地址了，不重复包
  if (/^http:\/\/127\.0\.0\.1:/i.test(String(player.src || ''))) return;
  if (!/^https?:\/\//i.test(originalUrl)) return;
  const handler = () => {
    try {
      // token 校验：视频被切走就别 fallback 了
      const tok = tokenRefObj ? tokenRefObj.current : player._playToken;
      if ((player._playToken || 0) !== (tok || 0)) return;
      // 1. 只 fallback 一次，避免死循环
      if (player._didFallbackProxy) return;
      player._didFallbackProxy = true;
      // 2. 拿到代理地址，立刻替换 src
      const proxyUrl = _wrapProxyVideoUrl(originalUrl);
      if (!proxyUrl || proxyUrl === originalUrl) return;
      const curTime = Number(player.currentTime) || 0;
      console.log('[直连失败，切兜底代理]', originalUrl.slice(0, 80));
      try { player.removeEventListener('error', handler); } catch (_) {}
      player.src = proxyUrl;
      try {
        // 3. 尝试恢复到原进度
        if (curTime > 0) {
          const trySeek = () => {
            if (player.duration && isFinite(player.duration)) {
              try { player.currentTime = Math.min(curTime, player.duration - 0.1); } catch (_) {}
            } else {
              setTimeout(trySeek, 100);
            }
          };
          setTimeout(trySeek, 50);
        }
        const p = player.play(); if (p && typeof p.catch === 'function') p.catch(() => {});
      } catch (_) {}
    } catch (_) {}
  };
  player._fallbackHandler = handler;
  player.addEventListener('error', handler, { once: true });
}

// ===== 视频事件清理：防止切课时同一个 <video> 叠加 N 套回调导致卡死 =====
const _VIDEO_EV_KEYS = ['onplay','onplaying','onpause','onended','ontimeupdate','onprogress',
  'onloadedmetadata','onloadeddata','oncanplay','onwaiting','onseeking','onseeked','onerror','onstalled','onsuspend'];
function _detachAllVideoEvents(player) {
  if (!player) return;
  try {
    // 先取消 rAF，防止动画帧回调里访问已失效的闭包
    if (player._rafTimer) { try { cancelAnimationFrame(player._rafTimer); } catch (_) {} }
    _VIDEO_EV_KEYS.forEach(k => { try { player[k] = null; } catch (_) {} });
    // 清理旧的 rAF / seek 相关标记（全部挂在 player 上，保证切视频后能正确重置）
    delete player._rafTimer;
    delete player._rafDirty;
    delete player._rafLastTime;
    delete player._playToken;
    delete player._seekingFromUser;
    delete player._seekQueuedTime;
    delete player._seekInFlight;
    delete player._nextSeekAfter;
    delete player._lastCommitted;
  } catch (_) {}
}

// ===== 视频自定义点击控制：作为原生 controls 的补充 =====
//       原生 controls 在缓冲/seeking 期间会被 Chromium 媒体锁禁用（点了没反应），
//       所以保留 controls（PC 浏览器默认体验），但额外安装：
//         1. 单击视频画面切换播放/暂停（缓冲期间也能点）
//         2. 双击视频画面切换全屏（缓冲期间也能点）
//         3. 键盘快捷键（空格/F/←/→/↑/↓）
//       这样原生 controls 没禁用时用户正常用原生，缓冲时原生被禁用 → 用户可以点画面或按键盘
function _installVideoClickControls() {
  const ids = ['detail-player', 'video-player'];
  ids.forEach(id => {
    const v = document.getElementById(id);
    if (!v) return;
    if (v._customControlsInstalled) return;
    v._customControlsInstalled = true;
    // 单击视频画面：切换播放 / 暂停（即使缓冲中也生效，不会被原生 controls disabled 挡住）
    v.addEventListener('click', (e) => {
      try {
        if (e.target !== v) return; // 点击的不是 video 本身（子元素）不处理
        if (v.paused || v.ended) { const p = v.play(); if (p && typeof p.catch === 'function') p.catch(() => {}); }
        else { try { v.pause(); } catch (_) {} }
      } catch (_) {}
    });
    // 双击视频画面：切换全屏
    v.addEventListener('dblclick', (e) => {
      try {
        if (e.target !== v) return;
        const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
        if (fsEl) { (document.exitFullscreen || document.webkitExitFullscreen).call(document); }
        else { const r = v.requestFullscreen || v.webkitRequestFullscreen; if (r) r.call(v); }
      } catch (_) {}
    });
  });
  // 全局键盘快捷键（空格键播放/暂停，F 全屏，← 10s，→ 10s）
  document.addEventListener('keydown', (e) => {
    try {
      // 输入框里不触发
      const tg = e.target;
      if (tg && (tg.tagName === 'INPUT' || tg.tagName === 'TEXTAREA' || tg.isContentEditable)) return;
      const v =
        (document.fullscreenElement && document.fullscreenElement.tagName === 'VIDEO' ? document.fullscreenElement : null) ||
        (() => {
          const o = document.getElementById('video-overlay');
          if (o && !o.classList.contains('hidden')) return document.getElementById('video-player');
          const dp = document.getElementById('detail-player');
          if (dp && dp.src) return dp;
          return null;
        })();
      if (!v) return;
      if (e.code === 'Space') {
        e.preventDefault();
        if (v.paused || v.ended) { const p = v.play(); if (p && typeof p.catch === 'function') p.catch(() => {}); }
        else { try { v.pause(); } catch (_) {} }
      } else if (e.key === 'f' || e.key === 'F') {
        const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
        if (fsEl) { (document.exitFullscreen || document.webkitExitFullscreen).call(document); }
        else { const r = v.requestFullscreen || v.webkitRequestFullscreen; if (r) r.call(v); }
      } else if (e.code === 'ArrowRight') {
        try { v.currentTime = Math.min((v.duration || 0) - 0.1, (v.currentTime || 0) + 10); } catch (_) {}
      } else if (e.code === 'ArrowLeft') {
        try { v.currentTime = Math.max(0, (v.currentTime || 0) - 10); } catch (_) {}
      } else if (e.code === 'ArrowUp') {
        e.preventDefault();
        try { v.volume = Math.min(1, (v.volume || 0) + 0.1); } catch (_) {}
      } else if (e.code === 'ArrowDown') {
        e.preventDefault();
        try { v.volume = Math.max(0, (v.volume || 0) - 0.1); } catch (_) {}
      }
    } catch (_) {}
  });
}
function _resetVideoForNext(player) {
  if (!player) return;
  try { player.pause(); } catch (_) {}
  // 清理旧的进度保存定时器（详情页 3s 定时写 DB）
  try { if (player._progSaveInterval) { clearInterval(player._progSaveInterval); } } catch (_) {}
  try {
    // 递增播放令牌：旧回调即使触发也会因为 token 不一致而被直接 return，防止竞态
    const prev = Number(player._playToken) || 0;
    player._playToken = prev + 1;
  } catch (_) {}
  try {
    // 取消尚未执行的 rAF（避免旧的 rAF 在新 src 加载后还在刷旧进度）
    if (player._rafTimer) { try { cancelAnimationFrame(player._rafTimer); } catch (_) {} }
    player._rafTimer = 0;
    player._rafDirty = false;
    player._rafLastTime = 0;
  } catch (_) {}
  _detachAllVideoEvents(player);
  try { player.removeAttribute('src'); } catch (_) {}
  try { player.setAttribute('src', ''); } catch (_) {}
  try { player.load(); } catch (_) {}
}
// ===== 视频资源释放工具（防止切课时解码帧内存堆积） =====
function _disposeVideo(player) {
  if (!player) return;
  _resetVideoForNext(player);
  try { if (player.parentNode) player.parentNode.removeChild(player); } catch (_) {}
  // 清掉已挂的监听器临时标记
  try { Object.keys(player).forEach(k => { if (k && k.indexOf('_wmBlock_') === 0) delete player[k]; }); } catch (_) {}
}
function _sweepVideoMemory() {
  // 清掉除了 detail-player / video-player（两个主播放器）之外的一切 video 临时元素
  const keepIds = new Set(['detail-player', 'video-player']);
  const all = Array.from(document.querySelectorAll('video'));
  all.forEach(v => { if (!keepIds.has(v.id)) _disposeVideo(v); });
  // 提示 GC 回收（Electron 支持 --js-flags='--expose-gc'，不支持也不会报错）
  try { if (typeof window.gc === 'function') window.gc(); } catch (_) {}
}
// ===== 进度条安全 seek 工具：带 token 校验 + 等待元数据就绪 + 防抖 =====
function _bindProgressSlider(player, slider, textEl, tokenRefObj) {
  if (!slider || !player) return;
  try { slider.oninput = null; slider.onchange = null; } catch (_) {}
  let _pendingSeekTime = -1;
  let _inputActive = false;
  let _seekDebounceTimer = 0;
  player._seekInFlight = false;
  // 🔴 新增：_lastCommitted 保存最后一次有效的 seek 时间值（秒），
  //    无论缓冲/播放/暂停，用户点击进度条立刻更新滑块位置到 UI，
  //    实际 currentTime/fastSeek 调用在"缓冲结束/playing/seeked 事件"时才真正执行。
  player._lastCommitted = null;
  // 🔴 新增：缓冲/暂停状态下主动提交最后一次点击的 seek（解决"缓冲时点不动"）
  const _flushLastCommitted = () => {
    try {
      const tok = tokenRefObj ? tokenRefObj.current : player._playToken;
      if ((player._playToken || 0) !== (tok || 0)) return;
      const t = player._lastCommitted;
      if (typeof t !== 'number' || !isFinite(t)) return;
      if (player._seekInFlight) return;
      if (!player.duration || !isFinite(player.duration)) return;
      player._lastCommitted = null;
      player._seekInFlight = true;
      // 🔴 看门狗：根据视频时长动态调整（长视频 OSS 定位慢，需要更长的等待时间）
      //    短视频 350ms，长视频（>30min）最多 3000ms
      const wdMs = player.duration && player.duration > 1800 ? Math.min(3000, player.duration * 1000 * 0.03) : 350;
      const wd = setTimeout(() => { try { player._seekInFlight = false; } catch (_) {} }, wdMs);
      const onSeekedOrErr = () => {
        try { clearTimeout(wd); } catch (_) {}
        try { player.removeEventListener('seeked', onSeekedOrErr); } catch (_) {}
        try { player.removeEventListener('error', onSeekedOrErr); } catch (_) {}
        try { player.removeEventListener('abort', onSeekedOrErr); } catch (_) {}
        try { player.removeEventListener('canplay', onSeekedOrErr); } catch (_) {}
        player._seekInFlight = false;
        // 如果 seek 期间又有新的点击，排队到 seek 完成后执行
        if (typeof player._lastCommitted === 'number') setTimeout(_flushLastCommitted, 0);
      };
      try { player.addEventListener('seeked', onSeekedOrErr, { once: true }); } catch (_) {}
      try { player.addEventListener('error', onSeekedOrErr, { once: true }); } catch (_) {}
      try { player.addEventListener('abort', onSeekedOrErr, { once: true }); } catch (_) {}
      // 🔴 不再监听 waiting/stalled！长视频后半段 seek 时 waiting 秒触发，
      //    如果秒清 _seekInFlight → 用户再点 → 取消旧 seek → 发新 Range → 又 waiting → 死循环
      //    现在：只等 seeked/error/abort/看门狗，用户点一次就排队等 seek 完成，不会反复取消
      try { player.addEventListener('canplay', onSeekedOrErr, { once: true }); } catch (_) {}
      try {
        if (typeof player.fastSeek === 'function') player.fastSeek(t);
        else player.currentTime = t;
      } catch (_) { try { player.currentTime = t; } catch (_2) {} }
    } catch (_) { try { player._seekInFlight = false; } catch (_2) {} }
  };
  const commitSeekSafe = (pct) => {
    const tok = tokenRefObj ? tokenRefObj.current : player._playToken;
    if ((player._playToken || 0) !== (tok || 0)) return;
    if (!player.duration || !isFinite(player.duration) || player.duration <= 0) {
      player._seekQueuedTime = pct;
      return;
    }
    const t = (parseFloat(pct) / 100) * player.duration;
    if (!isFinite(t) || t < 0) return;
    const clamped = Math.min(Math.max(t, 0), Math.max(player.duration - 0.1, 0));
    // 🔴 立刻记录最后一次点击的目标时间（秒），UI 层滑块已经更新了，不需要等 Chromium
    player._lastCommitted = clamped;
    // 如果当前完全空闲（不缓冲不 seeking），立刻 flush
    if (!player._seekInFlight) setTimeout(_flushLastCommitted, 0);
  };
  slider.oninput = () => {
    _inputActive = true;
    const v = parseFloat(slider.value);
    if (textEl) {
      const p = Math.round(v);
      if (textEl.textContent !== p + '%') textEl.textContent = p + '%';
    }
    player._seekingFromUser = true;
    _pendingSeekTime = v;
    if (_seekDebounceTimer) try { clearTimeout(_seekDebounceTimer); } catch (_) {}
    _seekDebounceTimer = setTimeout(() => {
      if (_inputActive) commitSeekSafe(slider.value);
    }, 60);
  };
  slider.onchange = () => {
    const v = parseFloat(slider.value);
    if (_seekDebounceTimer) try { clearTimeout(_seekDebounceTimer); } catch (_) {}
    _pendingSeekTime = -1;
    _inputActive = false;
    commitSeekSafe(v);
    setTimeout(() => { try { player._seekingFromUser = false; } catch (_) {} }, 300);
  };
  const origReady = player.onloadedmetadata;
  player.onloadedmetadata = (function(old) {
    return function() {
      const tok = tokenRefObj ? tokenRefObj.current : player._playToken;
      if ((player._playToken || 0) === (tok || 0)) {
        const q = player._seekQueuedTime;
        if (typeof q === 'number' && q >= 0 && q <= 100) {
          player._seekQueuedTime = undefined;
          try {
            if (player.duration && isFinite(player.duration)) {
              commitSeekSafe(q);
            }
          } catch (_) {}
        }
      }
      if (typeof old === 'function') try { old.apply(this, arguments); } catch (_) {}
    };
  })(origReady);
}
// ===== timeupdate 的 rAF 节流包装：把高频回调合并到浏览器下一帧再更新 UI =====
function _makeThrottledTimeupdate(player, slider, textEl, tokenRefObj) {
  return function _throttledTimeupdate() {
    const tok = tokenRefObj ? tokenRefObj.current : player._playToken;
    if ((player._playToken || 0) !== (tok || 0)) return; // 视频已切换，作废
    // 正在手动拖动 slider：不自动刷新，避免两者"互相拉锯"导致拖动卡死
    if (player._seekingFromUser || player.seeking) return;
    if (player._rafDirty) return;
    player._rafDirty = true;
    player._rafTimer = requestAnimationFrame(() => {
      player._rafDirty = false;
      if ((player._playToken || 0) !== (tok || 0)) return;
      if (!player.duration || !isFinite(player.duration)) return;
      const cur = Number(player.currentTime) || 0;
      const dur = player.duration;
      if (dur <= 0) return;
      // 与上一帧对比：没有变化就不操作 DOM（减少重排/重绘）
      if (Math.abs((cur || 0) - (player._rafLastTime || 0)) < 0.05) return;
      player._rafLastTime = cur;
      const pct = Math.min(100, Math.max(0, (cur / dur) * 100));
      if (slider) {
        const nvpct = Number(slider.value);
        // 只有当差异超过 0.3% 时才赋值（防止 <input type=range> 自身拖动卡顿）
        if (!isFinite(nvpct) || Math.abs(nvpct - pct) >= 0.3) slider.value = String(pct);
      }
      if (textEl) {
        const rounded = Math.round(pct);
        const want = rounded + '%';
        if (textEl.textContent !== want) textEl.textContent = want;
      }
    });
  };
}

// ===== 视频预加载：不再常驻 <video>（解码帧会吃内存），改用 <link rel="preload"> 仅让网络层预热几 MB =====
let preloadedUrl = '';
let preloadLinkEl = null;
function preloadNextVideo(url) {
  if (!url || preloadedUrl === url) return;
  const proxied = _toProxyVideoUrl(url);
  preloadedUrl = proxied;
  try {
    if (preloadLinkEl && preloadLinkEl.parentNode) preloadLinkEl.parentNode.removeChild(preloadLinkEl);
    const link = document.createElement('link');
    link.rel = 'preload';
    link.as = 'video';
    link.href = proxied;
    // 让代理至少拉 8MB 头部（不需要解码，只做 HTTP 层缓存）
    link.setAttribute('imagesrcset', '');
    const head = document.head || document.getElementsByTagName('head')[0];
    head.appendChild(link);
    preloadLinkEl = link;
    // 5 秒后移除 preload，避免长期占用资源
    setTimeout(() => { if (preloadLinkEl === link && link.parentNode) link.parentNode.removeChild(link); }, 5000);
    console.log('[预加载] 下一个视频（HTTP 层预热）:', (url || '').split('/').pop());
  } catch (_) {}
}

function formatDuration(seconds) {
  if (!seconds || isNaN(seconds) || seconds <= 0) return '00:00';
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = (m < 10 ? '0' : '') + m;
  const ss = (sec < 10 ? '0' : '') + sec;
  return h > 0 ? h + ':' + mm + ':' + ss : mm + ':' + ss;
}
