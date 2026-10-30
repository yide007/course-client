// ===================== 115 网盘播放源统一决策（隔离模块）=====================
// 目的：
//   - 课程详情页 / 网盘选择器共用同一套"怎么播"的判定，避免多处各自堆叠播放逻辑（降低耦合）
//   - 规则：原生 <video> 播不了的容器（flv/ts/mkv/avi…）→ 主进程下载 + ffmpeg 转封装成 MP4 再播
//           浏览器原生可解码（mp4/webm/mov/ogg 等）→ 本地 /stream（指纹头 + Range 直达 CDN）或 m3u8 /hls 边下边播
// 通过 window.P115Play 暴露；需在使用方（course-detail / course-modal）之前加载。
(function () {
  const api = window.electronAPI;

  // 本地媒体代理端口（带缓存，避免每个课时重复询问）
  let _portCache = 0;
  async function _mediaPort() {
    if (_portCache) return _portCache;
    try {
      const r = (typeof api.getMediaProxyPort === 'function') ? await api.getMediaProxyPort() : null;
      _portCache = Number(r && r.port) || 0;
    } catch (_) { _portCache = 0; }
    return _portCache;
  }

  // 从文件名取扩展名
  function extOf(fileName) {
    return (String(fileName || '').split('.').pop() || '').toLowerCase();
  }
  // 原生 <video> 无法直接解码的容器集合（需下载 + ffmpeg 转封装成 MP4 才能由原生 <video> 播放）
  const NON_NATIVE_EXT = ['flv', 'ts', 'm2ts', 'mts', 'mkv', 'avi', 'wmv', 'asf', 'mpg', 'mpeg', 'vob', 'rm', 'rmvb', '3gp'];
  // 是否需走"下载 + 转封装"（含 FLV / TS 等浏览器原生播不了的容器）
  function needsRemux(fileName) {
    return NON_NATIVE_EXT.indexOf(extOf(fileName)) !== -1;
  }
  // 兼容旧名：是否 FLV
  function isFlv(fileName) {
    return extOf(fileName) === 'flv';
  }
  // mpegts.js 能直解的容器扩展名（TS/FLV 等，零转码，真·首播秒开，不含 mkv/avi/rmvb 等）
  function canMpegts(fileName) {
    var e = extOf(fileName);
    return e === 'ts' || e === 'm2ts' || e === 'mts' || e === 'flv';
  }
  // 优先尝试 <video> 原生播放的容器（Chrome 实际支持 H.264+AAC 的 MKV，直链秒开无需转码）
  // 失败后自动降级到 ffmpeg 转封装兜底
  var NATIVE_FIRST_EXT = ['mkv'];
  function canNativeFirst(fileName) {
    return NATIVE_FIRST_EXT.indexOf(extOf(fileName)) !== -1;
  }

  // 把原画直链包装成本地流式代理地址（边下边播 + 支持 seek）：
  //   优先用后端已生成好的 127.0.0.1 代理地址；否则按是否 m3u8 构造 /hls 或 /stream。
  async function resolveStreamUrl(directUrl, backendStreamUrl) {
    if (!directUrl) return '';
    if (backendStreamUrl && /^https?:\/\/(127\.0\.0\.1|localhost)/i.test(backendStreamUrl)) {
      return backendStreamUrl;
    }
    const port = await _mediaPort();
    if (!port) return directUrl;
    const isHls = /\.m3u8/i.test(directUrl) || /videoplay\.115\.com\/m3u8/i.test(directUrl);
    return (isHls ? 'http://127.0.0.1:' + port + '/hls?src=' : 'http://127.0.0.1:' + port + '/stream?src=') + encodeURIComponent(directUrl);
  }

  // FLV：主进程下载 → ffmpeg remux 成 fMP4 → 返回 { success, filePath, duration }。
  // onProgress：{ stage:'download', value } | { stage:'remux' }
  function playFlvAsRemux(cfgId, pickCode, onProgress) {
    if (!api || typeof api.remux115FlvToMp4 !== 'function') {
      return Promise.resolve({ success: false, error: 'ffmpeg 未就绪' });
    }
    var off = null;
    if (onProgress && typeof api.onRemuxProgress === 'function') {
      off = api.onRemuxProgress(function (p) { try { onProgress(p); } catch (_) {} });
    }
    return Promise.resolve(api.remux115FlvToMp4(cfgId, pickCode)).finally(function () {
      if (typeof off === 'function') { try { off(); } catch (_) {} }
    });
  }

  // 尝试用 mpegts.js（已内置 Window.mpegts）直解播放 TS/FLV/M2TS。
  // 返回 { success: true } 时 mpegts 已 attach 到 player，播放就绪；返回 { success:false } 时调用方降级到下一层。
  // timeoutMs 超时未收到 mediaInfo 视为失败。
  function tryMpegts(player, url, timeoutMs) {
    if (!player || !url) return Promise.resolve({ success: false, error: '参数不足' });
    if (typeof window.mpegts === 'undefined') return Promise.resolve({ success: false, error: 'mpegts.js 未加载' });

    // 先清理之前可能残留的 mpegts 实例
    if (player._p115Mpegts) {
      try { player._p115Mpegts.unload(); } catch (_) {}
      try { player._p115Mpegts.detachMediaElement(); } catch (_) {}
      try { player._p115Mpegts.destroy(); } catch (_) {}
      player._p115Mpegts = null;
    }
    delete player._p115MpegtsReady;

    // 从 URL 取扩展名判断 type（也有利于直接喂 streamUrl 判断格式）
    var ext = (String(url).split('?')[0] || '').split('.').pop().toLowerCase();
    var dataType = (ext === 'flv') ? 'flv' : 'mpegts';

    return new Promise(function (resolve) {
      var done = false;
      var finish = function (result) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        console.log('[115] mpegts 结束 reason=' + (result.error || 'success') + ' success=' + result.success);
        if (!result.success) {
          try { mp.unload(); } catch (_) {}
          try { mp.detachMediaElement(); } catch (_) {}
          try { mp.destroy(); } catch (_) {}
          player._p115Mpegts = null;
          delete player._p115MpegtsReady;
        }
        resolve(result);
      };

      var timer = setTimeout(function () {
        try { if (mp) mp.unload(); } catch (_) {}
        finish({ success: false, error: 'mpegts 解码超时（' + (timeoutMs || 10000) + 'ms）' });
      }, timeoutMs || 10000);

      var mp;
      try {
        mp = mpegts.createPlayer({
          type: dataType,
          isLive: false,
          url: url,
        }, {
          enableWorker: true,
          lazyLoad: true,
          autoCleanupSourceBuffer: true,
        });
      } catch (e) {
        clearTimeout(timer);
        return resolve({ success: false, error: 'mpegts 初始化失败: ' + e.message });
      }

      player._p115Mpegts = mp;

      mp.on(mpegts.Events.ERROR, function (_type, info) {
        console.log('[115] mpegts 解码错误:', (info && info.msg) || '');
        finish({ success: false, error: (info && info.msg) || 'decode error' });
      });

      mp.on(mpegts.Events.MEDIA_INFO, function (info) {
        console.log('[115] mpegts mediaInfo 就绪 duration=' + (info && info.duration));
        finish({ success: true });
      });

      mp.attachMediaElement(player);
      mp.load();
      setTimeout(function () { if (!done) player.play().catch(function () {}); }, 200);
    });
  }

  // 流式转封装（方案A）：ffmpeg 以 /stream 为输入实时封装成 fMP4 → /watch 边转边播。
  // 返回 { success, watchUrl } 时调用方直接设 player.src=watchUrl；失败降级到 playFlvAsRemux（方案B 整片兜底）。
  // 覆盖 mkv/avi/rmvb 等 mpegts.js 不支持的格式，以及 TS/FLV 在 mpegts 解析失败时的降级。
  function playStreamingRemux(cfgId, pickCode) {
    if (!api || typeof api.remux115FlvStream !== 'function') {
      return Promise.resolve({ success: false, error: '流式转封装未就绪' });
    }
    return Promise.resolve(api.remux115FlvStream(cfgId, pickCode)).then(function (r) {
      if (r && r.success && r.watchUrl) {
        console.log('[115] 流式转封装 watchUrl=' + String(r.watchUrl).slice(0, 100) + ' total=' + r.total);
        return { success: true, watchUrl: r.watchUrl, total: r.total };
      }
      return { success: false, error: (r && r.error) || '流式启动失败' };
    }, function (e) {
      return { success: false, error: (e && e.message) || '流式转封装异常' };
    });
  }

  window.P115Play = { extOf: extOf, isFlv: isFlv, needsRemux: needsRemux, canMpegts: canMpegts, canNativeFirst: canNativeFirst, resolveStreamUrl: resolveStreamUrl, tryMpegts: tryMpegts, playStreamingRemux: playStreamingRemux, playFlvAsRemux: playFlvAsRemux };
})();