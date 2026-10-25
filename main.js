const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

// مجلد البيانات داخل "المستندات" ليسهل نسخه احتياطياً
const dataDir = () => path.join(app.getPath('documents'), 'برنامج الرواتب');
const dataFile = () => path.join(dataDir(), 'data.json');
const backupDir = () => path.join(dataDir(), 'نسخ احتياطية');

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

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
