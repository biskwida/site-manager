# Google Business Profile (Claudia)

## What it does

A venue connects its Google Business Profile ("Google listing") to Claudia from the dashboard or the chat.

- **Hours and holidays.** After the owner approves a change (new opening hours, a holiday added or removed), Claudia updates the opening hours and special days on the Google listing. Nothing is written without an approved change.
- **Review replies.** Claudia checks for new reviews every 15 minutes, drafts a reply and shows it to the owner. The reply is posted only after the owner approves it. Never automatically.

## Environment keys

| Key | What |
|---|---|
| `GOOGLE_CLIENT_ID` | OAuth client `claudia-web`, project `claudia-512010` |
| `GOOGLE_CLIENT_SECRET` | its secret |
| `DESTINATION_SECRET_KEY` | encrypts each venue's Google refresh token in the database (also used by WordPress and social connections) |

## Tanya's tasks, in this order

1. [ ] **Before the merge and the deploy**, apply the migration. Without it the deployed code cannot store Google reviews.
   - First check the name of the network constraint (the migration assumes it is named `social_comments_network_check`; if the name differs, tell the developer before applying):
     ```sql
     select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.social_comments'::regclass and contype = 'c';
     ```
   - Then apply: `npm run db:apply -- supabase/migrations/2026-10-31-google-reviews.sql`
2. [ ] In Google Cloud, OAuth client `claudia-web`, add both redirect URIs:
   - `https://site-manager-lovat.vercel.app/api/social/google/callback`
   - `https://getclaudia.app/api/social/google/callback`
3. [ ] On project `claudia-512010`, enable "My Business Business Information API", "My Business Account Management API" and "Google My Business API", and confirm the quota is 300 queries per minute.
4. [ ] Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (and `DESTINATION_SECRET_KEY`) in production.
5. [ ] Approve the privacy paragraph below for getclaudia.app/privacy (the page itself is not changed by this work).
6. [ ] Merge and deploy.
7. [ ] After the first connect, tell the Coffique owner.

## Draft privacy paragraph (for Tanya to approve)

> **Google Business Profile.** If you connect your Google Business Profile, Claudia stores the name and address of your listing, its opening hours, the name of the Google account that connected it, and your customers' reviews for at most 30 days. Reviews are used only to draft a reply that is shown to you; nothing is posted without your approval. Claudia uses the connection to update your opening hours and holidays and to post replies you approved. You can disconnect at any time in the dashboard or in your Google account's security settings; disconnecting takes effect immediately and Claudia then deletes the connection.

## Live check, in this order

Run by the developer against a real connected venue. Never from CI. The script never prints tokens, review text or reviewer names.

1. **Dry run** (no write to Google, only `validateOnly`):
   `npm run google:live -- --slug <slug>`
   Check the location, Google's hours against the website's week, `validateOnly: OK`, and the newest reviews.
2. **One real hours push and read-back**, only with Tanya's explicit go:
   `npm run google:live -- --slug <slug> --push`
   Prints `reviewing: yes|no` (Google may review the change before it shows).
3. **One review reply**, only with Tanya's explicit go:
   `npm run google:live -- --slug <slug> --reply "<review name from step 1>" --text "<reply>"`

## Known limits

- No menu, no Google posts, no `moreHours`, no "temporarily closed" status. Closures of 7 days or more are written as ordinary closed days and Claudia notes that Google's "temporarily closed" should be set by hand.
- A posted review reply cannot be deleted from the chat (undo of a reply set removes it, but there is no command for it).
- The connecting account's email is not stored, only its display name.
