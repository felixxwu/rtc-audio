import { useEffect, useReducer, useRef, useState } from 'react';
import styled from 'styled-components';
import { colors } from './colors.ts';
import { Button } from './Button.tsx';
import { Icon, Download } from './Icon.tsx';
import { refs } from './refs.ts';
import { acceptIncoming, sendFilesToAll } from './fileTransfer.ts';
import { Modal } from './Popup.tsx';

function formatSize(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1e3))} KB`;
}

const percent = (part: number, whole: number) =>
  whole > 0 ? Math.round((part / whole) * 100) : 0;

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

export function FilesPopup({ onClose }: { onClose: () => void }) {
  const [dragging, setDragging] = useState(false);
  const [, tick] = useReducer((n: number) => n + 1, 0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const interval = setInterval(tick, 300);
    return () => clearInterval(interval);
  }, []);

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
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setDragging(false);
  };

  return (
    <Modal onClose={onClose} title="Files">
      <Zone
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        $dragging={dragging}
      >
        <List>
          {items.length === 0 && <Empty>No files yet.</Empty>}
          {items.map((item) =>
            item.kind === 'in' ? (
              <Row key={item.key}>
                <Name>
                  {item.file.name} <Meta>{formatSize(item.file.size)}</Meta>
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
                  <Status>{percent(item.file.received, item.file.size)}%</Status>
                )}
              </Row>
            ) : (
              <Row key={item.key}>
                <Name>
                  ↑ {item.file.name} <Meta>{formatSize(item.file.size)}</Meta>
                </Name>
                <Status>{outgoingStatus(item.file)}</Status>
              </Row>
            )
          )}
        </List>
        <Button onClick={() => inputRef.current?.click()}>Choose files…</Button>
        <DropHint>or drop files here</DropHint>
        <input ref={inputRef} type="file" multiple hidden onChange={handlePick} />
      </Zone>
    </Modal>
  );
}

const Zone = styled('div')<{ $dragging?: boolean }>`
  display: flex;
  flex-direction: column;
  gap: 12px;
  border: 2px dashed ${(p) => (p.$dragging ? colors.accent2 : 'transparent')};
  border-radius: 8px;
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
const DropHint = styled('div')`
  color: ${colors.accent2};
  opacity: 0.6;
  font-size: 0.85em;
  text-align: center;
  margin-top: -4px;
`;
