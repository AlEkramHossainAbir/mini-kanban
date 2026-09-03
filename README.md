# Mini Kanban Board

Root project repository for the **Mini Kanban Board** — a full-stack technical assessment
submission for **Webbriks**.

This repository ties together the two application repositories as git submodules, plus the
original assessment document and write-ups describing it in English and Bangla.

## Repositories

| Repo | Description |
|------|--------------|
| [mini-kanban-frontend](https://github.com/AlEkramHossainAbir/mini-kanban-frontend) | Next.js + React (TypeScript) + Tailwind CSS frontend |
| [mini-kanban-backend](https://github.com/AlEkramHossainAbir/mini-kanban-backend) | NestJS (TypeScript) + PostgreSQL + Prisma backend |

Both are included here as git submodules under [mini-kanban-frontend/](mini-kanban-frontend/) and
[mini-kanban-backend/](mini-kanban-backend/).

```bash
git clone --recurse-submodules https://github.com/AlEkramHossainAbir/mini-kanban.git
# or, if already cloned:
git submodule update --init --recursive
```

## About the Assessment

- [Webbriks_Technical_Assessment.pdf](Webbriks_Technical_Assessment.pdf) — original assessment PDF
- [ASSESSMENT_EN.md](ASSESSMENT_EN.md) — assessment description in English
- [ASSESSMENT_BN.md](ASSESSMENT_BN.md) — assessment description in Bangla (বাংলা)

### Summary

Build a functional Mini Kanban Board application where users can create boards, organize workflow
columns, and manage tasks, with:

- Token-based authentication, board ownership, and sharing with other users.
- Access control preventing unauthorized cross-board access.
- Full CRUD for boards, columns, and tasks.
- A task-movement API supporting reordering within a column and moving across columns to a
  specific position, with stable/conflict-free ordering.
- A frontend board view with drag-and-drop task movement.

See the linked write-ups above for the full requirements and deliverables.
