"use client";

import { forwardRef, useId } from "react";
import { cn } from "@/lib/cn";

/**
 * The multi-line twin of `Input`, same paper surface (DESIGN §4.6) and same
 * label/error wiring (DESIGN §7) — kept as its own primitive rather than a
 * prop on `Input` so neither has to branch on element type.
 */
export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  error?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ label, error, className, id, ...props }, ref) => {
    const autoId = useId();
    const textareaId = id ?? autoId;
    const errorId = `${textareaId}-error`;

    return (
      <div className="on-paper flex flex-col gap-1.5">
        <label
          htmlFor={textareaId}
          className="font-archivo text-[11px] font-bold uppercase tracking-[.12em] text-pencil"
        >
          {label}
        </label>
        <textarea
          ref={ref}
          id={textareaId}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className={cn(
            "min-h-[76px] resize-y rounded-[3px] border bg-card px-3 py-2",
            "font-archivo text-[14px] text-ink placeholder:text-faint",
            error ? "border-rule" : "border-card-edge",
            className
          )}
          {...props}
        />
        {error && (
          <p
            id={errorId}
            role="alert"
            className="font-courier text-[11px] text-rule"
          >
            {error}
          </p>
        )}
      </div>
    );
  }
);
Textarea.displayName = "Textarea";
