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

Tham khảo: [Render Blueprint](https://render.com/docs/blueprint-spec), [Render Free](https://render.com/docs/free), [Neon](https://neon.com/pricing), [Cloudinary](https://cloudinary.com/pricing).
