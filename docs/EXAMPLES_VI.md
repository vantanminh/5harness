# Ví Dụ: Dự Án Mới Từ Đầu

> Hướng dẫn từng bước dùng 5harness để xây dựng dự án từ thư mục trống —
> từ ý tưởng đến hoàn thành, theo đúng workflow chuẩn của harness.

---

## Kịch Bản

Bạn muốn xây dựng một **TODO API** đơn giản với Node.js và Express. Thư mục
đang trống. Bạn sẽ dùng 5harness để cấu trúc công việc, theo dõi quyết định, và
ghi lại bằng chứng hoàn thành.

---

## Bước 1: Cài Đặt 5harness

```bash
npm i -g 5harness
harness --version   # xác nhận hoạt động
```

---

## Bước 2: Khởi Tạo Dự Án

```bash
mkdir todo-api && cd todo-api
git init
harness init
```

`harness init` làm gì:
- Tạo `AGENTS.md` (entrypoint cho agent, có harness block)
- Tạo `docs/` với `HARNESS.md`, `FEATURE_INTAKE.md`, `ARCHITECTURE.md`,
  `CONTEXT_RULES.md`, và cấu trúc thư mục cho stories, decisions, intakes,
  backlog
- Đăng ký dự án vào `~/.5harness` (registry máy local)
- Tự động reindex: index dẫn xuất sẵn sàng ngay lập tức

```
todo-api/
├── AGENTS.md
├── docs/
│   ├── HARNESS.md
│   ├── FEATURE_INTAKE.md
│   ├── ARCHITECTURE.md
│   ├── CONTEXT_RULES.md
│   ├── README.md
│   ├── TEST_MATRIX.md
│   ├── stories/
│   ├── decisions/
│   ├── intakes/
│   ├── backlog/
│   └── product/
├── .5harness/
│   └── index/
└── .gitignore
```

---

## Bước 3: Phân Loại Ý Tưởng — Feature Intake

Trước khi viết một dòng code nào, phân loại công việc qua intake:

```bash
harness intake \
  --type new_spec \
  --summary "Xây dựng TODO REST API với CRUD endpoints cho tasks" \
  --lane normal \
  --docs "docs/product/overview.md,docs/product/todo-api-spec.md"
```

Kết quả:
```
Intake IN-001 recorded.
```

> **Tại sao cần intake trước?** Harness phân loại rủi ro trước khi triển khai.
> Với CRUD API, lane là `normal` — quy mô story, phạm vi giới hạn.
> Bản ghi intake là markdown Git-backed bền vững tại `docs/intakes/IN-001.md`.

---

## Bước 4: Tạo Product Docs & Stories

Viết spec sản phẩm ngắn và tạo story cho phần đầu tiên:

```bash
# Tạo product overview (viết tay hoặc agent tạo)
# docs/product/overview.md mô tả API contract

# Tạo story
harness story add \
  --id US-001 \
  --title "TODO CRUD endpoints" \
  --lane normal
```

Giờ bạn đã có story trong matrix. Kiểm tra với:

```bash
harness query matrix
harness get US-001
```

---

## Bước 5: Triển Khai — Agent Work Loop

Bây giờ agent (hoặc bạn) triển khai code. Đây là product delta:

```bash
mkdir src
# viết src/index.ts, package.json, tsconfig.json...
npm init -y
npm install express
npm install -D typescript @types/express @types/node
```

Sau khi triển khai:

```bash
npm test   # chạy bộ test
```

---

## Bước 6: Ghi Bằng Chứng Xác Minh

Cập nhật story với trạng thái kiểm chứng:

```bash
harness story update \
  --id US-001 \
  --status implemented \
  --unit 1 \
  --integration 1 \
  --e2e 0 \
  --platform 0 \
  --evidence "Unit: 8/8 pass. Integration: 3/3 pass. Đã test thủ công tất cả CRUD endpoints bằng curl."
```

---

## Bước 7: Trace Công Việc

Ghi trace cho task này — bằng chứng bền vững về những gì đã xảy ra:

```bash
harness trace \
  --story US-001 \
  --summary "Đã triển khai TODO CRUD API endpoints" \
  --outcome completed \
  --actions "tạo Express app, triển khai GET/POST/PUT/DELETE /tasks, thêm unit+integration tests" \
  --read "docs/product/overview.md,docs/intakes/IN-001.md" \
  --changed "src/index.ts,package.json,tsconfig.json" \
  --friction "none"
```

Kết quả:
```
Trace #1 recorded.
  Tier achieved: minimal
  Missing:
    - standard: agent
```

---

## Bước 8: Ghi Quyết Định (nếu cần)

Nếu bạn đưa ra lựa chọn kiến trúc đáng ghi nhớ, hãy ghi lại:

```bash
harness decision add \
  --id 0001 \
  --title "In-memory storage cho MVP" \
  --doc docs/decisions/0001-in-memory-storage.md \
  --notes "Chọn in-memory Map thay vì SQLite để giữ MVP đơn giản. Sẽ migrate khi cần persistence."
```

---

## Bước 9: Phát Hiện Friction → Backlog

Nếu bạn thấy thiếu sót trong harness hoặc thiết lập dự án, ghi lại:

```bash
harness backlog add \
  --title "Thêm CI test workflow" \
  --while "đang kiểm tra test thủ công" \
  --pain "Không có CI tự động để bắt lỗi regression khi push"
```

---

## Bước 10: Audit & Propose

Định kỳ kiểm tra sức khỏe dự án:

```bash
harness audit
harness propose
harness query stats
```

```
=== Harness Stats ===
intakes  stories  decisions  backlog_items  traces
-------  -------  ---------  -------------  ------
1        1        1          1              1
```

---

## Bước 11: Tiếp Tục Vòng Lặp

Ý định tiếp theo quay lại intake:

```bash
harness intake \
  --type spec_slice \
  --summary "Thêm trường priority và bộ lọc cho task" \
  --lane normal

harness story add \
  --id US-002 \
  --title "Task priority và filtering" \
  --lane normal

# ... triển khai, kiểm chứng, trace ... lặp lại
```

---

## Timeline Đầy Đủ Các Lệnh

```
harness init
harness intake          → IN-001 (phân loại)
harness story add       → US-001 (lên kế hoạch)
# ... code ...
harness story update    → US-001 implemented (kiểm chứng)
harness trace           → trace #1 (ghi nhận)
harness decision add    → 0001 (quyết định)
harness backlog add     → BL-001 (cải tiến)
harness audit           → kiểm tra sức khỏe
harness next            → việc tiếp theo?
```

---

## Điểm Cốt Lõi

1. **Intake trước code** — phân loại rủi ro và lane trước
2. **Story trước triển khai** — một story = một đơn vị công việc
3. **Trace sau hoàn thành** — bản ghi bền vững về những gì đã xảy ra
4. **Decision cho kiến trúc** — đừng để mất các trade-off quan trọng
5. **Backlog cho friction** — cải tiến harness trong quá trình làm
6. **Mọi thứ là markdown Git-backed** — portable, reviewable, bền vững

> **Tham khảo:** `docs/HARNESS.md`, `docs/FEATURE_INTAKE.md`,
> `docs/WORKFLOW_VI.md`, `docs/GLOSSARY.md`
