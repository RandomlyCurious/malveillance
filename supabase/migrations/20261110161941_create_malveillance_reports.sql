-- Déjà appliquée sur le projet Supabase « LP Tracker » (vgzednygshdyuyjzwawz).
-- Gardée ici pour l'historique du dépôt.

create table public.malveillance_reports (
  id                     bigint generated always as identity primary key,
  guild_id               text        not null,
  malveillant_discord_id text        not null,  -- la personne signalée
  malveillant_username   text,
  malveille_discord_id   text        not null,  -- la personne qui signale
  malveille_username     text,
  reported_at            timestamptz not null default now(),
  constraint malveillance_not_self check (malveillant_discord_id <> malveille_discord_id)
);

comment on table public.malveillance_reports is
  'Signalements Discord : malveille (auteur du report) déclare que malveillant a été malveillant avec lui. 1 report par couple et par heure.';

create index malveillance_reports_pair_idx
  on public.malveillance_reports (malveillant_discord_id, malveille_discord_id, reported_at desc);
create index malveillance_reports_malveillant_idx
  on public.malveillance_reports (malveillant_discord_id, reported_at desc);

-- Accès uniquement via la clé secrète (service_role) : aucune policy pour anon/authenticated
alter table public.malveillance_reports enable row level security;

-- Enregistre un report en respectant le cooldown d'1 h par couple, de façon atomique
create or replace function public.report_malveillance(
  p_guild_id text,
  p_malveillant_id text,
  p_malveillant_username text,
  p_malveille_id text,
  p_malveille_username text
)
returns table (status text, reported_at timestamptz, next_allowed_at timestamptz)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_cooldown constant interval := interval '1 hour';
  v_last timestamptz;
  v_new  timestamptz;
begin
  -- Verrou par couple pour éviter deux reports simultanés (double clic)
  perform pg_advisory_xact_lock(hashtextextended(p_malveillant_id || ':' || p_malveille_id, 0));

  select max(r.reported_at) into v_last
  from public.malveillance_reports r
  where r.malveillant_discord_id = p_malveillant_id
    and r.malveille_discord_id = p_malveille_id
    and r.reported_at > now() - v_cooldown;

  if v_last is not null then
    return query select 'cooldown'::text, v_last, v_last + v_cooldown;
    return;
  end if;

  insert into public.malveillance_reports
    (guild_id, malveillant_discord_id, malveillant_username, malveille_discord_id, malveille_username)
  values
    (p_guild_id, p_malveillant_id, p_malveillant_username, p_malveille_id, p_malveille_username)
  returning malveillance_reports.reported_at into v_new;

  return query select 'ok'::text, v_new, v_new + v_cooldown;
end;
$$;

revoke all on function public.report_malveillance(text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.report_malveillance(text, text, text, text, text) to service_role;
