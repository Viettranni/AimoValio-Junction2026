import { describe, expect, it } from 'vitest';
import { claudeAddConnectorUrl, claudeCodeCommand } from './ConnectCard';

describe('connect links', () => {
  it('pre-fills claude.ai\'s Add custom connector dialog, with the key-bearing URL encoded', () => {
    const mcp = 'https://abc.trycloudflare.com/api/mcp?key=sakdnkfbwjklebfkjABF';
    const url = new URL(claudeAddConnectorUrl(mcp));
    expect(url.origin + url.pathname).toBe('https://claude.ai/customize/connectors');
    expect(url.searchParams.get('modal')).toBe('add-custom-connector');
    expect(url.searchParams.get('connectorName')).toBe('Aimo');
    expect(url.searchParams.get('connectorUrl')).toBe(mcp);
  });

  it('gives Claude Code a one-line command', () => {
    expect(claudeCodeCommand('http://localhost:3100/api/mcp?key=k')).toBe('claude mcp add --transport http aimo "http://localhost:3100/api/mcp?key=k"');
  });
});
