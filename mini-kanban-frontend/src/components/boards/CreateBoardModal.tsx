"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Button, Input, Modal, Textarea } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { useCreateBoard } from "@/lib/boards";
import { createBoardSchema, type CreateBoardValues } from "@/lib/schemas";

/**
 * The create-board dialog. The mutation itself is optimistic (see
 * `useCreateBoard`), so this closes the moment it fires rather than holding a
 * spinner over a board the user can already see on the shelf behind it.
 */
export function CreateBoardModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const create = useCreateBoard();

  const form = useForm<CreateBoardValues>({
    resolver: zodResolver(createBoardSchema),
    defaultValues: { title: "", description: "" },
    mode: "onSubmit",
  });

  const submit = form.handleSubmit((values) => {
    create.mutate(
      {
        title: values.title,
        description: values.description?.trim() || undefined,
      },
      {
        onError: (error) => {
          // The optimistic row has already been rolled back by the mutation;
          // all that is left is telling the user why the shelf went back.
          if (error instanceof ApiError && error.status === 429) {
            toast.error("Too many requests — wait a moment and try again.");
            return;
          }
          toast.error("Could not create that board.");
        },
      }
    );
    form.reset();
    onClose();
  });

  const close = () => {
    form.reset();
    onClose();
  };

  return (
    <Modal open={open} onClose={close} title="New board">
      <form noValidate onSubmit={submit} className="flex flex-col gap-4">
        <Input
          label="Name"
          placeholder="Q3 roadmap"
          autoComplete="off"
          error={form.formState.errors.title?.message}
          {...form.register("title")}
        />
        <Textarea
          label="Description"
          placeholder="Optional — what gets filed here."
          error={form.formState.errors.description?.message}
          {...form.register("description")}
        />

        <div className="mt-1 flex justify-end gap-2">
          <Button type="button" variant="paper" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" variant="primary">
            Create board
          </Button>
        </div>
      </form>
    </Modal>
  );
}
