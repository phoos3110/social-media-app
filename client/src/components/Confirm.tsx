import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { ConfirmContext } from '../lib/confirmation';
import type { ConfirmOptions } from '../lib/confirmation';

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<ConfirmOptions | null>(null);
  const resolve = useRef<((answer: boolean) => void) | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const messageId = useId();
  function finish(answer: boolean) {
    const pending = resolve.current;
    resolve.current = null;
    dialog.current?.close();
    setRequest(null);
    pending?.(answer);
  }
  function confirm(options: ConfirmOptions) {
    if (resolve.current) return Promise.resolve(false);
    return new Promise<boolean>((answer) => {
      resolve.current = answer;
      setRequest(options);
    });
  }
  useEffect(() => {
    if (request && !dialog.current?.open) dialog.current?.showModal();
  }, [request]);
  useEffect(
    () => () => {
      resolve.current?.(false);
      resolve.current = null;
    },
    [],
  );
  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <dialog
        ref={dialog}
        className="confirm-dialog"
        aria-labelledby={titleId}
        aria-describedby={messageId}
        onCancel={(event) => {
          event.preventDefault();
          finish(false);
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) finish(false);
        }}
      >
        {request && (
          <div className="confirm-content">
            <h2 id={titleId}>{request.title}</h2>
            <p id={messageId}>{request.message}</p>
            <div className="confirm-actions">
              <button type="button" className="secondary" autoFocus onClick={() => finish(false)}>
                Hủy
              </button>
              <button
                type="button"
                className={`primary ${request.danger ? 'danger-action' : ''}`}
                onClick={() => finish(true)}
              >
                {request.confirmLabel || 'Xác nhận'}
              </button>
            </div>
          </div>
        )}
      </dialog>
    </ConfirmContext.Provider>
  );
}
