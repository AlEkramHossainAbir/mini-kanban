# সিস্টেম ডিজাইন ও ইমপ্লিমেন্টেশন প্ল্যান — Mini Kanban Board

**স্কোপ সম্পর্কে নোট:** মূল অ্যাসেসমেন্ট ([ASSESSMENT_BN.md](ASSESSMENT_BN.md) দেখুন) একটি ৪ দিনের take-home চ্যালেঞ্জ, যা single-instance PostgreSQL স্ট্যাকের উপর ভিত্তি করে তৈরি। এখানে sharding বা million-user SLA-এর কোনো দাবি নেই। তাই এই প্ল্যানটি ইচ্ছাকৃতভাবে স্তরে স্তরে লেখা হয়েছে:

- **সেকশন ১–৬, ৯** বর্ণনা করে **৪ দিনের সাবমিশনের জন্য আসলে কী বানানো হবে** — নির্ধারিত স্ট্যাকের উপর একটি সঠিক, সুরক্ষিত, এবং সুগঠিত MVP।
- **সেকশন ৭** একটি **ডকুমেন্টেড রোডম্যাপ**, এখনই কোড করার জন্য নয় — এটি ব্যাখ্যা করে যে একই ডেটা মডেল কীভাবে বড় স্কেলে (মিলিয়ন ব্যবহারকারী) বিবর্তিত হবে, যাতে MVP-তে নেওয়া ডিজাইন সিদ্ধান্তগুলো (নিচে callout আকারে চিহ্নিত) সেই ভবিষ্যতের সাথে সামঞ্জস্যপূর্ণ প্রমাণিত হয় — একটি take-home অ্যাসেসমেন্টকে over-engineer না করেই।
- **সেকশন ৮** স্পষ্টভাবে বলে দেয় — ভুলবশত বাদ পড়া নয় — বাস্তব Kanban অ্যাপে দেখা যায় এমন কোন কোন ফেইলিওর মোড ইচ্ছাকৃতভাবে ৪ দিনের বিল্ডের **স্কোপের বাইরে** এবং কেন।
- **সেকশন ১০** হলো সেই কংক্রিট QA চেকলিস্ট, যার বিপরীতে এই প্ল্যানটি টেস্ট করা হয়।

একটি নতুন-তৈরি Kanban টুল প্রোডাকশনে সাধারণত যেসব ফেইলিওর মোডে ভোগে (reshuffling, jump-back, duplicate/disappearing কার্ড, race condition, WebSocket অর্ডারিং, deadlock, permission leak, cache stampede ইত্যাদি) — সেই বাস্তবসম্মত তালিকার বিপরীতে প্ল্যানটি যাচাই করার পর এই রিভিশন লেখা হয়েছে। প্রতিটি আইটেম এখন হয় নিচের কোনো সিদ্ধান্ত দিয়ে ইতিমধ্যে মিটিগেটেড, অথবা নতুনভাবে মিটিগেটেড (**(hardening)** চিহ্নিত), অথবা স্পষ্টভাবে স্কোপের বাইরে (§৮) — কোনোটাই নীরবে অসমাধিত রাখা হয়নি।

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
- **(hardening) ব্রাউজার সবসময় একটিমাত্র origin-এর সাথেই কথা বলে।** `/api/v1/*` `next.config.js` rewrites-এর মাধ্যমে Nest-এ প্রক্সি করা হয় (WebSocket upgrade-ও একই origin দিয়ে যায়)। এটি নিছক সৌন্দর্যের বিষয় নয়: `SameSite=Lax` cookie **cross-site রিকোয়েস্টে পাঠানো হয় না**, তাই একটি split ডিপ্লয়মেন্ট — frontend Vercel-এ, API Railway-তে, দুটি ভিন্ন registrable ডোমেইন — ডিপ্লয় করা ডেমোতে লগইন সম্পূর্ণ নীরবে ভেঙে দিত, অথচ `localhost`-এ নিখুঁতভাবে কাজ করত। প্রক্সি করার ফলে cookie first-party থাকে, `SameSite=Lax` অক্ষত থাকে, এবং প্রোডাকশনে cross-origin credentialed CORS-এর প্রয়োজনই আর থাকে না। লোকাল ডেভেলপমেন্টের জন্য `enableCors` কনফিগার করা থাকে, যেখানে দুটি dev সার্ভার সত্যিই ভিন্ন পোর্টে থাকে। বিকল্পটি (`SameSite=None; Secure`) বাতিল করা হয়েছে: এটি ঠিক সেই CSRF সারফেসই আবার খুলে দিত যা §৫ বন্ধ করার চেষ্টা করছে।

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
  boardId    String?  // denormalized, FK নয় — বোর্ড ডিলিট হয়ে গেলেও টিকে থাকে যাতে audit trail হারিয়ে না যায়, এবং এটিই সেই কলাম যার উপর §৭-এর board-based পার্টিশনিং আসলে শার্ড করে; nullable, যাতে বোর্ড-বহির্ভূত সিকিউরিটি ইভেন্টও (যেমন refresh-token reuse detection, §১) অডিট করা যায়
  action     String   // যেমন "BOARD_SHARE", "MEMBER_REMOVE", "ROLE_CHANGE"
  entityType String
  entityId   String
  metadata   Json?
  createdAt  DateTime @default(now())

  @@index([entityType, entityId])
  @@index([userId])
  @@index([boardId, createdAt])
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

- **বোর্ড লিস্ট** (`GET /boards`) — **cursor-based**, `(createdAt, id)` কম্পোজিট কার্সরের উপর: `?cursor=<base64>&limit=20`, কোয়েরি: `WHERE (createdAt, id) < (cursor.createdAt, cursor.id) ORDER BY createdAt DESC, id DESC LIMIT 20`। একজন ইউজারের বোর্ড লিস্ট (নিজের + শেয়ার করা) সময়ের সাথে সীমাহীনভাবে বাড়ে; offset পেজিনেশনে প্রতিটি পেজে scan-and-discard করতে হয় এবং পেজ ফেচের মাঝে বোর্ড তৈরি/মুছে গেলে row skip/duplicate হতে পারে। Cursor পেজিনেশন এই দুটো সমস্যাই এড়ায়। **সতর্কতা:** যেহেতু অ্যাক্সেস নির্ধারিত হয় `BoardMember`-এর (§৪) মাধ্যমে, `Board.ownerId` দিয়ে নয়, তাই এটি আসলে একটি join — `BoardMember.userId = ?` তার ইনডেক্স দিয়ে ফিল্টার হয়, তারপর `(createdAt, id)` সর্টের জন্য `Board`-এর সাথে join হয় — অর্থাৎ ফিল্টার দিকটা ইনডেক্স-চালিত হলেও, একটি single-table কার্সরের মতো এন্ড-টু-এন্ড পুরোপুরি ইনডেক্স-কভার্ড নয়। MVP ডেটা ভলিউমে এটি কোনো সমস্যা নয় (একজন ইউজারের বোর্ড সংখ্যা memory-তে সর্ট করার জন্য যথেষ্ট ছোট), কিন্তু সীমাহীন স্কেলে বিশুদ্ধ O(limit) দাবি করার বদলে এখানে স্পষ্টভাবে উল্লেখ করা হলো; পার-ইউজার বোর্ড সংখ্যা কখনো বড় হয়ে গেলে এটি পুনর্বিবেচনার জন্য §৭-এ চিহ্নিত করা আছে।
- **প্রতি বোর্ডে কলাম** — `GET /boards/:id`-এর অংশ হিসেবে সম্পূর্ণ লোড হয়। পেজিনেট করা হয় না: একটি Kanban বোর্ডে কলামের সংখ্যা স্বভাবতই ছোট ও সীমাবদ্ধ, এবং এগুলোকে পেজে ভাগ করলে UI-এর মূল ধারণাই (সব কলাম একসাথে দৃশ্যমান) ভেঙে যাবে।
- **প্রতি কলামে টাস্ক** — MVP-তে সম্পূর্ণ লোড হয় (বাস্তবসম্মত ডেমো ব্যবহারে প্রতি কলামে কয়েক ডজন টাস্ক, হাজার নয়)। কলামের আকার সীমাহীনভাবে বাড়লে সঠিক অ্যাপ্রোচ — `(rank, id)`-এর উপর cursor পেজিনেশন, `GET /columns/:id/tasks?cursor=...` — এখানে ইচ্ছাকৃত পরবর্তী ধাপ হিসেবে ডকুমেন্ট করা হয়েছে, §৭-এর ক্যাশিং স্ট্র্যাটেজির সাথে জোড়া লাগিয়ে, কিন্তু এখনই বানানো হচ্ছে না। এটি একটি সচেতন স্কোপ সিদ্ধান্ত, ভুলবশত বাদ পড়া নয়।

**(hardening) কলামের কাউন্ট derived, আলাদাভাবে সংরক্ষিত নয়।** কলাম হেডারে দেখানো টাস্ক সংখ্যা (যেমন "In Progress (15)") সবসময় ক্লায়েন্ট-সাইডে লোড হওয়া টাস্ক অ্যারের length থেকে হিসাব করা হয় — `Column`-এ আলাদা কোনো `taskCount` ফিল্ড নেই যা সিঙ্কে রাখতে হবে। এটি MVP-তে counter-drift বাগ (stale cache, miss হওয়া ইভেন্ট, soft-delete edge case) গঠনগতভাবেই এড়িয়ে যায়। tasks-per-column পেজিনেশন যোগ হওয়ার সাথে সাথে (§৭) এটি আর "ফ্রি" থাকবে না এবং একটি প্রকৃত সমাধান লাগবে — যেমন insert/delete-এর একই ট্রানজ্যাকশনে আপডেট হওয়া একটি DB-মেইনটেইনড কাউন্ট কলাম, partial page থেকে derive করা ভ্যালু নয়।

**(hardening) একটি টাস্ক দুই বোর্ডের মাঝে সরানো যায় না।** `Task.boardId` শুধুমাত্র একই বোর্ডের ভেতরে একটি ভ্যালিডেটেড move-এর সাইড-ইফেক্ট হিসেবেই বদলায় (§৩-এর cross-board rejection নিয়ম দেখুন) — এমন কোনো অপারেশন নেই যা `columnId` থেকে স্বাধীনভাবে টাস্ককে অন্য বোর্ডের `boardId`-এ পুনর্বরাদ্দ করে। এটি "একটি ফিল্ড আপডেট হলো, অন্যটি ভুলে যাওয়া হলো" ধরনের ক্লাসিক consistency বাগ শুরু হওয়ার আগেই বন্ধ করে দেয়।

---

## ৩. API সারফেস ও Task Movement

### সম্পূর্ণ এন্ডপয়েন্ট তালিকা

প্রতিটি রুট `/api/v1`-এর নিচে। "রোল" মানে প্রয়োজনীয় ন্যূনতম `BoardMember` রোল (§৪); `EDITOR+` মানে `EDITOR` অথবা `OWNER`।

| Method | Route | রোল | নোট |
|---|---|---|---|
| POST | `/auth/register` | public | |
| POST | `/auth/login` | public | `mk_at` + `mk_rt` সেট করে |
| POST | `/auth/refresh` | cookie | refresh token রোটেট করে |
| POST | `/auth/logout` | auth | প্রকৃত সার্ভার-সাইড revocation |
| GET | `/auth/me` | auth | অ্যাপ শেলের জন্য বর্তমান ইউজার |
| GET | `/boards` | auth | cursor-paginated; ইউজার যেসব বোর্ডের মেম্বার |
| POST | `/boards` | auth | creator স্বয়ংক্রিয়ভাবে `OWNER` মেম্বার হয় |
| GET | `/boards/:id` | member | board + columns + tasks; **প্রতিটি টাস্কে তার `version` থাকে** (এটি ছাড়া move API অচল) |
| PATCH | `/boards/:id` | EDITOR+ | নাম/বর্ণনা পরিবর্তন |
| DELETE | `/boards/:id` | OWNER | columns → tasks ক্যাসকেড হয় |
| GET | `/boards/:id/members` | member | |
| POST | `/boards/:id/members` | OWNER | ইমেইল + রোল দিয়ে রেজিস্টার্ড ইউজারের সাথে শেয়ার |
| PATCH | `/boards/:id/members/:userId` | OWNER | রোল পরিবর্তন |
| DELETE | `/boards/:id/members/:userId` | OWNER | last-owner গার্ড (§৪) |
| POST | `/boards/:id/columns` | EDITOR+ | rank ইউটিলিটি দিয়ে শেষে যুক্ত হয় |
| PATCH | `/columns/:id` | EDITOR+ | নাম পরিবর্তন |
| DELETE | `/columns/:id` | EDITOR+ | এর টাস্কগুলো ক্যাসকেড হয় |
| PATCH | `/columns/:id/move` | EDITOR+ | **কলাম রিঅর্ডারিং** — একই rank ইউটিলিটি, task move-এর মতোই neighbor-id পেলোড শেপ |
| POST | `/columns/:id/tasks` | EDITOR+ | শেষে যুক্ত হয় |
| PATCH | `/tasks/:id` | EDITOR+ | title / description |
| DELETE | `/tasks/:id` | EDITOR+ | |
| PATCH | `/tasks/:id/move` | EDITOR+ | নিচের move এন্ডপয়েন্ট |

### Move এন্ডপয়েন্ট

**এন্ডপয়েন্ট:** `PATCH /api/v1/tasks/:id/move`

**রিকোয়েস্ট:**

```json
{
  "targetColumnId": "uuid",
  "beforeTaskId": "uuid | null",
  "afterTaskId": "uuid | null",
  "position": 2,
  "expectedVersion": 4
}
```

UI একটি raw সংখ্যাসূচক index নয়, বরং যে দুটি টাস্কের মাঝে ড্র্যাগ করা টাস্কটি বর্তমানে দেখছে তাদের **neighbor task id** পাঠায়। Index অন্য কোনো ইউজারের move ল্যান্ড করার সাথে সাথেই বাসি (stale) হয়ে যায়; neighbor id-এর মাধ্যমে সার্ভার ট্রানজ্যাকশনের ভেতরে বর্তমান স্টেট থেকে প্রকৃত মিডপয়েন্ট নতুন করে বের করতে পারে, এবং কোনো neighbor ইতিমধ্যে সরে গেলে বা মুছে গেলে append-at-end-এ fallback করে (self-healing)।

**`position`-ও ইচ্ছাকৃতভাবে গ্রহণ করা হয়।** অ্যাসেসমেন্টে স্পষ্টভাবে বলা আছে "moving a task across different columns **to a specific position index**", তাই এন্ডপয়েন্টটি সেই কন্ট্রাক্ট আক্ষরিকভাবে মেনে চলে: `position` দেওয়া থাকলে (এবং neighbor id না থাকলে) সার্ভার *একই ট্রানজ্যাকশনের ভেতরেই* সেটিকে neighbor জোড়ায় রিজলভ করে — `SELECT id, rank FROM "Task" WHERE "columnId" = $1 ORDER BY rank, id OFFSET max(position-1,0) LIMIT 2` — তারপর হুবহু একই rank-midpoint পথ অনুসরণ করে। অর্থাৎ index-ভিত্তিক কলারও UI-এর মতোই একই race-safe আচরণ পায়; index ক্লায়েন্টের সম্ভাব্য বাসি স্ন্যাপশটের বদলে সার্ভারের লাইভ স্টেটের বিপরীতে রিজলভ হয়। দুটোই দেওয়া থাকলে neighbor id জেতে (তাতে বেশি তথ্য থাকে)। সীমার বাইরের index এরর না দিয়ে শুরু/শেষে clamp হয়।

একই এন্ডপয়েন্ট ও পেলোড শেপ same-column reorder ও cross-column move দুটোই হ্যান্ডেল করে — `targetColumnId` বর্তমান কলামের সমান হলে reorder, ভিন্ন হলে cross-column move। কলাম অর্ডারিংয়ের জন্য `PATCH /columns/:id/move` হুবহু এটির অনুরূপ।

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

### Cross-board move ভ্যালিডেশন (hardening)

কোনো rank হিসাব করার আগে, সার্ভিস `targetColumnId` থেকে তার `boardId` রিজলভ করে টাস্কের নিজস্ব `boardId`-এর (যা ইতিমধ্যে `BoardAccessGuard`, §৪ দ্বারা প্রতিষ্ঠিত) সাথে মেলায়। দুটো ভিন্ন হলে রিকোয়েস্ট `400 Bad Request` (`INVALID_TARGET_COLUMN`) দিয়ে ব্যর্থ হয়, টাস্ককে নীরবে অন্য বোর্ডে পুনর্বরাদ্দ করার বদলে। অ্যাসেসমেন্টের নিজস্ব ভাষাও শুধু টাস্ককে *কলামের মধ্যে* সরানোর কথা বলে, বোর্ডের মধ্যে নয় — তাই এই এন্ডপয়েন্ট গঠনগতভাবেই দ্বিতীয়টি করতে পারে না, এটি শুধু ইমপ্লিমেন্ট না করা নয়, সক্রিয়ভাবে প্রত্যাখ্যান করা। এটি একটি সূক্ষ্ম authorization গ্যাপও বন্ধ করে: এই চেক ছাড়া, বোর্ড A-তে থাকা একজন `EDITOR` বোর্ড B-এর কোনো `columnId`-কে টার্গেট করে সেখানে একটি টাস্ক সরাতে পারত, বোর্ড B-তে কোনো অ্যাক্সেস না থাকা সত্ত্বেও।

### কনকারেন্সি কন্ট্রোল

প্রতিটি `Task`-এ `version: Int` থাকে। move রিকোয়েস্টে অবশ্যই `expectedVersion` থাকতে হবে; আপডেট চলে এভাবে:

```sql
UPDATE "Task" SET rank = $1, "columnId" = $2, version = version + 1, "updatedAt" = now()
WHERE id = $3 AND version = $4
```

এটি চলে `prisma.$transaction(..., { isolation: Serializable })`-এর ভেতরে। যদি কোনো row ম্যাচ না করে, বুঝতে হবে অন্য কেউ ইতিমধ্যে এটি সরিয়েছে — সার্ভিস ফ্রেশ row-সহ `409` রিটার্ন করে। `SERIALIZABLE` isolation আরও একটি সূক্ষ্ম race-কে ঠেকায়, যেখানে দুটি concurrent move একই neighbor জোড়া পড়ে একই মিডপয়েন্ট হিসাব করে ফেলে (যা collide করত); এক্ষেত্রে Postgres একটি ট্রানজ্যাকশনকে serialization failure দিয়ে abort করে, সার্ভিস একবার ফ্রেশ স্টেটের বিপরীতে মিডপয়েন্ট রি-ক্যালকুলেট করে রিট্রাই করে, তাও ব্যর্থ হলে `409` দিয়ে ছেড়ে দেয়।

**দুটি rank কখনো collide করলেও ইউজারের চোখে কিছুই ভাঙে না।** সার্ভার (`ORDER BY rank, id`) এবং ক্লায়েন্ট (§৬) দুটোই `id` দিয়ে tie ভাঙে, তাই একটি ডুপ্লিকেট rank থাকলেও সবার জন্য একটিই স্থিতিশীল, নির্ধারিত অর্ডার তৈরি হয়। এই কারণেই `@@unique([columnId, rank])` কনস্ট্রেইন্ট *ইচ্ছাকৃতভাবে* যোগ করা হয়নি: এটি একটি বিরল ও নিরীহ collision-কে ড্র্যাগের সময় ইউজারের মুখোমুখি `500` এররে পরিণত করত। rank-এর uniqueness একটি অপ্টিমাইজেশন, correctness-এর শর্ত নয় — এবং এটাই সঠিক ক্রম।

**Row locking-এর (`SELECT ... FOR UPDATE`) বদলে optimistic concurrency কেন:** কনফ্লিক্ট বাস্তবে বিরল (দুই ব্যক্তি একই মুহূর্তে একই টাস্ক সরানোর চেষ্টা করা), এবং optimistic concurrency ট্রানজ্যাকশনকে ছোট রাখে — নেটওয়ার্ক রাউন্ড-ট্রিপ জুড়ে কোনো লক ধরে রাখা হয় না, শুধু neighbor পড়া → মিডপয়েন্ট হিসাব → শর্তসাপেক্ষ write, সবটাই একটি দ্রুত ট্রানজ্যাকশনের ভেতরে। এটি ইচ্ছাকৃতভাবে last-write-wins **নয়**: শেয়ার করা বোর্ডে নীরবে ডেটা হারিয়ে যাওয়া একটি প্রকৃত correctness বাগ, এবং অ্যাসেসমেন্টের "conflict-free" শব্দটিকে এখানে বোঝানো হয়েছে "সনাক্ত ও সমাধান করা হয়, ক্লায়েন্টকে প্রকৃত স্টেট দেখানো হয়" — শুধু "ক্র্যাশ করে না" নয়।

**এটিই ইউজারদের কাজ একে অপরের সাথে conflict হওয়া থেকে রক্ষা করে:** version-চেক করা write-এর কারণে দুই ইউজারের concurrent move সবসময় স্পষ্টভাবে সমাধান হয়, একে অপরকে নীরবে overwrite করে না; এবং প্রতিটি টাস্ক ঠিক একটি বোর্ডের authorization scope-এর ভেতরে থাকে (§৪) — ফলে কোনো ইউজারের drag-and-drop কখনো অন্য ইউজারের বোর্ডকে স্পর্শই করতে পারে না, শুধু যেসব বোর্ডে তাকে স্পষ্টভাবে অ্যাক্সেস দেওয়া হয়েছে সেগুলো ছাড়া।

### Deadlock এড়ানো (hardening)

দুটি concurrent move গঠনগতভাবেই একে অপরকে কখনো deadlock করতে পারে না: একটি move-এ কোনো explicit row lock নেওয়া হয় না (`SELECT ... FOR UPDATE` কখনো ব্যবহৃত হয় না), এবং শুধু একটি row-ই লেখা হয় — ড্র্যাগ করা টাস্কটি নিজেই — একটি একক শর্তসাপেক্ষ `UPDATE ... WHERE id = ? AND version = ?`-এর মাধ্যমে। মিডপয়েন্ট হিসাবের জন্য neighbor টাস্কের বর্তমান rank পড়া একটি সাধারণ MVCC স্ন্যাপশট read, কোনো lock নয়। তাই একই কলামে race করা দুটি ট্রানজ্যাকশন কখনো বিপরীত ক্রমে দুটি lock ধরে রেখে একে অপরের জন্য অপেক্ষা করে না — যা ক্লাসিক deadlock-এর গঠন। যে একটি ফেইলিওর মোড *ঘটতে পারে* — `SERIALIZABLE` একটি ট্রানজ্যাকশন প্রত্যাখ্যান করা কারণ তার হিসাব করা মিডপয়েন্ট একটি concurrent ট্রানজ্যাকশনের সাথে collide করত — সেটি একটি একক-ট্রানজ্যাকশন abort, deadlock নয়, এবং উপরে বর্ণিত একবারের রিট্রাই দিয়ে ইতিমধ্যেই হ্যান্ডেল করা হয়।

### Out-of-order রেসপন্স ও ইভেন্ট প্রোটেকশন (hardening)

দ্রুত ড্র্যাগিং (একজন ইউজার একই টাস্ক পরপর দুই-তিনবার সরানো) নেটওয়ার্ক রেসপন্স — এবং WebSocket `task.moved` ইভেন্ট — পাঠানোর ক্রম উল্টে ফেলতে পারে। REST রেসপন্স পাথ ও WebSocket পাথ দুটোই একই নিয়ম দিয়ে সুরক্ষিত: **ইতিমধ্যে প্রয়োগ করা কিছুর চেয়ে পুরনো কিছু কখনো প্রয়োগ করা হয় না।** নির্দিষ্টভাবে:
- প্রতিটি বাইরে যাওয়া move রিকোয়েস্ট একটি প্রতি-টাস্ক, monotonically increasing ক্লায়েন্ট-সাইড sequence নম্বর দিয়ে ট্যাগ করা হয়। কোনো পুরনো sequence নম্বরের রেসপন্স যদি নতুন একটি প্রয়োগ হওয়ার পরে আসে, সেটি বাদ দেওয়া হয়।
- প্রতিটি `task.moved` WebSocket ইভেন্টে টাস্কের সার্ভার-নির্ধারিত `version` থাকে। ক্লায়েন্ট সেটিকে সেই টাস্ক id-এর জন্য cache-এ থাকা version-এর সাথে তুলনা করে, এবং strictly নতুন না হলে ইভেন্টটি উপেক্ষা করে — এটি ঠিক "Event 2 তারপর Event 1 আসে, UI Event-1-এর ফলাফল দেখায়" ধরনের ফেইলিওর মোড বন্ধ করে।
- যেহেতু `version` ও `rank`-এর জন্য সার্ভারই সত্যের উৎস (ক্লায়েন্টের অনুমান নয়), তাই ক্লায়েন্টের পক্ষে এটি একটি সাধারণ "সর্বোচ্চ version জেতে" নিয়মে পরিণত হয়, আর সার্ভারের optimistic-concurrency চেক (উপরে) থেকে যায় আসলে কী ঘটেছে তার প্রকৃত কর্তৃপক্ষ হিসেবে।

### সংযুক্ত সব ক্লায়েন্টের মধ্যে রিয়েল-টাইম সিঙ্ক

একটি `BoardGateway` (NestJS `@WebSocketGateway`, Socket.IO) কানেকশনের সময় একই JWT দিয়ে অথেন্টিকেট করে; বোর্ড খোলার সময় ক্লায়েন্টরা `board:<boardId>` নামের একটি room-এ join করে। **(hardening)** সেই room-এ join করাটাও নিজে থেকেই authorized — শুধু কানেকশন নয়: `join` হ্যান্ডলার socket-কে room-এ ভর্তি করার আগে `BoardAccessGuard`-এর (§৪) মতোই একই `BoardMember` চেক আবার চালায়, না হলে একটি socket error দিয়ে প্রত্যাখ্যান করে — শুধু একটি বৈধ JWT থাকাই একটি বোর্ডের ইভেন্ট শোনার জন্য যথেষ্ট নয়, এটি "WebSocket চ্যানেল ভ্যালিডেট করা হয়নি" জাতীয় leak বন্ধ করে, যেখানে অন্যথায় একজন ইউজার এমন একটি বোর্ডের লাইভ আপডেট পেতে পারত যেখানে তার কোনো অ্যাক্সেসই নেই। কোনো move কমিট হওয়ার পর, `TasksService.move()` সেই room-এ আপডেট হওয়া টাস্কসহ `task.moved` ইভেন্ট এমিট করে। ফ্রন্টএন্ড রিকনসাইল করে: ইভেন্টটি নিজের কোনো in-flight optimistic আপডেটের সাথে মিললে কিছু করে না, নাহলে সরাসরি query cache প্যাচ করে (§৬), উপরের version-গেটিং নিয়ম সাপেক্ষে।

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
- **(hardening)** এই একই `BoardMember` চেক শুধু REST-এ সীমাবদ্ধ নয়: WebSocket gateway-এর room-join হ্যান্ডলারও (§৩) একটি socket-কে বোর্ডের লাইভ-আপডেট চ্যানেলে ভর্তি করার আগে এটি আবার চালায়, ফলে WebSocket-এর মাধ্যমে বোর্ডের ডেটায় ঢোকার কোনো কম-সুরক্ষিত পিছনের দরজা থাকে না।

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
- **(hardening) প্রতিটি optimistic প্যাচের আগে `cancelQueries`।** `onMutate` সবার আগে optimistic স্টেট লেখার আগে `queryClient.cancelQueries({ queryKey: ['board', boardId] })` কল করে। এটি না করলে, একটি in-flight ব্যাকগ্রাউন্ড refetch (যেমন ড্র্যাগের আগের একটি বাসি রিকোয়েস্ট, অথবা React Query-এর নিজস্ব refetch-on-focus) optimistic write-এর *পরে* এসে সেটিকে নীরবে ড্র্যাগের আগের ডেটা দিয়ে ওভাররাইট করে দিতে পারে — এটাই "move আসলে সফল হওয়া সত্ত্বেও কার্ড জাম্প করে ফিরে আসা"-র প্রকৃত কারণ।
- **(hardening) প্রতিটি cache write একটি keyed upsert, কখনো wholesale replace নয়।** একটি টাস্ক সরানো, একটি `task.moved` WebSocket ইভেন্ট প্রয়োগ করা, এবং একটি mutation রেসপন্স রিকনসাইল করা — এই তিনটিই একটি একক ফাংশনের মধ্য দিয়ে যায় যা বিদ্যমান cache করা স্ট্রাকচারের ভেতরে `id` দিয়ে একটি মাত্র টাস্ক আপডেট করে। বোর্ডের সম্পূর্ণ স্টেট শুধুমাত্র প্রাথমিক `GET /boards/:id`-এর মাধ্যমে (অথবা একটি explicit reconnect resync-এ, §৩) wholesale replace হয় — কখনো একটি move রেসপন্স বা ইভেন্ট দিয়ে নয়। এটাই **duplicate কার্ড** (অন্যথায় একটি WS ইভেন্ট বা রিট্রাই করা রিকোয়েস্ট সরানোর বদলে append হতো) এবং **disappearing কার্ড** (অন্যথায় একটি partial/incomplete রেসপন্স যেসব টাস্কের কথা উল্লেখ করেনি সেগুলোকে blank করে দিত) দুটোই প্রতিরোধ করে।
- **(hardening) স্থিতিশীল আইডেন্টিটি ও একটি মাত্র সর্ট-কি।** React key সবসময় `task.id`, কখনো array index নয়। একটি কলামের টাস্কের রেন্ডার করা অর্ডার সবসময় `rank` স্ট্রিং (এবং tiebreak হিসেবে `id`) দিয়ে `Array.sort` — আর কিছু দিয়ে নয়; কোনো আলাদা ক্লায়েন্ট-সাইড রিঅর্ডারিং লজিক নেই যা সার্ভারের rank-এর সাথে দ্বিমত হতে পারে, যা সাধারণত "একটি কার্ড ড্র্যাগ করলে অসম্পর্কিত কার্ড reshuffle হয়ে যাওয়া"-র মূল কারণ।
- **(hardening) প্রতি-টাস্ক রিকোয়েস্ট sequencing।** প্রতিটি বাইরে যাওয়া move mutation প্রতি-টাস্ক লোকালি increment হওয়া একটি sequence নম্বর দিয়ে ট্যাগ করা হয় (§৩); একটি নতুন রেসপন্স ইতিমধ্যে ল্যান্ড করার পরে আসা একটি পুরনো রেসপন্স প্রয়োগ না করে বাদ দেওয়া হয়, তাই একই কার্ড পরপর দুই-তিনবার দ্রুত ড্র্যাগ করলে রেসপন্স উল্টে যাওয়ার কারণে সেটি বাসি অবস্থানে আটকে থাকতে পারে না।
- **(hardening) Optimistic create একটি temp id swap করে, দুইবার append করে না।** একটি টাস্ক তৈরি করার সময় ক্লায়েন্ট-জেনারেটেড `tempId` ও একটি `pending` ফ্ল্যাগসহ একটি প্লেসহোল্ডার কার্ড বসানো হয়; সার্ভার রেসপন্স দিলে সেই row **জায়গাতেই প্রতিস্থাপিত** হয় (temp id → আসল id), append হয় না। এই স্পষ্ট swap ছাড়া উপরের keyed-upsert নিয়ম সার্ভারের আসল id-কে একদম নতুন টাস্ক ভেবে নিত এবং কার্ডটি দুইবার দেখা যেত — একই duplicate বাগ, move পথের বদলে create পথ দিয়ে আসা। এখনো pending অবস্থায় থাকা কোনো temp row-এর সাথে মিলে যাওয়া `task.created` WebSocket ইভেন্টও একইভাবে de-duplicate করা হয়।
- **UX: ড্র্যাগ ergonomics।** `dnd-kit`-এর auto-scroll চালু থাকে, যাতে প্রান্তের দিকে ড্র্যাগ করলে কার্ডটি viewport-এর সীমানায় আটকে না গিয়ে বোর্ড হরাইজন্টালি (এবং কলাম উলম্বভাবে) স্ক্রল হয়; একটি স্থায়ী drop placeholder — ড্র্যাগ করা কার্ডের ঠিক সমান উচ্চতার একটি ড্যাশড ফাঁকা জায়গা — দেখায় কার্ডটি কোথায় গিয়ে বসবে, ইউজারকে অনুমান করতে না দিয়ে; এবং **প্রতিটি কলাম নিজেই একটি droppable কন্টেইনার হিসেবে রেজিস্টার করা হয়**, শুধু sortable আইটেমের তালিকা হিসেবে নয়, যাতে একটি *খালি* কলামে ড্রপ করা কাজ করে। শেষেরটি dnd-kit Kanban-এর সবচেয়ে পরিচিত বাগ: শুধু আইটেম-লেভেল drop target থাকলে খালি কলামে আঘাত করার মতো কিছুই থাকে না এবং কার্ড নীরবে ফিরে যায়।
- **UX: move-এ Undo।** move-এর পরের toast-এ ~৫ সেকেন্ডের জন্য **Undo** থাকে, যা আগের neighbor id দিয়ে একই এন্ডপয়েন্টে একটি symmetric কল হিসেবে বাস্তবায়িত — সস্তা, কারণ ক্লায়েন্ট rollback-এর জন্য ওই snapshot ইতিমধ্যেই ধরে রেখেছে। ভুল জায়গায় ড্রপ করা Kanban-এ সবচেয়ে সাধারণ ইউজার ভুল, তাই এই পরিশ্রমের বিনিময়ে এটিই সর্বোচ্চ-মূল্যের প্রিমিয়াম টাচ। Delete-এ undo-এর বদলে confirm ডায়ালগ থাকে — নতুন id-তে row পুনরুজ্জীবিত করলে id বদলে যেত এবং উপরের cache নিয়মগুলো সামান্য লাভের বিনিময়ে জটিল হতো।
- **স্টেট ম্যানেজমেন্ট: শুধু TanStack Query** সার্ভার স্টেটের জন্য — বোর্ড/কলাম/টাস্ক ডেটাই অ্যাপের স্টেট, REST রেসপন্স ও §৩-এর WebSocket-চালিত cache প্যাচ দিয়ে ফ্রেশ রাখা হয়। এই স্কোপে Redux/Zustand লাগে না। শুধু-UI স্টেট (কোন মোডাল খোলা, drag-in-progress ভিজ্যুয়াল) component state-এ থাকে, ইচ্ছাকৃতভাবে আলাদা রাখা হয়।
- **Drag চলাকালীন re-render ঝড় এড়ানো:** বোর্ড ডেটা এমনভাবে গঠন করা হয় যাতে প্রতিটি `Column` cache-এর নিজস্ব অংশে সাবস্ক্রাইব করে, পুরো বোর্ড প্রতিটি drag ফ্রেমে re-render হয় না; `TaskCard` `id` + `rank`/`version` দিয়ে key করা `React.memo`-বদ্ধ; `dnd-kit`-এর `useSortable` drag gesture-টি CSS transform দিয়ে চালায়, layout-প্রভাবিত state দিয়ে নয় — এটাই ড্রপ কমিট হওয়ার আগেও ড্র্যাগিং smooth রাখে। খুব লম্বা কলামের জন্য virtualization (`@tanstack/react-virtual`) স্বাভাবিক পরবর্তী ধাপ হিসেবে ডকুমেন্ট করা হয়েছে, ডিফল্টভাবে বানানো হয়নি কারণ ডেমো-সাইজের বোর্ডে এর প্রয়োজন নেই।
- **লোডিং স্টেট:** খালি স্ক্রিন বা স্পিনারের বদলে প্রকৃত কলাম/কার্ডের মতো দেখতে skeleton placeholder (Tailwind `animate-pulse`), TanStack Query-এর `isLoading` দিয়ে চালিত।
- **প্রিমিয়াম অনুভূতি:** টাস্ক কার্ডে Framer Motion-এর `layout` প্রপ ব্যবহার করে "বাকি কার্ডগুলো জায়গা করে দিতে সরে যাওয়া" reflow ইফেক্টের জন্য, সাথে hover/drag-lift shadow-এর জন্য সাধারণ Tailwind transition — JS-চালিত অ্যানিমেশন শুধু সেখানেই যেখানে layout reflow সত্যিই প্রয়োজন, বাকি সব CSS দিয়ে।
- **অ্যাক্সেসিবিলিটি:** `dnd-kit`-এর `KeyboardSensor` কীবোর্ড ইউজারদের দেয় — Tab দিয়ে ফোকাস, Space/Enter দিয়ে তোলা, Arrow key দিয়ে কলামের ভেতরে/জুড়ে সরানো, Space/Enter দিয়ে ড্রপ, Escape দিয়ে বাতিল — সাথে `dnd-kit`-এর `announcements` API দিয়ে কাস্টমাইজড `aria-live` ঘোষণা ("Task 'Fix login bug' moved to column 'In Progress', position 2 of 4"), যাতে স্ক্রিন-রিডার ইউজাররাও সমতুল্য কার্যকারিতা পান, শুধু মাউস-ইউজাররা নয়।
- **(hardening) মোবাইল/টাচ ড্র্যাগ।** `dnd-kit`-এর `PointerSensor` (এবং সূক্ষ্মতর নিয়ন্ত্রণ দরকার হলে `TouchSensor`) একটি activation constraint দিয়ে কনফিগার করা হয় — সামান্য বিলম্ব (~১৫০–২৫০ms) ও সামান্য movement tolerance (~৫px) — যাতে একটি টাচকে স্ক্রল না বুঝে ড্র্যাগ হিসেবে গণ্য করার আগে নিশ্চিত হওয়া যায়, ফলে ট্যাপ করা ও একটি কলাম উলম্বভাবে স্ক্রল করা ভুলবশত ড্র্যাগ শুরু করে না। বোর্ডের কলাম-থেকে-কলাম হরাইজন্টাল স্ক্রলিং তার নিজস্ব আলাদা স্ক্রল কন্টেইনার, যা উলম্ব প্রতি-কলাম টাচ-ড্র্যাগ জোন থেকে আলাদা রাখা হয়েছে, যাতে আরও কলাম দেখার জন্য হরাইজন্টাল সোয়াইপ একটি কার্ড তোলার সাথে সংঘাত না করে।

---

## ৭. মিলিয়ন ইউজারের জন্য স্কেলিং — ডকুমেন্টেড রোডম্যাপ (৪ দিনের MVP-তে বানানো হচ্ছে না)

এই সেকশনটি স্পষ্টভাবে সামনের দিকে তাকানো যুক্তি, MVP থেকে আলাদা রাখা হয়েছে। এটি দেখায় যে বাস্তব প্রোডাকশন লোডে MVP-এর ইচ্ছাকৃত সরলীকরণগুলো কোথায় পুনর্বিবেচনা করতে হবে — এর কোনোটাই ৪ দিনের সাবমিশনে ইমপ্লিমেন্ট করা হচ্ছে না।

১. **প্রথমে read replica।** Kanban বোর্ড ট্রাফিক read-heavy (প্রতি write-এ অনেক view)। Streaming-replication read replica যোগ করা; সব `GET` read একটি replica pool-এ, এবং সব write (এবং যেকোনো strong-consistency দরকারি read, যেমন move এন্ডপয়েন্টের neighbor-rank read) primary-তে রাউট করা। এটিই সবচেয়ে বেশি লিভারেজের প্রথম ধাপ, কারণ read ভলিউম মূলত active ইউজারের সাথে স্কেল করে, write ভলিউম থেকে বেশ স্বাধীনভাবে।
২. **বোর্ড অনুযায়ী পার্টিশন/শার্ড।** একটি একক primary যখন আর write ভলিউম সামলাতে পারবে না, তখন `Task`/`Column`/`AuditLog`-কে `boardId` অনুযায়ী পার্টিশন করা — Postgres-এর নেটিভ declarative partitioning, অথবা `boardId`-কে distribution key ধরে একটি Citus-distributed টেবিল। এই জন্যই MVP স্কিমায় (§২) `Task.boardId` denormalize করা হয়েছিল: এটি এমনিতেই স্বাভাবিক শার্ড-কি, কোনো join ছাড়াই কোয়েরি রাউট করা যায়, এবং একটি বোর্ডের নিজস্ব ডেটার জন্য কখনো cross-shard ট্রানজ্যাকশন লাগে না, কারণ একটি টাস্ক-মুভ শুধু একটি বোর্ডের ভেতরের row স্পর্শ করে।
৩. **Redis ক্যাশিং** hot/ঘন ঘন দেখা বোর্ডের জন্য (`board:<id>` → সিরিয়ালাইজড board+columns+tasks), WebSocket gateway ইতিমধ্যেই যে `task.moved`/`column.updated` ইভেন্ট এমিট করে সেগুলো দিয়েই invalidate হয় — cache-invalidation hook ইতিমধ্যে থাকা ইনফ্রাস্ট্রাকচারের উপরেই বসে। **Cache-stampede প্রোটেকশন**: প্রতি cache key-তে একটি single-flight লক (যেমন একটি স্বল্পমেয়াদী Redis `SETNX` মিউটেক্স) নিশ্চিত করে যে একটি hot বোর্ডের cache entry উচ্চ concurrent read লোডের অধীনে এক্সপায়ার হলে, শুধু একটি রিকোয়েস্টই সেটি পুনরায় পূরণ করে আর বাকিগুলো অপেক্ষা করে বা সংক্ষিপ্তভাবে stale ভ্যালু সার্ভ করে (stale-while-revalidate), সবাই একসাথে Postgres-এ আঘাত করার বদলে; jittered TTL জনপ্রিয় বোর্ডগুলোর মধ্যে এক্সপায়ারি ছড়িয়ে দেয় যাতে সবগুলো একই মুহূর্তে cache miss না করে। একাধিক API instance হওয়ার সাথে সাথে দরকারি Socket.IO adapter-এর (`@socket.io/redis-adapter`) জন্যও Redis ব্যবহৃত হয়, কারণ in-memory Socket.IO room (MVP অ্যাপ্রোচ) একাধিক প্রসেস জুড়ে কাজ করে না।
৪. **PgBouncer** কানেকশন পুলিং (transaction-pooling মোডে), যখন হরাইজন্টালি স্কেল করা অনেক Nest instance প্রত্যেকে নিজস্ব Prisma connection pool রাখলে Postgres-এর নিজস্ব কানেকশন সীমা query throughput বাধা হওয়ার অনেক আগেই শেষ হয়ে যাবে।
৫. **BullMQ** (Redis-ভিত্তিক) ব্যাকগ্রাউন্ড কিউ non-critical/asynchronous write-এর জন্য — audit log সংরক্ষণ, শেয়ার-ইনভাইট ইমেইল, বড় বোর্ডের WebSocket fan-out, অ্যানালিটিক্স — এগুলোকে সিঙ্ক্রোনাস রিকোয়েস্ট পাথ থেকে সরিয়ে নেওয়া হয়, যাতে ডাউনস্ট্রিম সাইড-ইফেক্ট যাই হোক না কেন move এন্ডপয়েন্টের লেটেন্সি সীমাবদ্ধ থাকে।
৬. **হরাইজন্টাল API স্কেলিং** — লোড ব্যালান্সারের পেছনে stateless NestJS instance; REST-এ session affinity লাগে না (JWT stateless), Socket.IO-তে sticky session অথবা উপরের Redis adapter লাগে।
৭. Next.js স্ট্যাটিক অ্যাসেটের (JS bundle, ফন্ট, ছবি) জন্য **CDN** — স্ট্যাটিক অ্যাসেট লেটেন্সিকে অ্যাপ সার্ভার থেকে সম্পূর্ণ আলাদা করে দেয়।
৮. **বড় স্কেলে ইনডেক্সিং রিভিউ** — MVP-এর `(boardId, rank)` / `(columnId, rank)` কম্পোজিট ইনডেক্স সঠিকই থাকে, তবে উচ্চ cardinality-তে covering index (`INCLUDE`) যোগ করা, যাতে list read শুধু ইনডেক্স থেকেই পূরণ হয়; পার-ইউজার বোর্ড সংখ্যা কখনো join-then-sort-কে গুরুত্বপূর্ণ করে তুলার মতো বড় হয়ে গেলে বোর্ড-লিস্ট join-টি (§২-এর সতর্কতা) `BoardMember`-এ একটি denormalized সর্টেবল ফিল্ড দিয়ে পুনর্বিবেচনা করা; এবং নতুন কোয়েরি প্যাটার্ন (সার্চ/ফিল্টার) তৈরি হলে `pg_stat_statements`-এ sequential scan নিয়মিত রিভিউ করা।
৯. **অবজারভেবিলিটি** — request-id correlation-সহ structured JSON logging (`nestjs-pino`), Next.js → Nest → Postgres/Redis জুড়ে distributed tracing, এবং বিশেষভাবে move এন্ডপয়েন্টে p50/p95/p99 মেট্রিক্স, কারণ এটিই সবচেয়ে বেশি-ফ্রিকোয়েন্সি, লেটেন্সি- ও কনকারেন্সি-সংবেদনশীল পথ, যেখানে contention প্রথম দেখা দেবে।

---

## ৮. যা ৪-দিনের MVP-তে ইচ্ছাকৃতভাবে স্কোপের বাইরে

এখানে ইচ্ছাকৃতভাবে বলে দেওয়া হলো, যাতে কিছুই ভুলবশত বাদ পড়েছে বলে মনে না হয়: এগুলো বাস্তব Kanban অ্যাপের প্রকৃত উদ্বেগ, যা এই প্ল্যান ৪ দিনের সাবমিশনে **বানাচ্ছে না**, এবং কেন।

- **সার্চ ও ফিল্টারিং।** অ্যাসেসমেন্টের কোথাও কোনো সার্চ বা ফিল্টার ফিচার চাওয়া হয়নি। ফলে সার্চ-ইনডেক্স stale হওয়া, বা "একটি অ্যাক্টিভ ফিল্টারে লুকানো টাস্কের সাপেক্ষে drop পজিশন কীভাবে হিসাব করব" — কোনোটাই ঘটতে পারে না, কারণ পজিশন হিসাব করার মতো কোনো ফিল্টার করা ভিউই নেই।
- **নোটিফিকেশন** (push, ইমেইল, in-app) এবং তাদের ডুপ্লিকেট-ডেলিভারির ঝুঁকি। চাওয়া হয়নি; MVP-তে কোনো ধরনের নোটিফিকেশন সিস্টেমই নেই, তাই এমন কিছু নেই যা দুইবার fire করতে পারে।
- **অফলাইন সাপোর্ট / local-first sync।** এটি একটি বাস্তব ফিচার (service worker, লোকাল write queue, অফলাইন↔অনলাইন রিকনসিলিয়েশন) কিন্তু ৪ দিনের single-repo অ্যাসেসমেন্টে এর কোনো ভিত্তি নেই এবং §৭-এর স্কেলিং রোডম্যাপ থেকেও স্বতন্ত্র — সম্পূর্ণভাবে স্থগিত, আংশিকভাবে বানানো নয়।
- **Tasks-per-column পেজিনেশন।** ইতিমধ্যে §২-এ MVP-এর জন্য স্কোপের বাইরে রাখা হয়েছে (প্রতি কলামে সম্পূর্ণ লোড); সম্পূর্ণতার জন্য বাকি কাটছাঁটগুলোর পাশে এখানে পুনরায় উল্লেখ করা হলো।

---

## ৯. প্রজেক্ট স্ট্রাকচার ও ৪-দিনের ডেলিভারি প্ল্যান

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

**(সাবমিশন ঝুঁকি) Git সাবমডিউল বনাম "একটি মাত্র রিপোজিটরি"।** অ্যাসেসমেন্ট চায় *একটিমাত্র* GitHub রিপোজিটরি **যাতে frontend ও backend দুটি ডিরেক্টরিই থাকে**। এখন এই দুটি ডিরেক্টরি **git সাবমডিউল**, যা আলাদা রিপোর দিকে নির্দেশ করে — ফলে কোনো রিভিউয়ার সাধারণভাবে `git clone` করলে (`--recurse-submodules` ছাড়া, যা বেশিরভাগ মানুষ অভ্যাসবশত করেন) দুটি **খালি ফোল্ডার** পাবেন এবং `docker-compose up` ভেঙে পড়বে। এই প্ল্যানের সবচেয়ে উচ্চ-ঝুঁকির ডেলিভারি সমস্যা এটাই, এবং এটি প্যাকেজিংয়ের সমস্যা, কোডের নয়। সাবমিশনের আগে এটি সমাধান করুন, অগ্রাধিকার অনুসারে:

১. **সাবমডিউল বাদ দেওয়া (সুপারিশকৃত)।** সাবমডিউল এন্ট্রি সরিয়ে দুটি প্রজেক্টকেই এই রিপোতে সাধারণ ডিরেক্টরি হিসেবে কমিট করুন, যাতে একটি সাধারণ clone-ই সম্পূর্ণ হয় এবং অ্যাসেসমেন্টের শর্ত আক্ষরিকভাবে পূরণ হয়। পোর্টফোলিওর জন্য আলাদা রিপোগুলো থাকতেই পারে; শুধু সাবমিশন যেন সেগুলোর উপর নির্ভরশীল না হয়।
২. **সত্যিই কারণ থাকলেই সাবমডিউল রাখুন।** সেক্ষেত্রে README-এর *প্রথম* কমান্ডটিই হতে হবে `git clone --recurse-submodules …`, সাথে recovery ধাপ হিসেবে `git submodule update --init --recursive`, এবং একটি লাইভ ডিপ্লয়মেন্ট লিংক তখন অনেক বেশি গুরুত্বপূর্ণ হয়ে ওঠে — স্বাধীন প্রমাণ হিসেবে যে জিনিসটা আসলেই চলে।

**Docker Compose:** তিনটি সার্ভিস — `db` (`postgres:16-alpine`, named volume, healthcheck), `backend` (`mini-kanban-backend/Dockerfile` থেকে build, `db` healthy হওয়ার জন্য অপেক্ষা করে, শুরুতে `prisma migrate deploy` চালিয়ে তারপর স্টার্ট হয়, env রুট `.env` থেকে), `frontend` (`mini-kanban-frontend/Dockerfile` থেকে build, `backend`-এর উপর নির্ভরশীল, `NEXT_PUBLIC_API_URL` সেটির দিকে নির্দেশ করে)। একটি `docker-compose up --build`-এই একটি কার্যকর স্ট্যাক তৈরি হয় — এটি সরাসরি অ্যাসেসমেন্টের "থাকলে ভালো" Docker ডেলিভারেবল পূরণ করে।

**রুট README:** প্রয়োজনীয়তা (Docker, Node LTS), `git clone --recurse-submodules`, `docker-compose up --build` quick start, প্রতিটি সাবমডিউলের জন্য লোকাল (non-Docker) dev নির্দেশনা, backend-এর জন্য স্যাম্পল `.env` (`DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `FRONTEND_URL`) এবং frontend-এর জন্য (`NEXT_PUBLIC_API_URL`), এই প্ল্যানের দিকে নির্দেশ করা একটি সংক্ষিপ্ত আর্কিটেকচার-ওভারভিউ সেকশন, এবং ঐচ্ছিক live-deployment লিংক প্লেসহোল্ডার।

**দিন-অনুযায়ী পরিকল্পনা:**

- **দিন ১ — ব্যাকএন্ড ফাউন্ডেশন।** `mini-kanban-backend`-এ `nest new`; Prisma স্কিমা (§২) + প্রথম migration; `PrismaModule`; `AuthModule` (register/login/refresh/logout, bcrypt, JWT strategy, cookie হ্যান্ডলিং); গ্লোবাল `ValidationPipe`/`helmet`/CORS/throttler ওয়্যারিং; কার্যকর `db` + `backend`-সহ `docker-compose.yml`। *সম্পন্ন যখন:* Dockerized Postgres-এর বিপরীতে register/login/refresh/logout এন্ড-টু-এন্ড কাজ করে।
- **দিন ২ — ডোমেইন CRUD, অথোরাইজেশন, move API।** `BoardsModule`/`ColumnsModule`/`TasksModule` সম্পূর্ণ CRUD; `BoardAccessGuard`/`RolesGuard`/`@RequireRole` (§৪); বোর্ড-শেয়ারিং এন্ডপয়েন্ট; rank ইউটিলিটি (মিডপয়েন্ট + রিব্যালান্স, আলাদাভাবে unit-tested); optimistic concurrency, cross-board রিজেকশন ও deadlock-free ডিজাইনসহ `PATCH /tasks/:id/move` (§৩); join-time অথোরাইজেশনসহ `task.moved` এমিট করা `BoardGateway`। *সম্পন্ন যখন:* পুরো API সারফেস REST ক্লায়েন্ট দিয়ে টেস্টযোগ্য, §১০-এর কনকারেন্সি/IDOR/cross-board টেস্ট কেসগুলোসহ।
- **দিন ৩ — ফ্রন্টএন্ড।** `mini-kanban-frontend`-এ `create-next-app`; Tailwind; cookie flow-এর সাথে জোড়া লাগানো auth পেজ; বোর্ড লিস্ট (cursor pagination); কলাম+টাস্কসহ বোর্ড ডিটেইল পেজ; optimistic আপডেটসহ `dnd-kit` ইন্টিগ্রেশন (§৬); TanStack Query + WebSocket রিকনসিলিয়েশন; skeleton স্টেট; কীবোর্ড DnD পাস। *সম্পন্ন যখন:* ব্রাউজারে প্রকৃত backend-এর বিপরীতে আসল drag-and-drop বোর্ড কাজ করে।
- **দিন ৪ — পলিশ, হার্ডেনিং, ডেলিভারি।** Framer Motion পাস; খালি/এরর স্টেট; audit-log ওয়্যারিং; §৫-এর বিপরীতে সিকিউরিটি চেকলিস্ট পাস; সম্পূর্ণ §১০ QA চেকলিস্ট এন্ড-টু-এন্ড চালানো; উপরের সাবমডিউল প্যাকেজিং সিদ্ধান্তটি নিষ্পত্তি করা; ক্লিন ক্লোন থেকে সম্পূর্ণ `docker-compose up --build` স্মোক টেস্ট (`.env` তৈরি করা ছাড়া আর কোনো ম্যানুয়াল ধাপ নেই); রুট README চূড়ান্ত করা; সময় থাকলে ঐচ্ছিক ডিপ্লয় (যেমন frontend-এর জন্য Vercel + backend+Postgres-এর জন্য Railway/Render, যেখানে API-তে পৌঁছানো হয় §১-এর Next.js rewrite দিয়ে, যাতে cookie first-party থাকে)।

**অটোমেটেড টেস্ট — ইচ্ছাকৃতভাবে অল্প।** পূর্ণাঙ্গ টেস্ট স্যুট নয়; শুধু সেগুলোই যেগুলোর ব্যর্থতা রিভিউতে সত্যিই বিব্রতকর হতো, এবং সবগুলোই সস্তা:

- ইউনিট: rank ইউটিলিটি — দুটি rank-এর মিডপয়েন্ট, শুরুতে insert, শেষে insert, এবং একটি rebalance যা আপেক্ষিক অর্ডার অক্ষুণ্ণ রাখে। এটি বিশুদ্ধ লজিক, কোনো I/O নেই, তাই দ্রুত এবং ঠিকভাবে টেস্ট করার যোগ্য।
- ইন্টিগ্রেশন (Jest + `supertest`, প্রতিটির একটি করে): register→login→refresh→logout; `403` রিটার্ন করা একটি IDOR চেষ্টা; বাসি `expectedVersion`-সহ একটি move যা `409` দেয়; cross-board `targetColumnId` যা `400` দেয়।

চারটি ইন্টিগ্রেশন টেস্ট ও একটি ইউনিট ফাইল — মোটামুটি এক বিকেলের কাজ, এবং এটি ঠিক সেই চারটি দাবিই কভার করে যেগুলো একজন রিভিউয়ার সবচেয়ে বেশি যাচাই করে দেখবেন।

**সময়সূচি পিছিয়ে গেলে এই ক্রমে বাদ দিন** (সিদ্ধান্তটা এখনই নেওয়া, যাতে চতুর্থ দিনের রাত ২টায় নিতে না হয়):

১. Framer Motion পলিশ → সাধারণ Tailwind transition-এ ফিরে যান। শুধুই ভিজ্যুয়াল।
২. WebSocket লাইভ সিঙ্ক → বোর্ড পুরোপুরি কাজ করবে; শুধু অন্যদের পরিবর্তন দেখতে রিফ্রেশ লাগবে। (§৩-এর version-gating তখন অব্যবহৃত থাকবে, কিন্তু ক্ষতিকর নয়।)
৩. Audit logging → এটি যে অথোরাইজেশন নিয়মগুলো রেকর্ড করে, সেগুলো তখনো *কার্যকর* থাকে; শুধু রেকর্ড রাখাটা বাদ যায়।
৪. কীবোর্ড drag-and-drop → দুঃখজনক, তবে মাউস DnD দিয়েও অ্যাসেসমেন্টের শর্ত পূরণ হয়।

**কখনোই বাদ দেবেন না:** `409` কনফ্লিক্ট পাথ, অথোরাইজেশন গার্ড, এবং এক-কমান্ডে Docker চালু হওয়া। অ্যাসেসমেন্ট আসলে এগুলোরই মূল্যায়ন করে।

---

## ১০. টেস্টিং ও QA চেকলিস্ট

একটি প্রাধান্য-ভিত্তিক, বাস্তবে ৪ দিনে চালানো যায় এমন টেস্ট কেসের সেট, যা বাস্তব Kanban টুল সাধারণত যেসব ফেইলিওর মোড নিয়ে শিপ হয় তা লক্ষ্য করে তৈরি:

**Drag-and-drop সঠিকতা**
- একটি কার্ড ড্র্যাগ করে নিশ্চিত করা যে অসম্পর্কিত কোনো কার্ডের `rank` বা পজিশন বদলায়নি (reshuffle বাগের বিরুদ্ধে গার্ড, §৬)।
- একই কার্ড পরপর তিনবার দ্রুত ড্র্যাগ করে নিশ্চিত করা যে এটি ঠিক শেষ ড্রপ যেখানে রেখেছে সেখানেই আছে, কোনো মধ্যবর্তী পজিশনে নয় (§৩/§৬ out-of-order প্রোটেকশন)।
- একটি ব্যর্থ move জোর করে ঘটিয়ে (যেমন ড্র্যাগের মাঝখানে backend বন্ধ করে) নিশ্চিত করা যে কার্ডটি একটি দৃশ্যমান toast-সহ ড্র্যাগের আগের পজিশনে ফিরে যায়, নীরবে আটকে না থেকে (§৬)।
- সম্পূর্ণ **খালি একটি কলামে** কার্ড ড্রপ করে নিশ্চিত করা যে সেটি সেখানে বসে (dnd-kit-এর ক্লাসিক droppable-container গ্যাপ, §৬)।
- viewport-এর প্রান্তের দিকে কার্ড ড্র্যাগ করে নিশ্চিত করা যে বোর্ড auto-scroll করে, কার্ডটি সীমানায় আটকে যায় না (§৬)।
- থ্রটল করা কানেকশনে একটি টাস্ক তৈরি করে নিশ্চিত করা যে সার্ভার রেসপন্স দেওয়ার পর ঠিক **একটিই** কার্ড আছে — কোনো pending ডুপ্লিকেট নয় (temp-id swap, §৬)।
- শুধু `position` দিয়ে (neighbor id ছাড়া) `PATCH /tasks/:id/move` কল করে নিশ্চিত করা যে সেটি ওই index-এ গিয়ে বসে — অ্যাসেসমেন্টের আক্ষরিক কন্ট্রাক্ট (§৩)।

**কনকারেন্সি**
- দুটি ব্রাউজার সেশন (বা দুইজন ইউজার) একই মুহূর্তে একই টাস্ক সরালে নিশ্চিত করা যে একটি সফল হয় এবং অন্যটি সংশোধিত স্টেটসহ `409` পায়, নীরবে ওভাররাইট হওয়া কোনো ফলাফল নয় (§৩)।
- দুইজন ইউজার একই কলামের ভিন্ন টাস্ক একসাথে রিঅর্ডার করলে নিশ্চিত করা যে দুটো move-ই সঠিকভাবে ল্যান্ড করে, কোনো lost update ছাড়াই।

**অথোরাইজেশন**
- কোনো বোর্ডে membership নেই এমন একটি সেশন থেকে সরাসরি (UI বাইপাস করে) সেই বোর্ডের একটি টাস্কের জন্য `PATCH /tasks/:id` কল করে নিশ্চিত করা যে `403`/`404` পাওয়া যায়, সফলতা নয় (IDOR চেক, §৪)।
- টাস্কের নিজস্ব বোর্ড থেকে ভিন্ন একটি বোর্ডের `targetColumnId` দিয়ে move-এর চেষ্টা করে নিশ্চিত করা যে `400` পাওয়া যায় (§৩ cross-board রিজেকশন)।
- একটি WebSocket কানেক্ট করে যে বোর্ডে ইউজারের কোনো অ্যাক্সেস নেই তার `board:<boardId>` room-এ join করার চেষ্টা করে নিশ্চিত করা যে join প্রত্যাখ্যাত হয় (§৩/§৪)।

**রিয়েল-টাইম সিঙ্ক**
- একই বোর্ড দুটো ট্যাবে খুলে একটিতে একটি কার্ড সরিয়ে নিশ্চিত করা যে অন্যটি ম্যানুয়াল রিফ্রেশ ছাড়াই সেটি প্রতিফলিত করে।
- একটি ট্যাবের নেটওয়ার্ক মাঝপথে বন্ধ ও পুনরুদ্ধার করে নিশ্চিত করা যে এটি reconnect-এ সঠিক বোর্ড স্টেটে resync হয়, অনির্দিষ্টকাল stale ডেটা না দেখিয়ে (§৩)।

**সিকিউরিটি**
- বারবার ভুল পাসওয়ার্ড দিয়ে `/auth/login`-এর rate limit ট্রিপ করিয়ে নিশ্চিত করা যে এটি throttled হয় (§৫)।
- `POST /auth/logout`-এর পরে একটি লগ-আউট হওয়া সেশনের refresh token সত্যিই সার্ভার-সাইডে প্রত্যাখ্যাত হচ্ছে কিনা নিশ্চিত করা (প্রকৃত revocation, §১)।
- **বিশেষভাবে ডিপ্লয় করা URL-এ** (শুধু localhost-এ নয়): লগইন করে হার্ড-রিফ্রেশ দিয়ে নিশ্চিত করা যে সেশন টিকে আছে — এই চেকটিই cross-site cookie ভুল-কনফিগারেশন ধরে ফেলে, যা `localhost`-এ টেস্ট করে কখনোই ধরা পড়ে না (§১)।

**অ্যাক্সেসিবিলিটি**
- শুধু কীবোর্ড দিয়ে একটি সম্পূর্ণ move (তোলা, কলাম জুড়ে সরানো, ড্রপ করা) সম্পন্ন করে নিশ্চিত করা যে `aria-live` ঘোষণাগুলো এটি সঠিকভাবে বর্ণনা করছে (§৬)।
