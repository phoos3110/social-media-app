# Po — Social Media App

Ứng dụng mạng xã hội tiếng Việt, có giao diện responsive và chế độ sáng/tối.

## Công nghệ

- Frontend: React, TypeScript, Vite, Tailwind CSS.
- Backend: Node.js, Express, Socket.IO.
- Database: PostgreSQL; hỗ trợ PGlite cho phát triển local.
- Ảnh: Cloudinary hoặc lưu local khi phát triển.
- Docker Compose: frontend Nginx, backend Express và PostgreSQL.

## Chức năng

- Đăng ký, đăng nhập, đăng xuất; mật khẩu hash bcrypt và session cookie HttpOnly.
- Hồ sơ, avatar, ảnh bìa, giới thiệu; danh sách theo dõi, tài khoản riêng tư, duyệt yêu cầu và chặn hai chiều.
- Đăng bài chữ/nhiều ảnh/video, sửa/xóa, like, xem người đã like, lưu/chia sẻ; sửa/like bình luận và trả lời nhiều cấp có phân trang.
- Bảng tin chung/đang theo dõi, tìm kiếm và phân trang.
- Chat một-một, ảnh, trả lời/thu hồi tin, lịch sử, trạng thái online/đang nhập/đã xem và chưa đọc.
- Thông báo real-time cho like, bình luận, trả lời và follow.
- Xác nhận trước khi đăng xuất, xóa hoặc bỏ nội dung sửa chưa lưu.
- Cài đặt gom sáng/tối, PWA, đăng xuất, bảo mật tài khoản, quyền riêng tư, yêu cầu theo dõi và danh sách chặn.
- Đổi/quên mật khẩu, xác minh/đổi email (cần Resend), xóa tài khoản và thu hồi phiên đăng nhập cũ.
- Thông báo đẩy khi đóng app (cần cấu hình VAPID); thông báo bình luận mở đúng nhóm trả lời.
- Báo cáo nội dung và quản trị viên xử lý báo cáo, gỡ bài, khóa/mở khóa tài khoản.
- Bài viết, like, bình luận cập nhật qua Socket.IO; bản nháp lưu theo tài khoản trên từng thiết bị.
- Like phản hồi ngay, tuần tự hóa các lần bấm nhanh và hoàn tác khi API lỗi. Bình luận và chat hiện trạng thái đang gửi, khôi phục nội dung nếu gửi thất bại.

## Chạy bằng Docker

Cài Git và Docker Desktop, mở Docker Desktop rồi chạy:

```sh
git clone https://github.com/phoos3110/social-media-app.git
cd social-media-app
docker compose up -d --build --wait
```

Mở **http://localhost:5180** hoặc **http://127.0.0.1:5180**. Không cần cài Node.js hoặc chạy `npm run dev` để dùng chế độ Docker.

| Service | Vai trò | Cổng |
| --- | --- | --- |
| frontend | React đã build, Nginx proxy API và WebSocket | localhost:5180 |
| backend | Express + Socket.IO | 4180 trong mạng Docker |
| postgres | PostgreSQL 17 | localhost:5432 |

Backend chờ database khỏe trước khi khởi động; frontend chờ backend khỏe. Database nằm trong named volume `postgres_data`, ảnh local nằm ở `server/uploads`. Không có tài khoản mặc định; hãy đăng ký. Dùng cửa sổ ẩn danh để thử tài khoản thứ hai và chat.

```sh
docker compose ps
docker compose logs -f backend
docker compose down
```

`docker compose down` giữ volume dữ liệu; không thêm `-v` nếu muốn giữ database. Sau khi sửa code, chạy lại `docker compose up -d --build --wait`.

## Cloudinary và biến môi trường

Copy `server/.env.example` thành `server/.env`. Để dùng Cloudinary, điền trên máy của bạn:

```dotenv
MEDIA_DRIVER=cloudinary
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret
```

Chạy lại Compose để cập nhật môi trường. Khóa bí mật chỉ được backend sử dụng; không commit `.env` lên Git. Khi chưa chọn Cloudinary, Docker local lưu ảnh vào `server/uploads`.

Upload nhận một ảnh tối đa 5 MB, giải mã bằng sharp, giới hạn số pixel và chuyển WebP trong khung 1600×1600. Xóa bài hiện chưa tự dọn tài nguyên ảnh; cần thêm job thu gom khi vận hành lâu dài.

## Phát triển bằng Node trực tiếp

Dùng Node.js 24 LTS. Dừng frontend/backend Docker để tránh trùng cổng, giữ PostgreSQL chạy:

```sh
docker compose stop frontend backend
npm run setup
```

Tạo `server/.env` từ file mẫu. Để dùng PostgreSQL Docker, đặt:

```dotenv
DATABASE_URL=postgresql://social:social_local_password@localhost:5432/social
```

Sau đó chạy `npm run dev` và mở http://localhost:5180. Backend chạy trên cổng 4180. Nếu không có `DATABASE_URL`, backend dùng PostgreSQL nhúng PGlite tại `server/data/postgres`. Không chạy hai backend cùng mở database nhúng này.

PGlite và PostgreSQL lưu dữ liệu riêng. Để chuyển từ PGlite: dừng backend nhúng, cấu hình `DATABASE_URL`, chạy `npm run migrate:local --prefix server`. Script sao lưu nguồn, chỉ nhận đích rỗng và đối chiếu số bản ghi trong transaction.

## Kiểm tra code và chức năng

Cần chạy `npm run setup` để cài công cụ trên máy trước khi chạy các lệnh kiểm tra:

```sh
npm run check
npm test
npm run test:e2e
npm run test:docker
npm run test:buttons
```

- `check`: lint frontend (không chấp nhận cảnh báo), Prettier, TypeScript và build.
- `test`: tích hợp API và Socket.IO trên database nhúng trong bộ nhớ.
- `test:e2e`: Chrome, backend riêng cổng 4100 và database test trong bộ nhớ.
- `test:docker`: ảnh, session, dark mode, follow, thông báo, chat, mobile trên Docker đang chạy.
- `test:buttons`: xác nhận/Hủy/Esc, lỗi API, chống gửi trùng và cập nhật dữ liệu.

Các kiểm thử trình duyệt dùng Chrome đã cài trên máy. Hai bộ test Docker cần `server/.env` với `DATABASE_URL` trỏ vào database Docker để tự dọn tài khoản test. Ảnh kiểm tra nằm trong `test-results`, không đưa lên Git.

Để test API trên PostgreSQL riêng, đặt `TEST_DATABASE_URL` rồi chạy `npm test`. Bộ test tự tạo và dọn schema riêng, không dùng bảng dữ liệu chính.

## Cấu trúc

```text
client/src/
  App.tsx             Session, điều hướng, bảng tin và thông báo
  components/         AuthPage, Composer, FeedPost, Profile, Chat, Theme, Confirm
  lib/                API client, theme và confirmation hook
  types/              Kiểu dữ liệu TypeScript
server/src/
  index.js            Khởi động HTTP và Socket.IO
  app.js              REST API, xác thực, phân quyền và upload
  db.js               Schema, PostgreSQL và PGlite
  migrate-local.js    Chuyển dữ liệu local
server/test/          Kiểm thử tích hợp
docker/               Nginx proxy
docker-tests/         Kiểm thử stack Docker
e2e/                  Kiểm thử trình duyệt độc lập
```

## Cài Po dưới dạng PWA

Sau khi triển khai qua HTTPS, trên iPhone mở Po bằng Safari, chọn Chia sẻ → Thêm vào Màn hình chính → Thêm. Trên trình duyệt hỗ trợ cài ứng dụng, nút **Cài Po** sẽ mở hộp thoại cài đặt. Khi đã cài, Po mở trong cửa sổ riêng.

PWA có biểu tượng ứng dụng, hỗ trợ vùng an toàn màn hình và trang báo mất kết nối. Đăng nhập, bài viết và chat vẫn cần mạng. Service worker chỉ lưu tài nguyên tĩnh; không cache API, ảnh upload, Socket.IO hoặc HTML chứa phiên làm việc. Khi có bản cập nhật, Po hỏi trước khi tải lại để tránh mất nội dung đang nhập. Bật push trong Cài đặt sau khi operator cấu hình VAPID; xem DEPLOY-RENDER.md.

Chạy `npm run test:pwa` khi stack Docker đang hoạt động để kiểm tra manifest, biểu tượng, bộ nhớ cache, mất mạng/kết nối lại, hướng dẫn cài iPhone và cơ chế cập nhật. Đây là kiểm tra Chrome với mô phỏng iPhone; vẫn cần thử trên Safari iPhone thật sau khi triển khai HTTPS.

## Triển khai public

Deploy miễn phí lên Render với Neon và Cloudinary: xem [hướng dẫn từng bước](DEPLOY-RENDER.md) và cấu hình `render.yaml`.

Compose hiện dành cho local: HTTP, mật khẩu database mặc định và cookie không có Secure. Trước khi public, cần HTTPS, domain trong `CLIENT_ORIGIN`, `COOKIE_SECURE=true`, mật khẩu riêng và cơ chế sao lưu. Dùng PostgreSQL cloud và Cloudinary nếu nền tảng không có ổ đĩa bền vững.

Phiên bản hiện tại chạy một backend instance; nhiều instance cần adapter chia sẻ sự kiện Socket.IO và rate-limit store chung. Chat nhóm, gọi thoại/video, Stories/Reels và mã hóa đầu cuối chưa được triển khai. Email, push và quyền quản trị cần cấu hình môi trường trong DEPLOY-RENDER.md; chúng không tự kích hoạt chỉ bằng việc deploy code.

## Tài liệu tham khảo

- [Socket.IO](https://socket.io/docs/v4/)
- [node-postgres](https://node-postgres.com/features/queries)
- [Cloudinary Node.js uploads](https://cloudinary.com/documentation/node_image_and_video_upload)
- [Tailwind với Vite](https://tailwindcss.com/docs/installation/using-vite)
