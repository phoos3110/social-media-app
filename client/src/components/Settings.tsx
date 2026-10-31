import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Settings as SettingsIcon } from 'lucide-react';
import Modal from './Modal';
import AccountPanel from './AccountPanel';
import type { User } from '../types/social';

export default function Settings({
  children,
  me,
  onBookmarks,
  onChanged,
}: {
  children: ReactNode;
  me: User;
  onBookmarks: () => void;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [initialTab, setInitialTab] = useState('');
  useEffect(() => {
    const show = () => {
      setInitialTab('requests');
      setOpen(true);
    };
    window.addEventListener('po:open-settings', show);
    return () => window.removeEventListener('po:open-settings', show);
  }, []);
  return (
    <>
      <button
        className="icon-button"
        aria-label="Cài đặt"
        title="Cài đặt"
        onClick={() => {
          setInitialTab('');
          setOpen(true);
        }}
      >
        <SettingsIcon size={21} />
      </button>
      {open && (
        <Modal title="Cài đặt" onClose={() => setOpen(false)}>
          <div className="settings-actions">{children}</div>
          <button
            className="secondary saved-link"
            onClick={() => {
              setOpen(false);
              onBookmarks();
            }}
          >
            Bài viết đã lưu
          </button>
          <AccountPanel me={me} onSaved={onChanged} initialTab={initialTab} />
        </Modal>
      )}
    </>
  );
}
