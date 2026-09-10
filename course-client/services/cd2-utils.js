// ============================================================
//  CD2 工具函数 — 文件判断、自然排序、超时、路径拼接
// ============================================================

function _isDir(f) {
  if (!f) return false;
  if (typeof f.isDir === 'boolean') return f.isDir;
  if (typeof f.folder === 'boolean') return f.folder;
  if (typeof f.type === 'string') return f.type === 'folder' || f.type === 'dir';
  if (f.kind) return f.kind === 'folder';
  return false;
}
function _fileName(f) {
  return f.name || f.title || f.fileName || '';
}
function _fileSize(f) {
  const s = f.size != null ? f.size : f.fileSize != null ? f.fileSize : f.length;
  return Number(s) || 0;
}
function _directUrl(f) {
  return f.directUrl || f.url || f.download_url || f.downloadUrl || f.href || '';
}
function _directUrlDomain(f) {
  return f.directUrlDomain || f.directUrl || f.url || f.download_url || f.downloadUrl || f.href || '';
}
function _directUrlLocal(f) {
  return f.directUrlLocal || f.directUrl || f.url || f.download_url || f.downloadUrl || f.href || '';
}
function _videoExt(name) {
  return /\.(mp4|mkv|avi|flv|mov|wmv|webm|m4v|ts|mpg|mpeg)$/i.test(name || '');
}
function _docExt(name) {
  return /\.(pdf|doc|docx|ppt|pptx|txt|md|xls|xlsx|rtf|zip|rar|7z)$/i.test(name || '');
}

/** 自然排序：把文件名里的数字按数值大小比较 */
function _naturalCmpStr(a, b) {
  const sa = String(a || ''), sb = String(b || '');
  const reA = /(\d+)|(\D+)/g;
  const reB = /(\d+)|(\D+)/g;
  let ma, mb;
  while (true) {
    ma = reA.exec(sa);
    mb = reB.exec(sb);
    if (!ma && !mb) return 0;
    if (!ma) return -1;
    if (!mb) return 1;
    if (ma[1] && mb[1]) {
      const na = parseInt(ma[1], 10), nb = parseInt(mb[1], 10);
      if (na !== nb) return na - nb;
    } else {
      const ca = ma[0].toLowerCase(), cb = mb[0].toLowerCase();
      if (ca !== cb) return ca < cb ? -1 : 1;
    }
  }
}
/** 对 CD2 ls 返回的文件数组，按文件名自然排序（原地修改并返回） */
function _sortByFileName(arr) {
  if (!Array.isArray(arr) || arr.length < 2) return arr;
  return arr.sort((x, y) => _naturalCmpStr(_fileName(x), _fileName(y)));
}

function _cd2Timeout(p, ms, tip) {
  return new Promise((resolve, reject) => {
    let done = false;
    const t = setTimeout(() => {
      if (!done) {
        done = true;
        reject(new Error((tip || 'CloudDrive2 连接超时') + `（超过 ${Math.round(ms/1000)} 秒，请检查：1) CD2 本地服务是否已启动；2) endpoint 地址端口是否正确；3) Token 是否有效）`));
      }
    }, ms);
    Promise.resolve(p).then(r => { if (!done) { done = true; clearTimeout(t); resolve(r); } })
                     .catch(e => { if (!done) { done = true; clearTimeout(t); reject(e); } });
  });
}

/** 把路径拼起来（避免双斜杠） */
function _joinPath(base, name) {
  if (!base || base === '/') return '/' + name;
  return (base.endsWith('/') ? base.slice(0, -1) : base) + '/' + name;
}

function _stripTrailing(s) {
  return String(s || '').replace(/\/+$/, '');
}

function formatDuration(size) {
  if (!size || size <= 0) return '00:00';
  const minutes = Math.round(size / (2 * 1024 * 1024));
  if (minutes <= 0) return '00:00';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:00`;
  return `${String(m).padStart(2, '0')}:00`;
}

module.exports = {
  _isDir, _fileName, _fileSize, _directUrl, _directUrlDomain, _directUrlLocal,
  _videoExt, _docExt, _naturalCmpStr, _sortByFileName,
  _cd2Timeout, _joinPath, _stripTrailing, formatDuration,
};