-- Migration 002: Multi-operator support

-- Operators table
create table if not exists operators (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references event_sessions(id) on delete cascade,
  name text not null,
  device_id text not null,
  connected_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  current_zone_id uuid references zones(id),
  is_active boolean not null default true
);

create index if not exists idx_operators_event on operators(event_id);
create unique index if not exists idx_operators_device on operators(event_id, device_id);

-- Add assigned_to column to tasks
alter table tasks add column if not exists assigned_to uuid references operators(id);

-- Enable realtime
alter publication supabase_realtime add table operators;

-- RLS (open for MVP)
alter table operators enable row level security;
create policy "Allow all" on operators for all using (true) with check (true);
