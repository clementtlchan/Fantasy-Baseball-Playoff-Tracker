# GitHub Pages + Supabase

1. Run `SUPABASE_SETUP.sql` in Supabase SQL Editor.
2. Create an email/password user in Authentication > Users.
3. Copy that user's UUID and run:
   `insert into public.league_admins(user_id) values ('YOUR-AUTH-USER-UUID');`
4. Push this folder to GitHub and enable Pages from the main branch, root folder.

The publishable Supabase key is frontend-safe; RLS protects writes. Everyone can view teams, while only users in `league_admins` can modify teams/rosters.
