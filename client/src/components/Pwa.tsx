import { useSyncExternalStore } from 'react';
import { Download, RefreshCw, WifiOff, X } from 'lucide-react';
import { useConfirm } from '../lib/confirmation';
import {
  activatePwaUpdate,
  dismissPwaUpdate,
  getPwaSnapshot,
  installPwa,
  isAppleMobile,
  subscribePwa,
} from '../lib/pwa';

export function InstallApp({ className = '' }: { className?: string }) {
  const state = useSyncExternalStore(subscribePwa, getPwaSnapshot);
  const confirm = useConfirm();
  if (state.installed || !window.isSecureContext || (!state.canInstall && !isAppleMobile()))
    return null;
  return (
    <button
      type="button"
      className={`icon-button install-app ${className}`}
      title="Cài Po"
      aria-label="Cài Po"
      onClick={async () => {
        if (state.canInstall) {
          try {
            await installPwa();
          } catch {
            await confirm({
              title: 'Chưa thể cài Po',
              message: 'Hãy thử lại từ menu của trình duyệt hoặc mở Po bằng Safari trên iPhone.',
              confirmLabel: 'Đã hiểu',
            });
          }
        } else {
          await confirm({
            title: 'Thêm Po vào màn hình chính',
            message:
              'Mở Po bằng Safari, chạm nút Chia sẻ, chọn “Thêm vào Màn hình chính”, rồi chọn “Thêm”. Sau đó mở Po từ icon vừa tạo.',
            confirmLabel: 'Đã hiểu',
          });
        }
      }}
    >
      <Download size={20} />
    </button>
  );
}
export function PwaStatus() {
  const state = useSyncExternalStore(subscribePwa, getPwaSnapshot);
  const confirm = useConfirm();
  if (!state.online)
    return (
      <div className="pwa-status" role="status">
        <WifiOff size={18} />
        <span>Bạn đang ngoại tuyến. Kết nối Internet để tiếp tục.</span>
      </div>
    );
  if (!state.updateAvailable) return null;
  return (
    <div className="pwa-status" role="status">
      <RefreshCw size={18} />
      <span>Po có phiên bản mới.</span>
      <button
        className="primary"
        onClick={async () => {
          if (
            await confirm({
              title: 'Cập nhật Po?',
              message: 'Trang sẽ tải lại. Hãy lưu nội dung đang soạn trước khi tiếp tục.',
              confirmLabel: 'Cập nhật',
            })
          )
            activatePwaUpdate();
        }}
      >
        Cập nhật
      </button>
      <button className="icon-button" aria-label="Để cập nhật sau" onClick={dismissPwaUpdate}>
        <X size={17} />
      </button>
    </div>
  );
}
