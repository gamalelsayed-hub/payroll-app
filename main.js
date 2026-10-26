const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { extractItems } = require('./src/pdftext');
const { readFirstSheet } = require('./src/xlsx');

// مجلد البيانات داخل "المستندات" ليسهل نسخه احتياطياً
const dataDir = () => path.join(app.getPath('documents'), 'برنامج الرواتب');
const dataFile = () => path.join(dataDir(), 'data.json');
const backupDir = () => path.join(dataDir(), 'نسخ احتياطية');
const attachDir = () => path.join(dataDir(), 'مرفقات');

let win;

function createWindow() {
  win = new BrowserWindow({
    width: 1366,
    height: 860,
    minWidth: 1024,
    minHeight: 640,
    title: 'برنامج الرواتب',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
  win.webContents.on('before-input-event', (e, input) => {
    if (input.key === 'F12') win.webContents.toggleDevTools();
  });
}

function backupOnce() {
  // نسخة احتياطية واحدة يومياً، والاحتفاظ بآخر 60 نسخة
  if (!fs.existsSync(dataFile())) return;
  fs.mkdirSync(backupDir(), { recursive: true });
  const day = new Date().toISOString().slice(0, 10);
  const target = path.join(backupDir(), `data-${day}.json`);
  if (!fs.existsSync(target)) fs.copyFileSync(dataFile(), target);
  const files = fs.readdirSync(backupDir()).filter((f) => /^data-.*\.json$/.test(f)).sort();
  for (const f of files.slice(0, Math.max(0, files.length - 60))) fs.unlinkSync(path.join(backupDir(), f));
}

ipcMain.handle('data:load', () => {
  fs.mkdirSync(dataDir(), { recursive: true });
  if (!fs.existsSync(dataFile())) return null;
  return fs.readFileSync(dataFile(), 'utf8');
});

ipcMain.handle('data:save', (_e, json) => {
  fs.mkdirSync(dataDir(), { recursive: true });
  backupOnce();
  const tmp = dataFile() + '.tmp';
  fs.writeFileSync(tmp, json, 'utf8');
  fs.renameSync(tmp, dataFile());
  return true;
});

ipcMain.handle('data:folder', () => { shell.openPath(dataDir()); return dataDir(); });

ipcMain.handle('file:save', async (_e, { defaultName, bytes, filters }) => {
  const r = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('documents'), defaultName), filters });
  if (r.canceled || !r.filePath) return null;
  fs.writeFileSync(r.filePath, Buffer.from(bytes));
  return r.filePath;
});

ipcMain.handle('file:open', async (_e, { filters }) => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters });
  if (r.canceled || !r.filePaths.length) return null;
  const p = r.filePaths[0];
  return { name: path.basename(p), bytes: new Uint8Array(fs.readFileSync(p)) };
});

ipcMain.handle('pdf:save', async (_e, { html, defaultName, landscape }) => {
  const r = await dialog.showSaveDialog(win, {
    defaultPath: path.join(app.getPath('documents'), defaultName),
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (r.canceled || !r.filePath) return null;
  const w = new BrowserWindow({ show: false, webPreferences: { sandbox: true, javascript: false } });
  await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  const pdf = await w.webContents.printToPDF({ landscape: !!landscape, pageSize: 'A4', printBackground: true });
  w.destroy();
  fs.writeFileSync(r.filePath, pdf);
  return r.filePath;
});

ipcMain.handle('file:show', (_e, p) => shell.showItemInFolder(p));

ipcMain.handle('file:openMany', async (_e, { filters }) => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'], filters });
  if (r.canceled) return [];
  return r.filePaths.map((p) => ({ name: path.basename(p), bytes: new Uint8Array(fs.readFileSync(p)) }));
});

ipcMain.handle('pdf:extract', (_e, bytes) => extractItems(Buffer.from(bytes)));
ipcMain.handle('xlsx:read', (_e, bytes) => readFirstSheet(Buffer.from(bytes)));

// المرفقات تُنسخ داخل مجلد البيانات ويُحفظ مسارها النسبي
ipcMain.handle('attach:add', async (_e, { folder }) => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'] });
  if (r.canceled) return [];
  const dir = path.join(attachDir(), folder);
  fs.mkdirSync(dir, { recursive: true });
  return r.filePaths.map((src) => {
    const base = path.basename(src);
    let name = base, i = 1;
    while (fs.existsSync(path.join(dir, name))) name = `${path.parse(base).name} (${i++})${path.extname(base)}`;
    fs.copyFileSync(src, path.join(dir, name));
    return { name, rel: path.join(folder, name), addedAt: new Date().toISOString().slice(0, 10) };
  });
});

const attachPath = (rel) => {
  const p = path.resolve(attachDir(), rel);
  if (!p.startsWith(path.resolve(attachDir()) + path.sep)) throw new Error('مسار غير صالح');
  return p;
};
ipcMain.handle('attach:open', (_e, rel) => shell.openPath(attachPath(rel)));
ipcMain.handle('attach:remove', (_e, rel) => { const p = attachPath(rel); if (fs.existsSync(p)) fs.unlinkSync(p); return true; });

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
