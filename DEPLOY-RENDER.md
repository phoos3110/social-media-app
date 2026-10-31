# Deploy Po lên Render Free

Frontend, Express API và Socket.IO chạy chung một Web Service để dùng cùng domain, cookie và HTTPS. PostgreSQL ở Neon, ảnh ở Cloudinary. Cấu hình nằm trong `render.yaml`.

## 1. Tạo database Neon

Đăng ký tại https://console.neon.tech bằng GitHub. Tạo project `po`, chọn gói Free và region gần region Render. Trong **Connect**, chọn connection string PostgreSQL (có thể dùng pooled connection). Copy URL có `sslmode=require` để điền trực tiếp vào Render dưới tên `DATABASE_URL`.

Không đưa URL này vào GitHub hoặc ảnh chụp công khai. App tự tạo schema khi khởi động; đây là database mới, không tự chuyển dữ liệu Docker trên máy.

## 2. Tạo Cloudinary

Đăng ký tại https://cloudinary.com/users/register_free. Trong Console → Settings → API Keys, lấy Cloud name, API Key và API Secret. Điền trực tiếp vào ba biến tương ứng trên Render; giữ kín API Secret.

## 3. Tạo Render Blueprint

Mở https://dashboard.render.com, chọn **New → Blueprint**, kết nối GitHub và chọn repository `phoos3110/social-media-app`, nhánh `main`.

Render đọc `render.yaml`, tạo một Web Service **Free** tên `po-social` và yêu cầu:

| Biến | Giá trị |
| --- | --- |
| `DATABASE_URL` | Connection string Neon, giữ nguyên tham số SSL |
| `CLOUDINARY_CLOUD_NAME` | Cloud name |
| `CLOUDINARY_API_KEY` | API Key |
| `CLOUDINARY_API_SECRET` | API Secret |

Chọn **Deploy Blueprint**. Tên miền thực tế do Render cấp; không cần mua domain. App tự cho phép origin từ `RENDER_EXTERNAL_URL`. Nếu dùng custom domain sau này, đặt `CLIENT_ORIGIN` thành danh sách đầy đủ các origin HTTPS được phép, ngăn cách bằng dấu phẩy.

Không chọn Render Postgres Free cho cấu hình này: database đó có hạn dùng. Không dùng PGlite hay upload local trên Render Free vì filesystem không bền vững. App kiểm tra các biến bắt buộc khi khởi động trên Render.

## 4. Kiểm tra sau deploy

Đợi trạng thái Live, mở URL HTTPS và thử đăng ký, đăng nhập, đăng ảnh, bình luận và chat bằng hai tài khoản. Kiểm tra `/api/health` trả về thành công. Trên Safari iPhone chọn Chia sẻ → Thêm vào Màn hình chính để cài PWA.

Render Free có thể ngủ sau 15 phút không có lưu lượng; lần truy cập tiếp theo có thể chờ khoảng một phút. Máy cá nhân không cần bật. Các dịch vụ vẫn có hạn mức miễn phí; theo dõi usage trong dashboard.

## 5. Bật email, push và quản trị

Các tính năng này đã có code nhưng chỉ hoạt động khi cấu hình biến trong **po-social → Environment → Add Environment Variable**, rồi redeploy. Không đưa giá trị bí mật lên GitHub.

| Biến | Giá trị |
| --- | --- |
| `APP_URL` | URL HTTPS chính xác của app, ví dụ `https://po-social.onrender.com` |
| `RESEND_API_KEY` | API key của Resend |
| `EMAIL_FROM` | Địa chỉ gửi thuộc domain đã xác minh trên Resend, ví dụ `Po <noreply@domain-cua-ban>` |
| `ADMIN_EMAILS` | Email đã được xác minh của tài khoản quản trị; phân cách bằng dấu phẩy nếu có nhiều người |
| `ADMIN_USER_IDS` | UUID tài khoản quản trị đã tồn tại; dùng để thiết lập khi chưa có email. Lấy mã ở Cài đặt → Tài khoản & quyền riêng tư |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Bộ khóa push tạo một lần và giữ nguyên qua các lần deploy |

Chạy `npm run push:keys --prefix server` trên máy để tạo `server/.env.push.local` (đã được Git bỏ qua, không in khóa ra terminal). Mở file riêng trên máy, sửa `VAPID_SUBJECT` thành `mailto:email-cua-ban`, copy ba giá trị vào Render. Không tạo lại khóa mỗi lần deploy vì subscription cũ sẽ mất hiệu lực.

Email thiếu cấu hình sẽ hiện trạng thái chưa bật; quên mật khẩu không trả token ra trình duyệt hoặc log. Liên kết xác minh/đặt lại hết hạn sau 20 phút, chỉ dùng một lần. Đổi mật khẩu/đặt lại mật khẩu thu hồi session cũ. Trong giao diện **Cài đặt → Email**, người dùng có thể yêu cầu xác minh hoặc đổi email; email mới chỉ thay thế sau khi xác nhận.

Trong **Cài đặt → Thông báo đẩy**, người dùng chủ động cấp quyền trên từng thiết bị. iPhone cần cài Po ra Màn hình chính rồi mở app từ đó. Subscription gắn với phiên đăng nhập và bị xóa khi phiên đăng xuất/hết hiệu lực. Push chỉ gửi nội dung chung, không đưa nội dung chat lên màn hình khóa.

Tài khoản có UUID trong `ADMIN_USER_IDS`, hoặc email đã xác minh trong `ADMIN_EMAILS`, sẽ thấy **Cài đặt → Quản trị**: xem báo cáo, xử lý/bỏ qua, gỡ bài và khóa/mở khóa người dùng. Email chưa xác minh không được trao quyền chỉ vì trùng allowlist. Không có cơ chế tự trao quyền admin cho tài khoản đăng ký đầu tiên.

## 6. Dữ liệu và media

Schema được nâng cấp khi backend khởi động; sao lưu PostgreSQL trước các đợt nâng cấp lớn. Ảnh mới được giải mã thành WebP, tối đa 5 MB mỗi ảnh; video MP4/WebM tối đa 25 MB; tối đa 10 tệp mỗi bài. Chat nhận ảnh qua cùng pipeline kiểm tra quyền sở hữu.

Media mới trên Cloudinary dùng delivery type `authenticated`; trình duyệt tải qua `/api/media/:id` để server kiểm tra đăng nhập, chặn và quyền xem tài khoản riêng tư. Ảnh đại diện/ảnh bìa vẫn xem được từ trang cá nhân nếu không bị chặn. Khi chuyển tài khoản cũ sang riêng tư, app chuyển các asset Cloudinary công khai của tài khoản đó sang authenticated trước khi bật riêng tư, rồi đổi tham chiếu trong bài/chat/hồ sơ. Nếu Cloudinary đang lỗi, thao tác bật riêng tư sẽ báo lỗi để người dùng thử lại; không âm thầm bật một trạng thái bảo vệ chưa hoàn tất. CDN/bản sao đã tải từ trước không thể bị thu hồi khỏi thiết bị người nhận.

Xóa tài khoản đưa các asset vào hàng đợi dọn media, rồi xóa dữ liệu có liên quan bằng foreign key cascade. Backend thử dọn ngay và tiếp tục thử mỗi phút; lỗi mạng/Cloudinary được giữ lại để xử lý sau. Render Free đang ngủ thì công việc tiếp tục khi backend khởi động lại.

Bản nháp bài viết, tệp đã tải, bình luận, người được trả lời và tin nhắn được lưu riêng theo tài khoản trong localStorage của thiết bị. Có thể xóa ở **Cài đặt → Bản nháp**. Đây là lưu trên trình duyệt, không đồng bộ bản nháp qua các thiết bị.

Tham khảo: [Render Blueprint](https://render.com/docs/blueprint-spec), [Render Free](https://render.com/docs/free), [Neon](https://neon.com/pricing), [Cloudinary](https://cloudinary.com/pricing).
