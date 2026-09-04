/**
 * The decision to interrupt an operator, tested directly.
 *
 * A banner that appears when there is nothing to do is a banner people learn
 * to dismiss without reading, so most of what follows is about staying quiet.
 */
import { describe, expect, it, vi } from 'vitest';
import { compareVersions, resolveUpdateNudge } from '../../../shared/update-check';
import { UpdateCheckService } from './update-check.service';

describe('comparing versions', () => {
  it('orders by number rather than as text', () => {
    // The one that a string comparison gets wrong, and the reason this exists.
    expect(compareVersions('4.10.0', '4.9.0')).toBeGreaterThan(0);
    expect(compareVersions('4.2.1', '4.2.0')).toBeGreaterThan(0);
    expect(compareVersions('5.0.0', '4.99.99')).toBeGreaterThan(0);
    expect(compareVersions('4.2.0', '4.2.0')).toBe(0);
  });

  it('tolerates a leading v and missing segments', () => {
    expect(compareVersions('v4.3.0', '4.3.0')).toBe(0);
    expect(compareVersions('4.3', '4.3.0')).toBe(0);
    expect(compareVersions('4.3.1', '4.3')).toBeGreaterThan(0);
  });

  it('treats a pre-release as older than the release it precedes', () => {
    expect(compareVersions('4.3.0-rc.1', '4.3.0')).toBeLessThan(0);
    expect(compareVersions('4.3.0', '4.3.0-rc.1')).toBeGreaterThan(0);
    expect(compareVersions('4.3.0-rc.1', '4.3.0-rc.2')).toBeLessThan(0);
  });

  it('calls anything it cannot read equal, so nothing is announced on it', () => {
    for (const unreadable of ['', 'latest', 'v', '4.x', 'release-4', null as any, undefined as any]) {
      expect(compareVersions(unreadable, '4.2.0'), String(unreadable)).toBe(0);
      expect(compareVersions('4.2.0', unreadable), String(unreadable)).toBe(0);
    }
  });
});

describe('deciding whether to say anything', () => {
  const current = '4.2.1';

  it('says nothing when nothing is newer', () => {
    expect(resolveUpdateNudge({ currentVersion: current, publishedVersion: '4.2.1' })).toBeNull();
    expect(resolveUpdateNudge({ currentVersion: current, publishedVersion: '4.1.15' })).toBeNull();
    expect(resolveUpdateNudge({ currentVersion: current })).toBeNull();
  });

  it('says nothing when the feed could not be reached', () => {
    // An offline laboratory, which is the ordinary case rather than a failure.
    expect(resolveUpdateNudge({ currentVersion: current, publishedVersion: null })).toBeNull();
  });

  it('names the newer release', () => {
    expect(resolveUpdateNudge({ currentVersion: current, publishedVersion: 'v4.3.0' }))
      .toEqual({ version: '4.3.0' });
  });

  it('stays quiet about a version already dismissed', () => {
    expect(resolveUpdateNudge({
      currentVersion: current, publishedVersion: '4.3.0', dismissedVersion: '4.3.0'
    })).toBeNull();
  });

  it('speaks up again for a version later than the dismissed one', () => {
    // Dismissing one release must not silence every release after it.
    expect(resolveUpdateNudge({
      currentVersion: current, publishedVersion: '4.4.0', dismissedVersion: '4.3.0'
    })).toEqual({ version: '4.4.0' });
  });

  it('is not fooled by a version it cannot read', () => {
    expect(resolveUpdateNudge({ currentVersion: current, publishedVersion: 'nightly' })).toBeNull();
    expect(resolveUpdateNudge({ currentVersion: 'unreleased', publishedVersion: '4.3.0' })).toBeNull();
  });
});

describe('the service', () => {
  const createService = (options: {
    appVersion?: string;
    dismissed?: string | null;
    published?: string | null;
    invokeThrows?: boolean;
  } = {}) => {
    const values: Record<string, any> = {
      // Passing appVersion explicitly as undefined means "the store does not
      // know", which is a case worth testing.
      appVersion: 'appVersion' in options ? options.appVersion : '4.2.1',
      dismissedUpdateVersion: options.dismissed ?? null
    };
    const invoke = vi.fn(async (channel: string) => {
      if (options.invokeThrows) throw new Error('offline');
      if (channel === 'update-check-latest-release') return { version: options.published ?? null };
      return undefined;
    });
    const store = {
      get: (key: string) => values[key],
      set: (key: string, value: any) => { values[key] = value; }
    };
    const electron = { isElectron: true, ipcRenderer: { invoke } };
    const service = new UpdateCheckService(electron as any, store as any);
    return { service, invoke, values };
  };

  it('publishes the release it found', async () => {
    const { service } = createService({ published: 'v4.3.0' });
    await service.check();
    let seen: any = 'unset';
    service.availableUpdate().subscribe(value => { seen = value; });
    expect(seen).toEqual({ version: '4.3.0' });
  });

  it('stays silent when the check cannot be made at all', async () => {
    const { service } = createService({ invokeThrows: true });
    await expect(service.check()).resolves.toBeUndefined();
    let seen: any = 'unset';
    service.availableUpdate().subscribe(value => { seen = value; });
    expect(seen).toBeNull();
  });

  it('remembers a dismissal by version', async () => {
    const { service, values } = createService({ published: '4.3.0' });
    await service.check();
    service.dismiss('4.3.0');
    expect(values.dismissedUpdateVersion).toBe('4.3.0');

    await service.check();
    let seen: any = 'unset';
    service.availableUpdate().subscribe(value => { seen = value; });
    expect(seen).toBeNull();
  });

  it('says nothing when it does not know what version it is', async () => {
    const { service, invoke } = createService({ appVersion: undefined, published: '4.3.0' });
    await service.check();
    expect(invoke).not.toHaveBeenCalled();
  });
});
