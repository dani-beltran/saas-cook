# Authentication experience

## Scope and decisions

The localized account route keeps its existing password, registration, email-link,
password-reset request and recovery modes. Each mode now has its own heading and
primary action. Allowlisted `mode` query values support direct links and retain the
selected view when switching English/Spanish. Email stays in component memory
across mode changes; credentials are never placed in URLs or browser storage.

Use the existing light/dark tokens and teal accent, a neutral placeholder mark, a
400px form, and a quiet language/theme toolbar. The authentication layout follows
the system color scheme and permits an in-page override. Mobile uses the available
width without a surrounding card. Styles are scoped to authentication; shared UI
primitives and authenticated organization/account screens retain their behavior.

Password sign-in is primary. Passkeys and email links are secondary options, with
password reset beside the password label and account recovery below the form.
Registration preserves the name, email, 12–128 character password and confirmation
requirements. Password visibility controls, autofill attributes, inline validation,
focus handling and live feedback are part of each form. Submission guards prevent
repeated requests; the existing session-loaded guard preserves draft input while a
background session refresh is pending.

Registration and email requests use generic confirmation copy and provide a clear
next step. Reset and confirmation token pages share the visual language and offer
a direct new-link path on failure. Tokens remain in memory and are removed from
the visible URL; GET visits never consume them. Endpoints, callback destinations,
MFA/assurance gates, password policy and session revocation semantics are unchanged.
No dependencies, schema changes, external providers or legal links are added.

## Verification

Browser coverage includes both languages/themes at desktop and mobile widths,
keyboard password controls, confirmation errors, email retention, background
session refresh, duplicate submissions, request payloads, error/retry/success
states and missing-token paths. Existing real-service registration, mailbox
confirmation, password reset, passkey and MFA journeys remain part of acceptance.
Screenshots and diagnostic attempts are retained under `artifacts/auth-redesign/`.
