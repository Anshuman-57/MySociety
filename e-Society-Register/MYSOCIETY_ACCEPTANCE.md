# MySociety presentation acceptance review

**Current setup rule (latest user request):** Admins add active societies and Secretaries by mobile number; Secretaries add active homes/owners and Guards by mobile number. No prior account or setup approval is required. OTP and one-time profile completion preserve the assigned role. Old approval-flow references below describe the earlier presentation baseline and are superseded for society/home/Guard setup. Visitor and household member approval rules remain unchanged. Tests now use direct setup and include `backend/verify-provisioning.mjs`.

Reviewed on 14 November 2026 against `C:/Users/Anshuman/Downloads/MySociety_SPM_Group_45.pptx` (10 slides).

All core prototype workflows described in this presentation have implementations in the web app and shared API. The review found and fixed one timing gap: approval/rejection now enforces the three-minute response deadline directly, rather than depending on when the scheduled timeout job next runs. Automated checks were expanded to cover the presentation's precise acceptance scenarios.

The user's later role rules remain in effect: Admins add societies and assign Secretaries; Secretaries add homes and assign owners. Home Head and Home Member remain internal permission levels within the single Resident login/workspace label. Society and home selection use dropdowns.

## Feature coverage

| Deck | Requirement | Implementation and evidence |
| --- | --- | --- |
| 2 | Registered visitor: request, household approval, same QR at entry and exit | Implemented. Integration checks complete request through checkout with one signed token. |
| 2 | Walk-in: Guard submits request; approved entry/exit recorded manually | Implemented. Integration checks deny entry before approval and after rejection, then complete an approved walk-in's entry and exit. |
| 2 | Recurring house help: owner schedule and pass on eligible days | Implemented. Checks verify daily approved visits, correct weekday eligibility, QR entry/exit and one daily visit per pass despite repeated generation. |
| 2 | Next Guard can see visitors still inside after shift change | Implemented. Test ends the first Guard's duty, starts a second Guard at gate 1, reads the inside list and records departure using the visitor's original QR. |
| 3-4 | One account has scoped roles; Guard selects duty gates | Implemented through approved memberships, role workspaces and duty records. Login/workspace regression tests and cross-society authorization checks pass. |
| 4 | Admin verifies societies; Secretary approves Guards/homes; owner approves memberships | Implemented and exercised through the API. Later user rules restrict society/home creation to Admin/Secretary respectively. |
| 4 | Owner or authorized member decides visits | Implemented. Concurrent decisions accept one response; read-only members retain access to history but cannot decide requests. |
| 4, 10 | Destination lookup does not expose resident contacts | Implemented. B-204 lookup returns exactly `{ flatId, label }`. Dropdown directory fields contain only home identifiers, wing, flat number and label. |
| 5 | React/Vite/TypeScript frontend and Express `/api/v1` API | Implemented; both builds pass. |
| 5 | Socket.IO notifications and live visit updates | Implemented. Tests receive the resident request/notification, decision event and visitor approval update, then retrieve the QR. Browser repaint without refresh remains a manual UI check. |
| 5 | MongoDB, Twilio Verify and Cloudinary adapters | Implemented. MongoDB operations are tested locally; Atlas connection URI support exists. Real Twilio SMS and Cloudinary upload tests require credentials not currently configured. |
| 5, 8 | Jobs for expiry, overstay alerts and eligible daily passes | Implemented. Lifecycle checks invoke the same job functions against isolated test records. Cron schedules are configured in `backend/src/jobs.ts`. |
| 6 | Visits reference an app user or walk-in profile; at most one entry and one exit | Implemented. MongoDB unique scan indexes and database assertions verify one entry and one exit for all three visitor types, and exactly one of the user/walk-in references. |
| 7 | Pending request becomes approved and visitor receives its QR | Implemented; API/Socket.IO sequence verified. QR is returned only to its authorized visitor and is omitted from Guard responses. |
| 8 | Pending, Approved, Checked in, Checked out, Cancelled, Rejected, No response, Expired | Implemented and exercised in the expanded workflow/lifecycle checks. |
| 8 | No response after three minutes | Implemented and tightened during this review. Late decisions are refused even when the scheduled timeout sweep has not run; one timeout notification is recorded. |
| 8 | Overstay leaves the visitor checked in until exit | Implemented. Checks confirm overstay alert, retained checked-in state, validity extension and eventual exit. |
| 8 | Guard can resend a timed-out walk-in request | Implemented and tested. |
| 9 | Setup guides, repeatable seed and sample API requests | Present in project/frontend/backend READMEs, `backend/src/seed.ts`, `backend/requests.http` and verification scripts. A fresh dependency installation was not repeated during this review. |

## Slide 10 acceptance checks

| Check | Result |
| --- | --- |
| Visitor receives approval update and can retrieve QR without a page-navigation step | Socket.IO event and subsequent authenticated API retrieval pass. Actual browser rendering was not exercised. |
| Camera unavailable: manual token uses the same gate/duty checks | Manual token form remains available independently of camera initialization and camera errors. The manual-token API path passes. Actual browser camera-denial behavior is not physically verified. |
| Two residents respond at once; loser receives HTTP 409 | Pass: one success, one `ALREADY_HANDLED` with HTTP 409. |
| Duplicate entry leaves exactly one scan record | Pass: second entry is refused; database count is exactly one entry and one exit. Verified for app visitors, walk-ins and daily helper passes. |
| Guard assigned only to gate 1 cannot scan at gate 2 | Pass: a second gate in the same society is rejected with HTTP 403 `NOT_ON_DUTY_AT_GATE`; the visit remains approved and can subsequently enter at gate 1. |
| B-204 lookup returns only its ID and label | Pass: exact response comparison, with no resident name or phone. |

## Files changed in this review

- `backend/src/visits.ts`: shared atomic timeout transition and direct deadline enforcement during visit decisions.
- `backend/src/jobs.ts`: reuse the same timeout transition so scheduled and request-time handling cannot issue duplicate timeout notifications.
- `backend/verify.mjs`: visitor live-update checks, explicit HTTP 409 assertion, same-society wrong-gate check, shift handover, B-204 privacy check and full helper entry/exit.
- `backend/verify-lifecycle.mjs`: exact scan cardinality, app/walk-in relationship checks and late-approval regression test.

## Run the checks

Use the setup and isolated database instructions in [FUNCTIONALITY_REVIEW.md](FUNCTIONALITY_REVIEW.md). With the test API running on port 4001:

```powershell
cd backend
node verify-local.mjs verify
node --import tsx --test auth-validation.test.mjs
```

The integration run creates new test accounts, societies and records in `esociety_functional_verification`. Lifecycle tests change timestamps only on those test records. Regular application data is not deleted.

## Remaining external verification

Core implementation is complete for this deck's web prototype. Production SMS, Cloudinary uploads and an Atlas-hosted deployment require configured service accounts. Real-device camera scanning, camera-denial UI behavior, browser repaint and responsive layout still need a browser/device check; builds and API tests alone do not establish those outcomes. No external service or device check is marked as passed here.
