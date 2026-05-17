import { describe, it, expect } from 'vitest';
import { esc } from './sanitize';

describe('esc', () => {
  it('escapes < and >', () => {
    expect(esc('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('escapes double quotes', () => {
    expect(esc('"hello"')).toBe('&quot;hello&quot;');
  });

  it('escapes single quotes', () => {
    expect(esc("it's")).toBe('it&#39;s');
  });

  it('escapes ampersands', () => {
    expect(esc('a & b')).toBe('a &amp; b');
  });

  it('leaves safe strings unchanged', () => {
    expect(esc('hello world')).toBe('hello world');
  });

  it('handles empty string', () => {
    expect(esc('')).toBe('');
  });

  it('escapes all special chars in one string', () => {
    const result = esc('<a href="x" data-val=\'y\'>a & b</a>');
    expect(result).not.toContain('<');
    expect(result).not.toContain('>');
    expect(result).not.toContain('"');
    expect(result).not.toContain("'");
    expect(result).not.toContain('& ');
  });
});
