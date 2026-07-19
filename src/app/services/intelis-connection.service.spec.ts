import { describe, expect, it, vi } from 'vitest';
import { IntelisConnectionService } from './intelis-connection.service';
import { buildIntelisApiUrl, normalizeIntelisBaseUrl } from '../../../shared/intelis-connection';

describe('InteLIS URL contract', () => {
  it('normalizes a secure base URL and builds the versioned endpoint', () => {
    expect(normalizeIntelisBaseUrl(' https://vlsm.test/ ')).toBe('https://vlsm.test');
    expect(buildIntelisApiUrl('https://vlsm.test/', 'connection'))
      .toBe('https://vlsm.test/api/v1/interface/connection');
  });

  it('rejects insecure or credential-bearing URLs', () => {
    expect(() => normalizeIntelisBaseUrl('http://vlsm.test')).toThrow(/HTTPS/);
    expect(() => normalizeIntelisBaseUrl('https://user:secret@vlsm.test')).toThrow(/cannot contain credentials/);
    expect(() => normalizeIntelisBaseUrl('https://vlsm.test?facility=1')).toThrow(/query parameters/);
  });
});

describe('IntelisConnectionService', () => {
  function createService(response: any) {
    const electron = {
      isElectron: true,
      ipcRenderer: { invoke: vi.fn().mockResolvedValue(response) }
    } as any;
    return { service: new IntelisConnectionService(electron), electron };
  }

  it('activates through the main process without exposing a credential', async () => {
    const state = {
      configured: true,
      baseUrl: 'https://vlsm.test',
      installation: {
        installationId: 'server-id',
        sourceInstallationId: 'source-id',
        displayName: 'Lab computer',
        scopes: ['connection:read'],
        credentialVersion: 1
      }
    };
    const { service, electron } = createService({ ok: true, data: state });

    const result = await service.connect({
      baseUrl: 'https://vlsm.test',
      connectionCode: 'ABCD-EFGH',
      displayName: 'Lab computer'
    });

    expect(result.data).toEqual(state);
    expect((result.data as any).credential).toBeUndefined();
    expect((result.data as any).encryptedCredential).toBeUndefined();
    expect((result.data as any).installation.credential).toBeUndefined();
    expect(electron.ipcRenderer.invoke).toHaveBeenCalledWith('intelis-connection-connect', {
      baseUrl: 'https://vlsm.test',
      connectionCode: 'ABCD-EFGH',
      displayName: 'Lab computer'
    });
  });

  it('adopts the canonical identity returned after reconnect', async () => {
    const { service } = createService({
      ok: true,
      data: {
        configured: true,
        installation: {
          installationId: 'existing-server-id',
          sourceInstallationId: 'existing-source-id',
          displayName: 'Existing installation',
          scopes: ['connection:read'],
          credentialVersion: 3
        }
      }
    });

    await service.connect({ baseUrl: 'https://vlsm.test', connectionCode: 'RECONNECT', displayName: '' });

    expect(service.currentState().installation).toMatchObject({
      installationId: 'existing-server-id',
      sourceInstallationId: 'existing-source-id',
      credentialVersion: 3
    });
  });

  it('retains revoked state returned by a failed refresh', async () => {
    const revoked = {
      configured: true,
      health: 'revoked',
      lastError: { code: 'invalid_credential', message: 'Credential revoked', httpStatus: 401 }
    };
    const { service } = createService({ ok: false, data: revoked, error: revoked.lastError });

    const result = await service.refresh();

    expect(result.ok).toBe(false);
    expect(service.currentState()).toEqual(revoked);
  });
});
