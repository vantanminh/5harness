# Ví Dụ: Thêm Harness Vào Dự Án Có Sẵn

> Hướng dẫn từng bước thêm 5harness vào dự án đã có code, git history, và
> codebase ổn định — không làm gián đoạn công việc hiện tại.

---

## Kịch Bản

Bạn có một **Express blog API** đã phát triển được vài tháng. Nó có:
- `src/` với routes, middleware, và models
- `package.json` với các dependencies
- `tests/` với bộ test cơ bản
- Git history với hàng chục commit

Bạn muốn thêm 5harness để mang lại cấu trúc, theo dõi quyết định, và làm cho
dự án thân thiện với agent — không cần viết lại bất cứ thứ gì.

---

## Bước 1: Cài Đặt 5harness

```bash
npm i -g 5harness
harness --version
```

---

## Bước 2: Khởi Tạo Harness Vào Dự Án Có Sẵn

Điều hướng đến thư mục gốc của dự án và chạy init:

```bash
cd ~/projects/blog-api
harness init
```

> **Điều gì xảy ra?** `harness init` phát hiện dự án có sẵn và tạo các file
> harness **bên cạnh** code của bạn. Nó KHÔNG xóa hay ghi đè bất kỳ file nào
> có sẵn. Nó thêm vào:
> - `AGENTS.md` (entrypoint cho agent)
> - `docs/` với tài liệu harness và thư mục entity
> - `.5harness/` cho index dẫn xuất
> - `.gitignore` entries (nối thêm nếu `.gitignore` đã tồn tại)

Sau khi init, dự án trông như sau:

```
blog-api/
├── src/                    # ← code có sẵn (không đụng đến)
│   ├── routes/
│   ├── middleware/
│   └── models/
├── tests/                  # ← test có sẵn (không đụng đến)
├── package.json            # ← config có sẵn (không đụng đến)
├── AGENTS.md               # ← MỚI: harness entrypoint
├── docs/                   # ← MỚI: harness operating docs
│   ├── HARNESS.md
│   ├── FEATURE_INTAKE.md
│   ├── ARCHITECTURE.md
│   ├── CONTEXT_RULES.md
│   ├── stories/
│   ├── decisions/
│   ├── intakes/
│   ├── backlog/
│   └── product/
├── .5harness/              # ← MỚI: derived index
└── .gitignore              # ← CẬP NHẬT: thêm harness entries
```

Kiểm tra mọi thứ ổn định:

```bash
harness doctor
```

---

## Bước 3: Ghi Lại Kiến Trúc

Điền vào `docs/ARCHITECTURE.md` với stack và quyết định hiện tại:

```markdown
# Architecture

## Stack
- **Runtime:** Node.js 22
- **Framework:** Express 5
- **Database:** PostgreSQL qua `pg`
- **Auth:** JWT với refresh tokens
- **Testing:** Vitest

## Layering
- `src/routes/` — HTTP handlers
- `src/middleware/` — auth, validation, error handling
- `src/models/` — database queries và business logic
```

---

## Bước 4: Phân Loại Công Việc Có Sẵn — Backfill Intakes

Tạo intake cho các tính năng đã xây dựng, để thiết lập lịch sử bền vững:

```bash
# Tính năng có sẵn: xác thực người dùng
harness intake \
  --type spec_slice \
  --summary "User authentication với JWT login/register/refresh" \
  --lane normal \
  --notes "Đã triển khai. Backfill cho lịch sử."

# Tính năng có sẵn: blog CRUD
harness intake \
  --type spec_slice \
  --summary "Blog post CRUD với trạng thái draft/published" \
  --lane normal \
  --notes "Đã triển khai. Backfill cho lịch sử."
```

---

## Bước 5: Ghi Quyết Định Bền Vững

Các lựa chọn kiến trúc có sẵn xứng đáng có bản ghi quyết định:

```bash
harness decision add \
  --id 0001 \


---

## Bước 8: Triển Khai Tính Năng — Workflow Đầy Đủ

Giờ dùng harness workflow cho công việc mới. Đây là ví dụ triển khai hệ thống bình luận:

```bash
# 1. Intake (phân loại công việc mới)
harness intake \
  --type spec_slice \
  --summary "Hệ thống bình luận lồng nhau: CRUD bình luận trên bài viết, trả lời bình luận" \
  --lane normal \
  --docs "docs/product/blog-api-spec.md"

# 2. Triển khai (agent hoặc developer viết code)
# ... viết src/routes/comments.ts, src/models/comments.ts ...
# ... viết tests/comments.test.ts ...

# 3. Kiểm chứng
harness story update \
  --id US-001 \
  --status implemented \
  --unit 1 \
  --integration 1 \
  --e2e 0 \
  --platform 0 \
  --evidence "Unit: 12/12 pass. Integration: 5/5 pass. Đã test thủ công nested replies bằng curl."

# 4. Trace
harness trace \
  --story US-001 \
  --summary "Đã triển khai hệ thống bình luận lồng nhau với replies" \
  --outcome completed \
  --actions "tạo comments routes+model, thêm unit+integration tests, test nested replies" \
  --read "docs/product/blog-api-spec.md,docs/ARCHITECTURE.md" \
  --changed "src/routes/comments.ts,src/models/comments.ts,tests/comments.test.ts" \
  --friction "none"
```

---

## Bước 9: Hợp Tác — Clone Trên Máy Khác

Developer khác clone repo. Họ không cần `harness init` — chỉ cần `link`:

```bash
git clone git@github.com:team/blog-api.git
cd blog-api
npm i -g 5harness
harness link              # đăng ký clone + reindex lịch sử đã commit
harness query matrix      # thấy tất cả story ngay lập tức
harness next              # biết việc cần làm tiếp theo
```

`harness link` phát hiện harness markdown có sẵn trong repo, đăng ký đường dẫn
clone, và build lại index từ các entity đã commit.

---

## Bước 10: Kiểm Tra Sức Khỏe Định Kỳ

```bash
harness audit
harness query stats
harness doctor
```

---

## Timeline Đầy Đủ Các Lệnh (Dự Án Có Sẵn)

```
harness init              # tạo harness vào dự án có sẵn
harness doctor            # kiểm tra sức khỏe
# ... ghi kiến trúc vào docs/ARCHITECTURE.md ...
harness intake            → IN-001, IN-002 (backfill lịch sử)
harness decision add      → 0001, 0002 (ghi quyết định)
harness backlog add       → BL-001, BL-002 (vấn đề đã biết)
harness story add         → US-001, US-002 (lên kế hoạch)
# ... triển khai ...
harness story update      → US-001 implemented (kiểm chứng)
harness trace             → trace #1 (ghi nhận)
harness next              → US-002 (story tiếp theo)
```

---

## Khác Biệt Chính: Init vs Link

| Tình huống | Lệnh | Chức năng |
|---|---|---|
| Lần đầu thêm harness vào dự án bất kỳ | `harness init` | Tạo `AGENTS.md`, `docs/`, `.5harness/`; đăng ký vào `~/.5harness` |
| Clone repo đã có harness | `harness link` | Đăng ký đường dẫn clone vào `~/.5harness`; reindex từ markdown đã commit |
| Đăng ký lại dự án đã di chuyển | `harness link` | Cập nhật con trỏ registry, không tạo lại file |

---

## Điểm Cốt Lõi

1. **`harness init` không phá hủy** — nó tạo file bên cạnh code, không bao giờ ghi đè
2. **Backfill lịch sử** — tạo intake và decision cho công việc có sẵn để xây dựng context bền vững
3. **Backlog vấn đề có sẵn** — các điểm đau đã biết trở thành backlog item có thể theo dõi
4. **`harness link` cho clone** — đồng đội không cần re-init, họ chỉ cần link
5. **Áp dụng từ từ** — không cần phân loại tất cả cùng lúc; thêm harness dần dần
6. **Workflow giống nhau cho công việc mới** — khi harness đã sẵn sàng, tính năng mới theo intake → story → triển khai → kiểm chứng → trace

> **Tham khảo:** `docs/HARNESS.md`, `docs/FEATURE_INTAKE.md`,
> `docs/WORKFLOW_VI.md`, `docs/GLOSSARY.md`

  --title "PostgreSQL thay vì SQLite" \
  --doc docs/decisions/0001-postgres-choice.md \
  --notes "Chọn PostgreSQL vì hỗ trợ JSONB và sẵn sàng production. Dùng pg driver trực tiếp, không ORM."

harness decision add \
  --id 0002 \
  --title "JWT auth với refresh token rotation" \
  --doc docs/decisions/0002-jwt-auth.md \
  --notes "Access token ngắn hạn (15ph) + refresh token có rotation. Lưu trong httpOnly cookies."
```

---

## Bước 6: Tạo Story Cho Công Việc Sắp Tới

Giờ harness đã sẵn sàng, dùng story cho tính năng mới:

```bash
harness story add \
  --id US-001 \
  --title "Thêm hệ thống bình luận cho bài viết" \
  --lane normal

harness story add \
  --id US-002 \
  --title "Thêm bộ lọc tag/category cho bài viết" \
  --lane normal
```

Kiểm tra matrix:

```bash
harness query matrix
```

---

## Bước 7: Thêm Vấn Đề Đã Biết Vào Backlog

Các điểm đau hiện tại được đưa vào backlog:

```bash
harness backlog add \
  --title "Không có rate limiting cho request" \
  --while "theo dõi traffic production" \
  --pain "Không có bảo vệ chống brute-force hoặc lạm dụng trên auth endpoints"

harness backlog add \
  --title "Test coverage dưới 40%" \
  --while "refactoring route handlers" \
  --pain "Không thể tự tin refactor mà không sợ regression"
```
