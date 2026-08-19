# Quarterly Review — 2026 Q3 (1st)

**Date:** 2026-08-19
**Reviewer:** CTO
**Scope:** access rights (§3.6), third-party register (§6.1), data retention state (§5.3, §9.4)
**Context:** Pre-launch. Signup disabled, no real users, financial data integration in sandbox only. No production bank account data has been processed.

This is the first execution of the quarterly review defined in policy §12.1. The three areas are reviewed together in a single session.

---

## Part 1 — Access rights

| System | Roles present | Row-level user data reachable? | Basis |
|---|---|---|---|
| Database | Owner (x2), Developer, external contributors (x2) | **Yes** — non-CTO console roles can read individual rows through console query tools | Console role configuration |
| Deployment platform | Owner, Members | **Yes, indirect** — members can read the privileged database credential from environment variables; that credential bypasses row-level security | Verified in console as a member |
| Code repository | See restricted annex | No | — |
| DNS | See restricted annex | No | — |
| Email infrastructure | See restricted annex | No | — |
| Financial data provider | See restricted annex | Credentials only | — |

### Findings

**F1 — High.** The privileged database credential is readable by deployment-platform members. This grants row-level access to all stored user data and bypasses row-level security. Deviates from policy §1.2 (row-level access limited to a single role).

**F2 — Medium.** Database console roles below owner can read individual rows. Same deviation as F1, through a different path.

**F3 — Medium.** Project access is inherited organization-wide rather than granted per project. Deviates from policy §3.2.

**F4 — Low.** The reviewer does not hold the owner role on the deployment platform and therefore cannot modify member permissions. Remediation of F1 is blocked on this.

**F5 — Low.** Multi-factor authentication is not confirmed on the financial data provider console. Whether the provider supports it is unconfirmed.

### Root cause

F1, F2 and F3 share a single root cause: no separate non-production environment exists. External contributors therefore have a legitimate operational reason to hold production access, and access grants have accumulated around that necessity rather than around role requirements.

Remediating the three findings individually would remove the symptom without removing the reason, and access would re-accumulate. The durable remediation is environment separation; the access changes below are the interim measure that precedes it.

This is recorded here rather than as three unrelated findings because the sequencing matters: revoking access before a non-production environment exists would halt development.

### Actions taken

- Email transport set to enforced TLS.

### Actions deferred

- **F1, F2, F3** — owner: CTO. Trigger: before first real user.
  Rationale: external contributors currently require production access because no separate non-production environment exists. Removing access before that environment exists would halt development. Recorded as a known deviation, not an oversight.
- **F4** — owner: CEO. Trigger: this week.
- **F5** — owner: CTO. Pending provider confirmation.

---

## Part 2 — Third-party register

A register of external recipients was created during this review. One did not previously exist, which is itself a finding against policy §6.1.

- Active recipients identified: 8
- Inactive code paths recorded separately: 4
- Newly identified during this review: 5 browser-level recipients not previously recorded, of which 2 carry more than request metadata

Confirmed absent by full code review: analytics processors, tag managers, tracking pixels, inbound webhook endpoints.

### Findings

**F6 — Medium.** Map tile requests carry viewport coordinates to a third party. Not covered by the current collection notice.

**F7 — Low.** Institution logo requests allow inference of a user's affiliation. Not covered by the current notice.

**F8 — Low.** One web font loads from a third-party CDN at runtime while another is self-hosted. Inconsistent, and the CDN recipient is removable.

### Actions deferred

- **F6, F7** — collection notice revision. Owner: CTO. Trigger: before public launch, and only after the corresponding collection is changed. A notice must not be narrowed before the collection it describes.
- **F8** — owner: CTO. Trigger: this week.

---

## Part 3 — Data retention

Retention periods were defined by data category during this review (policy §5.3). No category-level periods existed previously.

### Findings

**F9 — Medium.** No automated expiry mechanism exists. Retention for account-linked data is bounded by account lifetime and enforced through cascading deletion on account removal, which is verified working. Data not linked to an account has no automated enforcement and is removed manually at quarterly review.

**F10 — Low.** Point-in-time recovery is not enabled on database backups. Daily physical backups are retained.

### Actions taken

- Sensitive identifier fields cleared across all existing rows (2026-08-17). No collection path remains for those fields.

### Actions deferred

- **F9** — automated expiry deferred until real usage data exists, so that the period is set on evidence rather than assumption. Owner: CTO.
- **F10** — cost decision. Owner: CTO. Trigger: before first real user.

---

**Next review:** 2026 Q4

**Note:** Account-level identification for the systems above is held in a restricted annex outside this repository. This document records roles, gaps, and remediation only.
