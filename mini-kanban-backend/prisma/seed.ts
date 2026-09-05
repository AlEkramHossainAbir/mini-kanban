/**
 * Idempotent demo-data seed. Creates (or reuses) `demo@example.com` /
 * `DemoPass123!` — the credentials documented in the root README and
 * ROADMAP.md, previously only ever created by hand against the live
 * deployment (via curl) and never persisted anywhere for local/dev use.
 *
 * Run with `npm run db:seed` — locally, or (once `docker compose up` has the
 * stack running) `docker compose exec backend npm run db:seed`. Not run
 * automatically by the container's own CMD (see Dockerfile): migrations
 * replay unconditionally on every boot by design, but seeding a database on
 * every restart is a separate decision this repo leaves manual on purpose.
 * Safe to run repeatedly either way: upserts the user, and only seeds the
 * "Product Launch" board the first time that user has zero boards, so
 * re-running never duplicates data or clobbers anything a reviewer has
 * since edited by hand.
 */
import { PrismaClient, BoardRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

// Deliberately not importing src/tasks/rank.util here: this script has to
// run standalone (plain ts-node, no tsconfig paths, no Nest DI) against
// whatever DATABASE_URL it's pointed at — including inside the runner
// Docker stage, which carries no `src/` tree by design (see Dockerfile).
// The seed only ever creates a small, fixed, already-ordered list of
// columns/tasks, so it doesn't need rank.util's full between()/rebalance()
// machinery — single characters from the same base-36 alphabet sort
// correctly for any list this short (up to 36 siblings) and remain valid
// input to that same machinery for every move made afterward.
const RANK_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';
function rankAt(index: number): string {
  if (index >= RANK_ALPHABET.length) {
    throw new Error('seed list longer than the single-character rank space');
  }
  return RANK_ALPHABET[index + 1]; // +1 keeps '0' free as headroom below the first item
}

// Matches src/auth/auth.service.ts's BCRYPT_COST — kept as a separate
// literal here on purpose: this script has no NestJS DI container to pull
// the app's own constant from, and duplicating one bcrypt cost number is a
// smaller risk than wiring Nest bootstrapping into a seed script.
const BCRYPT_COST = 12;

const DEMO_EMAIL = 'demo@example.com';
const DEMO_PASSWORD = 'DemoPass123!';
const DEMO_NAME = 'Demo User';

const BOARD_TITLE = 'Product Launch';
const COLUMNS: { title: string; tasks: string[] }[] = [
  {
    title: 'Backlog',
    tasks: ['Competitive analysis', 'Draft pricing tiers'],
  },
  {
    title: 'In Progress',
    tasks: ['Onboarding flow wireframes', 'API rate limiting'],
  },
  {
    title: 'Blocked',
    tasks: ['Legal review of ToS'],
  },
  {
    title: 'Done',
    tasks: [
      'Set up staging environment',
      'Finalize brand palette',
      'Write launch announcement',
    ],
  },
];

async function main() {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, BCRYPT_COST);

  const user = await prisma.user.upsert({
    where: { email: DEMO_EMAIL },
    update: {},
    create: { email: DEMO_EMAIL, passwordHash, name: DEMO_NAME },
  });
  console.log(`Demo user ready: ${user.email} (${user.id})`);

  const existingBoardCount = await prisma.board.count({
    where: { ownerId: user.id },
  });
  if (existingBoardCount > 0) {
    console.log(
      `Demo user already has ${existingBoardCount} board(s) — skipping board seed.`,
    );
    return;
  }

  await prisma.$transaction(async (tx) => {
    const board = await tx.board.create({
      data: { title: BOARD_TITLE, ownerId: user.id },
    });
    await tx.boardMember.create({
      data: { boardId: board.id, userId: user.id, role: BoardRole.OWNER },
    });

    for (const [columnIndex, column] of COLUMNS.entries()) {
      const createdColumn = await tx.column.create({
        data: {
          boardId: board.id,
          title: column.title,
          rank: rankAt(columnIndex),
        },
      });

      for (const [taskIndex, title] of column.tasks.entries()) {
        await tx.task.create({
          data: {
            columnId: createdColumn.id,
            boardId: board.id,
            title,
            rank: rankAt(taskIndex),
          },
        });
      }
    }

    console.log(
      `Seeded board "${BOARD_TITLE}" with ${COLUMNS.length} columns and ${COLUMNS.reduce((n, c) => n + c.tasks.length, 0)} tasks.`,
    );
  });
}

main()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
