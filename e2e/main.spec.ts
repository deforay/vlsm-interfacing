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

  test('guides operators to the correct LIS connection setup', async () => {
    await firstWindow.getByPlaceholder('Login ID').fill('admin');
    await firstWindow.getByPlaceholder('Login Password').fill('admin');
    await firstWindow.getByRole('button', { name: 'Sign in' }).click();

    await expect(firstWindow.getByRole('heading', { name: 'Interface Tool Settings' })).toBeVisible();
    await firstWindow.getByText('LIS Connection', { exact: true }).click();
    await expect(firstWindow.getByRole('heading', { name: 'Which system does your laboratory use?' })).toBeVisible();
    await firstWindow.getByRole('button', { name: /My laboratory uses InteLIS/ }).click();
    await expect(firstWindow.getByRole('heading', { name: 'Connect to InteLIS' })).toBeVisible();
    await expect(firstWindow.getByLabel('InteLIS URL')).toBeVisible();
    await expect(firstWindow.getByLabel('Connection Code')).toBeVisible();
    await firstWindow.getByRole('button', { name: 'Change connection type' }).click();
    await firstWindow.getByRole('button', { name: /My laboratory uses another LIS/ }).click();
    await expect(firstWindow.getByRole('heading', { name: 'Connect to another LIS' })).toBeVisible();
  });

  test('rejects an insecure InteLIS URL in the main process', async () => {
    await firstWindow.getByRole('button', { name: 'Change connection type' }).click();
    await firstWindow.getByRole('button', { name: /My laboratory uses InteLIS/ }).click();
    await firstWindow.getByLabel('InteLIS URL').fill('http://vlsm.test');
    await firstWindow.getByLabel('Connection Code').fill('ABCD-EFGH-JKMP');
    await firstWindow.getByRole('button', { name: 'Connect to InteLIS' }).click();

    await expect(firstWindow.getByText('InteLIS connections require HTTPS.')).toBeVisible();
  });

  test.afterAll( async () => {
    // WHY: a launch failure can occur before these resources are assigned;
    // cleanup must preserve the original failure instead of throwing another.
    if (context) {
      await context.tracing.stop({ path: 'e2e/tracing/trace.zip' });
    }
    if (app) {
      await app.close();
    }
    if (userDataDir) {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    }
  });
});
