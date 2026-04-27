-- Migration 004: Enable full replica identity for realtime UPDATE/DELETE events
-- Without this, Supabase Realtime only reliably fires INSERT events

alter table event_sessions replica identity full;
alter table checklist_items replica identity full;
alter table tasks replica identity full;
alter table zones replica identity full;
alter table operators replica identity full;
