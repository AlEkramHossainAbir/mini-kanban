import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** clsx + tailwind-merge: conditional classes that also de-duplicate when a
 *  caller overrides one (`className` on a primitive wins). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
