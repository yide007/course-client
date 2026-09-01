const { createClient } = require('@andie/cd2');

const CD2_ENDPOINT = '127.0.0.1:19798';
const CD2_TOKEN = 'b2d284cd-6ebd-4aa7-a677-f76b596ba402';

let client = null;

function getClient() {
  if (!client) {
    client = createClient({
      endpoint: CD2_ENDPOINT,
      token: CD2_TOKEN,
    });
  }
  return client;
}

/**
 * 从 CloudDrive2 获取"梅矛盾2.0"课程的文件列表，转换为课程章节/课时结构。
 * @returns {Promise<Array<{title: string, sortOrder: number, lessons: Array}>>}
 */
async function fetchCourseChapters() {
  try {
    const c = getClient();
    const files = await c.ls('/');

    // 将 CD2 文件列表转换为课程章节结构
    const chapters = [];

    // 有子目录时，每个子目录作为一个章节，根目录的视频文件作为"默认章节"
    const rootFiles = files.filter(f => !f.isDir);
    const dirs = files.filter(f => f.isDir);

    // 如果有根目录视频文件，创建一个默认章节
    if (rootFiles.length > 0) {
      chapters.push({
        title: '默认章节',
        sortOrder: 1,
        lessons: rootFiles.map((f, idx) => ({
          title: f.name.replace(/\.[^/.]+$/, ''), // 去掉扩展名作为标题
          duration: formatDuration(f.size),
          videoUrl: f.directUrl || '',
          videoType: 'direct',
          isFree: idx === 0 ? 1 : 0, // 第一节课免费试看
          sortOrder: idx + 1,
        })),
      });
    }

    // 每个子目录作为一个章节
    for (let di = 0; di < dirs.length; di++) {
      const dir = dirs[di];
      try {
        const subFiles = await c.ls(`/${dir.name}`);
        const videoFiles = subFiles.filter(sf => !sf.isDir);

        chapters.push({
          title: dir.name,
          sortOrder: chapters.length + 1,
          lessons: videoFiles.map((f, idx) => ({
            title: f.name.replace(/\.[^/.]+$/, ''),
            duration: formatDuration(f.size),
            videoUrl: f.directUrl || '',
            videoType: 'direct',
            isFree: 0,
            sortOrder: idx + 1,
          })),
        });
      } catch (e) {
        console.error(`Failed to list subdirectory "${dir.name}":`, e.message);
        // 跳过无法读取的目录
      }
    }

    return chapters;
  } catch (e) {
    console.error('fetchCourseChapters error:', e.message);
    return [];
  }
}

function formatDuration(size) {
  if (!size || size <= 0) return '00:00';
  // 按平均 2MB/min 估算视频时长
  const minutes = Math.round(size / (2 * 1024 * 1024));
  if (minutes <= 0) return '00:00';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:00`;
  return `${String(m).padStart(2, '0')}:00`;
}

module.exports = { fetchCourseChapters };