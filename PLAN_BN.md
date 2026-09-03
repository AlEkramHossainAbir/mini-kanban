# সিস্টেম ডিজাইন ও ইমপ্লিমেন্টেশন প্ল্যান — Mini Kanban Board

**স্কোপ সম্পর্কে নোট:** মূল অ্যাসেসমেন্ট ([ASSESSMENT_BN.md](ASSESSMENT_BN.md) দেখুন) একটি ৪ দিনের take-home চ্যালেঞ্জ, যা single-instance PostgreSQL স্ট্যাকের উপর ভিত্তি করে তৈরি। এখানে sharding বা million-user SLA-এর কোনো দাবি নেই। তাই এই প্ল্যানটি ইচ্ছাকৃতভাবে দুই স্তরে লেখা হয়েছে:

- **সেকশন ১–৬, ৮** বর্ণনা করে **৪ দিনের সাবমিশনের জন্য আসলে কী বানানো হবে** — নির্ধারিত স্ট্যাকের উপর একটি সঠিক, সুরক্ষিত, এবং সুগঠিত MVP।
- **সেকশন ৭** একটি **ডকুমেন্টেড রোডম্যাপ**, এখনই কোড করার জন্য নয় — এটি ব্যাখ্যা করে যে একই ডেটা মডেল কীভাবে বড় স্কেলে (মিলিয়ন ব্যবহারকারী) বিবর্তিত হবে, যাতে MVP-তে নেওয়া ডিজাইন সিদ্ধান্তগুলো (নিচে callout আকারে চিহ্নিত) সেই ভবিষ্যতের সাথে সামঞ্জস্যপূর্ণ প্রমাণিত হয় — একটি take-home অ্যাসেসমেন্টকে over-engineer না করেই।

---

## ১. সিস্টেম আর্কিটেকচার ওভারভিউ

**কম্পোনেন্ট**

| স্তর | সিদ্ধান্ত |
|---|---|
| ফ্রন্টএন্ড | Next.js 14 (App Router), React 18, TypeScript, Tailwind CSS |
| ব্যাকএন্ড | NestJS, TypeScript — মডিউল: `AuthModule`, `UsersModule`, `BoardsModule`, `ColumnsModule`, `TasksModule`, `CommonModule` (guards/pipes/interceptors), `PrismaModule`, `GatewayModule` (WebSockets) |
| ডেটাবেজ | PostgreSQL 16, শুধুমাত্র Prisma-এর মাধ্যমে অ্যাক্সেস |
| রিয়েলটাইম | Socket.IO (`@nestjs/websockets`), MVP-তে single instance |
| ডেভঅপস | Docker Compose — `db`, `backend`, `frontend` সার্ভিস |

**রিকোয়েস্ট ফ্লো**

Browser → Next.js (client component + server-rendered shell) → REST কল (`/api/v1/...`) → `JwtAuthGuard` → `BoardAccessGuard` → service layer → Prisma → PostgreSQL। রেসপন্স ফ্রন্টএন্ডে একটি TanStack Query ক্যাশ আপডেট করে; drag-and-drop-এর ক্ষেত্রে, নেটওয়ার্ক রেসপন্স ফেরত আসার আগেই UI optimistic আপডেট প্রয়োগ করে ফেলে (§৬)।

**অথ ফ্লো — JWT access token + rotating refresh token, দুটোই httpOnly cookie-তে**

- **Access token**: JWT, ১৫ মিনিট মেয়াদ, HS256, পেলোডে শুধু `sub` (userId) + `email` + স্ট্যান্ডার্ড claims। বোর্ড রোল টোকেনে embed করা হয় না — প্রতিটি রিকোয়েস্টে ডেটাবেজ থেকে ফ্রেশভাবে চেক করা হয়, কারণ membership ১৫ মিনিটের চেয়ে বেশি ঘন ঘন বদলাতে পারে।
- **Refresh token**: একটি opaque random 256-বিট ভ্যালু (JWT নয়), `RefreshToken` টেবিলে **hash** (SHA-256) করে সংরক্ষিত, সাথে `expiresAt` (৭ দিন), `revokedAt`, `replacedByTokenId`। প্রতিবার ব্যবহারে টোকেন **rotate** হয় (পুরনো row revoked, নতুন row ইস্যু হয়)। একটি revoked টোকেন যদি আবার ব্যবহার হওয়ার চেষ্টা হয়, সেটাকে চুরির সংকেত ধরে সেই ইউজারের পুরো টোকেন-ফ্যামিলি সাথে সাথে revoke করে দেওয়া হয়।
- **স্টোরেজ সিদ্ধান্ত: httpOnly, Secure, SameSite=Lax cookie**, `localStorage` নয়। কারণ: `localStorage`-এ থাকা যেকোনো ভ্যালু পেজে চলা যেকোনো স্ক্রিপ্ট পড়তে পারে, ফলে একটি মাত্র XSS বাগ পুরো অ্যাকাউন্ট টেকওভারে পরিণত হতে পারে টোকেন চুরির মাধ্যমে। httpOnly cookie জাভাস্ক্রিপ্টের কাছে সম্পূর্ণ অদৃশ্য — XSS বাগ থাকলেও attacker টোকেন চুরি করতে পারবে না, যদিও পেজ খোলা থাকা অবস্থায় ইউজার হিসেবে অ্যাকশন নিতে পারবে। এই সিদ্ধান্তের খরচ হলো CSRF এক্সপোজার, যা উপেক্ষা না করে স্পষ্টভাবে মিটিগেট করা হয়েছে (§৫)। `SameSite=Strict` নয়, `Lax` বেছে নেওয়া হয়েছে যাতে লগইনের পরপর শেয়ার করা বোর্ড লিংকে ক্লিক করলেও কাজ করে।
- Cookie নাম: `mk_at` (access, path `/`), `mk_rt` (refresh, শুধু `/api/v1/auth/refresh` path-এ সীমাবদ্ধ, যাতে এটি যতটা সম্ভব কম জায়গায় পাঠানো হয়)।
- `POST /auth/refresh` — `mk_rt` ভ্যালিডেট ও রোটেট করে নতুন দুটি cookie ইস্যু করে। ফ্রন্টএন্ডের fetch layer `401` পেলে একবার refresh কল করে রিট্রাই করে, সেটাও ব্যর্থ হলে `/login`-এ রিডাইরেক্ট করে।
- `POST /auth/logout` — **প্রকৃত সার্ভার-সাইড revocation** করে (refresh token row-কে revoked মার্ক করে) এবং দুটো cookie-ই মুছে দেয় — একটি কপি করা cookie স্বাভাবিক মেয়াদ শেষ না হওয়া পর্যন্ত বৈধ থাকে না।

---

## ২. ডেটাবেজ স্কিমা ডিজাইন (Prisma)

```prisma
model User {
  id           String   @id @default(uuid())
  email        String   @unique
  passwordHash String
  name         String
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  ownedBoards   Board[]        @relation("BoardOwner")
  boardMembers  BoardMember[]
  refreshTokens RefreshToken[]
  auditLogs     AuditLog[]
}

model RefreshToken {
  id                String    @id @default(uuid())
  tokenHash         String    @unique
  userId            String
  user              User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  expiresAt         DateTime
  revokedAt         DateTime?
  replacedByTokenId String?
  createdAt         DateTime  @default(now())

  @@index([userId])
}

model Board {
  id          String   @id @default(uuid())
  title       String
  description String?
  ownerId     String
  owner       User     @relation("BoardOwner", fields: [ownerId], references: [id], onDelete: Cascade)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  members BoardMember[]
  columns Column[]

  @@index([ownerId])
}

enum BoardRole {
  OWNER
  EDITOR
  VIEWER
}

model BoardMember {
  id        String    @id @default(uuid())
  boardId   String
  board     Board     @relation(fields: [boardId], references: [id], onDelete: Cascade)
  userId    String
  user      User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  role      BoardRole
  createdAt DateTime  @default(now())

  @@unique([boardId, userId])
  @@index([userId])
}

model Column {
  id        String   @id @default(uuid())
  boardId   String
  board     Board    @relation(fields: [boardId], references: [id], onDelete: Cascade)
  title     String
  rank      String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  tasks Task[]

  @@index([boardId, rank])
}

model Task {
  id          String   @id @default(uuid())
  columnId    String
  column      Column   @relation(fields: [columnId], references: [id], onDelete: Cascade)
  boardId     String   // denormalized: দ্রুত board-scoped authz, এবং ভবিষ্যতের শার্ড-কি (§৭)
  title       String
  description String?
  rank        String
  version     Int      @default(0) // optimistic concurrency token, দেখুন §৩
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([columnId, rank])
  @@index([boardId])
}

model AuditLog {
  id         String   @id @default(uuid())
  userId     String?
  user       User?    @relation(fields: [userId], references: [id], onDelete: SetNull)
  action     String   // যেমন "BOARD_SHARE", "MEMBER_REMOVE", "ROLE_CHANGE"
  entityType String
  entityId   String
  metadata   Json?
  createdAt  DateTime @default(now())

  @@index([entityType, entityId])
  @@index([userId])
}
```

`Task.boardId` ইচ্ছাকৃতভাবে denormalize করা হয়েছে। এতে একটি অতিরিক্ত কলাম রাখতে হয় (কলাম বদলের একই ট্রানজ্যাকশনে সিঙ্ক রাখা হয়), কিন্তু বিনিময়ে authorization চেকে কখনো `Task → Column → Board` join লাগে না, এবং এটিই সেই কলাম যার উপর ভবিষ্যতে sharding strategy পার্টিশন করবে (§৭)।

### অর্ডারিং স্ট্র্যাটেজি: fractional rank key, integer position নয়

বাতিল করা অ্যাপ্রোচ: একটি integer `position` কলাম যা প্রতিটি move-এ renumber হয় — এতে প্রতিটি drag-এ পুরনো ও নতুন পজিশনের মাঝের প্রতিটি row রিরাইট করতে হয়, যা ধীর এবং দুই ইউজার একই কলাম একসাথে রিঅর্ডার করলে লক-কনটেনশনের ঝুঁকি তৈরি করে।

**নেওয়া অ্যাপ্রোচ — LexoRank-স্টাইল স্ট্রিং rank:**

- প্রতিটি `Task`/`Column`-এ `rank: String` থাকে, lexicographically ordered কীস্পেস থেকে (base-36/base-62 ধরনের স্ট্রিং)।
- **rank A ও rank B-এর মাঝে insert**: lexicographic মিডপয়েন্ট স্ট্রিং হিসাব করা হয় (ছোট স্ট্রিং পুরো করে, ক্যারেক্টার-বাই-ক্যারেক্টার হেঁটে, adjacent হলে মাঝখানে একটি ক্যারেক্টার বসিয়ে)। এতে শুধু move হওয়া row-টি স্পর্শ হয় — কলামের আর কোনো row রিরাইট হয় না। **শুরুতে insert**: `""` ও প্রথম rank-এর মিডপয়েন্ট। **শেষে insert**: শেষ rank ও একটি নির্দিষ্ট max sentinel-এর মিডপয়েন্ট।
- **রিব্যালান্সিং**: একই জায়গায় বারবার insert হলে সময়ের সাথে rank স্ট্রিং লম্বা হতে পারে। একটি rank নির্দিষ্ট দৈর্ঘ্য (যেমন ৪০ ক্যারেক্টার) পার হয়ে গেলে, `rebalanceColumn(columnId)` ইউটিলিটি **শুধু সেই কলামের** সব টাস্ককে কীস্পেস জুড়ে সমানভাবে পুনরায় সাজিয়ে দেয় — এটি O(n) অপারেশন, কিন্তু একটি কলামে সীমাবদ্ধ এবং বাস্তবে বিরল, তাই এটি কখনো অন্য কলাম বা বোর্ডকে ব্লক করে না। এই ইউটিলিটি move এন্ডপয়েন্ট থেকে আলাদাভাবে unit-test করা হয়।
- একই স্কিম বোর্ডের ভেতরে কলাম অর্ডার করতেও ব্যবহৃত হয়।

### পেজিনেশন স্ট্র্যাটেজি

- **বোর্ড লিস্ট** (`GET /boards`) — **cursor-based**, `(createdAt, id)` কম্পোজিট কার্সরের উপর: `?cursor=<base64>&limit=20`, কোয়েরি: `WHERE (createdAt, id) < (cursor.createdAt, cursor.id) ORDER BY createdAt DESC, id DESC LIMIT 20`। একজন ইউজারের বোর্ড লিস্ট (নিজের + শেয়ার করা) সময়ের সাথে সীমাহীনভাবে বাড়ে; offset পেজিনেশনে প্রতিটি পেজে scan-and-discard করতে হয় এবং পেজ ফেচের মাঝে বোর্ড তৈরি/মুছে গেলে row skip/duplicate হতে পারে। Cursor পেজিনেশন এই দুটো সমস্যাই এড়ায় এবং যেকোনো গভীরতায় O(limit) থাকে।
- **প্রতি বোর্ডে কলাম** — `GET /boards/:id`-এর অংশ হিসেবে সম্পূর্ণ লোড হয়। পেজিনেট করা হয় না: একটি Kanban বোর্ডে কলামের সংখ্যা স্বভাবতই ছোট ও সীমাবদ্ধ, এবং এগুলোকে পেজে ভাগ করলে UI-এর মূল ধারণাই (সব কলাম একসাথে দৃশ্যমান) ভেঙে যাবে।
- **প্রতি কলামে টাস্ক** — MVP-তে সম্পূর্ণ লোড হয় (বাস্তবসম্মত ডেমো ব্যবহারে প্রতি কলামে কয়েক ডজন টাস্ক, হাজার নয়)। কলামের আকার সীমাহীনভাবে বাড়লে সঠিক অ্যাপ্রোচ — `(rank, id)`-এর উপর cursor পেজিনেশন, `GET /columns/:id/tasks?cursor=...` — এখানে ইচ্ছাকৃত পরবর্তী ধাপ হিসেবে ডকুমেন্ট করা হয়েছে, §৭-এর ক্যাশিং স্ট্র্যাটেজির সাথে জোড়া লাগিয়ে, কিন্তু এখনই বানানো হচ্ছে না। এটি একটি সচেতন স্কোপ সিদ্ধান্ত, ভুলবশত বাদ পড়া নয়।

---

## ৩. Task Movement API

**এন্ডপয়েন্ট:** `PATCH /api/v1/tasks/:id/move`

**রিকোয়েস্ট:**

```json
{
  "targetColumnId": "uuid",
  "beforeTaskId": "uuid | null",
  "afterTaskId": "uuid | null",
  "expectedVersion": 4
}
```

ক্লায়েন্ট একটি raw সংখ্যাসূচক index নয়, বরং যে দুটি টাস্কের মাঝে ড্র্যাগ করা টাস্কটি বর্তমানে দেখছে তাদের **neighbor task id** পাঠায়। Index অন্য কোনো ইউজারের move ল্যান্ড করার সাথে সাথেই বাসি (stale) হয়ে যায়; neighbor id-এর মাধ্যমে সার্ভার ট্রানজ্যাকশনের ভেতরে বর্তমান স্টেট থেকে প্রকৃত মিডপয়েন্ট নতুন করে বের করতে পারে, এবং কোনো neighbor ইতিমধ্যে সরে গেলে বা মুছে গেলে append-at-end-এ fallback করে (self-healing)। একই এন্ডপয়েন্ট ও পেলোড শেপ same-column reorder ও cross-column move দুটোই হ্যান্ডেল করে — `targetColumnId` বর্তমান কলামের সমান হলে reorder, ভিন্ন হলে cross-column move।

**রেসপন্স (200):**

```json
{
  "id": "uuid",
  "columnId": "uuid",
  "rank": "n5",
  "version": 5,
  "updatedAt": "2026-09-03T12:00:00.000Z"
}
```

**কনফ্লিক্টে — `409 Conflict`:**

```json
{ "error": "VERSION_CONFLICT", "currentTask": { "...": "সর্বশেষ row" } }
```

ফ্রন্টএন্ড `currentTask` থেকেই রিকনসাইল করে, পুরো বোর্ড রিফেচ না করেই।

### কনকারেন্সি কন্ট্রোল

প্রতিটি `Task`-এ `version: Int` থাকে। move রিকোয়েস্টে অবশ্যই `expectedVersion` থাকতে হবে; আপডেট চলে এভাবে:

```sql
UPDATE "Task" SET rank = $1, "columnId" = $2, version = version + 1, "updatedAt" = now()
WHERE id = $3 AND version = $4
```

এটি চলে `prisma.$transaction(..., { isolation: Serializable })`-এর ভেতরে। যদি কোনো row ম্যাচ না করে, বুঝতে হবে অন্য কেউ ইতিমধ্যে এটি সরিয়েছে — সার্ভিস ফ্রেশ row-সহ `409` রিটার্ন করে। `SERIALIZABLE` isolation আরও একটি সূক্ষ্ম race-কে ঠেকায়, যেখানে দুটি concurrent move একই neighbor জোড়া পড়ে একই মিডপয়েন্ট হিসাব করে ফেলে (যা collide করত); এক্ষেত্রে Postgres একটি ট্রানজ্যাকশনকে serialization failure দিয়ে abort করে, সার্ভিস একবার ফ্রেশ স্টেটের বিপরীতে মিডপয়েন্ট রি-ক্যালকুলেট করে রিট্রাই করে, তাও ব্যর্থ হলে `409` দিয়ে ছেড়ে দেয়।

**Row locking-এর (`SELECT ... FOR UPDATE`) বদলে optimistic concurrency কেন:** কনফ্লিক্ট বাস্তবে বিরল (দুই ব্যক্তি একই মুহূর্তে একই টাস্ক সরানোর চেষ্টা করা), এবং optimistic concurrency ট্রানজ্যাকশনকে ছোট রাখে — নেটওয়ার্ক রাউন্ড-ট্রিপ জুড়ে কোনো লক ধরে রাখা হয় না, শুধু neighbor পড়া → মিডপয়েন্ট হিসাব → শর্তসাপেক্ষ write, সবটাই একটি দ্রুত ট্রানজ্যাকশনের ভেতরে। এটি ইচ্ছাকৃতভাবে last-write-wins **নয়**: শেয়ার করা বোর্ডে নীরবে ডেটা হারিয়ে যাওয়া একটি প্রকৃত correctness বাগ, এবং অ্যাসেসমেন্টের "conflict-free" শব্দটিকে এখানে বোঝানো হয়েছে "সনাক্ত ও সমাধান করা হয়, ক্লায়েন্টকে প্রকৃত স্টেট দেখানো হয়" — শুধু "ক্র্যাশ করে না" নয়।

**এটিই ইউজারদের কাজ একে অপরের সাথে conflict হওয়া থেকে রক্ষা করে:** version-চেক করা write-এর কারণে দুই ইউজারের concurrent move সবসময় স্পষ্টভাবে সমাধান হয়, একে অপরকে নীরবে overwrite করে না; এবং প্রতিটি টাস্ক ঠিক একটি বোর্ডের authorization scope-এর ভেতরে থাকে (§৪) — ফলে কোনো ইউজারের drag-and-drop কখনো অন্য ইউজারের বোর্ডকে স্পর্শই করতে পারে না, শুধু যেসব বোর্ডে তাকে স্পষ্টভাবে অ্যাক্সেস দেওয়া হয়েছে সেগুলো ছাড়া।

### সংযুক্ত সব ক্লায়েন্টের মধ্যে রিয়েল-টাইম সিঙ্ক

একটি `BoardGateway` (NestJS `@WebSocketGateway`, Socket.IO) কানেকশনের সময় একই JWT দিয়ে অথেন্টিকেট করে; বোর্ড খোলার সময় ক্লায়েন্টরা `board:<boardId>` নামের একটি room-এ join করে। কোনো move কমিট হওয়ার পর, `TasksService.move()` সেই room-এ আপডেট হওয়া টাস্কসহ `task.moved` ইভেন্ট এমিট করে। ফ্রন্টএন্ড রিকনসাইল করে: ইভেন্টটি নিজের কোনো in-flight optimistic আপডেটের সাথে মিললে কিছু করে না, নাহলে সরাসরি query cache প্যাচ করে (§৬)।

৪ দিনের বিল্ডের জন্য এটি ইচ্ছাকৃতভাবে সীমিত: একটি **single Nest instance**, in-memory Socket.IO room — একটি backend কন্টেইনারের জন্য সঠিক। API হরাইজন্টালি স্কেল হওয়ার পর cross-instance pub/sub-এর জন্য Redis Socket.IO adapter হলো পরবর্তী ডকুমেন্টেড ধাপ (§৭)। (পুনঃ)সংযোগে, ক্লায়েন্ট শুধু REST-এর মাধ্যমে পুরো বোর্ড রিফেচ করে, miss হওয়া ইভেন্ট রিপ্লে করার বদলে — MVP স্কোপে সহজ ও নির্ভরযোগ্য; স্কেলে সঠিক অ্যাপ্রোচ হলো প্রতি-বোর্ড monotonic sequence number-সহ একটি events টেবিল (§৭), যা এখন বানানো হচ্ছে না।

Polling-এর বদলে WebSocket বেছে নেওয়া হয়েছে (একই বা বেশি effort-এ কিন্তু খারাপ UX), এবং SSE-এর বদলেও (এক-দিকমুখী; এখানে আলাদা mutation path লাগত, যা সুবিধা ছাড়াই জটিলতা বাড়াত)।

---

## ৪. অথোরাইজেশন / অ্যাক্সেস কন্ট্রোল

- **`JwtAuthGuard`** (গ্লোবাল, `APP_GUARD`-এর মাধ্যমে, `/auth/register`, `/auth/login`, `/auth/refresh`-এর জন্য `@Public()` escape hatch) — `mk_at` ভ্যালিডেট করে, `req.user` অ্যাটাচ করে।
- **`BoardAccessGuard`** — `boardId` রিজলভ করে (সরাসরি রুট থেকে, অথবা রুটে শুধু `columnId`/`taskId` থাকলে লুকআপের মাধ্যমে), কলারের `BoardMember` row লোড করে, না পেলে `403 Forbidden` রিটার্ন করে। পরবর্তী রোল-চেকের জন্য `req.boardRole` অ্যাটাচ করে। এই একই guard `BoardsController`, `ColumnsController`, `TasksController` জুড়ে সমানভাবে পুনর্ব্যবহৃত হয়।
- **বোর্ড তৈরি হলে স্বয়ংক্রিয়ভাবে creator-এর জন্য একটি `OWNER` `BoardMember` row insert হয়** — `Board.ownerId` আলাদা কোনো authority path নয়। প্রতিটি অ্যাক্সেস চেক একটিই `BoardMember` লুকআপ, "নাকি তুমি owner" জাতীয় ভুলে যাওয়ার মতো আলাদা branch নেই।
- **`RolesGuard` / `@RequireRole(BoardRole.EDITOR)`** mutation রুটে বসানো — কোনো `VIEWER` non-GET বোর্ড/কলাম/টাস্ক রুটে `403` পাবে। `POST /boards/:id/members` (শেয়ারিং) শুধু `OWNER`-এর জন্য।
- **Cross-board অ্যাক্সেস স্ট্রাকচারালি প্রতিরোধ করা হয়েছে**, শুধু প্রতিটি মেথডে চেক করে নয়: প্রতিটি কলাম/টাস্ক এন্ডপয়েন্ট service layer কোনো কোয়েরি চালানোর *আগেই* parent বোর্ড রিজলভ ও অথোরাইজ করে, ফলে এমন কোনো কোড-পথ নেই যা কলারের অ্যাক্সেস-না-পাওয়া বোর্ডের কোনো টাস্কে পৌঁছাতে পারে (classic IDOR গ্যাপ বন্ধ — যেখানে `PATCH /tasks/:id` একটি খালি id-কে বিশ্বাস করে বসে)।
- একটি বোর্ডে অন্য কোনো `OWNER` না থাকলে `OWNER` রোলের মেম্বার সরানো প্রত্যাখ্যান করা হয় — একটি বোর্ড কখনো owner-শূন্য হতে পারে না।

---

## ৫. সিকিউরিটি হার্ডেনিং

| বিষয় | নিয়ন্ত্রণ |
|---|---|
| পাসওয়ার্ড সংরক্ষণ | bcrypt, cost factor 12 |
| টোকেন চুরির প্রভাব সীমিত রাখা | স্বল্প-মেয়াদী (১৫ মিনিট) access JWT + rotating hashed refresh token, reuse-detection সহ (reuse হলে পুরো টোকেন-ফ্যামিলি revoke); টোকেন কখনো লগ হয় না |
| ব্রুট ফোর্স / credential stuffing | `@nestjs/throttler` — গ্লোবালি উদার ডিফল্ট, `/auth/login` ও `/auth/register`-এ বিশেষভাবে কড়া সীমা (যেমন 5/min/IP) |
| Mass assignment / খারাপ ইনপুট | প্রতিটি কন্ট্রোলারে `class-validator` DTO + গ্লোবাল `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })` — অপ্রত্যাশিত ফিল্ড (যেমন কেউ update payload-এ `ownerId` ঢোকানোর চেষ্টা করলে) নীরবে গৃহীত না হয়ে বাদ পড়ে যায় |
| Cross-origin রিকোয়েস্ট | `app.enableCors({ origin: FRONTEND_URL, credentials: true })` — স্পষ্ট allowlist, কখনো `*` নয় (`credentials: true`-এর সাথে `*` আসলে অবৈধও) |
| সাধারণ HTTP হেডার আক্রমণ | গ্লোবালি `helmet()` (CSP, `X-Content-Type-Options`, `X-Frame-Options` ইত্যাদি) |
| SQL injection | Prisma ডিফল্টভাবে প্রতিটি কোয়েরি parameterize করে — গঠনগতভাবেই নিরাপদ; কোডবেজে interpolated ইনপুটসহ `$queryRawUnsafe` কখনো ব্যবহার হয় না |
| XSS | React-এর ডিফল্ট JSX escaping অ্যাপের প্রকৃত সারফেস কভার করে (title/description সবসময় plain text হিসেবে রেন্ডার হয়); বোর্ড/কলাম/টাস্কের কনটেন্ট রেন্ডারে `dangerouslySetInnerHTML` কখনো ব্যবহৃত হয় না |
| CSRF (cookie-based auth) | `SameSite=Lax` ক্লাসিক cross-site form-POST CSRF ঠেকায়; প্রতিটি mutating রিকোয়েস্টে অতিরিক্তভাবে একটি কাস্টম হেডার (যেমন `X-Requested-With`) বাধ্যতামূলক, যা CORS preflight ট্রিগার করে — allowlist-এর বাইরের কোনো অরিজিনের পেজ সেই preflight-এই ব্যর্থ হয়, রিকোয়েস্ট সার্ভারে পৌঁছানোর আগেই |
| সিক্রেট হাইজিন | দুই সাবমডিউলেই `.env` git-ignored; প্রতিটি প্রয়োজনীয় ভেরিয়েবল ডকুমেন্ট করে placeholder-সহ `.env.example` কমিট করা; `docker-compose.yml` রুট `.env` (কখনো কমিট হয় না) থেকে `env_file:`-এর মাধ্যমে সিক্রেট পড়ে |
| জবাবদিহিতা | `AuditLog`-এ শুধু access-control-সংবেদনশীল অ্যাকশন রেকর্ড হয় (বোর্ড শেয়ার/আনশেয়ার, রোল পরিবর্তন, মেম্বার রিমুভ, বোর্ড ডিলিট) — রুটিন টাস্ক মুভ নয়, যা শুধু নয়েজ তৈরি করত |

---

## ৬. ফ্রন্টএন্ড: ল্যাগ-ফ্রি, প্রিমিয়াম Drag-and-Drop UI

- **লাইব্রেরি: `dnd-kit`**, `react-beautiful-dnd` নয়। `react-beautiful-dnd` (Atlassian) মেইনটেন্যান্স মোডে আছে এবং React 18 Strict Mode/concurrent rendering-এর সাথে পরিচিত সমস্যা আছে; `dnd-kit` সক্রিয়ভাবে মেইনটেইনড, ডিজাইন অনুযায়ী accessible, এবং এর sensor আর্কিটেকচার (`PointerSensor` + `KeyboardSensor`) একই drag context থেকে মাউস/টাচ ও কীবোর্ড ড্র্যাগ দুটোই সাপোর্ট করে।
- **Optimistic আপডেট** `onDragEnd`-এ:
  ১. কার্ডটি যেখানে ড্রপ হলো তা থেকে নতুন লোকাল অর্ডারিং হিসাব করা।
  ২. TanStack Query cache সরাসরি আপডেট করা (`queryClient.setQueryData`) — কোনো স্পিনার বা অপেক্ষা ছাড়াই UI সাথে সাথে move প্রতিফলিত করে।
  ৩. আগের cache snapshot ধরে রেখে ব্যাকগ্রাউন্ডে `PATCH /tasks/:id/move` পাঠানো।
  ৪. সফল হলে সার্ভারের authoritative `rank`/`version`-এর সাথে রিকনসাইল করা (সাধারণত visually কোনো পরিবর্তনই দেখা যায় না)।
  ৫. ব্যর্থ হলে (`409` বা নেটওয়ার্ক এরর) snapshot-এ রোলব্যাক করা এবং toast দেখানো ("কেউ একজন এই টাস্কটি সরিয়েছে — বোর্ড আপডেট হয়েছে") — TanStack Query-এর স্ট্যান্ডার্ড `onMutate`/`onError`/`onSettled` optimistic প্যাটার্ন।
- **স্টেট ম্যানেজমেন্ট: শুধু TanStack Query** সার্ভার স্টেটের জন্য — বোর্ড/কলাম/টাস্ক ডেটাই অ্যাপের স্টেট, REST রেসপন্স ও §৩-এর WebSocket-চালিত cache প্যাচ দিয়ে ফ্রেশ রাখা হয়। এই স্কোপে Redux/Zustand লাগে না। শুধু-UI স্টেট (কোন মোডাল খোলা, drag-in-progress ভিজ্যুয়াল) component state-এ থাকে, ইচ্ছাকৃতভাবে আলাদা রাখা হয়।
- **Drag চলাকালীন re-render ঝড় এড়ানো:** বোর্ড ডেটা এমনভাবে গঠন করা হয় যাতে প্রতিটি `Column` cache-এর নিজস্ব অংশে সাবস্ক্রাইব করে, পুরো বোর্ড প্রতিটি drag ফ্রেমে re-render হয় না; `TaskCard` `id` + `rank`/`version` দিয়ে key করা `React.memo`-বদ্ধ; `dnd-kit`-এর `useSortable` drag gesture-টি CSS transform দিয়ে চালায়, layout-প্রভাবিত state দিয়ে নয় — এটাই ড্রপ কমিট হওয়ার আগেও ড্র্যাগিং smooth রাখে। খুব লম্বা কলামের জন্য virtualization (`@tanstack/react-virtual`) স্বাভাবিক পরবর্তী ধাপ হিসেবে ডকুমেন্ট করা হয়েছে, ডিফল্টভাবে বানানো হয়নি কারণ ডেমো-সাইজের বোর্ডে এর প্রয়োজন নেই।
- **লোডিং স্টেট:** খালি স্ক্রিন বা স্পিনারের বদলে প্রকৃত কলাম/কার্ডের মতো দেখতে skeleton placeholder (Tailwind `animate-pulse`), TanStack Query-এর `isLoading` দিয়ে চালিত।
- **প্রিমিয়াম অনুভূতি:** টাস্ক কার্ডে Framer Motion-এর `layout` প্রপ ব্যবহার করে "বাকি কার্ডগুলো জায়গা করে দিতে সরে যাওয়া" reflow ইফেক্টের জন্য, সাথে hover/drag-lift shadow-এর জন্য সাধারণ Tailwind transition — JS-চালিত অ্যানিমেশন শুধু সেখানেই যেখানে layout reflow সত্যিই প্রয়োজন, বাকি সব CSS দিয়ে।
- **অ্যাক্সেসিবিলিটি:** `dnd-kit`-এর `KeyboardSensor` কীবোর্ড ইউজারদের দেয় — Tab দিয়ে ফোকাস, Space/Enter দিয়ে তোলা, Arrow key দিয়ে কলামের ভেতরে/জুড়ে সরানো, Space/Enter দিয়ে ড্রপ, Escape দিয়ে বাতিল — সাথে `dnd-kit`-এর `announcements` API দিয়ে কাস্টমাইজড `aria-live` ঘোষণা ("Task 'Fix login bug' moved to column 'In Progress', position 2 of 4"), যাতে স্ক্রিন-রিডার ইউজাররাও সমতুল্য কার্যকারিতা পান, শুধু মাউস-ইউজাররা নয়।

---

## ৭. মিলিয়ন ইউজারের জন্য স্কেলিং — ডকুমেন্টেড রোডম্যাপ (৪ দিনের MVP-তে বানানো হচ্ছে না)

এই সেকশনটি স্পষ্টভাবে সামনের দিকে তাকানো যুক্তি, MVP থেকে আলাদা রাখা হয়েছে। এটি দেখায় যে বাস্তব প্রোডাকশন লোডে MVP-এর ইচ্ছাকৃত সরলীকরণগুলো কোথায় পুনর্বিবেচনা করতে হবে — এর কোনোটাই ৪ দিনের সাবমিশনে ইমপ্লিমেন্ট করা হচ্ছে না।

১. **প্রথমে read replica।** Kanban বোর্ড ট্রাফিক read-heavy (প্রতি write-এ অনেক view)। Streaming-replication read replica যোগ করা; সব `GET` read একটি replica pool-এ, এবং সব write (এবং যেকোনো strong-consistency দরকারি read, যেমন move এন্ডপয়েন্টের neighbor-rank read) primary-তে রাউট করা। এটিই সবচেয়ে বেশি লিভারেজের প্রথম ধাপ, কারণ read ভলিউম মূলত active ইউজারের সাথে স্কেল করে, write ভলিউম থেকে বেশ স্বাধীনভাবে।
২. **বোর্ড অনুযায়ী পার্টিশন/শার্ড।** একটি একক primary যখন আর write ভলিউম সামলাতে পারবে না, তখন `Task`/`Column`/`AuditLog`-কে `boardId` অনুযায়ী পার্টিশন করা — Postgres-এর নেটিভ declarative partitioning, অথবা `boardId`-কে distribution key ধরে একটি Citus-distributed টেবিল। এই জন্যই MVP স্কিমায় (§২) `Task.boardId` denormalize করা হয়েছিল: এটি এমনিতেই স্বাভাবিক শার্ড-কি, কোনো join ছাড়াই কোয়েরি রাউট করা যায়, এবং একটি বোর্ডের নিজস্ব ডেটার জন্য কখনো cross-shard ট্রানজ্যাকশন লাগে না, কারণ একটি টাস্ক-মুভ শুধু একটি বোর্ডের ভেতরের row স্পর্শ করে।
৩. **Redis ক্যাশিং** hot/ঘন ঘন দেখা বোর্ডের জন্য (`board:<id>` → সিরিয়ালাইজড board+columns+tasks), WebSocket gateway ইতিমধ্যেই যে `task.moved`/`column.updated` ইভেন্ট এমিট করে সেগুলো দিয়েই invalidate হয় — cache-invalidation hook ইতিমধ্যে থাকা ইনফ্রাস্ট্রাকচারের উপরেই বসে। একাধিক API instance হওয়ার সাথে সাথে দরকারি Socket.IO adapter-এর (`@socket.io/redis-adapter`) জন্যও Redis ব্যবহৃত হয়, কারণ in-memory Socket.IO room (MVP অ্যাপ্রোচ) একাধিক প্রসেস জুড়ে কাজ করে না।
৪. **PgBouncer** কানেকশন পুলিং (transaction-pooling মোডে), যখন হরাইজন্টালি স্কেল করা অনেক Nest instance প্রত্যেকে নিজস্ব Prisma connection pool রাখলে Postgres-এর নিজস্ব কানেকশন সীমা query throughput বাধা হওয়ার অনেক আগেই শেষ হয়ে যাবে।
৫. **BullMQ** (Redis-ভিত্তিক) ব্যাকগ্রাউন্ড কিউ non-critical/asynchronous write-এর জন্য — audit log সংরক্ষণ, শেয়ার-ইনভাইট ইমেইল, বড় বোর্ডের WebSocket fan-out, অ্যানালিটিক্স — এগুলোকে সিঙ্ক্রোনাস রিকোয়েস্ট পাথ থেকে সরিয়ে নেওয়া হয়, যাতে ডাউনস্ট্রিম সাইড-ইফেক্ট যাই হোক না কেন move এন্ডপয়েন্টের লেটেন্সি সীমাবদ্ধ থাকে।
৬. **হরাইজন্টাল API স্কেলিং** — লোড ব্যালান্সারের পেছনে stateless NestJS instance; REST-এ session affinity লাগে না (JWT stateless), Socket.IO-তে sticky session অথবা উপরের Redis adapter লাগে।
৭. Next.js স্ট্যাটিক অ্যাসেটের (JS bundle, ফন্ট, ছবি) জন্য **CDN** — স্ট্যাটিক অ্যাসেট লেটেন্সিকে অ্যাপ সার্ভার থেকে সম্পূর্ণ আলাদা করে দেয়।
৮. **বড় স্কেলে ইনডেক্সিং রিভিউ** — MVP-এর `(boardId, rank)` / `(columnId, rank)` কম্পোজিট ইনডেক্স সঠিকই থাকে, তবে উচ্চ cardinality-তে covering index (`INCLUDE`) যোগ করা, যাতে list read শুধু ইনডেক্স থেকেই পূরণ হয়, এবং নতুন কোয়েরি প্যাটার্ন (সার্চ/ফিল্টার) তৈরি হলে `pg_stat_statements`-এ sequential scan নিয়মিত রিভিউ করা।
৯. **অবজারভেবিলিটি** — request-id correlation-সহ structured JSON logging (`nestjs-pino`), Next.js → Nest → Postgres/Redis জুড়ে distributed tracing, এবং বিশেষভাবে move এন্ডপয়েন্টে p50/p95/p99 মেট্রিক্স, কারণ এটিই সবচেয়ে বেশি-ফ্রিকোয়েন্সি, লেটেন্সি- ও কনকারেন্সি-সংবেদনশীল পথ, যেখানে contention প্রথম দেখা দেবে।

---

## ৮. প্রজেক্ট স্ট্রাকচার ও ৪-দিনের ডেলিভারি প্ল্যান

**রিপোজিটরি লেআউট** (বিদ্যমান সাবমডিউলের উপর ম্যাপ করা):

```
mini-kanban/
├── README.md                 (সেটআপ ধাপ + স্যাম্পল env var)
├── docker-compose.yml        (db + backend + frontend)
├── ASSESSMENT_EN.md / ASSESSMENT_BN.md
├── PLAN_EN.md / PLAN_BN.md   (এই ডকুমেন্ট)
├── mini-kanban-backend/
│   ├── src/
│   │   ├── auth/            (controller, service, strategies, DTOs, guards)
│   │   ├── users/
│   │   ├── boards/
│   │   ├── columns/
│   │   ├── tasks/           (CRUD + move endpoint + rank utility)
│   │   ├── common/          (guards, decorators, filters, interceptors, PrismaModule)
│   │   ├── gateway/         (BoardGateway, WebSockets)
│   │   └── main.ts
│   ├── prisma/schema.prisma, prisma/migrations/
│   ├── Dockerfile
│   └── .env.example
└── mini-kanban-frontend/
    ├── app/                  (Next.js App Router: /login, /register, /boards, /boards/[id])
    ├── components/           (Board, Column, TaskCard, DnD wrapper)
    ├── lib/                  (API client, TanStack Query সেটআপ, socket client)
    ├── Dockerfile
    └── .env.example
```

**Docker Compose:** তিনটি সার্ভিস — `db` (`postgres:16-alpine`, named volume, healthcheck), `backend` (`mini-kanban-backend/Dockerfile` থেকে build, `db` healthy হওয়ার জন্য অপেক্ষা করে, শুরুতে `prisma migrate deploy` চালিয়ে তারপর স্টার্ট হয়, env রুট `.env` থেকে), `frontend` (`mini-kanban-frontend/Dockerfile` থেকে build, `backend`-এর উপর নির্ভরশীল, `NEXT_PUBLIC_API_URL` সেটির দিকে নির্দেশ করে)। একটি `docker-compose up --build`-এই একটি কার্যকর স্ট্যাক তৈরি হয় — এটি সরাসরি অ্যাসেসমেন্টের "থাকলে ভালো" Docker ডেলিভারেবল পূরণ করে।

**রুট README:** প্রয়োজনীয়তা (Docker, Node LTS), `git clone --recurse-submodules`, `docker-compose up --build` quick start, প্রতিটি সাবমডিউলের জন্য লোকাল (non-Docker) dev নির্দেশনা, backend-এর জন্য স্যাম্পল `.env` (`DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `FRONTEND_URL`) এবং frontend-এর জন্য (`NEXT_PUBLIC_API_URL`), এই প্ল্যানের দিকে নির্দেশ করা একটি সংক্ষিপ্ত আর্কিটেকচার-ওভারভিউ সেকশন, এবং ঐচ্ছিক live-deployment লিংক প্লেসহোল্ডার।

**দিন-অনুযায়ী পরিকল্পনা:**

- **দিন ১ — ব্যাকএন্ড ফাউন্ডেশন।** `mini-kanban-backend`-এ `nest new`; Prisma স্কিমা (§২) + প্রথম migration; `PrismaModule`; `AuthModule` (register/login/refresh/logout, bcrypt, JWT strategy, cookie হ্যান্ডলিং); গ্লোবাল `ValidationPipe`/`helmet`/CORS/throttler ওয়্যারিং; কার্যকর `db` + `backend`-সহ `docker-compose.yml`। *সম্পন্ন যখন:* Dockerized Postgres-এর বিপরীতে register/login/refresh/logout এন্ড-টু-এন্ড কাজ করে।
- **দিন ২ — ডোমেইন CRUD, অথোরাইজেশন, move API।** `BoardsModule`/`ColumnsModule`/`TasksModule` সম্পূর্ণ CRUD; `BoardAccessGuard`/`RolesGuard`/`@RequireRole` (§৪); বোর্ড-শেয়ারিং এন্ডপয়েন্ট; rank ইউটিলিটি (মিডপয়েন্ট + রিব্যালান্স, আলাদাভাবে unit-tested); optimistic concurrency-সহ `PATCH /tasks/:id/move` (§৩); `task.moved` এমিট করা `BoardGateway`। *সম্পন্ন যখন:* পুরো API সারফেস REST ক্লায়েন্ট দিয়ে টেস্টযোগ্য, একটি manual দুই-ক্লায়েন্ট কনকারেন্সি টেস্টসহ।
- **দিন ৩ — ফ্রন্টএন্ড।** `mini-kanban-frontend`-এ `create-next-app`; Tailwind; cookie flow-এর সাথে জোড়া লাগানো auth পেজ; বোর্ড লিস্ট (cursor pagination); কলাম+টাস্কসহ বোর্ড ডিটেইল পেজ; optimistic আপডেটসহ `dnd-kit` ইন্টিগ্রেশন (§৬); TanStack Query + WebSocket রিকনসিলিয়েশন; skeleton স্টেট; কীবোর্ড DnD পাস। *সম্পন্ন যখন:* ব্রাউজারে প্রকৃত backend-এর বিপরীতে আসল drag-and-drop বোর্ড কাজ করে।
- **দিন ৪ — পলিশ, হার্ডেনিং, ডেলিভারি।** Framer Motion পাস; খালি/এরর স্টেট; audit-log ওয়্যারিং; §৫-এর বিপরীতে সিকিউরিটি চেকলিস্ট পাস; ক্লিন ক্লোন থেকে সম্পূর্ণ `docker-compose up --build` স্মোক টেস্ট (`.env` তৈরি করা ছাড়া আর কোনো ম্যানুয়াল ধাপ নেই); রুট README চূড়ান্ত করা; সময় থাকলে ঐচ্ছিক ডিপ্লয় (যেমন frontend-এর জন্য Vercel + backend+Postgres-এর জন্য Railway/Render)।
