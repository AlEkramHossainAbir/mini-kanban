import { z } from "zod";

/**
 * Mirrors the server DTOs exactly (backend src/auth/dto/*.ts) so the client
 * rejects what the server would reject, with the same limits:
 *   register — email, password 8..72, name 1..100
 *   login    — email, password ..72
 * The 72-byte ceiling is bcrypt's silent truncation point, not an arbitrary cap.
 */
export const loginSchema = z.object({
  email: z.string().min(1, "Email is required").email("Enter a valid email"),
  password: z.string().min(1, "Password is required").max(72),
});

export const registerSchema = z.object({
  name: z
    .string()
    .min(1, "Name is required")
    .max(100, "Name must be 100 characters or fewer"),
  email: z.string().min(1, "Email is required").email("Enter a valid email"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(72, "Password must be 72 characters or fewer"),
});

export type LoginValues = z.infer<typeof loginSchema>;
export type RegisterValues = z.infer<typeof registerSchema>;

/**
 * Mirrors CreateBoardDto (backend src/boards/dto/create-board.dto.ts):
 * title 1..200, description optional and ≤2000.
 */
export const createBoardSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, "Give the board a name")
    .max(200, "Name must be 200 characters or fewer"),
  description: z
    .string()
    .trim()
    .max(2000, "Description must be 2000 characters or fewer")
    .optional(),
});

export type CreateBoardValues = z.infer<typeof createBoardSchema>;

/**
 * Mirrors AddMemberDto (backend src/boards/dto/add-member.dto.ts): a
 * registered user's email plus the role to grant. The role choice is
 * deliberately narrowed to EDITOR/VIEWER in the UI — the DTO itself accepts
 * any BoardRole, but granting OWNER through a casual invite isn't a flow
 * this app offers; ownership changes go through the role-change endpoint,
 * which has no frontend yet (see the frontend ROADMAP Phase 6 note).
 */
export const addMemberSchema = z.object({
  email: z.string().trim().min(1, "Email is required").email("Enter a valid email"),
  role: z.enum(["EDITOR", "VIEWER"]),
});

export type AddMemberValues = z.infer<typeof addMemberSchema>;

/**
 * Mirrors CreateTaskDto/UpdateTaskDto (backend `src/tasks/dto/*.ts`): title
 * 1..200, description optional and ≤5000. Shared by the task composer and
 * the edit modal (frontend ROADMAP Phase 9) — both send the same shape.
 */
export const taskSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, "Give the card a title")
    .max(200, "Title must be 200 characters or fewer"),
  description: z
    .string()
    .trim()
    .max(5000, "Description must be 5000 characters or fewer")
    .optional(),
});

export type TaskValues = z.infer<typeof taskSchema>;

/**
 * Mirrors CreateColumnDto/UpdateColumnDto (backend
 * `src/columns/dto/*.ts`): title 1..200 — the only field either accepts.
 */
export const columnTitleSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, "Give the column a name")
    .max(200, "Name must be 200 characters or fewer"),
});

export type ColumnTitleValues = z.infer<typeof columnTitleSchema>;
