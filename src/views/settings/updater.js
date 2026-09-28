// 软件更新：手动检查 GitHub / Gitee Release、下载并安装新版本
// - 支持在设置里切换更新源（github / gitee），仓库 owner/name 一致
// - 检查范围：所有非草稿 release（含 pre-release），取版本号最高且高于当前版本的一个
// - 安装版：下载安装包后静默安装并自动重启
// - 便携版：下载到用户指定目录，由用户自行替换旧版本
import { invoke } from '@tauri-apps/api/core';
import { getVersion } from '@tauri-apps/api/app';
import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';
import { t } from '../../utils/i18n.js';

// 默认更新源（GitHub 本仓库；Gitee 镜像可在设置里改写）
export const DEFAULT_UPDATE_SOURCE = 'github';
export const DEFAULT_UPDATE_REPOS = {
  github: 'https://github.com/float0108/SnipJet',
  gitee: 'https://gitee.com/float0108/SnipJet',
};

// 更新流程状态：idle / checking / ready / downloading / installing / done / uptodate / error
const state = {
  installType: 'portable', // 'installer' | 'portable'
  source: DEFAULT_UPDATE_SOURCE, // 'github' | 'gitee'
  currentVersion: '',
  release: null,
  status: 'idle',
  progress: -1, // 0~100；-1 表示总大小未知
  message: '',
};

let bound = false;
let versionLoaded = false;
// 系统默认下载目录（便携版未自定义目录时的落点）
let defaultDownloadDir = '';
// 便携版下载目录变化时的回调（用于写回设置）
let downloadDirCallback = null;

const el = (id) => document.getElementById(id);

// --- 渲染 ---

// 当前版本 + 安装类型（在「当前版本」这一行的描述位）
function renderInstallType() {
  const target = el('update-install-type');
  if (!target) return;
  const version = state.currentVersion ? `v${state.currentVersion}` : '';
  const typeText = t(
    state.installType === 'installer'
      ? 'settings.general.installTypeInstaller'
      : 'settings.general.installTypePortable'
  );
  target.textContent = [version, typeText].filter(Boolean).join(' · ');
}

// 下载目录仅对便携版有意义
function renderDownloadDirVisibility() {
  const item = el('update-download-dir-item');
  if (item) item.style.display = state.installType === 'portable' ? 'flex' : 'none';
}

function render() {
  const checkBtn = el('check-update-btn');
  if (checkBtn) {
    checkBtn.disabled =
      state.status === 'checking' ||
      state.status === 'downloading' ||
      state.status === 'installing';
  }

  const result = el('update-result');
  if (!result) return;

  result.textContent = '';
  if (state.status === 'idle') {
    result.hidden = true;
    return;
  }
  result.hidden = false;

  switch (state.status) {
    case 'checking':
      result.appendChild(textEl(t('settings.general.checking')));
      return;
    case 'uptodate':
      result.appendChild(
        textEl(
          t('settings.general.upToDate').replace('{version}', state.currentVersion)
        )
      );
      return;
    case 'error':
      result.appendChild(
        textEl(
          t('settings.general.updateError').replace('{error}', state.message),
          true
        )
      );
      return;
    default:
      // ready / downloading / installing / done：渲染 release 卡片
      renderReleaseCard(result);
  }
}

function textEl(text, isError = false) {
  const div = document.createElement('div');
  div.className = isError ? 'update-text error' : 'update-text';
  div.textContent = text;
  return div;
}

function renderReleaseCard(container) {
  const release = state.release;
  if (!release) return;

  const card = document.createElement('div');
  card.className = 'update-card';

  const title = document.createElement('div');
  title.className = 'update-card-title';
  title.textContent = t('settings.general.newVersion').replace(
    '{version}',
    release.version
  );
  card.appendChild(title);

  const metaParts = [];
  const published = formatDate(release.published_at);
  if (published) metaParts.push(published);
  if (release.tag_name) metaParts.push(release.tag_name);
  if (release.prerelease) metaParts.push(t('settings.general.prerelease'));
  if (metaParts.length > 0) {
    const meta = document.createElement('div');
    meta.className = 'update-card-meta';
    meta.textContent = metaParts.join(' · ');
    card.appendChild(meta);
  }

  if (release.body && release.body.trim()) {
    const notes = document.createElement('div');
    notes.className = 'update-card-notes';
    notes.textContent = release.body.trim();
    card.appendChild(notes);
  }

  if (state.status === 'downloading') {
    card.appendChild(progressEl());
  } else if (state.status === 'installing') {
    card.appendChild(textEl(t('settings.general.installing')));
  } else if (state.status === 'done') {
    card.appendChild(textEl(state.message));
  } else {
    const asset = pickAsset(release.assets || []);
    if (asset) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-confirm update-btn';
      btn.textContent = t(
        state.installType === 'installer'
          ? 'settings.general.updateNow'
          : 'settings.general.download'
      );
      btn.addEventListener('click', startDownload);
      card.appendChild(btn);
    } else {
      card.appendChild(textEl(t('settings.general.noAsset'), true));
    }
  }

  container.appendChild(card);
}

function progressLabel() {
  const base = t('settings.general.downloading');
  return state.progress >= 0 ? `${base} ${state.progress}%` : base;
}

function progressEl() {
  const wrap = document.createElement('div');
  wrap.className = 'update-progress';

  const label = document.createElement('div');
  label.className = 'update-text update-progress-label';
  label.textContent = progressLabel();

  const track = document.createElement('div');
  track.className = 'update-progress-track';
  const bar = document.createElement('div');
  bar.className = 'update-progress-bar';
  bar.style.width = state.progress >= 0 ? `${state.progress}%` : '100%';
  track.appendChild(bar);

  wrap.append(label, track);
  return wrap;
}

// 进度事件很密集，只更新进度条本身，避免整块重建造成闪烁
function updateProgressUI() {
  const bar = document.querySelector('.update-progress-bar');
  const label = document.querySelector('.update-progress-label');
  if (bar) bar.style.width = state.progress >= 0 ? `${state.progress}%` : '100%';
  if (label) label.textContent = progressLabel();
}

// --- 工具函数 ---

function formatDate(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function errorText(error) {
  if (typeof error === 'string') return error;
  return error?.message || String(error);
}

// 按安装类型挑选附件：安装版优先 setup / msi，便携版优先 portable
function pickAsset(assets) {
  const packages = assets.filter((a) => /\.(exe|msi)$/i.test(a.name || ''));
  if (state.installType === 'installer') {
    return (
      packages.find((a) => /setup/i.test(a.name)) ||
      packages.find((a) => /\.msi$/i.test(a.name)) ||
      packages[0] ||
      null
    );
  }
  return packages.find((a) => /portable/i.test(a.name)) || packages[0] || null;
}

// 检测当前是安装版还是便携版（注册表卸载项存在即安装版）
async function detectInstallType() {
  try {
    const type = await invoke('detect_install_type');
    state.installType = type === 'installer' ? 'installer' : 'portable';
  } catch (e) {
    console.warn('检测安装类型失败，按便携版处理:', e);
    state.installType = 'portable';
  }
}

// 将外部传入或下拉选中的源值归一化为 'github' | 'gitee'
function normalizeSource(value) {
  const v = String(value || '').trim().toLowerCase();
  return v === 'gitee' ? 'gitee' : 'github';
}

// 把仓库链接占位符（仅展示用）切到当前源对应的示例
function syncRepoPlaceholder() {
  const repoInput = el('update-repo');
  if (repoInput) repoInput.placeholder = DEFAULT_UPDATE_REPOS[state.source] || '';
}

async function loadCurrentVersion() {
  if (versionLoaded) return;
  versionLoaded = true;
  try {
    state.currentVersion = await getVersion();
  } catch (e) {
    console.warn('获取当前版本失败:', e);
  }
  renderInstallType();
}

// 取系统「下载」文件夹，作为未自定义下载目录时的默认落点（同时作为输入框占位提示）
async function resolveDefaultDownloadDir() {
  try {
    defaultDownloadDir = await invoke('get_default_update_dir');
  } catch (e) {
    console.warn('获取默认下载目录失败:', e);
  }
  const input = el('update-download-dir');
  // 占位符只是提示，不写入设置值
  if (input) input.placeholder = defaultDownloadDir;
}

// --- 交互 ---

async function checkForUpdate() {
  const repo = (el('update-repo')?.value || '').trim() || DEFAULT_UPDATE_REPOS[state.source];

  state.status = 'checking';
  state.release = null;
  state.message = '';
  render();

  try {
    const result = await invoke('check_for_update', {
      source: state.source,
      repo,
    });
    if (result?.current_version) {
      state.currentVersion = result.current_version;
      renderInstallType();
    }
    if (result?.has_update && result.release) {
      state.release = result.release;
      state.status = 'ready';
    } else {
      state.status = 'uptodate';
    }
  } catch (e) {
    state.status = 'error';
    state.message = errorText(e);
  }
  render();
}

async function startDownload() {
  const asset = pickAsset(state.release?.assets || []);
  if (!asset) {
    state.status = 'error';
    state.message = t('settings.general.noAsset');
    render();
    return;
  }

  // 便携版落到用户指定目录，未指定则用系统「下载」文件夹
  let destDir = null;
  if (state.installType === 'portable') {
    destDir =
      (el('update-download-dir')?.value || '').trim() ||
      defaultDownloadDir ||
      null;
  }

  state.status = 'downloading';
  state.progress = -1;
  state.message = '';
  render();

  try {
    const path = await invoke('download_update', { url: asset.url, destDir });
    if (state.installType === 'installer') {
      state.status = 'installing';
      render();
      // 安装脚本会结束当前进程，正常情况下不会走到下一行
      await invoke('install_update', { path });
    } else {
      state.status = 'done';
      state.message = t('settings.general.downloadedTo').replace('{path}', path);
      render();
    }
  } catch (e) {
    state.status = 'error';
    state.message = errorText(e);
    render();
  }
}

async function pickDownloadDir() {
  const picked = await open({
    directory: true,
    multiple: false,
    title: t('settings.general.downloadDirPick'),
  });
  if (!picked) return '';
  const dir = typeof picked === 'string' ? picked : picked.path || '';
  if (dir) setDownloadDir(dir);
  return dir;
}

function setDownloadDir(dir) {
  const input = el('update-download-dir');
  if (input) input.value = dir;
  if (downloadDirCallback) downloadDirCallback(dir);
}

// --- 对外接口 ---

// 回显设置并检测安装类型（每次进入常规分区时调用）
export async function applyUpdateSettings({ source, repo, downloadDir } = {}) {
  state.source = normalizeSource(source);
  const sourceSelect = el('update-source');
  if (sourceSelect) sourceSelect.value = state.source;
  syncRepoPlaceholder();

  // 仅在当前域匹配时回显链接，避免旧值污染另一个源的设置
  const currentRepo = (repo || '').trim();
  const matchesSource = !currentRepo
    ? true
    : (state.source === 'gitee' && /gitee\.com/i.test(currentRepo)) ||
      (state.source === 'github' && /github\.com/i.test(currentRepo));
  const repoInput = el('update-repo');
  if (repoInput) repoInput.value = matchesSource ? currentRepo : '';
  const dirInput = el('update-download-dir');
  if (dirInput) dirInput.value = downloadDir || '';

  await Promise.all([
    detectInstallType(),
    loadCurrentVersion(),
    resolveDefaultDownloadDir(),
  ]);
  renderDownloadDirVisibility();
  renderInstallType();
  render();
}

// 绑定更新区的交互（只绑一次）
export function bindUpdaterEvents({
  onSourceChange,
  onRepoChange,
  onDownloadDirChange,
} = {}) {
  if (bound) return;
  bound = true;
  downloadDirCallback = onDownloadDirChange || null;

  const sourceSelect = el('update-source');
  if (sourceSelect) {
    sourceSelect.addEventListener('change', () => {
      const next = normalizeSource(sourceSelect.value);
      const prev = state.source;
      state.source = next;
      syncRepoPlaceholder();
      // 切换源时把已有链接清空（不同域的链接无意义），并通知外部设置变化
      const repoInput = el('update-repo');
      if (repoInput) repoInput.value = '';
      if (next !== prev && onSourceChange) onSourceChange(next, '');
    });
  }

  const repoInput = el('update-repo');
  if (repoInput) {
    // 失焦/回车时归一化：留空回落到当前源的默认仓库链接
    repoInput.addEventListener('change', () => {
      const fallback = DEFAULT_UPDATE_REPOS[state.source] || '';
      const repo = repoInput.value.trim() || fallback;
      repoInput.value = repo;
      if (onRepoChange) onRepoChange(repo);
    });
  }

  el('check-update-btn')?.addEventListener('click', () => {
    checkForUpdate();
  });

  el('update-browse-btn')?.addEventListener('click', () => {
    pickDownloadDir();
  });

  // 下载进度：常驻监听，按当前状态过滤
  listen('update-download-progress', (event) => {
    if (state.status !== 'downloading') return;
    const { downloaded = 0, total = 0 } = event.payload || {};
    state.progress =
      total > 0 ? Math.min(100, Math.round((downloaded / total) * 100)) : -1;
    updateProgressUI();
  }).catch((e) => console.warn('监听下载进度失败:', e));
}

// 语言切换后重写由脚本生成的文案
export function refreshUpdaterTexts() {
  renderInstallType();
  render();
}

// 清空上一次的检查结果（换源、取消修改时调用）
export function resetUpdaterUI() {
  // 下载/安装进行中不打断（进度渲染与状态一致）
  if (state.status === 'downloading' || state.status === 'installing') return;
  state.status = 'idle';
  state.release = null;
  state.message = '';
  state.progress = -1;
  render();
}
