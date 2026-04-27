import { createServerClient } from "./supabase";

interface Operator {
  id: string;
  name: string;
  is_active: boolean;
}

interface Task {
  id: string;
  assigned_to: string | null;
}

/**
 * Distribute open tasks evenly across active operators.
 * 12 tasks / 3 operators = 4 each
 * 11 tasks / 3 operators = 4, 4, 3
 */
export async function distributeTasks(eventId: string): Promise<void> {
  const db = createServerClient();

  // Get active operators
  const { data: operators } = await db
    .from("operators")
    .select("id, name, is_active")
    .eq("event_id", eventId)
    .eq("is_active", true)
    .order("connected_at", { ascending: true });

  if (!operators || operators.length === 0) return;

  // Get open tasks
  const { data: tasks } = await db
    .from("tasks")
    .select("id, assigned_to")
    .eq("event_id", eventId)
    .eq("status", "open")
    .order("created_at", { ascending: true });

  if (!tasks || tasks.length === 0) return;

  // Calculate distribution
  const numOperators = operators.length;
  const numTasks = tasks.length;
  const baseCount = Math.floor(numTasks / numOperators);
  const remainder = numTasks % numOperators;

  // Build assignment: first `remainder` operators get baseCount+1, rest get baseCount
  const assignments: { taskId: string; operatorId: string }[] = [];
  let taskIndex = 0;

  for (let i = 0; i < numOperators; i++) {
    const count = i < remainder ? baseCount + 1 : baseCount;
    for (let j = 0; j < count && taskIndex < numTasks; j++) {
      assignments.push({
        taskId: tasks[taskIndex].id,
        operatorId: operators[i].id,
      });
      taskIndex++;
    }
  }

  // Apply assignments
  for (const { taskId, operatorId } of assignments) {
    await db
      .from("tasks")
      .update({ assigned_to: operatorId })
      .eq("id", taskId);
  }
}
