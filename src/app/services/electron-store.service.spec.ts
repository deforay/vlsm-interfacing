import { describe, expect, it } from 'vitest';
import { ElectronStoreService } from './electron-store.service';

describe('ElectronStoreService settings export', () => {
  it('removes database and API credentials from persisted settings', () => {
    const service = Object.create(ElectronStoreService.prototype) as ElectronStoreService;
    const settings: any = {
      commonConfig: {
        labID: 'LAB001',
        mysqlHost: '127.0.0.1',
        mysqlPassword: 'secret',
        encryptionKey: 'key'
      },
      lisApiConfig: {
        url: 'https://lis.example.test',
        credentials: { token: 'token' }
      }
    };

    service.removeSensitiveFields(settings);

    expect(settings.commonConfig).toEqual({
      labID: 'LAB001',
      mysqlHost: '127.0.0.1'
    });
    expect(settings.lisApiConfig.credentials).toBeUndefined();
  });
});
