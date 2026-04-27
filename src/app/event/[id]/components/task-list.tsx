import type { Task } from "@/lib/types";

const typeLabel: Record<string, string> = {
  missing_item: "Missing",
  contradiction: "Contradiction",
  skipped_zone: "Skipped Zone",
};

const typeBg: Record<string, string> = {
  missing_item: "bg-yellow-900/20 border-yellow-700/30",
  contradiction: "bg-red-900/20 border-red-700/30",
  skipped_zone: "bg-blue-900/20 border-blue-700/30",
};

export function TaskList({
  tasks,
  onResolve,
}: {
  tasks: Task[];
  onResolve: (taskId: string) => void;
}) {
  const openTasks = tasks.filter((t) => t.status === "open");
  const resolvedTasks = tasks.filter((t) => t.status === "resolved");

  return (
    <div className="bg-gray-900 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wide">
          Tasks
        </h2>
        <span className="text-xs text-gray-500">
          {openTasks.length} open
        </span>
      </div>

      {openTasks.length === 0 && resolvedTasks.length === 0 && (
        <p className="text-sm text-gray-600">No tasks yet.</p>
      )}

      <div className="space-y-2">
        {openTasks.map((task) => (
          <div
            key={task.id}
            className={`${typeBg[task.type]} border rounded-lg p-3`}
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] text-gray-400 uppercase">
                    {typeLabel[task.type]}
                  </span>
                </div>
                <p className="text-sm text-gray-200">{task.title}</p>
                <p className="text-xs text-gray-500 mt-1">
                  {task.description}
                </p>
              </div>
              <button
                onClick={() => onResolve(task.id)}
                className="text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 px-2 py-1 rounded shrink-0"
              >
                Resolve
              </button>
            </div>
          </div>
        ))}

        {resolvedTasks.length > 0 && (
          <div className="mt-3 pt-3 border-t border-gray-800">
            <p className="text-xs text-gray-600 mb-2">
              Resolved ({resolvedTasks.length})
            </p>
            {resolvedTasks.map((task) => (
              <div
                key={task.id}
                className="text-xs text-gray-600 line-through py-0.5"
              >
                {task.title}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
