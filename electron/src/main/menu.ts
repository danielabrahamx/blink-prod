// Application menu. Keeps the standard edit/view/window shortcuts plus a
// Help > Check for Updates stub that calls into the updater module.

import { Menu, type MenuItemConstructorOptions, shell, app } from 'electron';
import { checkForUpdates } from './updater.js';

export function buildMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [{ role: 'quit' }],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [{ role: 'minimize' }, { role: 'close' }],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Check for Updates',
          click: (): void => {
            void checkForUpdates({ userInitiated: true });
          },
        },
        {
          label: 'Open Logs Folder',
          click: (): void => {
            void shell.openPath(app.getPath('logs'));
          },
        },
        { type: 'separator' },
        {
          label: 'Blink Website',
          click: (): void => {
            void shell.openExternal('https://sibrox.com');
          },
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
