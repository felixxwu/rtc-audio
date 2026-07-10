// src/linkify.test.tsx
import { describe, it, expect } from 'vitest';
import { linkify } from './linkify.tsx';
import { isValidElement } from 'react';

describe('linkify', () => {
  it('returns a plain string when there is no URL', () => {
    expect(linkify('hello world')).toEqual(['hello world']);
  });

  it('wraps a URL in an anchor element', () => {
    const nodes = linkify('see https://example.com now');
    const anchor = nodes.find((n) => isValidElement(n));
    expect(anchor).toBeTruthy();
    expect((anchor as React.ReactElement).props.href).toBe('https://example.com');
  });
});
