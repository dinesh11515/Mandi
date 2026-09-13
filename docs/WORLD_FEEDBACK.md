# World ID Selfie Check — integration feedback (Mandi, ETHOnline 2026)

Mandi uses Selfie Check as a **supplier accreditation signal**: a seller who completes Selfie Check receives a verifier-signed attestation bound to their ENS name and wallet, and the buyer's policy executor refuses to pay unverified suppliers when the human's policy says `requireVerifiedFor: ["financial"]`. The ENS `mandi:verified` text record is only a display hint; authorization reads the attestation.

This document is kept open during the build. Sections 3 and 4 are filled while testing with production World App; entries marked *pending* still need a device run.

## 1. Docs and integration flow

- **Two IDKit APIs coexist in search results.** The archived `worldcoin/idkit-js` repo and older blog posts show `<IDKitWidget actionId verification_level>`; the live `@worldcoin/idkit` 4.x package has a different, rp-signature based API (`IDKitRequestWidget`, `useIDKitRequest`, presets like `selfieCheckLegacy`). It took a source read of `idkit-core/dist/index.d.ts` to confirm the current call signature. A prominent "v3 → v4 migration" banner on the React page would save time.
- **`allow_legacy_proofs` is required in the type but undocumented for Selfie.** Selfie Check currently returns a World ID 3.0 proof, so the widget fails type-checking without `allow_legacy_proofs: true`. The credentials page should say this explicitly next to the preset.
- **RP signature has to be produced server-side.** `signRequest({ signingKeyHex, action, ttl })` lives in `@worldcoin/idkit-core/signing` and returns `{ sig, nonce, createdAt, expiresAt }`, while the widget wants `rp_context: { rp_id, nonce, created_at, expires_at, signature }`. The camelCase to snake_case mapping is easy to get wrong and is not shown in one place.
- **Verify endpoint.** `POST https://developer.world.org/api/v4/verify/{rp_id}` accepts the IDKit result verbatim, which is convenient. Two things were only discoverable in the developer-portal source: (a) `environment: "sandbox"` is accepted and normalized to staging, but the published OpenAPI enum lists only `production | staging`; (b) a replayed nullifier still returns HTTP 200 with `message: "Proof verified successfully (nullifier reuse)"`. Relying parties must enforce nullifier uniqueness themselves. Mandi stores a hash of the nullifier and rejects a second supplier name for the same human.
- **Signal enforcement.** `hashSignal` from `@worldcoin/idkit-core/hashing` is the public helper; `hashToField` mentioned in older docs is internal in 4.x. Mandi checks `responses[0].signal_hash === hashSignal(sellerWallet)` so a proof cannot be replayed against another wallet.
- **Selfie Check semantics** are documented as a low-assurance liveness + similarity credential, not a strict one-person-one-account guarantee. Mandi's README says the same: the attestation proves "a live human completed Selfie Check for this wallet", nothing more.

## 2. Developer Portal navigation

- Creating an external app, enabling World ID 4.0 to mint `rp_id` and the one-time signing key, and copying `app_id` were straightforward.
- Actions are auto-created on first successful verify in the resolved environment. Mandi now requests `environment: "production"`, so the action `mandi-supplier-accreditation` must exist (or be auto-created) under production, not staging/sandbox.
- Selfie Check shipped to production World App. The Developer Portal still treats it as a gated feature per app. Confirm the flag is on for Mandi's `app_id` before a demo. *pending: date requested, date enabled.*

## 3. Production World App states, flows, test users, errors, edge cases

*pending device testing*

- Production World App from the App Store / Play Store. No sandbox build.
- Demo path: open `/seller?name=risk-pro` on a laptop and scan the QR, or open the same URL inside World App (native IDKit transport, no QR).
- Observed states when scanning the QR from the seller page: *pending.*
- Error codes seen (`credential_unavailable`, `feature_unavailable`, `invalid_rp_signature`, `nullifier_replayed`, …): *pending.*
- Repeating the check for the same wallet and action returns the same nullifier; Mandi treats that as a renewal, not a second accreditation. *pending confirmation on device.*
- Attempting to accredit a second supplier name with the same human is rejected by Mandi (`one accreditation per human`). *pending confirmation on device.*

## 4. Confusing, missing, broken, or hard to test

- The desktop simulator does not offer Selfie Check. Production demos need a phone with World App.
- The v4 verify response returning 200 on nullifier reuse is surprising; a distinct status or `code` would be safer.
- Sandbox is missing from the published OpenAPI `environment` enum even though the handler accepts it.
- *pending: anything hit during device testing.*
