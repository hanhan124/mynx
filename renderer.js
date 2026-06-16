const { ipcRenderer, shell } = require('electron');

const LANG = {
  zh: {
    appTitle: 'ToolBox', appDesc: '你的万能工具箱',
    qpcrName: 'qPCR Tools', qpcrDesc: 'qPCR 数据分析',
    tiffName: 'TIFF 转 JPG', tiffDesc: '批量转换 TIFF 图片',
    file: '文件', selectFile: '未选择文件',支持格式: '支持 .xlsx 格式',
    open: '打开', save: '保存', sheet: '工作表', selectSheet: '请选择...',
    step1: '数据转换', step1Desc: '转换为转置表格，缺失值自动处理并标黄',
    step2: 'qPCR 计算', repeats: '重复数', refGene: '参考基因', pleaseConvert: '请先转换',
    runTransform: '执行转换', runCalc: '执行计算', calculating: '计算中，正在生成图表...',
    converting: '转换中...', loading: '处理中...',
    tiffFolder: '文件夹', selectFolder: '未选择文件夹', tiffHint: '包含 .tif/.tiff 文件的目录',
    selectFolderBtn: '选择文件夹', options: '转换选项', optionsDesc: '配置文字水印和输出质量',
    addLabel: '添加文件名水印', yes: '是', no: '否',
    font: '字体', fontSize: '字号', bold: '粗体', italic: '斜体',
    marginX: '左边距', marginY: '上边距', padX: '内边距 X', padY: '内边距 Y',
    bgAlpha: '背景透明度', quality: 'JPG 质量', opaque: '不透明', semi: '半透明',
    moreSemi: '较透明', fullTrans: '全透明', startConvert: '开始转换',
    about: '关于', version: '版本', author: '作者', homepage: '主页',
    langSwitch: 'EN', close: '关闭',
    errSelectSheet: '请先选择工作表', errOpenFile: '请先打开文件', errSelectGene: '请选择参考基因',
    errSelectFolder: '请先选择文件夹', errNoTiff: '未找到 .tif/.tiff 文件',
    fileLoaded: '文件已加载', transformDone: '转换完成', calcDone: '计算完成',
    saveSuccess: '保存成功', folderSelected: '文件夹已选择',
    updateChecking: '检查更新中...', updateAvailable: '有新版本 v{v}', updateDownloaded: '更新已下载，重启生效',
    updateDownloading: '下载中 {p}%', updateError: '更新失败', updateUpToDate: '已是最新版本',
    updateDownload: '下载更新', updateRestart: '立即重启', updateLater: '稍后', updateTitle: '应用更新'
  },
  en: {
    appTitle: 'ToolBox', appDesc: 'Your All-in-One Toolbox',
    qpcrName: 'qPCR Tools', qpcrDesc: 'qPCR Data Analysis',
    tiffName: 'TIFF to JPG', tiffDesc: 'Batch Convert TIFF Images',
    file: 'File', selectFile: 'No file selected', '支持 .xlsx 格式': 'Supports .xlsx format',
    open: 'Open', save: 'Save', sheet: 'Sheet', selectSheet: 'Please select...',
    step1: 'Data Transform', step1Desc: 'Transform data, highlight missing values',
    step2: 'qPCR Calculate', repeats: 'Repeats', refGene: 'Ref Gene', pleaseConvert: 'Convert first',
    runTransform: 'Run Transform', runCalc: 'Run Calculate', calculating: 'Calculating...',
    converting: 'Converting...', loading: 'Processing...',
    tiffFolder: 'Folder', selectFolder: 'No folder selected', tiffHint: 'Directory with .tif/.tiff files',
    selectFolderBtn: 'Select Folder', options: 'Options', optionsDesc: 'Configure watermark & quality',
    addLabel: 'Add filename watermark', yes: 'Yes', no: 'No',
    font: 'Font', fontSize: 'Size', bold: 'Bold', italic: 'Italic',
    marginX: 'Margin X', marginY: 'Margin Y', padX: 'Padding X', padY: 'Padding Y',
    bgAlpha: 'BG Alpha', quality: 'JPG Quality', opaque: 'Opaque', semi: 'Semi',
    moreSemi: 'Light', fullTrans: 'Transparent', startConvert: 'Start Convert',
    about: 'About', version: 'Version', author: 'Author', homepage: 'Homepage',
    langSwitch: '中文', close: 'Close',
    errSelectSheet: 'Please select a sheet', errOpenFile: 'Please open a file', errSelectGene: 'Please select ref gene',
    errSelectFolder: 'Please select a folder', errNoTiff: 'No .tif/.tiff files found',
    fileLoaded: 'File loaded', transformDone: 'Transform done', calcDone: 'Calculation done',
    saveSuccess: 'Saved', folderSelected: 'Folder selected',
    updateChecking: 'Checking for updates...', updateAvailable: 'New version v{v} available', updateDownloaded: 'Update downloaded, restart to apply',
    updateDownloading: 'Downloading {p}%', updateError: 'Update failed', updateUpToDate: 'Already up to date',
    updateDownload: 'Download', updateRestart: 'Restart Now', updateLater: 'Later', updateTitle: 'Update'
  }
};

let lang = localStorage.getItem('lang') || 'zh';
let currentFile = null, currentSheet = null, isAlwaysOnTop = false, currentTheme = 'light';
let tiffFolderPath = null;

function t(key) { return LANG[lang][key] || key; }

function setLang(l) {
  lang = l;
  localStorage.setItem('lang', l);
  updateAllText();
  renderToolList();
}

function updateAllText() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') el.placeholder = t(key);
    else el.textContent = t(key);
  });
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    el.title = t(el.getAttribute('data-i18n-title'));
  });
}

const tools = [
  { id: 'qpcr', nameKey: 'qpcrName', descKey: 'qpcrDesc',
    icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 3h6v4H9z"/><path d="M9 7v14"/><path d="M15 7v14"/><path d="M5 21h14"/></svg>`,
    panel: 'qpcrPanel' },
  { id: 'tiff', nameKey: 'tiffName', descKey: 'tiffDesc',
    icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`,
    panel: 'tiffPanel' }
];

document.addEventListener('DOMContentLoaded', async () => {
  renderToolList();
  isAlwaysOnTop = await ipcRenderer.invoke('get-always-on-top');
  currentTheme = await ipcRenderer.invoke('get-theme');
  updatePinButton();
  applyTheme(currentTheme);
  updateAllText();

  setTimeout(() => ipcRenderer.invoke('check-update'), 3000);

  document.getElementById('tiffAddLabel').addEventListener('change', (e) => {
    document.getElementById('tiffTextOptions').style.display = e.target.value === '1' ? 'block' : 'none';
  });

  document.getElementById('langSwitch').addEventListener('click', () => {
    setLang(lang === 'zh' ? 'en' : 'zh');
  });

  document.getElementById('aboutBtn').addEventListener('click', () => {
    document.getElementById('aboutModal').style.display = 'flex';
  });

  document.getElementById('closeAbout').addEventListener('click', () => {
    document.getElementById('aboutModal').style.display = 'none';
  });

  document.getElementById('aboutModal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('aboutModal')) {
      document.getElementById('aboutModal').style.display = 'none';
    }
  });
});

function renderToolList() {
  document.getElementById('toolList').innerHTML = tools.map(t_ => `
    <button class="nav-item" onclick="selectTool('${t_.id}')" data-tool="${t_.id}">
      <div class="nav-icon-wrapper">${t_.icon}</div><span>${t(t_.nameKey)}</span>
    </button>`).join('');
}

function selectTool(id) {
  const t_ = tools.find(x => x.id === id);
  if (!t_) return;
  document.querySelectorAll('.nav-item[data-tool]').forEach(i => i.classList.toggle('active', i.dataset.tool === id));
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.getElementById(t_.panel).classList.add('active');
  document.getElementById('titleText').textContent = t(t_.nameKey);
}

function toggleTheme() {
  currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
  applyTheme(currentTheme);
  ipcRenderer.send('set-theme', currentTheme);
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  currentTheme = theme;
}

function toggleAlwaysOnTop() { ipcRenderer.send('toggle-always-on-top'); }
function updatePinButton() { document.getElementById('pinBtn').classList.toggle('active', isAlwaysOnTop); }
ipcRenderer.on('always-on-top-changed', (e, v) => { isAlwaysOnTop = v; updatePinButton(); });

function minimizeWindow() { ipcRenderer.send('window-minimize'); }
function maximizeWindow() { ipcRenderer.send('window-maximize'); }
function closeWindow() { ipcRenderer.send('window-close'); }
function openWebsite() { shell.openExternal('https://www.fanguanghan.homes'); }

function showToast(msg, type = 'info') {
  const c = document.getElementById('toastContainer');
  const t_ = document.createElement('div');
  t_.className = `toast ${type}`;
  const icons = { success: '✓', error: '✗', info: 'i' };
  t_.innerHTML = `<span class="toast-icon">${icons[type]}</span><span>${msg}</span>`;
  c.appendChild(t_);
  setTimeout(() => { t_.style.opacity = '0'; t_.style.transform = 'translateY(-12px)'; t_.style.transition = 'all 200ms ease'; setTimeout(() => t_.remove(), 200); }, 3000);
}

function showLoading(text) {
  document.getElementById('loadingText').textContent = text || t('loading');
  document.getElementById('loadingOverlay').style.display = 'flex';
}

function hideLoading() { document.getElementById('loadingOverlay').style.display = 'none'; }

async function openExcelFile() {
  const path = await ipcRenderer.invoke('open-excel');
  if (!path) return;
  showLoading(t('loading'));
  const result = await ipcRenderer.invoke('read-excel', path[0]);
  hideLoading();
  if (!result.success) { showToast(result.error, 'error'); return; }
  currentFile = path[0];
  document.getElementById('fileName').textContent = currentFile.split('\\').pop();
  document.getElementById('filePath').textContent = currentFile;
  document.getElementById('sheetSelector').style.display = 'block';
  document.getElementById('saveBtn').disabled = false;
  const sel = document.getElementById('sheetSelect');
  sel.innerHTML = `<option value="">${t('selectSheet')}</option>`;
  result.sheetNames.forEach(n => { const o = document.createElement('option'); o.value = n; o.textContent = n; sel.appendChild(o); });
  document.getElementById('transformBtn').disabled = false;
  showToast(t('fileLoaded'), 'success');
}

function onSheetChange() {
  currentSheet = document.getElementById('sheetSelect').value;
  if (currentSheet === 'Transformed Data') {
    document.getElementById('calculateBtn').disabled = false;
    loadGeneList();
  }
}

async function loadGeneList() {
  if (!currentFile) return;
  const result = await ipcRenderer.invoke('read-excel', currentFile);
  if (!result.success || !result.sheets['Transformed Data']) return;
  const data = result.sheets['Transformed Data'];
  if (data.length < 1) return;
  const genes = data[0].slice(2).filter(h => h && String(h).trim());
  const sel = document.getElementById('refGeneSelect');
  sel.innerHTML = '';
  if (genes.length === 0) { sel.innerHTML = '<option value="">No genes</option>'; return; }
  genes.forEach(g => { const o = document.createElement('option'); o.value = g; o.textContent = g; sel.appendChild(o); });
}

async function runTransform() {
  if (!currentFile || !currentSheet) { showToast(t('errSelectSheet'), 'error'); return; }
  showLoading(t('converting'));
  updateStatus('transform', 'processing', '...');
  const result = await ipcRenderer.invoke('data-transform', { filePath: currentFile, sheetName: currentSheet });
  hideLoading();
  if (!result.success) { updateStatus('transform', 'error', '✗'); showToast(result.error, 'error'); return; }
  updateStatus('transform', 'success', '✓');
  document.getElementById('transformResult').style.display = 'flex';
  document.getElementById('transformResultContent').innerHTML = `<strong>${result.message}</strong>`;
  document.getElementById('calculateBtn').disabled = false;
  loadGeneList();
  showToast(t('transformDone'), 'success');
}

async function runCalculate() {
  if (!currentFile) { showToast(t('errOpenFile'), 'error'); return; }
  const numRepeats = parseInt(document.getElementById('repeatsSelect').value);
  const refGene = document.getElementById('refGeneSelect').value;
  if (!refGene) { showToast(t('errSelectGene'), 'error'); return; }
  showLoading(t('calculating'));
  updateStatus('calculate', 'processing', '...');
  const result = await ipcRenderer.invoke('qpcr-calculate', { filePath: currentFile, numRepeats, refGene });
  hideLoading();
  if (!result.success) { updateStatus('calculate', 'error', '✗'); showToast(result.error, 'error'); return; }
  updateStatus('calculate', 'success', '✓');
  document.getElementById('calculateResult').style.display = 'flex';
  document.getElementById('calculateResultContent').innerHTML = `<strong>${result.message}</strong>`;
  showToast(t('calcDone'), 'success');
}

function updateStatus(type, status, text) {
  const el = document.getElementById(`${type}Status`);
  el.querySelector('.status-dot').className = 'status-dot ' + status;
  el.querySelector('span:last-child').textContent = text;
}

async function saveFile() {
  if (!currentFile) { showToast(t('errOpenFile'), 'error'); return; }
  const result = await ipcRenderer.invoke('save-excel', { filePath: currentFile });
  if (result.success) showToast(t('saveSuccess'), 'success');
  else if (result.error !== '用户取消保存') showToast(result.error, 'error');
}

async function selectTiffFolder() {
  const result = await ipcRenderer.invoke('select-folder');
  if (!result) return;
  tiffFolderPath = result;
  document.getElementById('tiffFolderName').textContent = result.split('\\').pop();
  document.getElementById('tiffFolderPath').textContent = result;
  document.getElementById('tiffConvertBtn').disabled = false;
  showToast(t('folderSelected'), 'success');
}

async function runTiffConvert() {
  if (!tiffFolderPath) { showToast(t('errSelectFolder'), 'error'); return; }
  const options = {
    folderPath: tiffFolderPath,
    addLabel: document.getElementById('tiffAddLabel').value === '1',
    font: document.getElementById('tiffFont').value,
    fontSize: parseInt(document.getElementById('tiffFontSize').value),
    fontBold: document.getElementById('tiffBold').value === 'true',
    fontItalic: document.getElementById('tiffItalic').value === 'true',
    marginX: parseInt(document.getElementById('tiffMarginX').value),
    marginY: parseInt(document.getElementById('tiffMarginY').value),
    paddingX: parseInt(document.getElementById('tiffPaddingX').value),
    paddingY: parseInt(document.getElementById('tiffPaddingY').value),
    bgAlpha: parseInt(document.getElementById('tiffBgAlpha').value),
    quality: parseInt(document.getElementById('tiffQuality').value)
  };
  showLoading(t('converting'));
  const result = await ipcRenderer.invoke('tiff-convert', options);
  hideLoading();
  if (!result.success) { showToast(result.error, 'error'); return; }
  document.getElementById('tiffResult').style.display = 'flex';
  document.getElementById('tiffResultContent').innerHTML = `<strong>${result.message}</strong>`;
  showToast(`${t('calcDone')}: ${result.successCount}`, 'success');
}

let updateModal = null;
function ensureUpdateModal() {
  if (updateModal) return updateModal;
  updateModal = document.createElement('div');
  updateModal.className = 'modal-overlay';
  updateModal.id = 'updateModal';
  updateModal.innerHTML = `
    <div class="modal-box" style="min-width:320px">
      <div class="modal-header">
        <h3 id="updateModalTitle">${t('updateTitle')}</h3>
        <button class="modal-close" id="closeUpdateModal">&times;</button>
      </div>
      <div class="modal-body" style="text-align:center">
        <div id="updateModalContent"></div>
        <div class="btn-row" style="margin-top:16px;justify-content:center" id="updateModalBtns"></div>
      </div>
    </div>`;
  document.body.appendChild(updateModal);
  updateModal.querySelector('#closeUpdateModal').onclick = () => { updateModal.style.display = 'none'; };
  updateModal.onclick = (e) => { if (e.target === updateModal) updateModal.style.display = 'none'; };
  return updateModal;
}

function showUpdateModal(content, btns) {
  const modal = ensureUpdateModal();
  modal.querySelector('#updateModalContent').innerHTML = content;
  modal.querySelector('#updateModalBtns').innerHTML = btns;
  modal.style.display = 'flex';
}

function checkForUpdates() {
  showUpdateModal(`<p>${t('updateChecking')}</p>`, '');
  ipcRenderer.invoke('check-update');
}

ipcRenderer.on('update-status', (e, data) => {
  switch (data.status) {
    case 'available':
      showUpdateModal(
        `<div style="font-size:32px;margin-bottom:12px">&#127381;</div><p style="font-weight:600">${t('updateAvailable').replace('{v}', data.version)}</p>`,
        `<button class="btn btn-primary" onclick="downloadUpdate()">${t('updateDownload')}</button>
         <button class="btn" onclick="document.getElementById('updateModal').style.display='none'">${t('updateLater')}</button>`
      );
      break;
    case 'downloading':
      showUpdateModal(
        `<p>${t('updateDownloading').replace('{p}', data.percent)}</p>
         <div style="width:100%;height:6px;background:var(--border);border-radius:3px;margin-top:12px;overflow:hidden">
           <div style="width:${data.percent}%;height:100%;background:var(--accent);border-radius:3px;transition:width 0.3s"></div>
         </div>`,
        ''
      );
      break;
    case 'downloaded':
      showUpdateModal(
        `<div style="font-size:32px;margin-bottom:12px">&#9989;</div><p>${t('updateDownloaded')}</p>`,
        `<button class="btn btn-primary" onclick="installUpdate()">${t('updateRestart')}</button>
         <button class="btn" onclick="document.getElementById('updateModal').style.display='none'">${t('updateLater')}</button>`
      );
      break;
    case 'up-to-date':
      showUpdateModal(`<p>${t('updateUpToDate')}</p>`, `<button class="btn" onclick="document.getElementById('updateModal').style.display='none'">${t('close')}</button>`);
      break;
    case 'error':
      showUpdateModal(`<p>${t('updateError')}</p>`, `<button class="btn" onclick="document.getElementById('updateModal').style.display='none'">${t('close')}</button>`);
      break;
  }
});

function downloadUpdate() { ipcRenderer.invoke('download-update'); }
function installUpdate() { ipcRenderer.invoke('install-update'); }
