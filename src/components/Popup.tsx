import styled from 'styled-components';
import { colors } from '../util/colors.ts';
import { Icon, Cross } from './Icon.tsx';

// Centered modal reusing the app's established backdrop + dialog look.
// Clicking the backdrop (or the close button) calls onClose; clicks inside
// the dialog are contained.
export function Modal({
  onClose,
  title,
  children,
}: {
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <Backdrop onClick={onClose}>
      <Dialog onClick={(e) => e.stopPropagation()}>
        <Header>
          <Title>{title}</Title>
          <IconButton onClick={onClose} title="Close">
            <Icon path={Cross} size={20} color={colors.accent2} />
          </IconButton>
        </Header>
        {children}
      </Dialog>
    </Backdrop>
  );
}

export const Backdrop = styled('div')`
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 30;
`;

export const Dialog = styled('div')`
  background: ${colors.bg};
  border: 1px solid ${colors.border};
  border-radius: 12px;
  padding: 16px 24px 24px;
  width: min(90vw, 460px);
  max-height: 80vh;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
  line-height: 1.5;
  color: ${colors.accent2};
`;

const Header = styled('div')`
  display: flex;
  align-items: center;
  justify-content: space-between;
`;

const Title = styled('div')`
  font-size: 1.15em;
  font-weight: 600;
`;

const IconButton = styled('button')`
  background: none;
  border: none;
  padding: 4px;
  cursor: pointer;
  display: flex;
  align-items: center;
`;
