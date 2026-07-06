import { useEffect, useReducer, useRef, useState } from 'react';
import styled from 'styled-components';
import { colors } from './colors.ts';
import { Button } from './Button.tsx';
import { Icon, Cross, Download } from './Icon.tsx';
import { refs } from './refs.ts';
import { acceptIncoming, sendFilesToAll } from './fileTransfer.ts';

function formatSize(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1e3))} KB`;
}

const percent = (part: number, whole: number) =>
  whole > 0 ? Math.round((part / whole) * 100) : 0;

// Aggregate an outgoing file's status across recipients into one line.
function outgoingStatus(outgoing: {
  size: number;
  perPeer: Map<string, { status: string; sent: number }>;
}): string {
  const peers = [...outgoing.perPeer.values()];
  if (peers.some((p) => p.status === 'sending')) {
    const min = Math.min(...peers.map((p) => percent(p.sent, outgoing.size)));
    return `Sending ${min}%`;
  }
  if (peers.every((p) => p.status === 'done')) return 'Sent';
  if (peers.every((p) => p.status === 'declined')) return 'Declined';
  if (peers.some((p) => p.status === 'queued' || p.status === 'offered'))
    return 'Waiting…';
  return 'Done';
}

export function FileControls() {
  const [open, setOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [, tick] = useReducer((n: number) => n + 1, 0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const interval = setInterval(tick, 300);
    return () => clearInterval(interval);
  }, []);

  // One combined, newest-first list of incoming + outgoing files.
  const items = [
    ...[...refs.incomingFiles.entries()].map(([key, file]) => ({
      kind: 'in' as const,
      key,
      seq: file.seq,
      file,
    })),
    ...[...refs.outgoingFiles.values()].map((file) => ({
      kind: 'out' as const,
      key: `out-${file.id}`,
      seq: file.seq,
      file,
    })),
  ].sort((a, b) => b.seq - a.seq);
  const pendingOffers = [...refs.incomingFiles.values()].filter(
    (f) => f.status === 'offered'
  ).length;

  const handlePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    if (files.length) sendFilesToAll(files);
    e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const files = e.dataTransfer?.files ? Array.from(e.dataTransfer.files) : [];
    if (files.length) sendFilesToAll(files);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    // Ignore leaves into child elements (dragleave bubbles).
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setDragging(false);
  };

  return (
    <>
      <p>
        <Button onClick={() => setOpen(true)}>
          Files{pendingOffers > 0 ? ` (${pendingOffers})` : ''}
        </Button>
      </p>

      {open && (
        <Backdrop onClick={() => setOpen(false)}>
          <Dialog
            onClick={(e) => e.stopPropagation()}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            $dragging={dragging}
          >
            <Header>
              <span>Files</span>
              <IconButton onClick={() => setOpen(false)} title="Close">
                <Icon path={Cross} size={20} color={colors.accent2} />
              </IconButton>
            </Header>

            <Button onClick={() => inputRef.current?.click()}>
              Send files…
            </Button>
            <DropHint>or drop files here</DropHint>
            <input
              ref={inputRef}
              type="file"
              multiple
              hidden
              onChange={handlePick}
            />

            <List>
              {items.length === 0 && <Empty>No files yet.</Empty>}

              {items.map((item) =>
                item.kind === 'in' ? (
                  <Row key={item.key}>
                    <Name>
                      {item.file.name}{' '}
                      <Meta>{formatSize(item.file.size)}</Meta>
                    </Name>
                    {item.file.status === 'offered' ? (
                      <IconButton
                        onClick={() => acceptIncoming(item.key)}
                        title="Download"
                      >
                        <Icon path={Download} size={20} color={colors.accent2} />
                      </IconButton>
                    ) : item.file.status === 'done' ? (
                      <Status>Saved</Status>
                    ) : (
                      <Status>
                        {percent(item.file.received, item.file.size)}%
                      </Status>
                    )}
                  </Row>
                ) : (
                  <Row key={item.key}>
                    <Name>
                      ↑ {item.file.name}{' '}
                      <Meta>{formatSize(item.file.size)}</Meta>
                    </Name>
                    <Status>{outgoingStatus(item.file)}</Status>
                  </Row>
                )
              )}
            </List>
          </Dialog>
        </Backdrop>
      )}
    </>
  );
}

const Backdrop = styled('div')`
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 20;
`;

const Dialog = styled('div')<{ $dragging?: boolean }>`
  background: ${(p) => (p.$dragging ? 'rgba(170, 170, 255, 0.1)' : colors.bg)};
  border: 2px dashed
    ${(p) => (p.$dragging ? colors.accent2 : 'transparent')};
  outline: 1px solid ${colors.accent};
  border-radius: 12px;
  padding: 20px;
  width: min(90vw, 460px);
  max-height: 80vh;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

const DropHint = styled('div')`
  color: ${colors.accent2};
  opacity: 0.6;
  font-size: 0.85em;
  text-align: center;
  margin-top: -4px;
`;

const Header = styled('div')`
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 1.1em;
  color: ${colors.accent2};
`;

const List = styled('div')`
  display: flex;
  flex-direction: column;
  max-height: 260px;
  overflow-y: auto;
`;

const Row = styled('div')`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  height: 40px;
  border-top: 1px solid rgba(170, 170, 255, 0.2);
`;

const Name = styled('div')`
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const Meta = styled('span')`
  color: ${colors.accent2};
  opacity: 0.7;
  font-size: 0.85em;
`;

const Status = styled('div')`
  display: flex;
  align-items: center;
  gap: 6px;
  color: ${colors.accent2};
  flex-shrink: 0;
`;

const IconButton = styled('button')`
  background: none;
  border: none;
  padding: 4px;
  cursor: pointer;
  display: flex;
  align-items: center;
`;

const Empty = styled('div')`
  color: ${colors.accent2};
  opacity: 0.7;
  padding: 8px 0;
`;
