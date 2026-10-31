import { createContext, useContext } from 'react';

export type ConfirmOptions = {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
};
export const ConfirmContext = createContext<((options: ConfirmOptions) => Promise<boolean>) | null>(
  null,
);

export function useConfirm() {
  const confirm = useContext(ConfirmContext);
  if (!confirm) throw new Error('useConfirm must be used inside ConfirmProvider');
  return confirm;
}
