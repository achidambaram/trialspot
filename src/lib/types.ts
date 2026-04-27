// ============================================================
// CORE ENTITIES
// ============================================================

export type SessionStatus = "SETUP" | "ACTIVE" | "REVIEW" | "CLOSED";
export type Readiness = "READY" | "PARTIAL" | "BLOCKED" | "UNKNOWN";
export type Criticality = "critical" | "required" | "nice_to_have";
export type ItemStatus = "unverified" | "verified" | "flagged";
export type TaskType = "missing_item" | "contradiction" | "skipped_zone";
export type TaskStatus = "open" | "resolved";
export type AlertType = "blocker" | "missed_check" | "contradiction" | "verdict";
export type AlertSeverity = "warning" | "critical";

export type ActivityType =
  | "inspection_update"
  | "zone_enter"
  | "zone_exit"
  | "alert_fired"
  | "readiness_changed"
  | "task_created"
  | "task_resolved"
  | "raw_input"
  | "contradiction_detected";

export interface EventSession {
  id: string;
  name: string;
  status: SessionStatus;
  room_name: string;
  readiness: Readiness;
  created_at: string;
  updated_at: string;
}

export interface Zone {
  id: string;
  event_id: string;
  name: string;
  label: string;
}

export interface ChecklistItem {
  id: string;
  event_id: string;
  zone_id: string;
  name: string;
  label: string;
  criticality: Criticality;
  status: ItemStatus;
  verified_at: string | null;
  verified_in_zone: string | null;
  note: string | null;
}

export interface Task {
  id: string;
  event_id: string;
  type: TaskType;
  status: TaskStatus;
  title: string;
  description: string;
  related_item_id: string | null;
  related_zone_id: string | null;
  assigned_to: string | null;
  created_at: string;
  resolved_at: string | null;
}

export interface ActivityEvent {
  id: string;
  event_id: string;
  type: ActivityType;
  payload: Record<string, unknown>;
  timestamp: string;
}

export interface UserPathEvent {
  id: string;
  event_id: string;
  zone_id: string;
  action: "enter" | "exit";
  timestamp: string;
  dwell_ms: number | null;
}

export interface SpatialRealAlert {
  id: string;
  event_id: string;
  type: AlertType;
  message: string;
  severity: AlertSeverity;
  fired_at: string;
  related_item_id: string | null;
  related_zone_id: string | null;
}

// ============================================================
// OPERATORS
// ============================================================

export interface Operator {
  id: string;
  event_id: string;
  name: string;
  device_id: string;
  connected_at: string;
  last_seen_at: string;
  current_zone_id: string | null;
  is_active: boolean;
}

// ============================================================
// OPERATOR CAPTURES
// ============================================================

export interface OperatorCapture {
  id: string;
  event_id: string;
  operator_id: string | null;
  image_base64: string;
  mime_type: string;
  scene_description: string | null;
  zone_detected: string | null;
  items_verified: string[];
  issues: string[];
  captured_at: string;
}

// ============================================================
// SPATIAL STATE
// ============================================================

export interface SpatialSnapshot {
  current_zone: string | null;
  zones_visited: string[];
  zones_never_visited: string[];
  zone_dwell: Record<string, number>;
}

// ============================================================
// BODHI CONTRACT
// ============================================================

export interface BodhiParsedUpdate {
  item_id: string | null;
  status: "verified" | "flagged";
  zone_hint: string | null;
  note: string;
  confidence: number;
  raw_text: string;
}
