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
