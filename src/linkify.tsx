// src/linkify.tsx
import React from 'react';

const URL_RE = /(https?:\/\/[^\s]+)/g;

// Split text into plain strings and anchor elements. Pure + deterministic so
// it is unit-testable without a DOM.
export function linkify(text: string): React.ReactNode[] {
  const parts = text.split(URL_RE);
  return parts.map((part, i) =>
    part.startsWith('http') ? (
      <a key={i} href={part} target="_blank" rel="noopener noreferrer">
        {part}
      </a>
    ) : (
      part
    )
  );
}
