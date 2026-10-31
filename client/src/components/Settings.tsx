import { useState } from 'react';
import type { ReactNode } from 'react';
import { Settings as SettingsIcon } from 'lucide-react';
import Modal from './Modal';

export default function Settings({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        className="icon-button"
        aria-label="Cài đặt"
        title="Cài đặt"
        onClick={() => setOpen(true)}
      >
        <SettingsIcon size={21} />
      </button>
      {open && (
        <Modal title="Cài đặt" onClose={() => setOpen(false)}>
          <div className="settings-actions">{children}</div>
        </Modal>
      )}
    </>
  );
}
