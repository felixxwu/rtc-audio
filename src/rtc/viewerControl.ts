// Imperative open channel for StreamViewer: the participant box (watch) and
// the self box's own thumbnail (host) request the fullscreen view; the viewer
// consumes the request on its next notification.
type View = 'watch' | 'host';
let requested: View | null = null;
let notify: () => void = () => {};

export function requestView(v: View): void {
  requested = v;
  notify();
}

export function consumeRequest(): View | null {
  const r = requested;
  requested = null;
  return r;
}

export function onRequest(fn: () => void): () => void {
  notify = fn;
  return () => {
    notify = () => {};
  };
}
