import { useRef, useState } from 'react';
import styled from 'styled-components';
import { colors } from './colors.ts';
import { Icon, AddPerson } from './Icon.tsx';
import { Modal } from './Popup.tsx';
import { Button } from './Button.tsx';

export function InviteBox({ link }: { link: string }) {
  const [open, setOpen] = useState(false);
  const [buttonText, setButtonText] = useState('Copy link');
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setButtonText('Link copied');
    } catch {
      setButtonText('Failed to copy');
    }
    clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setButtonText('Copy link'), 2000);
  };

  return (
    <>
      <Box onClick={() => setOpen(true)} title="Invite someone">
        <Icon path={AddPerson} size={40} color={colors.accent2} />
      </Box>
      {open && (
        <Modal onClose={() => setOpen(false)} title="Invite">
          <div>Invite someone to join the session:</div>
          <Link>{link}</Link>
          <Button onClick={copy}>{buttonText}</Button>
        </Modal>
      )}
    </>
  );
}

const Box = styled('div')`
  aspect-ratio: 1.5 / 1;
  border: 3px solid #555;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #2b2b2b;
  cursor: pointer;
  &:hover {
    background: #333;
  }
`;

const Link = styled('div')`
  color: ${colors.accent2};
  text-decoration: underline;
  user-select: all;
  word-break: break-all;
`;
