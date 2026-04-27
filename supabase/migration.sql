-- TrialRun Supabase Schema
-- Run this in the Supabase SQL Editor to create all tables

-- Event Sessions
create table if not exists event_sessions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  status text not null default 'SETUP' check (status in ('SETUP', 'ACTIVE', 'REVIEW', 'CLOSED')),
  room_name text not null,
  readiness text not null default 'UNKNOWN' check (readiness in ('READY', 'PARTIAL', 'BLOCKED', 'UNKNOWN')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Zones
create table if not exists zones (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references event_sessions(id) on delete cascade,
  name text not null,
  label text not null
);

-- Checklist Items
create table if not exists checklist_items (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references event_sessions(id) on delete cascade,
  zone_id uuid not null references zones(id) on delete cascade,
  name text not null,
  label text not null,
  criticality text not null check (criticality in ('critical', 'required', 'nice_to_have')),
  status text not null default 'unverified' check (status in ('unverified', 'verified', 'flagged')),
  verified_at timestamptz,
  verified_in_zone uuid references zones(id),
  note text
);

-- Tasks
create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references event_sessions(id) on delete cascade,
  type text not null check (type in ('missing_item', 'contradiction', 'skipped_zone')),
  status text not null default 'open' check (status in ('open', 'resolved')),
  title text not null,
  description text not null,
  related_item_id uuid references checklist_items(id),
  related_zone_id uuid references zones(id),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

-- Activity Events
create table if not exists activity_events (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references event_sessions(id) on delete cascade,
  type text not null,
  payload jsonb not null default '{}',
  timestamp timestamptz not null default now()
);

-- User Path Events (spatial tracking)
create table if not exists user_path_events (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references event_sessions(id) on delete cascade,
  zone_id uuid not null references zones(id),
  action text not null check (action in ('enter', 'exit')),
  timestamp timestamptz not null default now(),
  dwell_ms integer
);

-- Alerts (SpatialReal)
create table if not exists alerts (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references event_sessions(id) on delete cascade,
  type text not null check (type in ('blocker', 'missed_check', 'contradiction', 'verdict')),
  message text not null,
  severity text not null check (severity in ('warning', 'critical')),
  fired_at timestamptz not null default now(),
  related_item_id uuid references checklist_items(id),
  related_zone_id uuid references zones(id)
);

-- Indexes for common queries
create index if not exists idx_checklist_event on checklist_items(event_id);
create index if not exists idx_tasks_event on tasks(event_id);
create index if not exists idx_activity_event on activity_events(event_id);
create index if not exists idx_path_event on user_path_events(event_id);
create index if not exists idx_alerts_event on alerts(event_id);
create index if not exists idx_zones_event on zones(event_id);

-- Enable Realtime on all tables
alter publication supabase_realtime add table event_sessions;
alter publication supabase_realtime add table checklist_items;
alter publication supabase_realtime add table tasks;
alter publication supabase_realtime add table activity_events;
alter publication supabase_realtime add table user_path_events;
alter publication supabase_realtime add table alerts;
alter publication supabase_realtime add table zones;

-- Disable RLS for MVP (no auth)
alter table event_sessions enable row level security;
alter table zones enable row level security;
alter table checklist_items enable row level security;
alter table tasks enable row level security;
alter table activity_events enable row level security;
alter table user_path_events enable row level security;
alter table alerts enable row level security;

-- Allow all access (MVP — no auth)
create policy "Allow all" on event_sessions for all using (true) with check (true);
create policy "Allow all" on zones for all using (true) with check (true);
create policy "Allow all" on checklist_items for all using (true) with check (true);
create policy "Allow all" on tasks for all using (true) with check (true);
create policy "Allow all" on activity_events for all using (true) with check (true);
create policy "Allow all" on user_path_events for all using (true) with check (true);
create policy "Allow all" on alerts for all using (true) with check (true);
