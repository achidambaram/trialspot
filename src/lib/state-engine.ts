import type {
  ChecklistItem,
  Readiness,
  SpatialSnapshot,
  Zone,
  BodhiParsedUpdate,
} from "./types";
import { createServerClient } from "./supabase";

// ============================================================
// READINESS COMPUTATION — Pure function, no side effects
// ============================================================

export function computeReadiness(
  items: ChecklistItem[],
  spatial: SpatialSnapshot
): Readiness {
  // Before any inspection
  const hasAnyVerified = items.some((i) => i.status === "verified");
  if (!hasAnyVerified) return "UNKNOWN";

  // BLOCKED: any critical item not verified
  const critical = items.filter((i) => i.criticality === "critical");
  if (critical.some((i) => i.status !== "verified")) return "BLOCKED";

  // PARTIAL: required items missing OR zones unvisited
  const required = items.filter((i) => i.criticality === "required");
  if (required.some((i) => i.status !== "verified")) return "PARTIAL";
  if (spatial.zones_never_visited.length > 0) return "PARTIAL";

  return "READY";
}

// ============================================================
// SPATIAL SNAPSHOT — Computed from path events
// ============================================================

export async function computeSpatialSnapshot(
  eventId: string,
  allZones: Zone[]
): Promise<SpatialSnapshot> {
  const db = createServerClient();

  const { data: pathEvents } = await db
    .from("user_path_events")
    .select("*")
    .eq("event_id", eventId)
    .order("timestamp", { ascending: true });

  const events = pathEvents || [];
  const zoneIds = allZones.map((z) => z.id);

  // Determine current zone: last event should be an "enter" without a matching "exit"
  let currentZone: string | null = null;
  const visitedSet = new Set<string>();
  const enterTimes: Record<string, string> = {};
  const dwellMs: Record<string, number> = {};

  for (const e of events) {
    if (e.action === "enter") {
      currentZone = e.zone_id;
      visitedSet.add(e.zone_id);
      enterTimes[e.zone_id] = e.timestamp;
    } else if (e.action === "exit") {
      if (currentZone === e.zone_id) {
        currentZone = null;
      }
      // Accumulate dwell time
      if (enterTimes[e.zone_id]) {
        const enterTime = new Date(enterTimes[e.zone_id]).getTime();
        const exitTime = new Date(e.timestamp).getTime();
        dwellMs[e.zone_id] = (dwellMs[e.zone_id] || 0) + (exitTime - enterTime);
        delete enterTimes[e.zone_id];
      }
    }
  }

  const zonesVisited = Array.from(visitedSet);
  const zonesNeverVisited = zoneIds.filter((id) => !visitedSet.has(id));

  return {
    current_zone: currentZone,
    zones_visited: zonesVisited,
    zones_never_visited: zonesNeverVisited,
    zone_dwell: dwellMs,
  };
}

// ============================================================
// STATE ENGINE — Accepts updates, validates, persists, recomputes
// ============================================================

export async function acceptInspectionUpdate(
  eventId: string,
  parsed: BodhiParsedUpdate
): Promise<{ accepted: boolean; reason?: string }> {
  const db = createServerClient();

  // Reject low-confidence parses
  if (parsed.confidence < 0.6) {
    await db.from("activity_events").insert({
      event_id: eventId,
      type: "raw_input",
      payload: { raw_text: parsed.raw_text, confidence: parsed.confidence },
      timestamp: new Date().toISOString(),
    });
    return { accepted: false, reason: "Low confidence parse — please try again with more detail." };
  }

  // Reject if no item matched
  if (!parsed.item_id) {
    await db.from("activity_events").insert({
      event_id: eventId,
      type: "raw_input",
      payload: { raw_text: parsed.raw_text, note: "No checklist item matched" },
      timestamp: new Date().toISOString(),
    });
    return { accepted: false, reason: "Could not match to a checklist item." };
  }

  // Verify item exists and belongs to this event
  const { data: item } = await db
    .from("checklist_items")
    .select("*")
    .eq("id", parsed.item_id)
    .eq("event_id", eventId)
    .single();

  if (!item) {
    return { accepted: false, reason: "Checklist item not found." };
  }

  // Get current spatial state for verified_in_zone
  const { data: zones } = await db
    .from("zones")
    .select("*")
    .eq("event_id", eventId);
  const snapshot = await computeSpatialSnapshot(eventId, zones || []);

  // Update the checklist item
  const now = new Date().toISOString();
  await db
    .from("checklist_items")
    .update({
      status: parsed.status,
      verified_at: now,
      verified_in_zone: snapshot.current_zone,
      note: parsed.note,
    })
    .eq("id", parsed.item_id);

  // Log the activity
  await db.from("activity_events").insert({
    event_id: eventId,
    type: "inspection_update",
    payload: {
      item_id: parsed.item_id,
      item_name: item.name,
      item_label: item.label,
      status: parsed.status,
      note: parsed.note,
      zone: snapshot.current_zone,
      confidence: parsed.confidence,
    },
    timestamp: now,
  });

  // Auto-resolve related open tasks when item is verified
  if (parsed.status === "verified") {
    await db
      .from("tasks")
      .update({ status: "resolved", resolved_at: now })
      .eq("event_id", eventId)
      .eq("related_item_id", parsed.item_id)
      .eq("status", "open");

    // Log task resolution
    const { data: resolvedTasks } = await db
      .from("tasks")
      .select("id, title")
      .eq("event_id", eventId)
      .eq("related_item_id", parsed.item_id)
      .eq("status", "resolved");

    if (resolvedTasks && resolvedTasks.length > 0) {
      for (const t of resolvedTasks) {
        await db.from("activity_events").insert({
          event_id: eventId,
          type: "task_resolved",
          payload: { task_id: t.id, task_title: t.title, resolved_by: "auto" },
          timestamp: now,
        });
      }
    }
  }

  // Recompute readiness
  await recomputeReadiness(eventId);

  return { accepted: true };
}

export async function recomputeReadiness(eventId: string): Promise<Readiness> {
  const db = createServerClient();

  const { data: items } = await db
    .from("checklist_items")
    .select("*")
    .eq("event_id", eventId);

  const { data: zones } = await db
    .from("zones")
    .select("*")
    .eq("event_id", eventId);

  const snapshot = await computeSpatialSnapshot(eventId, zones || []);
  const readiness = computeReadiness(items || [], snapshot);

  // Update session
  await db
    .from("event_sessions")
    .update({ readiness, updated_at: new Date().toISOString() })
    .eq("id", eventId);

  return readiness;
}
