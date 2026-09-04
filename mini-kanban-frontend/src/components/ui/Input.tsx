"use client";

import { forwardRef, useId } from "react";
import { cn } from "@/lib/cn";

/**
 * Paper surface (DESIGN §4.6): --card fill, --edge border, --ink text.
 * Errors use --rule. The label/description/error are wired to the input with
 * ids so screen readers announce them (DESIGN §7).
 */
export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, className, id, ...props }, ref) => {
    const autoId = useId();
    const inputId = id ?? autoId;
    const errorId = `${inputId}-error`;

    return (
      <div className="on-paper flex flex-col gap-1.5">
        <label
          htmlFor={inputId}
          className="font-archivo text-[11px] font-bold uppercase tracking-[.12em] text-pencil"
        >
          {label}
        </label>
        <input
          ref={ref}
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className={cn(
            "h-[38px] rounded-[3px] border bg-card px-3",
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
Input.displayName = "Input";
