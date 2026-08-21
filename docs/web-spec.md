# Đặc tả website EternalGhost-Afk-Bot-Minecraft

## Mục tiêu

Website bổ sung một giao diện HTTP quản trị cho một admin duy nhất của hệ thống Discord-managed Minecraft AFK bot. Website có hai bề mặt: `/` để chọn trang trạng thái hoặc khu vực quản trị, `/status` trả JSON raw phục vụ quan sát, và `/admin` cung cấp đăng nhập cùng toàn bộ thao tác Discord tương thích. Giao diện client dùng Dark Neon Cyberpunk, không dùng emoji, không đưa secret hoặc logic xác thực vào `src/web/public`.

## Phạm vi chức năng

Website phải bao phủ các lệnh Discord hiện có và tái sử dụng `BotManager`, `Persistence`, các validator và log buffer thay vì sao chép logic nghiệp vụ:

| Nhóm          | Tính năng web                                | Tương đương Discord                       |
| ------------- | -------------------------------------------- | ----------------------------------------- |
| Fleet         | Liệt kê bot, thống kê tổng hợp, trợ giúp     | `/list-bot`, `/stats`, `/help`            |
| CRUD          | Tạo, sửa, xoá bot                            | `/create-bot`, `/edit-bot`, `/delete-bot` |
| Lifecycle     | Start, stop thường, force stop, restart      | `/start`, `/stop`, `/restart`             |
| Runtime       | Xem status chi tiết, chat Minecraft          | `/status-bot`, `/chat`                    |
| Observability | Log theo lines/hours/level, activity history | `/logs-bot`, audit history                |
| Selection     | Chọn bot mặc định                            | `/select-bot`                             |

Các cấu hình anti-AFK, auto-eat và combat đã tồn tại trong record/persistence nhưng Discord command hiện tại không có lệnh chỉnh sửa riêng. Chúng được giữ nguyên trong backend và không tự ý mở rộng thành tính năng mới nếu không có yêu cầu riêng.

## Kiến trúc

Ứng dụng giữ Node.js CommonJS hiện có và dùng `node:http` cùng các module built-in để tránh thêm framework không cần thiết. `index.js` khởi động web server dùng chung process với Discord client và `BotManager`. Backend được chia nhỏ trong `src/web/private`, gồm cấu hình auth, session store, HTTP helpers, route handlers và server composition. Client nằm trong `src/web/public` và chỉ chứa HTML/CSS/JS không nhạy cảm.

Máy chủ bind vào `WEB_HOST`, mặc định `0.0.0.0`, và dùng HTTP theo yêu cầu localhost/public IP. Port cấu hình qua `WEB_PORT`. Không coi HTTP là kênh an toàn cho Internet công cộng; tài liệu sẽ ghi rõ nên đặt reverse proxy TLS bên ngoài nếu triển khai public, nhưng PR này không triển khai HTTPS.

## Xác thực và bảo mật

`WEB_ADMIN_USERNAME` lưu username dạng thường trong `.env`; `WEB_ADMIN_PASSWORD_SHA256` lưu đúng 64 ký tự hex của SHA-256 password. Server chỉ giữ hash đã cấu hình và so sánh bằng `crypto.timingSafeEqual`. Session dùng cookie `httpOnly`, `sameSite=lax`, `secure=false` vì HTTP, token ngẫu nhiên trong memory và TTL hữu hạn. Không lưu token auth trong localStorage.

Mutating API yêu cầu session hợp lệ và CSRF token gửi qua header `X-CSRF-Token`. Login có rate limit theo IP và toàn cục ở mức nhỏ; request body có giới hạn kích thước; JSON và path parameters được kiểm tra. Response không trả encrypted password, Discord token, database credentials hoặc stack trace. Header bảo vệ gồm CSP phù hợp với static client, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` và `Cache-Control: no-store` cho API.

SHA-256 được dùng vì đây là yêu cầu tương thích cấu hình của người dùng. Đây không phải lựa chọn tốt hơn password KDF có salt; tài liệu `.env.example` sẽ yêu cầu hash ở ngoài process và không commit secret.

## API contract

| Method | Path                     |      Auth | Mục đích                                   |
| ------ | ------------------------ | --------: | ------------------------------------------ |
| GET    | `/api/auth/session`      |     Không | Kiểm tra phiên và lấy CSRF token           |
| POST   | `/api/auth/login`        |     Không | Đăng nhập admin                            |
| POST   | `/api/auth/logout`       |        Có | Huỷ phiên                                  |
| GET    | `/api/status`            |     Không | Trạng thái raw tối thiểu, không credential |
| GET    | `/api/help`              |        Có | Danh sách khả năng web/Discord             |
| GET    | `/api/bots`              |        Có | Danh sách snapshot bot                     |
| POST   | `/api/bots`              | Có + CSRF | Tạo bot                                    |
| PATCH  | `/api/bots/:id`          | Có + CSRF | Sửa bot                                    |
| DELETE | `/api/bots/:id`          | Có + CSRF | Xoá bot                                    |
| GET    | `/api/bots/:id/status`   |        Có | Status chi tiết                            |
| GET    | `/api/bots/:id/logs`     |        Có | Logs với lines/hours/level                 |
| GET    | `/api/bots/:id/activity` |        Có | Activity history                           |
| POST   | `/api/bots/:id/start`    | Có + CSRF | Start                                      |
| POST   | `/api/bots/:id/stop`     | Có + CSRF | Stop, body `{force}`                       |
| POST   | `/api/bots/:id/restart`  | Có + CSRF | Restart                                    |
| POST   | `/api/bots/:id/chat`     | Có + CSRF | Chat hoặc game command whitelist           |
| POST   | `/api/bots/:id/select`   | Có + CSRF | Chọn bot mặc định                          |
| GET    | `/api/stats`             |        Có | Fleet/process statistics                   |

Web principal có dạng `{ userId: WEB_ADMIN_USERNAME, guildId: null, roles: ['web-admin'] }`, cho phép admin web quản lý các record. Không expose `createdBy` hoặc encrypted credentials cho client.

## Dữ liệu status

`/status` trả JSON raw gồm `service`, `timestamp`, `process.uptime`, `fleet` với `totalBots`, `aliveBots`, `states`, và mảng bot đã sanitize gồm `id`, `host`, `port`, `username`, `version`, `state`, `uptime`, `health`, `food`, `ping`, `position`, `reconnectAttempts`, `autoReconnect`. Status public không yêu cầu đăng nhập nhưng không chứa credentials, activity actor, logs hoặc connection secrets.

## Giao diện

Trang public có lựa chọn rõ ràng giữa Status và Admin. Trang admin gồm login view, header điều khiển, fleet statistic cards, bot table/cards, create/edit modal/form, lifecycle buttons, log viewer, activity viewer và chat composer. CSS dùng biến màu, grid responsive, focus-visible states, reduced-motion support và icon thuần CSS hoặc inline SVG do ứng dụng kiểm soát; không dùng emoji.

## Testing strategy

Dùng native Node test runner hiện có. Unit tests bao phủ SHA-256 comparison, session/CSRF, JSON body limits, public status redaction và route mapping. Integration tests dùng fake manager hoặc test doubles ở boundary để kiểm tra HTTP status, auth và API validation. Existing suite phải tiếp tục pass. Runtime verification thực hiện bằng cách khởi động server với env test, gọi login/status/API bằng curl và kiểm tra static routes, headers và lỗi unauthorized.

## Commands

```bash
npm test
npm run lint
npm run format:check
npm start
```

Nếu repository chưa có `format:check`, PR sẽ bổ sung script kiểm tra Prettier không ghi đè file. Không chạy database migration tự động; schema hiện tại đủ cho website vì BotManager/Persistence đã cung cấp CRUD và activity log.

## Ranh giới

- **Luôn làm:** Không commit `.env`, validate input ở server, giữ password encrypted trong DB, dùng parameterized queries qua lớp hiện có, sanitize response, chạy test/lint trước commit.
- **Cần hỏi trước:** Thêm chức năng Discord chưa tồn tại, thay đổi schema PostgreSQL, thay đổi policy egress, hoặc đổi mô hình một-admin thành multi-user/RBAC.
- **Không làm:** Đưa secrets vào `src/web/public`, lưu session token trong localStorage, trả password/encryptedPassword về browser, dùng `innerHTML` với dữ liệu runtime, hoặc mở HTTP write API không có auth/CSRF.

## Tiêu chí hoàn thành

Website chạy được trên localhost và bind public IP qua HTTP; `/status` trả JSON raw; `/admin` yêu cầu login; username/hash đọc từ env; client/backend tách đúng thư mục; toàn bộ 13 lệnh Discord hiện có có đường tương ứng trên web; bot CRUD/lifecycle/chat/log/status/activity hoạt động qua `BotManager`; static client không chứa secret; tests/lint/build verification pass; tài liệu `.env.example` và README được cập nhật; PR mô tả rõ các tính năng, giới hạn và verification.

## Open questions

Không có câu hỏi chặn triển khai trong phạm vi repository hiện tại. Các tính năng Discord chưa có command web riêng như chỉnh sửa trực tiếp cấu hình anti-AFK/auto-eat/combat sẽ không được tự ý thêm; chúng có thể được triển khai ở PR sau khi người dùng xác nhận trường và semantics mong muốn.
