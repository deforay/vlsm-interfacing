import { describe, expect, it, vi } from 'vitest';
import { UtilitiesService } from './utilities.service';

describe('UtilitiesService', () => {
  const createService = () => new UtilitiesService(null, null, { log: vi.fn() } as any);

  describe('hex2ascii', () => {
    it('turns every byte value into the character with that code', () => {
      const bytes = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
      const text = createService().hex2ascii(bytes.toString('hex'));

      expect(text).toHaveLength(256);
      expect(Array.from(text, character => character.charCodeAt(0))).toEqual([...bytes]);
    });

    it('keeps an ASTM frame byte for byte', () => {
      const frame = '\x021H|\\^&|||Analyzer\r\x0349\r\n';
      const hex = Buffer.from(frame, 'latin1').toString('hex');

      expect(createService().hex2ascii(hex)).toBe(frame);
    });

    it('returns an empty string for no bytes', () => {
      expect(createService().hex2ascii('')).toBe('');
    });
  });

  describe('decodeHtmlEntities', () => {
    it('decodes each entity everywhere it appears', () => {
      const decoded = createService().decodeHtmlEntities('&lt;20&gt; &lt;40&gt; a&amp;b &quot;x&quot; it&#39;s&nbsp;&nbsp;here');

      expect(decoded).toBe('<20> <40> a&b "x" it\'s  here');
    });

    it('leaves text without entities as it is', () => {
      expect(createService().decodeHtmlEntities('cp/mL')).toBe('cp/mL');
    });
  });
});
