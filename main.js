// gemaro1y
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { startServer, getServerInfo } = require('./server');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 650,
    minWidth: 700,
    minHeight: 500,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
    backgroundColor: '#0a0a0f',
    autoHideMenuBar: true,
    title: 'PhoneStream',
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  createWindow();
  const info = await getServerInfo();
  if (mainWindow) {
    mainWindow.webContents.on('did-finish-load', () => {
      mainWindow.webContents.send('server-info', info);
    });
  }
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

ipcMain.handle('get-server-info', async () => {
  return await getServerInfo();
});
