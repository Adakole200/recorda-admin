# Recorda Developer Console

A separate site for monitoring the whole Recorda platform. Deploy it as its OWN
Vercel project so it is never mixed with the public app.

## Setup
1. In Supabase SQL Editor, make sure `schema_v2.sql` (from the main project) has been run.
2. Register on the main Recorda site with the email you want to use as developer.
3. Run this once in the SQL Editor (put your email in):
       insert into platform_admins (user_id)
       select id from auth.users where lower(email) = lower('YOUR_EMAIL_HERE');
4. Open `config.js`, paste the SAME Project URL and anon key used in the main app.
5. Upload this folder to a NEW GitHub repo (e.g. `recorda-admin`), import it in Vercel
   (Framework Preset: Other), and deploy.
6. Open the Vercel URL and sign in with the developer email and password.

## What you can do
- Overview: users, businesses, active businesses, sales volume, debts, errors,
  database and storage usage, 7/30/90-day charts, plan split, live activity feed,
  API round-trip time. Auto-refreshes every 60 seconds.
- Businesses: search/filter, change plan, suspend or unsuspend (suspended = read-only),
  export CSV.
- Users: search/filter (unconfirmed, no business yet, admins), export CSV.
- Errors: problems reported from users' browsers, with stack traces.
- Audit log: every plan change, suspension and clear-errors action.

## Security
- Anyone can open the URL, but every number comes from database functions that check
  on the server that you are a platform admin. Other accounts see "not a platform admin".
- Keep the URL to yourself and use a strong, unique password.
- To add another developer, run the insert above with their email.
- Never put the service_role key in config.js.
