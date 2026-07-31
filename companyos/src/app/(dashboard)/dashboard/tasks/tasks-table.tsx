"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { TaskPriority, TaskStatus } from "@prisma/client";
import { deleteTaskAction, updateTaskAction } from "@/app/(dashboard)/dashboard/tasks/actions";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const STATUSES: TaskStatus[] = ["todo", "in_progress", "done", "cancelled"];
const PRIORITY_VARIANT: Record<TaskPriority, "outline" | "secondary" | "default" | "destructive"> = {
  low: "outline",
  medium: "secondary",
  high: "default",
  urgent: "destructive",
};

type Task = {
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: Date | null;
  assigneeName: string | null;
  leadId: string | null;
  leadTitle: string | null;
};

export function TasksTable({ tasks }: { tasks: Task[] }) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);

  async function handleStatusChange(taskId: string, status: TaskStatus) {
    setPendingId(taskId);
    const result = await updateTaskAction(taskId, { status });
    setPendingId(null);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    router.refresh();
  }

  async function handleDelete(taskId: string) {
    setPendingId(taskId);
    const result = await deleteTaskAction(taskId);
    setPendingId(null);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    toast.success("Task deleted");
    router.refresh();
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Title</TableHead>
          <TableHead>Lead</TableHead>
          <TableHead>Assignee</TableHead>
          <TableHead>Priority</TableHead>
          <TableHead>Due</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {tasks.length === 0 && (
          <TableRow>
            <TableCell colSpan={7} className="text-center text-muted-foreground">
              No tasks yet.
            </TableCell>
          </TableRow>
        )}
        {tasks.map((task) => (
          <TableRow key={task.id}>
            <TableCell className="font-medium">{task.title}</TableCell>
            <TableCell className="text-muted-foreground">
              {task.leadId ? (
                <Link href={`/dashboard/leads/${task.leadId}`} className="hover:underline">
                  {task.leadTitle}
                </Link>
              ) : (
                "—"
              )}
            </TableCell>
            <TableCell className="text-muted-foreground">{task.assigneeName ?? "Unassigned"}</TableCell>
            <TableCell>
              <Badge variant={PRIORITY_VARIANT[task.priority]} className="capitalize">
                {task.priority}
              </Badge>
            </TableCell>
            <TableCell className="text-muted-foreground">
              {task.dueDate ? new Date(task.dueDate).toLocaleDateString() : "—"}
            </TableCell>
            <TableCell>
              <Select
                value={task.status}
                onValueChange={(status) => handleStatusChange(task.id, status as TaskStatus)}
                disabled={pendingId === task.id}
              >
                <SelectTrigger aria-label={`Status for ${task.title}`} className="w-32 capitalize">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUSES.map((status) => (
                    <SelectItem key={status} value={status} className="capitalize">
                      {status.replace("_", " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </TableCell>
            <TableCell className="text-right">
              <Button
                variant="ghost"
                size="sm"
                disabled={pendingId === task.id}
                onClick={() => handleDelete(task.id)}
              >
                Delete
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
