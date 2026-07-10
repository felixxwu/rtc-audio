// src/ChatPanel.tsx
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import styled from 'styled-components';
import { colors } from './colors.ts';
import { Icon, Cross, Download, Send, Paperclip } from './Icon.tsx';
import { letterFor } from './participants.ts';
import { circleColor } from './participantColor.ts';
import { linkify } from './linkify.tsx';
import { myPeerId } from './identity.ts';
import {
  subscribeChat,
  getMessages,
  getTypingIds,
  sendText,
  setLocalTyping,
  sendFiles,
  fileAvailability,
  downloadFile,
  type ChatMessage,
  type FileMessage,
} from './chat.ts';
import { fileTransferState } from './fileTransfer.ts';
import { refs } from './refs.ts';

function formatSize(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1e3))} KB`;
}

// Re-render on any chat-store change; a 300ms tick also refreshes file
// progress (transfer state mutates in place, outside the store).
function useChatMessages(): readonly ChatMessage[] {
  return useSyncExternalStore(subscribeChat, getMessages);
}

function FileRow({ msg }: { msg: FileMessage }) {
  const mine = msg.senderId === myPeerId;
  const color = circleColor(msg.senderId);
  const availability = fileAvailability(msg);
  const transfer = fileTransferState(msg.id);
  let control: React.ReactNode;
  if (transfer?.status === 'done') {
    control = <Status>Saved</Status>;
  } else if (transfer?.status === 'receiving') {
    const pct = msg.size > 0 ? Math.round((transfer.received / msg.size) * 100) : 0;
    control = <Status>{pct}%</Status>;
  } else if (availability === 'available') {
    control = (
      <IconButton onClick={() => downloadFile(msg)} title="Download">
        <Icon path={Download} size={20} color={color} />
      </IconButton>
    );
  } else if (availability === 'self') {
    control = <Status>Shared</Status>;
  } else {
    control = <Status>No longer available</Status>;
  }
  return (
    <FileCard
      $mine={mine}
      style={{
        borderColor: color,
        color: color,
      }}
    >
      <Clip>
        <Icon
          path={Paperclip}
          size={20}
          color={color}
          strokeWidth={2.2}
          transform="rotate(45 12 12)"
        />
      </Clip>
      <Body>
        <Name $mine={mine}>{msg.name}</Name>
        <Sub>
          <Meta>{formatSize(msg.size)}</Meta>
          {control}
        </Sub>
      </Body>
    </FileCard>
  );
}

// The composer owns its own draft state so typing a message doesn't re-render
// (and re-linkify) the whole message list on every keystroke.
function Composer() {
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = () => {
    if (!draft.trim()) return;
    sendText(draft);
    setDraft('');
    setLocalTyping(false);
  };

  return (
    <ComposerBar>
      <IconButton onClick={() => inputRef.current?.click()} title="Attach files">
        <Icon
          path={Paperclip}
          size={20}
          color={colors.accent2}
          strokeWidth={2.2}
          transform="rotate(45 12 12)"
        />
      </IconButton>
      <TextInput
        rows={1}
        value={draft}
        placeholder="Message…"
        onChange={(e) => {
          setDraft(e.target.value);
          setLocalTyping(e.target.value.length > 0);
        }}
        onBlur={() => setLocalTyping(false)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
      />
      <input
        ref={inputRef}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          const files = e.target.files ? Array.from(e.target.files) : [];
          if (files.length) sendFiles(files);
          e.target.value = '';
        }}
      />
      <IconButton onClick={submit} title="Send">
        <Icon path={Send} size={20} color={colors.accent2} />
      </IconButton>
    </ComposerBar>
  );
}

export function ChatPanel({ onClose }: { onClose: () => void }) {
  const messages = useChatMessages();
  const [, tick] = useState(0);
  const endRef = useRef<HTMLDivElement>(null);

  // Periodic tick so in-place transfer progress updates the file rows — but
  // only re-render while a download is actually receiving, so an open-but-idle
  // panel doesn't rebuild the whole message list every 300ms.
  useEffect(() => {
    const t = setInterval(() => {
      for (const transfer of refs.incomingTransfers.values()) {
        if (transfer.status === 'receiving') {
          tick((n) => n + 1);
          return;
        }
      }
    }, 300);
    return () => clearInterval(t);
  }, []);

  // Auto-scroll to the newest message.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);

  const typing = getTypingIds();

  return (
    <Panel>
      <Header>
        <span>Chat</span>
        <IconButton onClick={onClose} title="Close">
          <Icon path={Cross} size={20} color={colors.accent2} />
        </IconButton>
      </Header>

      <List>
        {messages.length === 0 && <Empty>No messages yet.</Empty>}
        {messages.map((m) => {
          if (m.kind === 'system') {
            return (
              <SystemLine key={m.id}>
                {letterFor(m.senderId)}{' '}
                {m.event === 'joined' ? 'joined' : 'left'}
              </SystemLine>
            );
          }
          const mine = m.senderId === myPeerId;
          const color = circleColor(m.senderId);
          return (
            <Bubble key={m.id} $mine={mine}>
              <Author style={{ background: color }}>
                {letterFor(m.senderId)}
              </Author>
              {m.kind === 'file' ? (
                <FileRow msg={m} />
              ) : (
                <Text $mine={mine} style={{ background: color }}>
                  {linkify(m.text)}
                </Text>
              )}
            </Bubble>
          );
        })}
        <div ref={endRef} />
      </List>

      <TypingLine>
        {typing.length > 0 &&
          `${typing.map(letterFor).join(', ')} ${typing.length === 1 ? 'is' : 'are'} typing…`}
      </TypingLine>

      <Composer />
    </Panel>
  );
}

const Panel = styled('div')`
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #1c1c1c;
  border-left: 1px solid #000;
`;
const Header = styled('div')`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  color: ${colors.accent2};
  border-bottom: 1px solid #000;
`;
const List = styled('div')`
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
`;
const Bubble = styled('div')<{ $mine?: boolean }>`
  display: flex;
  align-items: center;
  gap: 8px;
  align-self: ${(p) => (p.$mine ? 'flex-end' : 'flex-start')};
  flex-direction: ${(p) => (p.$mine ? 'row-reverse' : 'row')};
  max-width: 85%;
`;
// Peer marker: a coloured disc the height of one chat line with the letter
// knocked out in dark, matching the participant circles in the middle grid.
const Author = styled('div')`
  flex-shrink: 0;
  width: 35px;
  height: 35px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  color: #111;
`;
const Text = styled('div')<{ $mine?: boolean }>`
  color: #111;
  min-width: 0;
  overflow-wrap: anywhere;
  padding: 6px 10px;
  border-radius: 10px;
  text-align: ${(p) => (p.$mine ? 'right' : 'left')};
`;
const FileCard = styled('div')<{ $mine?: boolean }>`
  display: flex;
  align-items: center;
  flex-direction: ${(p) => (p.$mine ? 'row-reverse' : 'row')};
  gap: 10px;
  padding: 8px 12px;
  border: 1px solid rgba(170, 170, 255, 0.3);
  border-radius: 8px;
  /* Allow the card to shrink within the bubble so a long name can ellipsize
     rather than overflow the chat width. */
  min-width: 0;
  max-width: 100%;
`;
const Clip = styled('div')`
  flex-shrink: 0;
  display: flex;
  align-items: center;
`;
// Two-line body: title on top, size + status beneath.
const Body = styled('div')`
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
`;
const Sub = styled('div')`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
`;
const Name = styled('div')<{ $mine?: boolean }>`
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: ${(p) => (p.$mine ? 'right' : 'left')};
`;
const Meta = styled('span')`
  color: currentColor;
  opacity: 0.7;
  font-size: 0.85em;
`;
const Status = styled('div')`
  color: currentColor;
  flex-shrink: 0;
  font-size: 0.85em;
`;
const SystemLine = styled('div')`
  align-self: center;
  color: ${colors.accent2};
  opacity: 0.6;
  font-size: 0.85em;
`;
const Empty = styled('div')`
  color: ${colors.accent2};
  opacity: 0.7;
`;
const TypingLine = styled('div')`
  min-height: 18px;
  padding: 0 12px;
  color: ${colors.accent2};
  opacity: 0.7;
  font-size: 0.85em;
`;
const ComposerBar = styled('div')`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-top: 1px solid #000;
`;
const TextInput = styled('textarea')`
  flex: 1;
  background: #111;
  border: 1px solid ${colors.border};
  border-radius: 8px;
  color: ${colors.accent2};
  padding: 8px 10px;
  font: inherit;
  line-height: 1.4;
  resize: none;
  max-height: 120px;
  overflow-y: auto;
`;
const IconButton = styled('button')<{ $disabled?: boolean }>`
  background: none;
  border: none;
  padding: 4px;
  cursor: ${(p) => (p.$disabled ? 'default' : 'pointer')};
  opacity: ${(p) => (p.$disabled ? 0.4 : 1)};
  display: flex;
  align-items: center;
  color: ${colors.accent2};
  font-size: 18px;
`;
