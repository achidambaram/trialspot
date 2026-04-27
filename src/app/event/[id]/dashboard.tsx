"use client";

import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import type {
  EventSession,
  Zone,
  ChecklistItem,
  Task,
  ActivityEvent,
  SpatialSnapshot,
  SpatialRealAlert,
  Operator,
} from "@/lib/types";
import { ChecklistPanel } from "./components/checklist-panel";
import { InteractiveMap } from "./components/interactive-map";
import { ActivityFeed } from "./components/activity-feed";
import { TaskList } from "./components/task-list";
import { ReadinessBadge } from "./components/readiness-badge";
import { OperatorControls } from "./components/operator-controls";
import { AlertBanner } from "./components/alert-banner";
import { VoiceClient } from "./components/voice-client";
import { AvatarPanel } from "./components/avatar-panel";
import { OperatorFeeds } from "./components/operator-feeds";

type RightTab = "voice" | "feeds" | "tasks" | "controls";

interface EventState {
  session: EventSession;
  zones: Zone[];
  items: ChecklistItem[];
  tasks: Task[];
  activities: ActivityEvent[];
  alerts: SpatialRealAlert[];
  spatial: SpatialSnapshot;
  operators: Operator[];
}

export function Dashboard({ eventId }: { eventId: string }) {
  const [state, setState] = useState<EventState | null>(null);
  const [loading, setLoading] = useState(true);
  const [latestAlert, setLatestAlert] = useState<SpatialRealAlert | null>(null);
  const [rightTab, setRightTab] = useState<RightTab>("feeds");
  const [liveOperatorIds, setLiveOperatorIds] = useState<Set<string>>(new Set());

  const fetchState = useCallback(async () => {
    const res = await fetch(`/api/event/${eventId}`);
    const data = await res.json();
    setState(data);
    setLoading(false);
  }, [eventId]);

  useEffect(() => {
    fetchState();
  }, [fetchState]);

  useEffect(() => {
    const channel = supabase
      .channel(`event:${eventId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "checklist_items", filter: `event_id=eq.${eventId}` }, () => fetchState())
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "activity_events", filter: `event_id=eq.${eventId}` }, () => fetchState())
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks", filter: `event_id=eq.${eventId}` }, () => fetchState())
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "alerts", filter: `event_id=eq.${eventId}` }, (payload) => {
        setLatestAlert(payload.new as SpatialRealAlert);
        fetchState();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "event_sessions", filter: `id=eq.${eventId}` }, () => fetchState())
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "user_path_events", filter: `event_id=eq.${eventId}` }, () => fetchState())
      .on("postgres_changes", { event: "*", schema: "public", table: "operators", filter: `event_id=eq.${eventId}` }, () => fetchState())
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "operator_captures", filter: `event_id=eq.${eventId}` }, () => fetchState())
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [eventId, fetchState]);

  if (loading || !state) {
    return (
      <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center">
        <p className="text-gray-400">Loading event...</p>
      </div>
    );
  }

  const openTasks = state.tasks.filter(t => t.status === "open").length;

  const tabs: { key: RightTab; label: string; badge?: number }[] = [
    { key: "voice", label: "Voice" },
    { key: "feeds", label: "Feeds", badge: liveOperatorIds.size || undefined },
    { key: "tasks", label: "Tasks", badge: openTasks || undefined },
    { key: "controls", label: "Manual" },
  ];

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col">
      {/* Header */}
      <header className="border-b border-gray-800 px-6 py-3 flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-lg font-bold">{state.session.name}</h1>
          <p className="text-xs text-gray-500">{state.session.room_name}</p>
        </div>
        <ReadinessBadge readiness={state.session.readiness} />
      </header>

      {/* Alert Banner */}
      {latestAlert && (
        <AlertBanner alert={latestAlert} onDismiss={() => setLatestAlert(null)} />
      )}

      {/* Main Layout: 3 columns */}
      <div className="flex-1 grid grid-cols-12 gap-3 p-3 min-h-0">

        {/* LEFT: Map + Checklist */}
        <div className="col-span-3 flex flex-col gap-3 min-h-0 overflow-auto">
          <InteractiveMap
            zones={state.zones}
            items={state.items}
            tasks={state.tasks}
            spatial={state.spatial}
            alerts={state.alerts}
            operators={state.operators.filter(op => liveOperatorIds.has(op.id))}
          />
          <ChecklistPanel items={state.items} zones={state.zones} />
        </div>

        {/* CENTER: Avatar + Activity Feed */}
        <div className="col-span-5 flex flex-col gap-3 min-h-0">
          {/* Avatar — compact bar at top */}
          <div className="shrink-0">
            <AvatarPanel
              alert={latestAlert}
              onAlertPlayed={() => setLatestAlert(null)}
            />
          </div>
          {/* Activity Feed — fills remaining space */}
          <div className="flex-1 min-h-0 overflow-auto">
            <ActivityFeed activities={state.activities} />
          </div>
        </div>

        {/* RIGHT: Tabbed panel */}
        <div className="col-span-4 flex flex-col gap-0 min-h-0">
          {/* Tab bar */}
          <div className="flex bg-gray-900 rounded-t-lg border-b border-gray-800 shrink-0">
            {tabs.map(tab => (
              <button
                key={tab.key}
                onClick={() => setRightTab(tab.key)}
                className={`flex-1 py-2 text-xs font-medium relative transition-colors ${
                  rightTab === tab.key
                    ? "text-white bg-gray-800"
                    : "text-gray-500 hover:text-gray-300"
                }`}
              >
                {tab.label}
                {tab.badge && (
                  <span className="ml-1 bg-red-600 text-white text-[9px] px-1.5 py-0.5 rounded-full">
                    {tab.badge}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="flex-1 min-h-0 overflow-auto bg-gray-900 rounded-b-lg">
            {rightTab === "voice" && <VoiceClient eventId={eventId} />}
            {/* Always mounted so broadcast subscription stays alive */}
            <div className={rightTab === "feeds" ? "" : "hidden"}>
              <OperatorFeeds
                operators={state.operators}
                zones={state.zones}
                eventId={eventId}
                onLiveOperatorsChange={setLiveOperatorIds}
              />
            </div>
            {rightTab === "tasks" && (
              <TaskList
                tasks={state.tasks}
                onResolve={async (taskId) => {
                  await fetch("/api/tasks/update", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ task_id: taskId, status: "resolved" }),
                  });
                }}
              />
            )}
            {rightTab === "controls" && (
              <OperatorControls
                eventId={eventId}
                zones={state.zones}
                spatial={state.spatial}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
