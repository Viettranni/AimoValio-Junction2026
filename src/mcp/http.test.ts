import { describe, expect, it } from 'vitest';
import { originAllowed } from './http';

const url = 'https://abc.trycloudflare.com/api/mcp?key=k';

describe('MCP origin check', () => {
  it('accepts non-browser clients, its own origin, localhost and Claude\'s apps', () => {
    for (const o of [null, 'https://abc.trycloudflare.com', 'http://localhost:3100', 'https://claude.ai', 'https://www.claude.ai', 'https://claude.com']) {
      expect(originAllowed(o, url, {})).toBe(true);
    }
  });

  it('rejects other sites and look-alikes, unless listed in AIMO_ALLOWED_ORIGINS', () => {
    for (const o of ['https://evil.example', 'https://claude.ai.evil.example', 'https://notclaude.ai', 'garbage']) {
      expect(originAllowed(o, url, {})).toBe(false);
    }
    expect(originAllowed('https://tools.example', url, { AIMO_ALLOWED_ORIGINS: 'https://tools.example' })).toBe(true);
  });
});
