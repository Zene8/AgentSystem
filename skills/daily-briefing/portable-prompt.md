# Portable daily-briefing prompt

Paste the block below into any AI's scheduled-task feature (Grok Tasks, Gemini
scheduled prompts, a cron'd Claude, etc.). It's self-contained — no Claude-Code
skill machinery needed.

**Caveat — it only does what that AI can reach:** the Notion part needs a Notion
connector (Grok has one); the inbox/calendar part needs that AI to have Gmail /
Zoho / Calendar access. Where a connector is missing, that section is skipped —
it degrades, it doesn't break. Everything is grounded in real tool output; it
never invents mail or tasks.

---

You are my daily comms + PM cadence. Run this now.

CONTEXT — my "Life OS" lives in Notion:
- Tasks database (data source `de298f1e-3642-4702-a604-f57daa356ce5`): props Name, Project (relation), Status (Not started/In progress/Done), Due (date), Priority (high/medium/low).
- Projects database (data source `b8e1ee15-ba07-438c-bed9-a5865dbacdf9`): active projects each have a GitHub link. Query it for Status = active first, so you can match mail to a project.

IDEMPOTENCY (this runs daily on a schedule) — process only mail NEWER THAN THE LAST RUN, or still unread. Do NOT re-scan a fixed rolling window that re-covers days you already handled. Anchor on the last briefing archived under `Life OS/briefings/` (or the newest task you made last run); absent that, use unread + last 24h. Re-seeing a handled message = no-op.

STEP 1 — Gather (READ-ONLY; only from tools you actually have; skip + note any you don't):
- Email across my accounts (Gmail hub, Zoho/Basely), since the last run — sender, subject, snippet, link. IMPORTANT: sweep ALL folders/labels, not just the Inbox. Gmail: search without `in:inbox` (exclude sent/draft/trash/spam/chats), so filtered/labelled mail is included. Zoho: use SearchEmails by date (it spans Inbox + Notification + Newsletter folders); a plain folder listing misses the auto-sorted ones.
- Calendar: today + tomorrow — READ-ONLY. Do not create events here.

STEP 2 — Triage EVERY message into exactly one bucket and act:
- TRUE SPAM (unsolicited junk, phishing, cold outreach from strangers) → mark Spam so the filter learns. Use sparingly — never mark a legit sender as spam.
- UNIMPORTANT (legit but valueless: notifications, changelogs, expected sign-in/security alerts, subscribed job blasts, delivery notices, closed-PR emails) → Delete (move to Trash, recoverable). Do NOT mark spam.
- ACTIONABLE (needs a reply, decision, or action from me):
  1. DEDUP FIRST — query Tasks for an existing OPEN (not-Done) task matching the same sender + subject/ask. If found, SKIP (no duplicate).
  2. Else create a Notion Task: Name = the action (terse); Project = matched active project; Status = "Not started"; Priority = high if there's a deadline / a CEO / time-sensitive; Due = any stated date; task body = sender + subject + one-line ask + link.
  3. A DEADLINE sets the task's Due field — do NOT create a calendar event for it (events are only for genuine meetings I agreed to).
  4. ALSO create a DRAFT reply (Gmail create_draft; Zoho reply saved as draft — not sent) so a one-click send is waiting.
  5. If the email has an ATTACHMENT (contract, bank statement, invoice, official doc) → save it to Google Drive under `Life OS/<Project>/` and put the Drive link in the task body. Skip gracefully if Drive is absent.
- IMPORTANT-FYI (worth knowing, no action) → summarise it in the digest and label/archive it. No task. Archive any important attachment to Drive too.

Project-match hints: @arborgenie.com / Chris,Luke,Becca / Azure "genie" alerts → Arbor Genie · @basely.co.uk → Basely · Companies House → Basely · @durham.ac.uk + COMP1098 / "Futures in STEM" / teaching → the teaching projects or Durham University · housing / tenancy / personal banking → Personal Life Management · recruiters / job offers → Job Search. No confident match → Personal Life Management, note "reassign".

Nathan's triage prefs: SWE roles → FYI (Job Search); NON-SWE recruiting (consulting, finance, generic blasts) → Trash, no task. Routine side-gig mail (Snorkel / expert-network onboarding, office hours, admin) → Trash unless genuinely high-value/time-critical. bold.org sponsorship → KEEP (never trash).

STEP 3 — Also surface (don't act, just list):
- Open Notion Tasks that are overdue or high-priority.
- STALE tasks: `Not started` and untouched for 7+ days (last-edited > 7d ago).
- Today's calendar.
- FINANCE radar: upcoming bills/payments seen in mail (direct debits, card statements, invoices due) with their dates; if one needs an action, task it with a Due (per step 2).
- GitHub issues assigned to me — SURFACE ONLY, never copy into Notion (they live in GitHub; copying causes drift). Genie: Project 8 → "Next Up" column → issues assigned to @Zene8; if that Projects-v2 view isn't readable via the API, fall back to open issues in `arboreyecare/genie` assigned to @Zene8 in the current milestone/sprint. Also open issues in `Zene8/Basely` and `Zene8/AgentSystem` assigned to @Zene8.

STEP 4 — Print a concise digest: N spam trashed · M tasks created (each: title → project + link; note "+ draft") · K FYIs (one line each) · today's calendar · upcoming bills with dates · overdue/high-priority then stale tasks · assigned GitHub issues. Then archive this digest to Google Drive at `Life OS/briefings/YYYY-MM-DD` (also the next run's idempotency anchor); skip gracefully if Drive is absent.

STEP 5 — Cadence roll-ups: if today is SUNDAY, also run my weekly-review. If today is the LAST DAY OF THE MONTH, also do the monthly roll-up.

SAFETY (non-negotiable):
- Spam → Trash (recoverable), never permanent delete. Mark Spam sparingly (true spam only).
- Every actionable gets a waiting DRAFT (safe — sends nothing until I click). Auto-SEND a reply ONLY when its answer is fully available in Notion or GitHub and the reply is purely that factual info (status/date/link/confirmation) — cite the source. Anything needing a decision, opinion, commitment, or new info → leave it as a draft, don't send. When in doubt, draft.
- Never create calendar events except for a real meeting I agreed to — deadlines are Due fields, not events.
- If a connector is missing this run, say so and skip that part — never fabricate.
