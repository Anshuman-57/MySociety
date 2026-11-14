# Core functionality review

**Current setup rule (latest user request):** Admins add active societies and Secretaries by mobile number; Secretaries add active homes/owners and Guards by mobile number. No prior account or setup approval is required. OTP and one-time profile completion preserve the assigned role. Old approval-flow references below describe the earlier presentation baseline and are superseded for society/home/Guard setup. Visitor and household member approval rules remain unchanged. Tests now use direct setup and include `backend/verify-provisioning.mjs`.

Reviewed on 14 November 2026 against the 10-slide Digital Visitor Management System presentation. The latest requested role rules take precedence over the original build briefs.

The later [MySociety presentation acceptance review](MYSOCIETY_ACCEPTANCE.md) maps the second deck to implementation and tests. It also records the stricter three-minute response deadline added during that review.

The core web visitor-management workflow is implemented. This review found and completed searchable history, guard history, platform oversight, and scan audit events. It also corrected read-only resident access to visit details.

| Main feature | Implementation | Verification |
| --- | --- | --- |
| Role-based access | Admin assigns Secretaries and adds societies; Secretaries add homes and assign owners; Residents approve according to permissions; Guards record gate activity; Visitors request visits | Login role checks, workspace rules, blocked creation attempts, cross-society restrictions |
| Society and home selection | Approved societies and homes use dropdowns; selecting another society clears the home; resident names and phones are not listed in home choices | Pending society/home exclusion, approved options, privacy of home-directory fields |
| Digital visitor requests | Registered visits and guard-recorded walk-ins capture destination, purpose, guest type and applicable vehicle details | Creation, required vehicle numbers, home lookup and rejected entry |
| OTP and QR | OTP-based account login, signed QR tokens, guard duty and gate checks | Development OTP, signed QR flow, duplicate entry, exit-before-entry, wrong-society scans, QR expiry and revoked sessions |
| Live resident approval | Socket.IO request events and in-app notifications; first approval/rejection wins | Request/notification events, concurrent decisions, guard rejection notification, no entry after rejection |
| Searchable records | Resident, Guard, Secretary and Platform Admin history; search visitor/name/phone, purpose, vehicle, guest type or home; status and inclusive IST request-date filters | Scoped matches, phone/home search, date boundaries, invalid ranges, literal special characters, no-match results |
| Gate records and audit | Entry/exit timestamps, unique scan records, approval audit, new entry/exit audit events, Secretary audit and Platform Admin audit views | Entry/exit events, audit attribution, authorized oversight and denied access |
| Recurring visitors | Scheduled helper/vendor passes and daily QR generation | Assigned passes, same-day QR, repeated generation creates one pass per day |
| Operational exceptions | No-response timeout, walk-in resend, cancellation, expiry, overstay notification, extension, child protection and automatic duty closure | Deterministic lifecycle checks in the isolated local test database |
| Membership and notifications | Join requests, owner approval, member permissions/removal, headship transfer, in-app notifications | Read-only residents, removed-member denial, transfer, notification read-all |

## Changes made during this review

- Added `backend/src/history.ts` for shared text/status/date filtering with escaped search terms and IST date boundaries.
- Added searchable visit-history forms for Residents, Visitors, Guards, Secretaries and Platform Admins.
- Added Platform Admin visitor-record and audit pages. Guard history remains readable after ending duty; gate mutations still require active duty.
- Added `VISIT_ENTRY` and `VISIT_EXIT` events to the existing audit log.
- Allowed approved residents to read their home visit details even when they cannot approve visits.
- Expanded `backend/verify.mjs` and added `backend/verify-lifecycle.mjs` for state transitions and time-sensitive checks.

## Validation

Frontend and backend production builds passed. The five role/mobile regression tests passed. The expanded integration workflow passed, including real MongoDB operations and Socket.IO request/approval events. Lifecycle checks move timestamps only on newly created test records, avoiding waits and changes to regular application records.

From `backend`, run:

```powershell
npm run build
node --import tsx --test auth-validation.test.mjs
node verify-local.mjs seed
```

Start the isolated test API in another terminal:

```powershell
node verify-local.mjs server
```

Then run:

```powershell
node verify-local.mjs verify
```

This uses `esociety_functional_verification` on local MongoDB and API port 4001. It adds test accounts/records without deleting the configured application database. Stop any existing test API on port 4001 before starting another instance. The lifecycle checks execute the real job functions against the isolated database; they do not wait for the cron schedule.

## Remaining configuration and limits

- Real SMS requires Twilio credentials and `OTP_MODE=twilio`. The verified local mode uses OTP `123456` and does not send SMS. Walk-ins are manually recorded by the Guard; their entered phone number is not OTP-verified by that form.
- Photo/document uploads require Cloudinary credentials. These are not configured locally, so external uploads were not verified.
- Notifications are live in-app Socket.IO notifications. Native Android/iOS apps and background push notifications are not implemented in this web repository.
- Camera scanning code exists, but real-device camera permission and image decoding were not verified in this review. Manual QR-token entry/exit was verified through the API.
- Audit and scan records have no update/delete API. They are not cryptographically tamper-proof against someone with direct MongoDB write access. Backups and production database access controls require deployment configuration.
- Browser interaction/layout was not verified in this review; the evidence above comes from builds and automated API/Socket.IO/database checks.
- Recurring-pass edits apply to future issuance; an already issued daily QR follows its existing visit lifecycle, as documented in the README.

## Visitor navigation update

The latest user request replaces Visitor history and Helper passes with **My pass**. `GET /visits/current` returns only the signed-in visitor's pending and active visits in approved homes/societies, including ordinary approved visits and eligible recurring passes. QR codes remain available after check-in for exit, including overstays; completed/cancelled/expired unused passes are excluded. The UI updates through existing visit events. Old `/helper` and `/visits` routes redirect to `/pass`. Guards, Secretaries and Admins keep the log pages. Regression checks cover pending-to-approved QR visibility, visitor isolation, checked-in QR retention, and removal after checkout/cancellation/expiry.
