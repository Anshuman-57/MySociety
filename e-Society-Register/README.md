# MySociety

A visitor register for housing societies. The React frontend calls an Express API backed by MongoDB. Socket.IO updates pending approvals, gate activity, and visitor status across signed-in devices. Times shown in the app are in Asia/Kolkata.

See [the functionality review](FUNCTIONALITY_REVIEW.md) for feature coverage, the expanded test workflow, and configuration limits. Guard, Secretary, Resident and Admin visit history supports text search, status and IST date filters. Visitors use My pass, which shows pending requests and active QR passes instead of a history page. Guards have a history page; Platform Admins have visitor records and audit pages. Successful gate scans also create audit events.

The [MySociety acceptance review](MYSOCIETY_ACCEPTANCE.md) covers the second presentation, including shift handover, same-society gate restrictions, conflicting decisions and exact scan counts. A visit decision submitted after its three-minute response window is refused immediately, without waiting for the scheduled timeout sweep.

## Run on Windows

Install Node.js 22 or later and MongoDB Community Server, or use MongoDB Atlas. Open PowerShell in the extracted project folder.

```powershell
Copy-Item .\backend\.env.example .\backend\.env
Copy-Item .\frontend\.env.example .\frontend\.env
node -e "for (const name of ['JWT_ACCESS_SECRET','JWT_SIGNUP_SECRET','QR_SECRET']) console.log(name+'='+require('node:crypto').randomBytes(48).toString('hex'))"
notepad .\backend\.env
```

Paste the three generated values into the corresponding lines. Set `OTP_MODE=dev` for the local demo and keep `ADMIN_PHONE=+919100000100` unless you want another number.

- **MongoDB** — Start the local MongoDB service if installed as a service (`Start-Service MongoDB` in an elevated PowerShell). The example connects to `mongodb://127.0.0.1:27017/esociety`. For Atlas, add your IP to the project's network access list, create a database user, and put its connection URI with the database name in `MONGODB_URI`. URL-encode any reserved characters in the password.
- **Secrets** — Keep the three generated values distinct and private. The access secret signs 15-minute access tokens, the signup secret signs 15-minute signup tokens, and the QR secret signs the opaque gate tokens. Keep the QR secret stable for previously issued passes.
- **CORS** — `CORS_ORIGINS=http://localhost:5173` must match the frontend origin. If Vite uses another port, update CORS and restart the API. Set `VITE_API_URL` in the frontend env to the API origin, without `/api/v1`.
- **Twilio Verify** — For real SMS, create a Verify service, set `OTP_MODE=twilio`, and fill `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_VERIFY_SERVICE_SID`. Local development uses `123456` without sending SMS. The API rejects development OTP mode with `NODE_ENV=production`.
- **Cloudinary** — Fill all three `CLOUDINARY_*` settings for uploads. The API checks file type and a 5 MB limit. Use a Cloudinary account that permits PDF delivery for society documents. You can run the gate demo without uploads.
- **Camera** — Allow browser camera access on HTTPS or localhost. Manual token entry works with the same API and permissions.

Install, build, and seed from the project folder:

```powershell
npm --prefix backend ci
npm --prefix frontend ci
npm --prefix backend run build
npm --prefix frontend run build
npm --prefix backend run seed -- --demo
```

Run these in separate PowerShell windows from the project folder:

```powershell
npm --prefix backend run dev
```

```powershell
npm --prefix frontend run dev -- --strictPort
```

Open [http://localhost:5173](http://localhost:5173). The API listens on port 4000 by default.

Setup follows the selected workspace. **Platform Admin ? Societies ? Add society & Secretary** creates an active society and assigns its Secretary by mobile number. **Secretary ? Homes ? Add home** creates an active home and assigns its owner by mobile number. **Secretary ? Guards ? Add Guard** activates Guard access immediately. No prior accounts or setup approvals are required. The person verifies their mobile number by OTP and completes their name/date of birth once at first sign-in; the assigned role is preserved. Later sign-ins go directly to that workspace.

Admins can change a society's Secretary under Manage. Secretaries can change an active home's owner or remove a Guard. Inactive societies/homes can be activated directly by the responsible Admin/Secretary. Old inactive records are visible under All societies/All homes. Visitor entry decisions and household member join requests still use their existing resident approval rules.

Societies and existing homes are selected from dropdowns. Search societies by name, city, state, street address, or PIN code; combine terms such as `Greenwood Ahmedabad` to narrow results. After choosing a society, select one of its active homes. Changing society resets the home selection. Optional filters and pagination support larger lists. Pending, rejected, and suspended records are excluded. Home options show only wing and flat number, without resident names or phones. Secretaries still enter a new wing and flat number when adding a home.

## Role demo

Use separate browser profiles to keep sessions for different accounts open. Enter the 10-digit mobile number beside the fixed **+91** prefix, choose **Sign in as**, click **Send code**, and enter `123456` in development. The server checks that the selected role is active before creating a session and opens its dashboard. **My primary role** chooses Admin, Secretary, Guard, Resident, then Visitor, in that order. Switch between authorized roles using **Workspace**. New users sign in as Visitor or My primary role. They can request home membership. Admins assign Secretaries, and Secretaries add home owners and Guards by mobile number. Seeding without `--demo` creates the configured Platform Admin and guest types only.

All mobile fields accept exactly 10 digits and block additional characters. The API accepts 10 digits or `+91` followed by 10 digits, storing the canonical `+91` form.

Run the isolated mobile-validation and role-login checks without a database or SMS service (install both frontend and backend dependencies first):

```powershell
cd backend
node --import tsx --test auth-validation.test.mjs
```

| Workspace | Demo phone | What to show |
| --- | --- | --- |
| Platform Admin | `+919100000100` | Add a society and Secretary by mobile number. Both are active immediately. The Secretary mobile must not already manage another society. |
| Society Secretary | `+919100000101` | Open Greenwood Residency, check the Main gate, add Guards and homes directly by mobile number, and open the audit trail. |
| Guard | `+919100000102` | Start duty at Main gate. In Scan at gate, paste a visitor's token in Entry mode, then use Exit mode to record departure. |
| Resident (owner permissions) | `+919100000103` | Open Greenwood Residency A-101, approve a pending visit, manage members, and create a recurring pass for a registered helper. |
| Resident | `+919100000104` | Open A-101 and review household visits. QR verification and gate scans belong to the Guard workspace. |
| Visitor or helper | `+919100000105` | Request a visit to Greenwood Residency, wing A, flat 101. Keep the detail page open for the live approval and copy its QR token. My pass shows approved visitor and scheduled helper QR codes to present to the Guard. |

For a walk-in, use the Guard workspace while on duty, submit a phone and name, and have the Head approve the request. Select **Allow entry** and then **Mark exit** from Inside now. Emergency vehicles have a separate log with gate, guard, and time.

To verify the full registration chain independently, use a disposable database with seeded admin and guest types and run:

```powershell
npm --prefix backend run verify
```

The script creates fresh demo accounts and records in the configured test database. If you changed `ADMIN_PHONE`, set the same value in your PowerShell session (`$env:ADMIN_PHONE = '+91…'`). See [backend/requests.http](backend/requests.http) for individual requests.

## Contract decisions

- Societies added by a Platform Admin are active immediately; documents are optional. This allows a local demo without Cloudinary. Uploaded documents are listed in the society management dialog.
- Wing and flat number are normalized to uppercase. Floor number is optional and is a whole number.
- Walk-ins are created while a guard is on duty in the society. Entry and exit then require a gate on the guard's current duty. The gate is recorded at entry and exit.
- A recurring pass covers a same-day IST time window. Today's pass is generated at 00:05 IST, at startup, and immediately after an eligible pass is saved. Pass edits apply to future issuance. A QR already issued for the current day follows the existing visit lifecycle.
- The Secretary uses the same inside-now list for the dashboard count. Role-specific API responses omit resident identity from visitor and guard views.
- A Secretary confirms property ownership before transferring headship. Ownership records are outside the app's data model.

## Code tour

- `backend/src/server.ts` starts Express and Socket.IO. `auth.ts` handles OTP and session rotation. `societies.ts`, `homes.ts`, `visits.ts`, `passes.ts`, and `activity.ts` own the domain routes. `core.ts` validates requests and checks scope. `models.ts` defines storage and uniqueness constraints. `jobs.ts` schedules visit and duty changes.
- `frontend/src/main.tsx` owns navigation, workspaces, and socket-driven query invalidation. `account.tsx`, `management.tsx`, `guard.tsx`, `resident.tsx`, and `visitor.tsx` render role screens against the API.
- For an interview walkthrough, follow a visitor's request from `POST /visits` through resident approval, QR signing, and the conditional check-in/check-out updates and scan records.

Visitor navigation uses **My pass** and **Request a visit**. After approval, the QR appears on My pass automatically and remains available for exit after check-in. Completed, cancelled, rejected and expired unused visits are excluded. The former `/helper` and `/visits` pages redirect to `/pass`. Guards, Secretaries and Admins retain their visit logs.
