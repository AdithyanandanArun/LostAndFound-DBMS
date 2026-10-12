# Lost & Found Platform

A static Lost & Found app hosted on GitHub Pages, using Supabase Auth, Postgres, and Storage.

## Supabase setup

1. Create a Supabase project.
2. In the SQL Editor, run [`db/migrations/001_initial_schema.sql`](db/migrations/001_initial_schema.sql). This creates the tables, auth profile trigger, row level security policies, and the public `item-images` bucket.
3. Copy the Project URL and anon/public key from **Project Settings → API** into `config.js`. The anon key is intended for browser use; never put a `service_role` key in this repository.
4. In **Authentication → URL Configuration**, set the GitHub Pages URL as the Site URL and add it to the Redirect URLs. For a project repository the URL is `https://OWNER.github.io/REPOSITORY/`.
5. Configure email confirmation and password reset email templates as desired in Supabase Auth.

`config.js` is public. RLS is what protects user-owned changes. Review and keep the policies in the migration enabled before deploying.

## Deploy to GitHub Pages

The repository includes a Pages workflow in `.github/workflows/pages.yml`. In GitHub, select **Settings → Pages → Build and deployment → GitHub Actions**, then push to `main`. The workflow publishes the static files; no server or build secrets are required. GitHub Pages URLs and page links are relative so this works from a repository subpath.

## Local development

Serve the repository root over HTTP (ES modules do not work reliably from `file://`):

```sh
python -m http.server 8000
```

Then open `http://localhost:8000`. Add that origin to Supabase Auth's allowed redirect URLs if using password reset locally.

## Existing Firebase data

The app no longer reads or writes Firebase. Existing Firebase accounts, posts, and images have not been transferred; the demo starts with a fresh Supabase database. See [`db/README.md`](db/README.md) for the schema overview.

## Current functionality

- Email/password signup, login, logout, and password reset through Supabase Auth
- Public lost/found listings and search
- Authenticated item creation, editing, deletion, and status updates
- Item photos in Supabase Storage
- Public contact form saved to Postgres
- Owner scoped operations enforced by Postgres RLS

Claims, messaging, notifications, and moderation tables are schema groundwork; the UI for those workflows is not implemented yet.
