-- Preserve saved palettes and allow the two new neutral themes.
-- One ALTER statement replaces the check atomically; all profile values stay intact.
alter table public.profiles
  drop constraint profiles_theme_check,
  add constraint profiles_theme_check check (
    theme in ('graphite','rose','ocean','aurora','forest','burgundy','plum','pastel','steel','white','black')
  );
