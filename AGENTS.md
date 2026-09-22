<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Diamond Planning Project — Agent Engineering Rules

These rules apply to every change in this repository. Security, data integrity, RBAC, traceability, maintainability, and removal of dead code are acceptance criteria—not optional cleanup work.

## 1. Understand Before Editing

- Read the relevant implementation, database schema, migrations, tests, and project documentation before changing behavior.
- Trace the complete path: UI → API → authentication and authorization → service → database → audit log → downstream consumers.
- Reuse existing business rules, components, utilities, data models, and permission definitions. Do not create parallel implementations of the same concept.
- Preserve unrelated and uncommitted user changes. Avoid repository-wide formatting or mechanical rewrites unless explicitly requested.
- If a business rule is not confirmed, make it configurable or label it clearly as advisory, unavailable, or pending. Never invent authoritative behavior.

## 2. Security Is Mandatory

- Never hardcode secrets, credentials, tokens, private keys, connection strings, or sensitive customer data in source code, fixtures, tests, logs, screenshots, or documentation.
- Keep secrets server-side and load them through validated environment configuration. Never expose them through client bundles or public-prefixed variables.
- Treat every external value as untrusted, including request bodies, query parameters, headers, route parameters, file uploads, imported Fantasy ERP data, CSV/Excel content, and database text displayed in HTML.
- Validate inputs on the server with strict schemas, length and size limits, explicit enums, safe defaults, and rejection of unknown fields where appropriate.
- Use Prisma or parameterized queries. Never concatenate untrusted values into SQL or execute untrusted raw SQL.
- Prevent injection in HTML, CSV/spreadsheets, filenames, logs, filters, exports, and error messages.
- Do not expose stack traces, SQL details, credentials, internal paths, environment values, or sensitive identifiers to users.
- Apply appropriate request, upload, export, and batch limits. Rate-limit expensive or abuse-prone operations.
- Do not log sensitive records or complete payloads when identifiers and summaries are sufficient.
- Never weaken authentication, authorization, validation, or security controls merely to make a test pass.

## 3. Enforce RBAC End to End

- Every page, API route, query, mutation, export, sync, retry, unlock, approval, override, configuration change, and administration action must have an explicit permission decision.
- Authorization must be enforced on the server. Hiding or disabling a UI control is useful UX but is never a security boundary.
- The UI and backend must use the same centralized permission vocabulary and policy source.
- Follow least privilege. A role receives only the permissions required for its responsibilities.
- Do not assume an administrator may approve plans. Sensitive approval permissions must remain explicitly assignable and separable from system administration.
- Keep permissions granular where risk differs: view, run, create, update, approve, export, retry, unlock, override, and manage.
- Add positive and negative authorization tests for protected behavior, including cross-country, cross-lab, ownership, and status restrictions when applicable.
- Derive actor identity and scope from the authenticated server session, never from client-supplied user or role fields.

## 4. Protect Data Integrity

- Use database transactions for multi-step writes that must succeed or fail together.
- Make syncs, imports, retries, and webhook-like operations idempotent.
- Use database-enforced atomic locks or claims for concurrent work. Do not depend on process-local memory for correctness.
- Use owner tokens or equivalent safeguards so one worker cannot release another worker's lock.
- Keep synchronization checkpoints monotonic and advance them only after the related data is committed successfully.
- Preserve immutable history and audit records. Do not cascade-delete permanent operational or approval history.
- Use deterministic business identities and database uniqueness constraints to prevent duplicates.
- Store canonical timestamps in UTC and convert to IST only for display or explicitly documented business cutoffs.
- Never interpret a record missing from an incremental feed as sold, deleted, or unavailable without a confirmed source event or reconciliation rule.
- Do not silently map unknown source values into valid business categories. Quarantine or flag them for review.
- Prefer additive, backward-compatible migrations. Make destructive migrations explicit, reviewed, and safely reversible where possible.

## 5. Keep the Codebase Clean

- Do not leave dead, unused, abandoned, duplicate, commented-out, experimental, temporary, debug, mock-only, or placeholder code in production paths.
- When replacing an implementation, remove the obsolete implementation, imports, types, routes, flags, styles, tests, and documentation after confirming they have no remaining references.
- Search the repository for references before deleting or renaming shared code.
- Do not keep both old and new implementations unless a documented compatibility or rollout strategy requires both and both are tested.
- Prefer small, focused modules and functions with one clear responsibility.
- Use clear domain names. Avoid vague names such as data, item, temp, new, or handler2 when a precise business name is available.
- Comments should explain business rules, security decisions, or non-obvious constraints—not repeat the code.
- Do not add a dependency when the platform or an existing dependency already solves the problem safely.
- Remove temporary agent-generated files and diagnostic artifacts before completion.
- Never delete or rewrite unrelated user files, untracked work, or changes outside the requested scope.

## 6. Show Honest Product States

- Never display fabricated HEALTHY, success, zero-error, live, or current-time values when the underlying check has not run.
- Use explicit states such as NOT_RUN, UNKNOWN, STALE, DEGRADED, FAILED, and UNAVAILABLE.
- Clearly label fixture, simulation, demo, seeded, or fallback data in the UI and API responses.
- Do not claim a real Fantasy ERP connection while the application is using fixture simulation.
- Treat predictions and forecasts as advisory until their model, inputs, confidence, and validation are approved.

## 7. Design for Production-Scale Data

- Avoid unbounded database reads and in-memory processing of entire operational tables.
- Aggregate, filter, paginate, batch, and index at the database level.
- Never silently truncate results. Surface pagination, limits, and partial-result status clearly.
- Avoid N+1 queries and unnecessarily large JSON responses.
- Paginate trace, audit, history, issue, and export workflows.
- Add indexes and uniqueness constraints that match real filters, joins, sort orders, and idempotency keys.
- Assume multiple application instances and workers can run concurrently.

## 8. Tests Must Prove Real Behavior

- Exercise the real service or API path for the behavior under test; do not replace the subject with manually constructed records.
- Do not use unconditional assertions, placeholder tests, or tests that merely mirror implementation details.
- Concurrency tests must create genuine overlapping work.
- Rollback tests must inject a real failure inside the transaction and verify that partial writes are absent.
- Large-data tests must create enough data to exercise batching or pagination.
- Batch-size tests must vary the actual batch configuration.
- Authorization tests must cross the API or server-action boundary, not only inspect a permission array.
- Cover success, denial, validation failure, retry, idempotency, concurrency, rollback, empty state, and important boundary cases.
- Run destructive or cleanup tests only against an isolated test database and fail hard if the database cannot be proven safe.
- Never reset, truncate, seed over, or migrate a development or production database as part of automated tests.

## 9. Verify Before Declaring Completion

Run the checks relevant to the changed area, normally in this order:

1. Prisma schema validation and client generation when the schema or data layer changes.
2. Migrations against an isolated test database.
3. Focused behavioral and security tests for the changed feature.
4. Related regression tests.
5. Type checking.
6. Linting.
7. Production build when application behavior or bundling changes.

Only claim checks that were actually executed. Distinguish clearly between static review, simulated verification, and executed verification.

## 10. Completion Checklist

Before handing work back:

- Review the complete diff for secrets, debug output, temporary files, dead code, duplicate paths, and unrelated formatting changes.
- Confirm backend and UI RBAC decisions agree.
- Confirm failed operations leave data consistent and produce an appropriate audit trail.
- Confirm errors are safe for users and useful for operators.
- Confirm migrations preserve existing data and documented invariants.
- Confirm documentation, permission matrices, API contracts, and tests match the implemented behavior.
- State assumptions, deferred work, and checks that could not be run.
- Do not describe partial, mocked, simulated, or unverified work as complete.

## 11. Git and Publication Safety

- Agents must never run `git commit`, `git push`, force-push, create or push tags, publish releases, or open pull requests for this repository.
- Leave all implementation changes uncommitted in the working tree so the user can inspect and commit them personally.
- Do not stage files with `git add` unless the user asks only for a staging preview; never convert staging into a commit.
- Never add or commit chat prompts, copied prompt files, agent session notes, completion reports, audit scratch files, temporary Markdown, or generated instruction drafts to Git or GitHub.
- Do not create repository Markdown files merely to store a prompt or the agent's report.
- Existing project documentation may be edited only when the user explicitly requests a documentation change. Those edits must still remain uncommitted and unpushed.
- `AGENTS.md` may be updated when the user explicitly asks to change agent rules, but the agent must not commit or push it.
- Git status, diff, log, and other read-only inspection commands are allowed.
