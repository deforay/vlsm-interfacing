import { enableProdMode } from '@angular/core';
import { platformBrowserDynamic } from '@angular/platform-browser-dynamic';

import { AppModule } from './app/app.module';
import { APP_CONFIG } from './environments/environment';

if (APP_CONFIG.production) {
  enableProdMode();
}

function serializeRendererError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}${error.stack ? `\n${error.stack}` : ''}`;
  }

  if (typeof error === 'string') {
    return error;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function logRendererStartupError(prefix: string, error: unknown): void {
  const message = `${prefix} ${serializeRendererError(error)}`;
  console.error(message);

  const electron = (window as any)?.require?.('electron');
  electron?.ipcRenderer?.invoke('log-error', message).catch(() => {});
}

window.addEventListener('error', (event: ErrorEvent) => {
  logRendererStartupError('[Renderer][WindowError]', event.error ?? event.message);
});

window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
  logRendererStartupError('[Renderer][UnhandledRejection]', event.reason);
});

platformBrowserDynamic()
  .bootstrapModule(AppModule, {
    preserveWhitespaces: false
  })
  .catch(err => logRendererStartupError('[Renderer][Bootstrap]', err));
