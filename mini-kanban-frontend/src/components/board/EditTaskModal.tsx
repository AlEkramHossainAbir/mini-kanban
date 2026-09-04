"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { Button, ConfirmDialog, Input, Modal, Textarea } from "@/components/ui";
import { taskSchema, type TaskValues } from "@/lib/schemas";
import { useDeleteTask, useUpdateTask } from "@/lib/tasks";
import type { Task } from "@/lib/types";

/**
 * The task edit dialog (frontend ROADMAP Phase 9) — title + description via
 * `PATCH /tasks/:id`, plus delete behind a nested confirm step so a single
 * misclick can't fire an unrecoverable delete (PLAN §6: task deletion has
 * no undo). Opened by clicking a card; `useSortable`'s 4px activation
 * distance (DESIGN §6) is what keeps a plain click from being swallowed by
 * the drag sensor.
 */
export function EditTaskModal({
  task,
  boardId,
  open,
  onClose,
}: {
  task: Task | null;
  boardId: string;
  open: boolean;
  onClose: () => void;
}) {
  const update = useUpdateTask(boardId);
  const deleteTask = useDeleteTask(boardId);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const form = useForm<TaskValues>({
    resolver: zodResolver(taskSchema),
    defaultValues: { title: "", description: "" },
  });

  // Re-seed whenever a (possibly different) task opens — `task` stays fixed
  // for the lifetime of one open, so this only fires on open/task-id change,
  // never on every keystroke.
  useEffect(() => {
    if (open && task) {
      form.reset({ title: task.title, description: task.description ?? "" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, task?.id]);

  if (!task) return null;

  const submit = form.handleSubmit((values) => {
    update.mutate({
      taskId: task.id,
      title: values.title,
      description: values.description?.trim() || undefined,
    });
    onClose();
  });

  return (
    <>
      <Modal open={open && !confirmingDelete} onClose={onClose} title="Edit card">
        <form noValidate onSubmit={submit} className="flex flex-col gap-4">
          <Input
            label="Title"
            autoComplete="off"
            error={form.formState.errors.title?.message}
            {...form.register("title")}
          />
          <Textarea
            label="Description"
            placeholder="Optional"
            error={form.formState.errors.description?.message}
            {...form.register("description")}
          />

          <div className="mt-1 flex items-center justify-between gap-2 border-t border-hair pt-4">
            <Button type="button" variant="paper" onClick={() => setConfirmingDelete(true)}>
              Delete
            </Button>
            <div className="flex gap-2">
              <Button type="button" variant="paper" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" variant="primary">
                Save
              </Button>
            </div>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={open && confirmingDelete}
        title="Delete this card?"
        description="This can't be undone."
        loading={deleteTask.isPending}
        onClose={() => setConfirmingDelete(false)}
        onConfirm={() => {
          deleteTask.mutate(task.id);
          setConfirmingDelete(false);
          onClose();
        }}
      />
    </>
  );
}
