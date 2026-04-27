import type {
  ChecklistItem,
  SpatialSnapshot,
  Zone,
  BodhiParsedUpdate,
  SpatialRealAlert,
  Task,
  AlertSeverity,
} from "./types";
import { createServerClient } from "./supabase";

// ============================================================
// DETECTION TYPES
// ============================================================

interface MissedCheck {
  item_id: string;
  item_label: string;
  zone_id: string;
  severity: AlertSeverity;
}

interface Contradiction {
  item_id: string;
  item_label: string;
  item_zone_id: string;
  current_zone: string | null;
  severity: AlertSeverity;
}

interface SkippedZone {
  zone_id: string;
  zone_label: string;
  severity: AlertSeverity;
}

// ============================================================
// RULE 1: Missed Checks (on zone exit)
// ============================================================

export function detectMissedChecks(
  exitedZoneId: string,
  items: ChecklistItem[]
): MissedCheck[] {
  return items
    .filter(
      (i) =>
        i.zone_id === exitedZoneId &&
        i.status === "unverified" &&
        i.criticality !== "nice_to_have"
    )
    .map((i) => ({
      item_id: i.id,
      item_label: i.label,
      zone_id: exitedZoneId,
      severity: i.criticality === "critical" ? "critical" as const : "warning" as const,
    }));
}

// ============================================================
// RULE 2: Contradiction (on inspection update)
// ============================================================

export function detectContradiction(
  item: ChecklistItem,
  snapshot: SpatialSnapshot
): Contradiction | null {
  const itemZone = item.zone_id;
  const currentZone = snapshot.current_zone;

  // Only flag if the item's zone was NEVER visited
  if (
    itemZone !== currentZone &&
    !snapshot.zones_visited.includes(itemZone)
  ) {
    return {
      item_id: item.id,
      item_label: item.label,
      item_zone_id: itemZone,
      current_zone: currentZone,
      severity: "critical",
    };
  }
  return null;
}

// ============================================================
// RULE 3: Skipped Zones (on verdict)
// ============================================================

export function detectSkippedZones(
  snapshot: SpatialSnapshot,
  zones: Zone[]
): SkippedZone[] {
  return snapshot.zones_never_visited.map((zoneId) => {
    const zone = zones.find((z) => z.id === zoneId);
    return {
      zone_id: zoneId,
      zone_label: zone?.label || zoneId,
      severity: "warning" as const,
    };
  });
}

// ============================================================
// ALERT + TASK GENERATION
// ============================================================

import { distributeTasks } from "./task-distributor";

export async function handleZoneExit(
  eventId: string,
  exitedZoneId: string
): Promise<SpatialRealAlert[]> {
  const db = createServerClient();

  const { data: items } = await db
    .from("checklist_items")
    .select("*")
    .eq("event_id", eventId)
    .eq("zone_id", exitedZoneId);

  const missed = detectMissedChecks(exitedZoneId, items || []);
  if (missed.length === 0) return [];

  const { data: zone } = await db
    .from("zones")
    .select("*")
    .eq("id", exitedZoneId)
    .single();

  const zoneName = zone?.label || exitedZoneId;
  const missedLabels = missed.map((m) => m.item_label).join(", ");
  const worstSeverity = missed.some((m) => m.severity === "critical")
    ? "critical"
    : "warning";

  const message = `You left ${zoneName} without verifying: ${missedLabels}.`;
  const now = new Date().toISOString();

  // Create alert
  const { data: alert } = await db
    .from("alerts")
    .insert({
      event_id: eventId,
      type: "missed_check",
      message,
      severity: worstSeverity,
      fired_at: now,
      related_item_id: missed[0].item_id,
      related_zone_id: exitedZoneId,
    })
    .select()
    .single();

  // Log activity
  await db.from("activity_events").insert({
    event_id: eventId,
    type: "alert_fired",
    payload: { alert_type: "missed_check", message, zone_id: exitedZoneId },
    timestamp: now,
  });

  // Create tasks for each missed item
  for (const m of missed) {
    // Check for existing open task for this item
    const { data: existing } = await db
      .from("tasks")
      .select("id")
      .eq("event_id", eventId)
      .eq("related_item_id", m.item_id)
      .eq("status", "open")
      .maybeSingle();

    if (!existing) {
      await db.from("tasks").insert({
        event_id: eventId,
        type: "missing_item",
        status: "open",
        title: `Verify: ${m.item_label}`,
        description: `This item was not checked when you were in ${zoneName}.`,
        related_item_id: m.item_id,
        related_zone_id: exitedZoneId,
        created_at: now,
      });

      await db.from("activity_events").insert({
        event_id: eventId,
        type: "task_created",
        payload: { item_id: m.item_id, item_label: m.item_label, zone_id: exitedZoneId },
        timestamp: now,
      });
    }
  }

  // Redistribute tasks after new ones are created
  await distributeTasks(eventId);

  return alert ? [alert] : [];
}

export async function handleContradictionCheck(
  eventId: string,
  parsed: BodhiParsedUpdate,
  item: ChecklistItem,
  snapshot: SpatialSnapshot
): Promise<SpatialRealAlert | null> {
  const contradiction = detectContradiction(item, snapshot);
  if (!contradiction) return null;

  const db = createServerClient();
  const now = new Date().toISOString();

  const { data: itemZone } = await db
    .from("zones")
    .select("label")
    .eq("id", item.zone_id)
    .single();

  const message = `You reported "${item.label}" but haven't visited ${itemZone?.label || item.zone_id}.`;

  const { data: alert } = await db
    .from("alerts")
    .insert({
      event_id: eventId,
      type: "contradiction",
      message,
      severity: "critical",
      fired_at: now,
      related_item_id: item.id,
      related_zone_id: item.zone_id,
    })
    .select()
    .single();

  await db.from("activity_events").insert({
    event_id: eventId,
    type: "contradiction_detected",
    payload: {
      item_id: item.id,
      item_label: item.label,
      item_zone: item.zone_id,
      current_zone: snapshot.current_zone,
    },
    timestamp: now,
  });

  // Create contradiction task
  await db.from("tasks").insert({
    event_id: eventId,
    type: "contradiction",
    status: "open",
    title: `Resolve: ${item.label}`,
    description: message,
    related_item_id: item.id,
    related_zone_id: item.zone_id,
    created_at: now,
  });

  return alert;
}

export async function handleVerdict(
  eventId: string
): Promise<{
  readiness: string;
  alerts: SpatialRealAlert[];
  tasks: Task[];
}> {
  const db = createServerClient();

  const { data: items } = await db
    .from("checklist_items")
    .select("*")
    .eq("event_id", eventId);

  const { data: zones } = await db
    .from("zones")
    .select("*")
    .eq("event_id", eventId);

  const { computeSpatialSnapshot, recomputeReadiness } = await import("./state-engine");
  const snapshot = await computeSpatialSnapshot(eventId, zones || []);

  // Detect skipped zones
  const skipped = detectSkippedZones(snapshot, zones || []);

  // Detect all unverified critical/required items
  const unverified = (items || []).filter(
    (i) => i.status !== "verified" && i.criticality !== "nice_to_have"
  );

  const now = new Date().toISOString();
  const alerts: SpatialRealAlert[] = [];

  // Create tasks for skipped zones
  for (const s of skipped) {
    const { data: existing } = await db
      .from("tasks")
      .select("id")
      .eq("event_id", eventId)
      .eq("type", "skipped_zone")
      .eq("related_zone_id", s.zone_id)
      .eq("status", "open")
      .maybeSingle();

    if (!existing) {
      await db.from("tasks").insert({
        event_id: eventId,
        type: "skipped_zone",
        status: "open",
        title: `Visit: ${s.zone_label}`,
        description: `This zone was never visited during inspection.`,
        related_zone_id: s.zone_id,
        created_at: now,
      });
    }
  }

  // Recompute final readiness
  const readiness = await recomputeReadiness(eventId);

  // Build verdict message
  let message: string;
  if (readiness === "READY") {
    message = "Room is READY. All items verified, all zones checked.";
  } else if (readiness === "BLOCKED") {
    const blockers = unverified
      .filter((i) => i.criticality === "critical")
      .map((i) => i.label);
    const remaining = unverified
      .filter((i) => i.criticality === "required")
      .map((i) => i.label);
    const parts: string[] = ["Room is NOT READY."];
    if (blockers.length > 0) {
      parts.push(
        `${blockers.length} blocker${blockers.length > 1 ? "s" : ""}: ${blockers.join(", ")}.`
      );
    }
    if (remaining.length > 0) {
      parts.push(`${remaining.length} required item${remaining.length > 1 ? "s" : ""} remaining.`);
    }
    if (skipped.length > 0) {
      parts.push(`${skipped.length} zone${skipped.length > 1 ? "s" : ""} never visited.`);
    }
    message = parts.join(" ");
  } else {
    const remaining = unverified.map((i) => i.label);
    const parts: string[] = ["Room is partially ready."];
    if (remaining.length > 0) {
      parts.push(`${remaining.length} item${remaining.length > 1 ? "s" : ""} still need verification.`);
    }
    if (skipped.length > 0) {
      parts.push(`${skipped.length} zone${skipped.length > 1 ? "s" : ""} not visited.`);
    }
    message = parts.join(" ");
  }

  // Fire verdict alert
  const { data: verdictAlert } = await db
    .from("alerts")
    .insert({
      event_id: eventId,
      type: "verdict",
      message,
      severity: readiness === "READY" ? "warning" : "critical",
      fired_at: now,
    })
    .select()
    .single();

  if (verdictAlert) alerts.push(verdictAlert);

  await db.from("activity_events").insert({
    event_id: eventId,
    type: "alert_fired",
    payload: { alert_type: "verdict", message, readiness },
    timestamp: now,
  });

  // Update session status to REVIEW
  await db
    .from("event_sessions")
    .update({ status: "REVIEW", updated_at: now })
    .eq("id", eventId);

  // Fetch all open tasks
  const { data: tasks } = await db
    .from("tasks")
    .select("*")
    .eq("event_id", eventId)
    .eq("status", "open");

  // Redistribute all tasks after verdict
  await distributeTasks(eventId);

  return { readiness, alerts, tasks: tasks || [] };
}
