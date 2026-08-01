'use strict';

// === State ===
const selectedPaths = new Set();
let currentScanResults = [];
let currentPkgMode = 'project'; // 'project' | 'global'

// === HTML Escape (prevents XSS in innerHTML) ===
function esc(str) {
  if (str == null) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const text = await res.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { /* non-JSON response */ }
  }
  if (!res.ok) {
    throw new Error(data && data.error ? data.error : `Request failed (${res.status})`);
  }
  return data || {};
}

async function apiPost(path, body) {
  return api(path, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

// === UI Helpers ===
function showToast(message, type = 'info') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = `toast ${type}`;
  toast.classList.remove('hidden');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.add('hidden'), 4000);
}

function showModal(title, bodyHTML, onConfirm, confirmText = '确认', confirmClass = 'btn-danger') {
  const modal = document.getElementById('modal');
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = bodyHTML;
  const confirmBtn = document.getElementById('modal-confirm-btn');
  confirmBtn.textContent = confirmText;
  confirmBtn.className = `btn ${confirmClass}`;
  confirmBtn.onclick = () => {
    closeModal();
    if (onConfirm) onConfirm();
  };
  modal.classList.remove('hidden');
}

function closeModal() {
  document.getElementById('modal').classList.add('hidden');
}

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const val = bytes / Math.pow(1024, i);
  if (!isFinite(val) || !isFinite(i) || i < 0) return '0 B';
  return `${val.toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
}

function formatDate(isoString) {
  if (!isoString) return '-';
  const d = new Date(isoString);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function setLoading(btn, loading) {
  if (loading) {
    btn._origText = btn.textContent;
    btn.innerHTML = '<span class="loading"></span>';
    btn.disabled = true;
  } else {
    btn.textContent = btn._origText || btn.textContent;
    btn.disabled = false;
  }
}

// === Tab Switching ===
function switchTab(tabName) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  document.querySelector(`.tab[data-tab="${tabName}"]`).classList.add('active');
  document.getElementById(`tab-${tabName}`).classList.add('active');
}

// === Status ===
async function loadStatus() {
  try {
    const status = await api('/api/status');
    const bar = document.getElementById('status-bar');
    bar.innerHTML = `
      <span class="text-green">${esc(status.pm.toUpperCase())}</span> |
      <span>${esc(status.targetDir)}</span> |
      <span class="text-muted">Node ${esc(status.versions.node || '?')} / npm ${esc(status.versions.npm || '?')}</span>
    `;
  } catch (err) {
    document.getElementById('status-bar').textContent = `Error: ${err.message}`;
  }
}

// ====================
// Tab 1: Packages
// ====================

// === Package mode toggle ===
function switchPkgMode(mode) {
  currentPkgMode = mode;
  document.getElementById('pkg-mode-project').classList.toggle('active', mode === 'project');
  document.getElementById('pkg-mode-global').classList.toggle('active', mode === 'global');
  document.getElementById('pkg-project-table').classList.toggle('hidden', mode !== 'project');
  document.getElementById('pkg-global-container').classList.toggle('hidden', mode !== 'global');
  if (mode === 'project') loadPackages();
  else loadGlobalPackages();
}

async function loadPackages() {
  const tbody = document.getElementById('pkg-tbody');
  tbody.innerHTML = '<tr><td colspan="5" class="text-muted">Loading...</td></tr>';
  try {
    const data = await api('/api/packages/list');
    renderPackages(data);
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-red">${err.message}</td></tr>`;
  }
}

async function loadGlobalPackages() {
  const tbody = document.getElementById('pkg-global-tbody');
  tbody.innerHTML = '<tr><td colspan="4" class="text-muted">Loading...</td></tr>';
  try {
    const data = await api('/api/packages/global-list');
    renderGlobalPackages(data);
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="4" class="text-red">${err.message}</td></tr>`;
  }
}

function renderGlobalPackages(data) {
  const tbody = document.getElementById('pkg-global-tbody');
  const summary = document.getElementById('pkg-global-summary');
  
  if (!data.managers || data.managers.length === 0) {
    summary.innerHTML = '未发现全局包';
    tbody.innerHTML = '<tr><td colspan="4" class="text-muted">No global packages found</td></tr>';
    return;
  }

  const totalCount = data.managers.reduce((s, m) => s + m.packages.length, 0);
  summary.innerHTML = `共 <span class="text-yellow">${totalCount}</span> 个全局包`;

  let html = '';
  for (const m of data.managers) {
    for (const pkg of m.packages) {
      html += `
        <tr>
          <td class="mono">${esc(pkg.name)}</td>
          <td class="text-green mono">${esc(pkg.version)}</td>
          <td><span class="badge badge-dep">${esc(m.pm)}</span></td>
          <td><button class="btn btn-sm btn-danger" onclick="globalUninstallPackage('${esc(pkg.name)}', '${esc(m.pm)}')">卸载</button></td>
        </tr>
      `;
    }
  }
  tbody.innerHTML = html;
}

async function globalUninstallPackage(name, pm) {
  showModal(
    '卸载全局包',
    `<p>即将卸载全局包 <span class="mono text-red">${esc(name)}</span> (${esc(pm)})</p><p class="text-muted">此操作不可撤销。</p>`,
    async () => {
      try {
        showToast(`正在卸载全局包 ${name}...`, 'info');
        await apiPost('/api/packages/global-uninstall', { name, pm });
        showToast(`卸载成功: ${name}`, 'success');
        loadGlobalPackages();
      } catch (err) {
        showToast(`卸载失败: ${err.message}`, 'error');
      }
    },
    '卸载',
    'btn-danger'
  );
}

function renderPackages(data) {
  const tbody = document.getElementById('pkg-tbody');
  if (!data.packages || data.packages.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="text-muted">项目无依赖 — 点击上方「全局包」查看全局安装的包</td></tr>';
    return;
  }

  tbody.innerHTML = data.packages.map(pkg => {
    const isMissing = pkg.installed === 'missing';
    return `
      <tr>
        <td class="mono">${esc(pkg.name)}</td>
        <td>${isMissing ? '<span class="badge badge-missing">missing</span>' : `<span class="text-green mono">${esc(pkg.installed)}</span>`}</td>
        <td class="mono text-muted">${esc(pkg.wanted)}</td>
        <td><span class="badge ${pkg.type === 'dev' ? 'badge-dev' : 'badge-dep'}">${esc(pkg.type)}</span></td>
        <td>
          <button class="btn btn-sm" onclick="updatePackage('${esc(pkg.name)}')">更新</button>
          <button class="btn btn-sm btn-primary" onclick="upgradePackage('${esc(pkg.name)}')">升级</button>
          <button class="btn btn-sm btn-danger" onclick="uninstallPackage('${esc(pkg.name)}')">卸载</button>
        </td>
      </tr>
    `;
  }).join('');
}

async function searchPackages() {
  const input = document.getElementById('pkg-search');
  const q = input.value.trim();
  if (!q) return;

  const btn = document.getElementById('pkg-search-btn');
  setLoading(btn, true);

  try {
    const data = await api(`/api/packages/search?q=${encodeURIComponent(q)}`);
    const container = document.getElementById('pkg-search-results');
    if (!data.objects || data.objects.length === 0) {
      container.innerHTML = '<div class="text-muted">No results found</div>';
      return;
    }

    container.innerHTML = data.objects.map(item => {
      const pkg = item.package;
      return `
        <div class="search-result-item">
          <span class="pkg-name mono">${esc(pkg.name)}</span>
          <span class="pkg-ver">${esc(pkg.version)}</span>
          <span class="pkg-desc">${esc((pkg.description || '').slice(0, 80))}</span>
          <button class="btn btn-sm btn-primary" onclick="installPackage('${esc(pkg.name)}')">安装</button>
          <button class="btn btn-sm" onclick="installPackage('${esc(pkg.name)}', true)">dev</button>
        </div>
      `;
    }).join('');
  } catch (err) {
    showToast(`搜索失败: ${err.message}`, 'error');
  } finally {
    setLoading(btn, false);
  }
}

async function installPackage(name, isDev = false) {
  showModal(
    '安装包',
    `<p>即将安装 <span class="mono text-green">${esc(name)}</span> ${isDev ? '(devDependency)' : '(dependency)'}</p>`,
    async () => {
      try {
        showToast(`正在安装 ${name}...`, 'info');
        await apiPost('/api/packages/install', { name, isDev });
        showToast(`安装成功: ${name}`, 'success');
        loadPackages();
      } catch (err) {
        showToast(`安装失败: ${err.message}`, 'error');
      }
    },
    '安装',
    'btn-primary'
  );
}

async function uninstallPackage(name) {
  showModal(
    '卸载包',
    `<p>即将卸载 <span class="mono text-red">${esc(name)}</span></p><p class="text-muted">此操作不可撤销。</p>`,
    async () => {
      try {
        showToast(`正在卸载 ${name}...`, 'info');
        await apiPost('/api/packages/uninstall', { name });
        showToast(`卸载成功: ${name}`, 'success');
        loadPackages();
      } catch (err) {
        showToast(`卸载失败: ${err.message}`, 'error');
      }
    },
    '卸载',
    'btn-danger'
  );
}

async function upgradePackage(name) {
  showModal(
    '升级包',
    `<p>即将升级 <span class="mono text-green">${esc(name)}</span> 到最新版本</p>`,
    async () => {
      try {
        showToast(`正在升级 ${name}...`, 'info');
        await apiPost('/api/packages/upgrade', { name });
        showToast(`升级成功: ${name}`, 'success');
        loadPackages();
      } catch (err) {
        showToast(`升级失败: ${err.message}`, 'error');
      }
    },
    '升级',
    'btn-primary'
  );
}

async function updatePackage(name) {
  showModal(
    '更新包',
    `<p>即将更新 <span class="mono text-green">${esc(name)}</span> (在版本范围内更新)</p>`,
    async () => {
      try {
        showToast(`正在更新 ${name}...`, 'info');
        await apiPost('/api/packages/update', { name });
        showToast(`更新成功: ${name}`, 'success');
        loadPackages();
      } catch (err) {
        showToast(`更新失败: ${err.message}`, 'error');
      }
    },
    '更新',
    'btn-primary'
  );
}

async function updateAllPackages() {
  showModal(
    '更新全部',
    `<p>即将更新所有依赖包 (在 <span class="mono">package.json</span> 声明的版本范围内)。</p>
     <p class="text-muted">不同于升级到最新版,更新只会在 semver 范围内升级补丁/小版本。</p>`,
    async () => {
      try {
        showToast('正在更新全部依赖...', 'info');
        await apiPost('/api/packages/update-all', {});
        showToast('全部更新完成', 'success');
        loadPackages();
      } catch (err) {
        showToast(`更新失败: ${err.message}`, 'error');
      }
    },
    '更新全部',
    'btn-primary'
  );
}

// ====================
// Tab 2: Cache
// ====================

async function loadCacheInfo() {
  const container = document.getElementById('cache-info-container');
  container.innerHTML = '<div class="text-muted">Loading cache info...</div>';
  try {
    const data = await api('/api/cache/info');
    renderCacheInfo(data);
  } catch (err) {
    container.innerHTML = `<div class="text-red">${err.message}</div>`;
  }
}

function renderCacheInfo(data) {
  const container = document.getElementById('cache-info-container');
  container.innerHTML = `
    <div class="summary-bar">
      缓存总占用: <span class="text-yellow">${esc(data.totalSizeFormatted)}</span>
    </div>
    ${data.caches.map(c => `
      <div class="cache-card">
        <div class="cache-card-header">
          <h3>${esc(c.pm.toUpperCase())} 缓存</h3>
          <span class="cache-size">${esc(c.sizeFormatted)}</span>
        </div>
        <div class="cache-path">${esc(c.path)}</div>
        ${c.exists ? `
          <div class="cache-actions">
            <button class="btn btn-danger btn-sm" onclick="cleanCache('${esc(c.pm)}')">清理缓存</button>
            ${c.pm === 'npm' ? `<button class="btn btn-sm" onclick="verifyCache('${esc(c.pm)}')">验证缓存</button>` : ''}
            ${c.pm === 'pnpm' ? `<button class="btn btn-sm" onclick="pruneStore('${esc(c.pm)}')">清理 Store</button>` : ''}
          </div>
        ` : '<div class="text-muted">缓存目录不存在</div>'}
      </div>
    `).join('')}
  `;
}

async function cleanCache(pm) {
  showModal(
    '清理缓存',
    `<p>即将清理 <span class="mono text-yellow">${esc(pm)}</span> 的缓存。</p><p class="text-muted">已下载的包缓存将被删除,下次安装时需重新下载。</p>`,
    async () => {
      try {
        showToast(`正在清理 ${pm} 缓存...`, 'info');
        await apiPost('/api/cache/clean', { pm });
        showToast(`${pm} 缓存清理完成`, 'success');
        loadCacheInfo();
      } catch (err) {
        showToast(`清理失败: ${err.message}`, 'error');
      }
    }
  );
}

async function verifyCache(pm) {
  try {
    showToast(`正在验证 ${pm} 缓存...`, 'info');
    const result = await apiPost('/api/cache/verify', { pm });
    showToast(`${pm} 缓存验证完成`, 'success');
  } catch (err) {
    showToast(`验证失败: ${err.message}`, 'error');
  }
}

async function pruneStore(pm) {
  showModal(
    '清理 Store',
    `<p>即将清理 <span class="mono text-yellow">${esc(pm)}</span> 的 store 中未被引用的包。</p>`,
    async () => {
      try {
        showToast(`正在清理 ${pm} store...`, 'info');
        await apiPost('/api/cache/store-prune', { pm });
        showToast(`${pm} store 清理完成`, 'success');
        loadCacheInfo();
      } catch (err) {
        showToast(`清理失败: ${err.message}`, 'error');
      }
    }
  );
}

async function loadGlobals() {
  const container = document.getElementById('globals-container');
  container.innerHTML = '<div class="text-muted">Loading...</div>';
  try {
    const data = await api('/api/cache/all-globals');
    renderGlobals(data);
  } catch (err) {
    container.innerHTML = `<div class="text-red">${err.message}</div>`;
  }
}

async function loadRegistry() {
  const container = document.getElementById('registry-container');
  container.innerHTML = '<div class="text-muted">Loading registry info...</div>';
  try {
    const data = await api('/api/cache/registry');
    if (!data.registries || data.registries.length === 0) {
      container.innerHTML = '<div class="text-muted">未找到镜像源配置</div>';
      return;
    }
    const knownRegistries = {
      'https://registry.npmjs.org/': 'npm 官方',
      'https://registry.npmmirror.com/': '淘宝镜像',
      'https://registry.npm.taobao.org/': '淘宝旧镜像',
      'https://r.cnpmjs.org/': 'CNPM',
      'https://registry.yarnpkg.com/': 'Yarn 官方',
    };
    container.innerHTML = `
      <div class="cache-card">
        <div class="cache-card-header"><h3>镜像源 (Registry)</h3></div>
        <table class="data-table compact">
          <thead><tr><th>包管理器</th><th>源地址</th><th>来源</th></tr></thead>
          <tbody>
            ${data.registries.map(r => {
              const label = knownRegistries[r.registry] || '自定义';
              return `<tr>
                <td><span class="badge badge-dep">${esc(r.pm.toUpperCase())}</span></td>
                <td class="mono">${esc(r.registry)}</td>
                <td class="text-muted">${esc(label)}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  } catch (err) {
    container.innerHTML = `<div class="text-red">${err.message}</div>`;
  }
}

function renderGlobals(data) {
  const container = document.getElementById('globals-container');
  if (!data.managers || data.managers.length === 0) {
    container.innerHTML = '<div class="text-muted">No global packages found</div>';
    return;
  }
  container.innerHTML = data.managers.map(m => `
    <div class="cache-card">
      <div class="cache-card-header">
        <h3>${esc(m.pm.toUpperCase())} 全局包 (${esc(String(m.packageCount))})</h3>
        <span class="cache-size">${esc(m.rootSizeFormatted)}</span>
      </div>
      <div class="cache-path">${esc(m.root)}</div>
      <table class="data-table compact">
        <thead><tr><th>包名</th><th>版本</th></tr></thead>
        <tbody>
          ${m.packages.map(p => `<tr><td class="mono">${esc(p.name)}</td><td class="text-green mono">${esc(p.version)}</td></tr>`).join('')}
        </tbody>
      </table>
    </div>
  `).join('');
}

// ====================
// Tab 3: Cleanup
// ====================

async function scanNodeModules() {
  const dirInput = document.getElementById('scan-dir');
  const rootDir = dirInput.value.trim() || undefined;
  const btn = document.getElementById('scan-btn');
  setLoading(btn, true);

  try {
    const data = await apiPost('/api/cleanup/scan', { rootDir });
    currentScanResults = data.results;
    renderCleanup(data);
  } catch (err) {
    showToast(`扫描失败: ${err.message}`, 'error');
  } finally {
    setLoading(btn, false);
  }
}

function renderCleanup(data) {
  const summary = document.getElementById('cleanup-summary');
  summary.innerHTML = `
    扫描根目录: <span class="mono">${esc(data.rootDir)}</span> |
    找到 <span class="text-yellow">${esc(String(data.count))}</span> 个 node_modules |
    总占用 <span class="text-red">${esc(data.totalSizeFormatted)}</span>
  `;

  const tbody = document.getElementById('cleanup-tbody');
  if (!data.results || data.results.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="text-muted">No node_modules found</td></tr>';
    return;
  }

  selectedPaths.clear();
  tbody.innerHTML = data.results.map((r, i) => `
    <tr>
      <td class="col-check"><input type="checkbox" data-idx="${i}" data-path="${esc(r.path)}"></td>
      <td class="mono" style="max-width:400px;overflow:hidden;text-overflow:ellipsis;">${esc(r.path)}</td>
      <td class="text-yellow mono">${esc(formatBytes(r.size))}</td>
      <td class="text-muted">${esc(formatDate(r.lastModified))}</td>
      <td><span class="badge ${r.type === 'pnpm' ? 'badge-dev' : 'badge-dep'}">${esc(r.type)}</span></td>
      <td>
        <button class="btn btn-sm" onclick="inspectDir('${esc(r.path.replace(/\\/g, '/'))}')">详情</button>
        <button class="btn btn-sm btn-danger" onclick="deleteSingle('${esc(r.path.replace(/\\/g, '/'))}')">删除</button>
      </td>
    </tr>
  `).join('');

  // Attach checkbox listeners
  tbody.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', (e) => {
      if (e.target.checked) selectedPaths.add(e.target.dataset.path);
      else selectedPaths.delete(e.target.dataset.path);
    });
  });
}

function selectAllNodeModules() {
  const checkboxes = document.querySelectorAll('#cleanup-tbody input[type="checkbox"]');
  const allChecked = checkboxes.length > 0 && [...checkboxes].every(cb => cb.checked);
  checkboxes.forEach(cb => {
    cb.checked = !allChecked;
    if (cb.checked) selectedPaths.add(cb.dataset.path);
    else selectedPaths.delete(cb.dataset.path);
  });
}

function invertSelection() {
  const checkboxes = document.querySelectorAll('#cleanup-tbody input[type="checkbox"]');
  checkboxes.forEach(cb => {
    cb.checked = !cb.checked;
    if (cb.checked) selectedPaths.add(cb.dataset.path);
    else selectedPaths.delete(cb.dataset.path);
  });
}

async function deleteSelected() {
  if (selectedPaths.size === 0) {
    showToast('请先选择要删除的目录', 'info');
    return;
  }
  const paths = [...selectedPaths];
  const totalSize = currentScanResults
    .filter(r => paths.includes(r.path))
    .reduce((sum, r) => sum + r.size, 0);

  showModal(
    '确认删除',
    `<p>即将删除 <span class="text-red">${paths.length}</span> 个 node_modules 目录</p>
     <p>预计释放空间: <span class="text-yellow">${esc(formatBytes(totalSize))}</span></p>
     <ul>${paths.map(p => `<li>${esc(p)}</li>`).join('')}</ul>
     <p class="text-red">此操作不可撤销!</p>`,
    async () => {
      try {
        showToast(`正在删除 ${paths.length} 个目录...`, 'info');
        const result = await apiPost('/api/cleanup/delete', { paths });
        showToast(`已删除 ${result.deleted} 个,失败 ${result.failed} 个`, result.failed > 0 ? 'error' : 'success');
        selectedPaths.clear();
        scanNodeModules();
      } catch (err) {
        showToast(`删除失败: ${err.message}`, 'error');
      }
    }
  );
}

async function deleteSingle(path) {
  showModal(
    '确认删除',
    `<p>即将删除:</p><p class="mono text-peach">${esc(path)}</p><p class="text-red">此操作不可撤销!</p>`,
    async () => {
      try {
        await apiPost('/api/cleanup/delete', { paths: [path] });
        showToast('删除成功', 'success');
        scanNodeModules();
      } catch (err) {
        showToast(`删除失败: ${err.message}`, 'error');
      }
    }
  );
}

async function inspectDir(path) {
  try {
    showToast('正在扫描包详情...', 'info');
    const data = await apiPost('/api/cleanup/inspect', { path });
    const pkgList = data.topPackages.map(p => `<tr><td class="mono">${esc(p.name)}</td><td class="text-yellow mono">${esc(p.sizeFormatted)}</td></tr>`).join('');
    showModal(
      `node_modules 详情 (${esc(String(data.packageCount))} 个包)`,
      `<p class="mono text-muted">${esc(path)}</p>
       <p>包含 <span class="text-yellow">${esc(String(data.packageCount))}</span> 个包</p>
       <table class="data-table compact" style="margin-top:8px;">
         <thead><tr><th>包名 (按大小排序, 前20)</th><th>大小</th></tr></thead>
         <tbody>${pkgList}</tbody>
       </table>`,
      null,
      '关闭',
      'btn'
    );
  } catch (err) {
    showToast(`查询失败: ${err.message}`, 'error');
  }
}

async function loadDiskUsage() {
  try {
    const data = await api('/api/cleanup/disk-usage');
    const cacheRows = (data.caches || []).map(c => `
      <tr>
        <td><span class="badge badge-dep">${esc(c.pm.toUpperCase())}</span></td>
        <td class="text-yellow mono">${esc(c.sizeFormatted)}</td>
        <td class="mono text-muted" style="max-width:300px;word-break:break-all;">${esc(c.path)}</td>
      </tr>
    `).join('');
    showModal(
      '缓存磁盘占用',
      `<p>缓存总占用: <span class="text-red">${esc(data.totalSizeFormatted)}</span></p>
       <table class="data-table compact" style="margin-top:8px;">
         <thead><tr><th>包管理器</th><th>大小</th><th>路径</th></tr></thead>
         <tbody>${cacheRows || '<tr><td colspan="3" class="text-muted">无缓存</td></tr>'}</tbody>
       </table>`,
      null,
      '关闭',
      'btn'
    );
  } catch (err) {
    showToast(`查询失败: ${err.message}`, 'error');
  }
}

// ====================
// Tab 4: Health
// ====================

async function healthCheck() {
  const btn = document.getElementById('health-check-btn');
  setLoading(btn, true);
  try {
    await Promise.all([
      loadOutdated(),
      loadDuplicates(),
      loadUnused(),
      loadTree(),
    ]);
    showToast('检查完成', 'success');
  } catch (err) {
    showToast(`检查失败: ${err.message}`, 'error');
  } finally {
    setLoading(btn, false);
  }
}

async function loadOutdated() {
  try {
    const data = await api('/api/health/outdated');
    const tbody = document.getElementById('outdated-tbody');
    if (!data.outdated || data.outdated.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="text-green">所有包均为最新</td></tr>';
      return;
    }
    tbody.innerHTML = data.outdated.map(pkg => `
      <tr>
        <td class="mono">${esc(pkg.name)}</td>
        <td class="text-red mono">${esc(pkg.current)}</td>
        <td class="text-yellow mono">${esc(pkg.wanted)}</td>
        <td class="text-green mono">${esc(pkg.latest)}</td>
        <td><button class="btn btn-sm btn-primary" onclick="upgradePackage('${esc(pkg.name)}')">升级</button></td>
      </tr>
    `).join('');
  } catch (err) {
    document.getElementById('outdated-tbody').innerHTML = `<tr><td colspan="5" class="text-red">${err.message}</td></tr>`;
  }
}

async function loadDuplicates() {
  try {
    const data = await api('/api/health/duplicates');
    const container = document.getElementById('duplicates-container');
    if (!data.duplicates || data.duplicates.length === 0) {
      container.innerHTML = '<div class="text-green">未发现重复包</div>';
      return;
    }
    container.innerHTML = data.duplicates.map(dup => `
      <div class="dup-item">
        <span class="dup-name mono">${esc(dup.name)}</span>
        <span class="dup-count">(${esc(String(dup.versionCount))} versions)</span><br>
        ${dup.versions.map(v => `<span class="dup-version mono">${esc(v.version)}</span><span class="dup-count">×${esc(String(v.count))}</span>`).join('')}
      </div>
    `).join('');
  } catch (err) {
    document.getElementById('duplicates-container').innerHTML = `<div class="text-red">${err.message}</div>`;
  }
}

async function loadUnused() {
  try {
    const data = await api('/api/health/unused');
    const tbody = document.getElementById('unused-tbody');
    if (data.error) {
      tbody.innerHTML = `<tr><td colspan="3" class="text-red">${data.error}</td></tr>`;
      return;
    }
    const allUnused = [
      ...(data.unused || []).map(name => ({ name, type: 'dep' })),
      ...(data.unusedDev || []).map(name => ({ name, type: 'dev' })),
    ];
    if (allUnused.length === 0) {
      tbody.innerHTML = '<tr><td colspan="3" class="text-green">未发现未使用依赖</td></tr>';
      return;
    }
    tbody.innerHTML = allUnused.map(pkg => `
      <tr>
        <td class="mono">${esc(pkg.name)}</td>
        <td><span class="badge ${pkg.type === 'dev' ? 'badge-dev' : 'badge-dep'}">${esc(pkg.type)}</span></td>
        <td><button class="btn btn-sm btn-danger" onclick="uninstallPackage('${esc(pkg.name)}')">卸载</button></td>
      </tr>
    `).join('');
  } catch (err) {
    document.getElementById('unused-tbody').innerHTML = `<tr><td colspan="3" class="text-red">${err.message}</td></tr>`;
  }
}

async function loadTree() {
  try {
    const data = await api('/api/health/tree');
    const container = document.getElementById('tree-container');
    if (!data.tree || (!data.tree.dependencies && !data.tree.name)) {
      container.innerHTML = '<div class="text-muted">No dependency tree available</div>';
      return;
    }
    container.innerHTML = renderTreeNode(data.tree, '', true);
  } catch (err) {
    document.getElementById('tree-container').innerHTML = `<div class="text-red">${err.message}</div>`;
  }
}

function renderTreeNode(node, prefix, isRoot, depth = 0, maxDepth = 12) {
  if (!node) return '';
  const name = isRoot ? (node.name || 'root') : node.name || 'unknown';
  const version = node.version || '';
  let html = `<div class="tree-node">${esc(prefix)}${esc(name)}${version ? ` <span class="text-green">@${esc(version)}</span>` : ''}</div>`;

  if (node.dependencies && depth < maxDepth) {
    const deps = Object.entries(node.dependencies);
    for (const [depName, depInfo] of deps) {
      html += `<div class="tree-children">${renderTreeNode({ ...depInfo, name: depName }, prefix + '  ', false, depth + 1, maxDepth)}</div>`;
    }
  } else if (node.dependencies && depth >= maxDepth) {
    html += `<div class="tree-children text-muted">… (max depth ${maxDepth} reached, deeper deps hidden)</div>`;
  }
  return html;
}

async function runDedupe() {
  showModal(
    '执行去重',
    `<p>即将执行 <span class="mono text-yellow">dedupe</span>。</p><p class="text-muted">这将尝试将重复的包版本统一为兼容的单一版本。</p>`,
    async () => {
      try {
        showToast('正在执行去重...', 'info');
        await apiPost('/api/health/dedupe');
        showToast('去重完成', 'success');
        loadDuplicates();
      } catch (err) {
        showToast(`去重失败: ${err.message}`, 'error');
      }
    },
    '执行',
    'btn-primary'
  );
}

async function runPrune() {
  showModal(
    '执行清理',
    `<p>即将执行 <span class="mono text-yellow">prune</span>。</p><p class="text-muted">这将删除不在 package.json 中声明的多余包。</p>`,
    async () => {
      try {
        showToast('正在执行清理...', 'info');
        await apiPost('/api/health/prune');
        showToast('清理完成', 'success');
      } catch (err) {
        showToast(`清理失败: ${err.message}`, 'error');
      }
    },
    '执行',
    'btn-primary'
  );
}

// ====================
// Init
// ====================

document.addEventListener('DOMContentLoaded', () => {
  // Tab switching
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });

  // Packages tab
  document.getElementById('pkg-refresh-btn').addEventListener('click', () => {
    if (currentPkgMode === 'global') loadGlobalPackages();
    else loadPackages();
  });
  document.getElementById('pkg-update-all-btn').addEventListener('click', updateAllPackages);
  document.getElementById('pkg-mode-project').addEventListener('click', () => switchPkgMode('project'));
  document.getElementById('pkg-mode-global').addEventListener('click', () => switchPkgMode('global'));
  document.getElementById('pkg-search-btn').addEventListener('click', searchPackages);
  document.getElementById('pkg-search').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') searchPackages();
  });

  // Cache tab
  document.getElementById('cache-refresh-btn').addEventListener('click', loadCacheInfo);
  document.getElementById('cache-registry-btn').addEventListener('click', loadRegistry);
  document.getElementById('globals-load-btn').addEventListener('click', loadGlobals);

  // Cleanup tab
  document.getElementById('scan-btn').addEventListener('click', scanNodeModules);
  document.getElementById('select-all-btn').addEventListener('click', invertSelection);
  document.getElementById('delete-selected-btn').addEventListener('click', deleteSelected);
  document.getElementById('disk-usage-btn').addEventListener('click', loadDiskUsage);
  document.getElementById('cleanup-select-all').addEventListener('change', selectAllNodeModules);

  // Health tab
  document.getElementById('health-check-btn').addEventListener('click', healthCheck);
  document.getElementById('health-dedupe-btn').addEventListener('click', runDedupe);
  document.getElementById('health-prune-btn').addEventListener('click', runPrune);

  // Initial load
  loadStatus();
  loadPackages();
  loadGlobalPackages(); // preload global packages in background
});

// Expose functions for inline onclick handlers
window.installPackage = installPackage;
window.uninstallPackage = uninstallPackage;
window.upgradePackage = upgradePackage;
window.updatePackage = updatePackage;
window.updateAllPackages = updateAllPackages;
window.globalUninstallPackage = globalUninstallPackage;
window.cleanCache = cleanCache;
window.verifyCache = verifyCache;
window.pruneStore = pruneStore;
window.deleteSingle = deleteSingle;
window.inspectDir = inspectDir;
window.closeModal = closeModal;
