import { BrowserContext, ElectronApplication, Page, _electron as electron } from 'playwright';
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

test.describe('Check Home Page', async () => {
  let app: ElectronApplication;
  let firstWindow: Page;
  let context: BrowserContext;
  let userDataDir: string;

  test.beforeAll( async () => {
    // WHY: never let automated tests read or migrate an operator's real local
    // database and settings. Each run gets a disposable Electron profile.
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vlsm-interfacing-e2e-'));
    app = await electron.launch({
      args: [
        path.join(__dirname, '../app/main.js'),
        path.join(__dirname, '../app/package.json'),
        `--user-data-dir=${userDataDir}`
      ]
    });
    context = app.context();
    await context.tracing.start({ screenshots: true, snapshots: true });
    firstWindow = await app.firstWindow();
    await firstWindow.waitForLoadState('domcontentloaded');
  });

  test('Launch electron app', async () => {

    const windowState: { isVisible: boolean; isDevToolsOpened: boolean; isCrashed: boolean } = await app.evaluate(async (process) => {
      const mainWindow = process.BrowserWindow.getAllWindows()[0];

      const getState = () => ({
        isVisible: mainWindow.isVisible(),
        isDevToolsOpened: mainWindow.webContents.isDevToolsOpened(),
        isCrashed: mainWindow.webContents.isCrashed(),
      });

      return new Promise((resolve) => {
        if (mainWindow.isVisible()) {
          resolve(getState());
        } else {
          mainWindow.once('ready-to-show', () => setTimeout(() => resolve(getState()), 0));
        }
      });
    });

    expect(windowState.isVisible).toBeTruthy();
    expect(windowState.isDevToolsOpened).toBeFalsy();
    expect(windowState.isCrashed).toBeFalsy();
  });

  // test('Check Home Page design', async ({ browserName}) => {
  //   // Uncomment if you change the design of Home Page in order to create a new screenshot
  //   const screenshot = await firstWindow.screenshot({ path: '/tmp/home.png' });
  //   expect(screenshot).toMatchSnapshot(`home-${browserName}.png`);
  // });

  test('shows the application login screen', async () => {
    const elem = await firstWindow.$('app-home h1');
    const text = await elem.innerText();
    expect(text.trim()).toBe('Instrument Interfacing Tool');
    await expect(firstWindow.getByRole('button', { name: 'Sign in' })).toBeVisible();
  });

  test.afterAll( async () => {
    await context.tracing.stop({ path: 'e2e/tracing/trace.zip' });
    await app.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  });
});
