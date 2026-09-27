<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Publication

For every user-requested change to this app, include publication in the task: run relevant checks, commit the intended files, integrate safely with `origin/main`, push `origin/main`, wait for a successful Vercel Production deployment, and verify the change at https://yks-tracker-puce.vercel.app/. Apply and verify required database migrations before deploying code that depends on them. If a step is blocked, report the exact blocker and keep the work recoverable.
