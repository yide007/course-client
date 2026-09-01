const http = require('http');

// ============================================================
// CloudDrive2 gRPC-Web Client
// 基于 clouddrive.proto 的定义
// ============================================================
function createClient({ endpoint, token }) {
  let host = endpoint || '127.0.0.1';
  let port = 19798;
  let useHttps = false;

  if (/^https:\/\//i.test(host)) {
    useHttps = true;
  } else if (/^http:\/\//i.test(host)) {
    useHttps = false;
  }
  host = host.replace(/^https?:\/\//i, '');
  host = host.replace(/\/+$/, '');
  if (host.includes(':')) {
    const parts = host.split(':');
    host = parts[0];
    port = parseInt(parts[1]) || 19798;
  }

  // ---- Protobuf helpers ----
  function encodeVarint(value) {
    value = value >>> 0;
    if (value < 0) value = 0;
    const bytes = [];
    while (value >= 0x80) {
      bytes.push((value & 0x7f) | 0x80);
      value = (value / 128) | 0;
    }
    bytes.push(value);
    return Buffer.from(bytes);
  }

  function decodeVarint(buf, offset) {
    let result = 0;
    let shift = 0;
    let pos = offset;
    while (pos < buf.length) {
      const b = buf[pos++];
      result |= (b & 0x7f) << shift;
      if ((b & 0x80) === 0) break;
      shift += 7;
    }
    return { value: result >>> 0, bytesRead: pos - offset };
  }

  // 构造 protobuf: ListSubFileRequest { string path = 1; bool forceRefresh = 2; }
  function encodeListSubFileRequest(path, forceRefresh) {
    const parts = [];
    const pathBuf = Buffer.from(path || '', 'utf8');
    parts.push(Buffer.from([0x0a])); // field 1, wire 2 (length-delimited)
    parts.push(encodeVarint(pathBuf.length));
    parts.push(pathBuf);
    if (forceRefresh) {
      parts.push(Buffer.from([0x10, 0x01])); // field 2, wire 0, value 1
    }
    return Buffer.concat(parts);
  }

  // 构造 protobuf: StringValue { string value = 1; }
  function encodeStringValue(val) {
    const parts = [];
    const vb = Buffer.from(val || '', 'utf8');
    parts.push(Buffer.from([0x0a]));
    parts.push(encodeVarint(vb.length));
    parts.push(vb);
    return Buffer.concat(parts);
  }

  // 解析 protobuf: CloudDriveFile
  // 关键字段: name=2, fullPathName=3, size=4, fileType=5, isDirectory=30, downloadUrlPath=76
  function parseCloudDriveFile(buf) {
    const f = {
      id: '', name: '', fullPathName: '', size: 0, fileType: 1,
      isDirectory: false, thumbnailUrl: '', previewUrl: '',
      downloadUrlPath: null, directUrl: '', readOnly: false,
    };
    let offset = 0;
    let fieldLog = [];
    while (offset < buf.length) {
      if (offset >= buf.length) break;
      const tagVi = decodeVarint(buf, offset);
      offset += tagVi.bytesRead;
      const tag = tagVi.value;
      const fieldNum = tag >> 3;
      const wireType = tag & 0x07;

      if (wireType === 2) { // length-delimited (string, bytes, message)
        const lenVi = decodeVarint(buf, offset);
        offset += lenVi.bytesRead;
        const len = lenVi.value;
        const data = buf.slice(offset, offset + len);
        offset += len;

        fieldLog.push({ fieldNum, wireType, len, preview: data.toString('utf8').substring(0, 40) });
        switch (fieldNum) {
          case 1: f.id = data.toString('utf8'); break;
          case 2: f.name = data.toString('utf8'); break;
          case 3: f.fullPathName = data.toString('utf8'); break;
          case 10: f.thumbnailUrl = data.toString('utf8'); break;
          case 11: f.previewUrl = data.toString('utf8'); break;
          case 14: f.originalPath = data.toString('utf8'); break;
          case 76: f.downloadUrlPath = parseDownloadUrlPathInfo(data); break;
        }
      } else if (wireType === 0) { // varint
        const vi = decodeVarint(buf, offset);
        offset += vi.bytesRead;
        fieldLog.push({ fieldNum, wireType, value: vi.value });
        switch (fieldNum) {
          case 4:
            f.size = vi.value;
            break;
          case 5:
            f.fileType = vi.value; // 0=Directory, 1=File, 2=Other
            f.isDirectory = vi.value === 0;
            break;
          case 30: f.isDirectory = vi.value !== 0; break;
          case 31: f.isRoot = vi.value !== 0; break;
          case 80: f.readOnly = vi.value !== 0; break;
        }
      } else if (wireType === 1) { // 64-bit fixed
        offset += 8;
        fieldLog.push({ fieldNum, wireType: 1 });
      } else if (wireType === 5) { // 32-bit fixed
        offset += 4;
        fieldLog.push({ fieldNum, wireType: 5 });
      } else {
        break;
      }
    }
    // 调试：打印第一个文件的所有原始字段
    if (f.name) {
      console.log('[cd2-raw] 文件 %s 的原始 protobuf 字段: %j', f.name, fieldLog);
      if (!f.downloadUrlPath) {
        console.log('[cd2-raw] 警告: 文件 %s 没有 downloadUrlPath (字段76)!', f.name);
      }
    }
    return f;
  }

  function parseDownloadUrlPathInfo(buf) {
    const result = { downloadUrlPath: '', directUrl: '', userAgent: '', additionalHeaders: {} };
    let offset = 0;
    while (offset < buf.length) {
      if (offset >= buf.length) break;
      const tagVi = decodeVarint(buf, offset);
      offset += tagVi.bytesRead;
      const fieldNum = tagVi.value >> 3;
      const wireType = tagVi.value & 0x07;
      if (wireType === 2) {
        const vi = decodeVarint(buf, offset);
        offset += vi.bytesRead;
        const len = vi.value;
        const data = buf.slice(offset, offset + len);
        offset += len;
        if (fieldNum === 1) result.downloadUrlPath = data.toString('utf8');
        if (fieldNum === 3) result.directUrl = data.toString('utf8');
        if (fieldNum === 4) result.userAgent = data.toString('utf8');
      } else if (wireType === 0) {
        const vi = decodeVarint(buf, offset);
        offset += vi.bytesRead;
        result.expiresIn = vi.value;
      } else {
        break;
      }
    }
    return result;
  }

  // 解析 SubFilesReply { repeated CloudDriveFile subFiles = 1; }
  function parseSubFilesReply(buf) {
    const files = [];
    let offset = 0;
    while (offset < buf.length) {
      if (offset >= buf.length) break;
      const tagVi = decodeVarint(buf, offset);
      offset += tagVi.bytesRead;
      const fieldNum = tagVi.value >> 3;
      const wireType = tagVi.value & 0x07;
      if (wireType === 2 && fieldNum === 1) {
        const vi = decodeVarint(buf, offset);
        offset += vi.bytesRead;
        const len = vi.value;
        const data = buf.slice(offset, offset + len);
        offset += len;
        files.push(parseCloudDriveFile(data));
      } else if (wireType === 2) {
        const vi = decodeVarint(buf, offset);
        offset += vi.bytesRead;
        offset += vi.value;
      } else if (wireType === 0) {
        const vi = decodeVarint(buf, offset);
        offset += vi.bytesRead;
      } else {
        break;
      }
    }
    return files;
  }

  // ---- gRPC-Web framing ----
  function buildGrpcWebFrame(protoBody) {
    const header = Buffer.alloc(5);
    header[0] = 0; // 0 = uncompressed
    header.writeUInt32BE(protoBody.length, 1);
    return Buffer.concat([header, protoBody]);
  }

  function parseGrpcWebFrames(buffer) {
    const messages = [];
    let offset = 0;
    while (offset + 5 <= buffer.length) {
      const flags = buffer[offset];
      if (flags & 0x80) { // trailer
        const length = buffer.readUInt32BE(offset + 1);
        offset += 5 + length;
        break;
      }
      const length = buffer.readUInt32BE(offset + 1);
      offset += 5;
      if (offset + length > buffer.length) break;
      const body = buffer.slice(offset, offset + length);
      messages.push(body);
      offset += length;
    }
    return messages;
  }

  // ---- HTTP request ----
  function grpcWebUnary(servicePath, protoBody, extraHeaders) {
    return new Promise((resolve, reject) => {
      const framedBody = buildGrpcWebFrame(protoBody);

      const headers = Object.assign({
        'Content-Type': 'application/grpc-web+proto',
        'Accept': 'application/grpc-web+proto',
        'Content-Length': framedBody.length,
        'x-grpc-web': '1',
        'x-user-agent': 'grpc-web-javascript/0.1',
        'Host': host + ':' + port,
      }, extraHeaders || {});

      if (token) {
        headers['Authorization'] = 'Bearer ' + token;
      }

      const opts = {
        hostname: host,
        port,
        path: servicePath,
        method: 'POST',
        headers,
        timeout: 20000,
      };

      const transport = useHttps ? require('https') : http;
      const req = transport.request(opts, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const body = Buffer.concat(chunks);
          const grpcStatus = res.headers['grpc-status'];
          const grpcMessage = res.headers['grpc-message'];
          if (grpcStatus && grpcStatus !== '0') {
            return reject(new Error('gRPC Error (' + grpcStatus + '): ' + (grpcMessage || '') + '  (HTTP ' + res.statusCode + ')'));
          }
          if (res.statusCode === 401 || res.statusCode === 403) {
            return reject(new Error('认证失败（HTTP ' + res.statusCode + '）：请确认 Token 是否正确。响应：' + body.slice(0, 200).toString('utf8')));
          }
          if (res.statusCode === 404) {
            return reject(new Error('gRPC 服务路径不存在（HTTP 404）：' + servicePath));
          }
          if (res.statusCode === 405) {
            return reject(new Error('gRPC 服务方法不允许（HTTP 405）：请检查服务路径 ' + servicePath));
          }
          resolve({ status: res.statusCode, headers: res.headers, body });
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('连接超时：无法访问 ' + host + ':' + port)); });
      req.write(framedBody);
      req.end();
    });
  }

  function resolveFullUrl(rawUrl) {
    if (!rawUrl) return '';
    if (/^https?:\/\//i.test(rawUrl)) return rawUrl;
    const prefix = useHttps ? 'https://' : 'http://';
    const p = rawUrl.startsWith('/') ? rawUrl : '/' + rawUrl;
    let final = p;
    final = final.replace(/\{SCHEME\}/g, useHttps ? 'https' : 'http');
    final = final.replace(/\{HOST\}/g, host + ':' + port);
    final = final.replace(/\{PREVIEW\}/g, 'false');
    if (final.startsWith('/')) final = prefix + host + ':' + port + final;
    return final;
  }

  function getFullDirectUrl(pathOrInfo) {
    if (!pathOrInfo) return '';
    if (typeof pathOrInfo === 'string') {
      return resolveFullUrl(pathOrInfo);
    }
    // 并存兼容：优先用云盘返回的直链（带域名 CDN），fallback 到本地拼接
    const directResolved = pathOrInfo.directUrl ? resolveFullUrl(pathOrInfo.directUrl) : '';
    const downloadResolved = pathOrInfo.downloadUrlPath ? resolveFullUrl(pathOrInfo.downloadUrlPath) : '';
    // 优先返回已带域名的直链（非本地 host 的）；否则返回本地拼接的
    if (directResolved) {
      const localPrefix = (useHttps ? 'https://' : 'http://') + host + ':' + port;
      const isLocalDirect = directResolved.startsWith(localPrefix);
      if (!isLocalDirect) return directResolved; // 非本地的云盘 CDN 直链，优先用
    }
    return downloadResolved || directResolved;
  }

  function getBothDirectUrls(pathOrInfo) {
    if (!pathOrInfo) return { domain: '', local: '' };
    if (typeof pathOrInfo === 'string') {
      const resolved = resolveFullUrl(pathOrInfo);
      return { domain: resolved, local: resolved };
    }
    const domainUrl = pathOrInfo.directUrl ? resolveFullUrl(pathOrInfo.directUrl) : '';
    const localUrl = pathOrInfo.downloadUrlPath ? resolveFullUrl(pathOrInfo.downloadUrlPath) : (domainUrl || '');
    // 确保 domainUrl 是"非本地"的（带 CDN 域名），否则置空，让前端用 local
    const localPrefix = (useHttps ? 'https://' : 'http://') + host + ':' + port;
    const isDomainActuallyLocal = domainUrl && domainUrl.startsWith(localPrefix);
    return {
      domain: isDomainActuallyLocal ? '' : domainUrl,
      local: localUrl || (isDomainActuallyLocal ? domainUrl : ''),
    };
  }

  // 构造 protobuf: FindFileByPathRequest { string parentPath = 1; string path = 2; }
  function encodeFindFileByPathRequest(parentPath, path) {
    const parts = [];
    const parentBuf = Buffer.from(parentPath || '', 'utf8');
    parts.push(Buffer.from([0x0a])); // field 1, wire 2
    parts.push(encodeVarint(parentBuf.length));
    parts.push(parentBuf);
    const pathBuf = Buffer.from(path || '', 'utf8');
    parts.push(Buffer.from([0x12])); // field 2, wire 2
    parts.push(encodeVarint(pathBuf.length));
    parts.push(pathBuf);
    return Buffer.concat(parts);
  }

  const SERVICE_PATHS = [
    '/clouddrive.CloudDriveFileSrv/GetSubFiles',
    '/clouddrive/CloudDriveFileSrv/GetSubFiles',
    '/CloudDriveFileSrv/GetSubFiles',
    '/clouddrive.ClouddriveFileSrv/GetSubFiles',
    '/api.CloudDriveFileSrv/GetSubFiles',
    '/v1.CloudDriveFileSrv/GetSubFiles',
  ];

  const FIND_SERVICE_PATHS = [
    '/clouddrive.CloudDriveFileSrv/FindFileByPath',
    '/clouddrive/CloudDriveFileSrv/FindFileByPath',
    '/CloudDriveFileSrv/FindFileByPath',
    '/clouddrive.ClouddriveFileSrv/FindFileByPath',
    '/api.CloudDriveFileSrv/FindFileByPath',
    '/v1.CloudDriveFileSrv/FindFileByPath',
  ];

  async function tryGrpcCall(authOverride, dirPathOverride) {
    const normalized = dirPathOverride && dirPathOverride.startsWith('/') ? dirPathOverride : '/' + (dirPathOverride || '');
    const protoBody = encodeListSubFileRequest(normalized, false);

    for (const servicePath of SERVICE_PATHS) {
      try {
        const result = await grpcWebUnary(servicePath, protoBody, authOverride || {});
        const frames = parseGrpcWebFrames(result.body);
        
        let allFiles = [];
        for (const frame of frames) {
          allFiles = allFiles.concat(parseSubFilesReply(frame));
        }
        if (frames.length === 0 && result.body.length > 0) {
          allFiles = parseSubFilesReply(result.body);
        }
        
        if (allFiles.length > 0 || (result.status === 200 && result.body.length > 5)) {
          console.log('[cd2-grpc] 路径成功: ' + servicePath + ' → ' + allFiles.length + ' 项');
          return { files: allFiles, servicePath };
        }
      } catch (e) {
        if (e.message && (e.message.includes('404') || e.message.includes('405'))) {
          // 路径不对，试下一个
          continue;
        }
        throw e;
      }
    }
    return { files: [], servicePath: null, error: '所有 gRPC 路径均返回 404/405' };
  }

  async function findFileByPath(filePath, authOverride) {
    const normalized = filePath && filePath.startsWith('/') ? filePath : '/' + (filePath || '');
    const parentPath = normalized.substring(0, normalized.lastIndexOf('/')) || '/';
    const fileName = normalized.substring(normalized.lastIndexOf('/') + 1);
    const protoBody = encodeFindFileByPathRequest(parentPath, fileName);

    for (const servicePath of FIND_SERVICE_PATHS) {
      try {
        const result = await grpcWebUnary(servicePath, protoBody, authOverride || {});
        const frames = parseGrpcWebFrames(result.body);
        if (frames.length > 0) {
          const f = parseCloudDriveFile(frames[0]);
          console.log('[cd2] findFileByPath 成功: %s → downloadUrlPath=%s', normalized, f.downloadUrlPath ? '有' : '无');
          return f;
        }
        if (result.body.length > 5) {
          const f = parseCloudDriveFile(result.body);
          if (f.name) {
            console.log('[cd2] findFileByPath 成功(无frame): %s → downloadUrlPath=%s', normalized, f.downloadUrlPath ? '有' : '无');
            return f;
          }
        }
      } catch (e) {
        if (e.message && (e.message.includes('404') || e.message.includes('405'))) {
          continue;
        }
        console.log('[cd2] findFileByPath 失败 %s: %s', servicePath, e.message);
      }
    }
    return null;
  }

  function formatFile(f, both) {
    // 如果没有 downloadUrlPath，使用 fullPathName 构造回退 URL
    if (!both.domain && !both.local && f.fullPathName) {
      const encodedPath = f.fullPathName.split('/').map(seg => encodeURIComponent(seg)).join('/');
      const finalPath = encodedPath.replace(/^%2F/, '/');
      const fallbackUrl = resolveFullUrl(finalPath);
      both = { domain: fallbackUrl, local: fallbackUrl };
      console.log('[cd2] 使用 fullPath 构造 URL: %s → %s', f.fullPathName, fallbackUrl);
    }
    return {
      name: f.name,
      isDir: !!f.isDirectory,
      size: Number(f.size) || 0,
      type: f.isDirectory ? 'folder' : 'file',
      directUrl: both.domain || both.local || '',
      directUrlDomain: both.domain || '',
      directUrlLocal: both.local || '',
      fullPath: f.fullPathName,
      readOnly: !!f.readOnly,
    };
  }

  async function ls(dirPath) {
    const normalized = dirPath && dirPath.startsWith('/') ? dirPath : '/' + (dirPath || '');
    console.log('[cd2-grpc] ls ' + normalized);

    const authList = [
      { label: 'Bearer', extra: {} },
      { label: 'X-Token', extra: { Authorization: null, 'X-Token': token } },
      { label: 'X-API-Token', extra: { Authorization: null, 'X-API-Token': token } },
      { label: 'CD2-Token', extra: { Authorization: null, 'CD2-Token': token } },
      { label: '无Authorization', extra: { Authorization: null } },
    ];

    let lastError = null;
    for (const auth of authList) {
      try {
        console.log('[cd2-grpc] 尝试认证方式: ' + auth.label);
        const r = await tryGrpcCall(auth.extra, normalized);
        if (r.files.length > 0) {
          // 先处理所有文件，收集缺少 downloadUrlPath 的文件
          const result = [];
          const needFallback = [];
          for (const f of r.files) {
            let both = f.downloadUrlPath ? getBothDirectUrls(f.downloadUrlPath) : { domain: '', local: '' };
            if (!both.domain && !both.local && f.fullPathName && !f.isDirectory) {
              needFallback.push({ f, both });
            } else {
              result.push(formatFile(f, both));
            }
          }
          // 对缺少 downloadUrlPath 的非目录文件，尝试 findFileByPath 获取详情
          if (needFallback.length > 0) {
            console.log('[cd2] 有 %d 个文件缺少 downloadUrlPath，尝试 FindFileByPath...', needFallback.length);
            for (const item of needFallback) {
              try {
                const detail = await findFileByPath(item.f.fullPathName, auth.extra);
                if (detail && detail.downloadUrlPath) {
                  const both = getBothDirectUrls(detail.downloadUrlPath);
                  console.log('[cd2] FindFileByPath 获取到下载链接: %s', item.f.name);
                  result.push(formatFile(item.f, both));
                } else {
                  // 仍然没有 downloadUrlPath，使用 fullPathName 回退
                  result.push(formatFile(item.f, item.both));
                }
              } catch (e) {
                console.log('[cd2] FindFileByPath 失败: %s, 使用回退', item.f.name);
                result.push(formatFile(item.f, item.both));
              }
            }
          }
          return result;
        } else {
          lastError = new Error('认证[' + auth.label + ']成功但没有返回文件');
        }
      } catch (e) {
        console.log('[cd2-grpc]   认证[' + auth.label + ']失败: ' + e.message);
        lastError = e;
      }
    }
    throw lastError || new Error('所有方式均失败');
  }

  // ============================================================
  //  readdir / stat / getDownloadUrl — 兼容 RESTful 风格的 API
  // ============================================================

  async function readdir(dirPath) {
    const items = await ls(dirPath);
    return items.map(item => ({
      name: item.name,
      isDirectory: item.isDir,
      size: item.size,
      type: item.type,
    }));
  }

  async function stat(filePath) {
    const file = await findFileByPath(filePath);
    if (!file) throw new Error('文件不存在: ' + filePath);
    return {
      name: file.name,
      isFile: !file.isDirectory,
      isDirectory: file.isDirectory,
      size: Number(file.size) || 0,
    };
  }

  async function getDownloadUrl(filePath) {
    const file = await findFileByPath(filePath);
    if (!file) throw new Error('文件不存在: ' + filePath);
    if (file.isDirectory) throw new Error('不是文件，是目录: ' + filePath);
    if (file.downloadUrlPath) {
      const both = getBothDirectUrls(file.downloadUrlPath);
      const url = both.domain || both.local || '';
      if (url) return { url };
    }
    // fallback: 用 fullPathName 构造
    if (file.fullPathName) {
      const encodedPath = file.fullPathName.split('/').map(seg => encodeURIComponent(seg)).join('/').replace(/^%2F/, '/');
      return { url: resolveFullUrl(encodedPath) };
    }
    throw new Error('无法获取下载链接: ' + filePath);
  }

  return { ls, readdir, stat, getDownloadUrl, findFileByPath, getFullDirectUrl, getBothDirectUrls, resolveFullUrl };
}

module.exports = { createClient };