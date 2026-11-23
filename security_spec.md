# SantralBayi Firestore Security Specification (Phase 0 TDD)

## 1. Data Invariants
1. **Default Deny Safety Net**: Every path outside explicitly declared collections (`/admins/{adminId}`, `/workspaces/{workspaceId}`, `/workspaces/{workspaceId}/snapshots/{snapshotId}`) is unconditionally denied (`allow read, write: if false`).
2. **Verified Identity Gate**: Every write and read requires an authenticated user (`request.auth != null`) whose identity is verified via either verified email (`request.auth.token.email_verified == true`) or verified Firebase Phone Auth (`request.auth.token.firebase.sign_in_provider == 'phone'`).
3. **PII & Vault Ownership Isolation**: A `WorkspaceVault` at `/workspaces/{workspaceId}` contains dealer/subscriber phone numbers, setup profiles, and operational logs; `workspaceId` MUST match `request.auth.uid` (or an authenticated verified admin), and `ownerId` MUST equal `request.auth.uid` on creation and remain immutable on update.
4. **Master Gate Relational Sync**: A `WorkspaceSnapshot` at `/workspaces/{workspaceId}/snapshots/{snapshotId}` cannot be created, read, or updated unless `/workspaces/{workspaceId}` exists and its `ownerId` equals `request.auth.uid` (or verified admin).
5. **Temporal & Immutable Integrity**: `createdAt` and `updatedAt` MUST equal server `request.time`; `createdAt` and `ownerId` are strictly immutable across all updates.
6. **Terminal State Locking**: Once a `WorkspaceSnapshot` reaches `status == 'LOCKED'`, non-admin updates are rejected.
7. **Volumetric & ID Poisoning Guards**: All path IDs match `^[a-zA-Z0-9_\-]+$` (`<= 128` chars), and every string field enforces explicit `.size()` upper bounds from `firebase-blueprint.json`.

## 2. The "Dirty Dozen" Adversarial Payloads
1. **Unauthenticated Write**: `auth = null` writing to `/workspaces/user_1` -> `PERMISSION_DENIED`.
2. **Unverified Email Spoof**: `auth = { uid: 'spoof_1', token: { email: 'kurumsalpark@gmail.com', email_verified: false } }` reading `/workspaces/other_uid` -> `PERMISSION_DENIED`.
3. **Identity Spoofing on Create**: `auth.uid = 'user_1'` creating `/workspaces/user_1` with `ownerId: 'user_2'` -> `PERMISSION_DENIED`.
4. **Shadow / Ghost Field Injection**: Updating `/workspaces/user_1` with required fields plus `isAdmin: true` -> `PERMISSION_DENIED` (`hasOnly` rejection).
5. **Cross-Tenant PII Read**: `auth.uid = 'user_2'` attempting `get` on `/workspaces/user_1` -> `PERMISSION_DENIED`.
6. **Client Timestamp Forgery**: Creating `/workspaces/user_1` with `createdAt: Timestamp.fromMillis(1000)` (`!= request.time`) -> `PERMISSION_DENIED`.
7. **Immortal Field Mutation**: Updating `/workspaces/user_1` where `createdAt` or `ownerId` differs from `resource.data` -> `PERMISSION_DENIED`.
8. **ID Poisoning Attack**: Writing to `/workspaces/bad$id!with/slashes` or 500-char ID -> `PERMISSION_DENIED`.
9. **Value Poisoning / Megabyte String**: Updating `settingsJson` with a Boolean `true` or `400,000` char string (`> 350000`) -> `PERMISSION_DENIED`.
10. **Orphaned Subcollection Write**: Creating `/workspaces/missing_ws/snapshots/snap_1` when parent `/workspaces/missing_ws` does not exist -> `PERMISSION_DENIED`.
11. **Terminal State Bypass**: Non-admin updating `/workspaces/user_1/snapshots/snap_1` after `status == 'LOCKED'` -> `PERMISSION_DENIED`.
12. **Blanket Collection Scraping (`list`)**: Authenticated `user_2` executing unfiltered `list` on `/workspaces` or `/workspaces/user_1/snapshots` without `resource.data.ownerId == request.auth.uid` -> `PERMISSION_DENIED`.
