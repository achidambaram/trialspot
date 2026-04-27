-- Migration 003: Operator captures for command center feeds

create table if not exists operator_captures (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references event_sessions(id) on delete cascade,
  operator_id uuid references operators(id) on delete set null,
  image_base64 text not null,
  mime_type text not null default 'image/jpeg',
  scene_description text,
  zone_detected text,
  items_verified text[] not null default '{}',
  issues text[] not null default '{}',
  captured_at timestamptz not null default now()
);

create index if not exists idx_captures_event on operator_captures(event_id);
create index if not exists idx_captures_operator on operator_captures(operator_id);
create index if not exists idx_captures_time on operator_captures(captured_at desc);

-- Enable realtime
alter publication supabase_realtime add table operator_captures;

-- RLS (open for MVP)
alter table operator_captures enable row level security;
create policy "Allow all" on operator_captures for all using (true) with check (true);
