# ClapCheeks Live Send Evidence Runbook

Date: 2026-05-18

## Purpose

This runbook closes the final experimental readiness gate only after Julian explicitly confirms:

1. Destination phone number.
2. Exact message body.
3. Permission to perform one live send.

Do not run the live-send evidence command from memory or partial context. Use the values Julian confirms in the current conversation.

## Safety Defaults

The live-send harness is fail-closed. Without every required environment variable, it refuses and writes evidence with `live_send_performed=false`.

Required permission phrase:

```bash
SEND LIVE TO JULIAN
```

The dashboard iMessage API and scheduled-message send API both require `confirm_send: true`, `live_send_phrase: "SEND LIVE TO JULIAN"`, a ready live-send env gate, and a request destination/body that matches the explicit preflight inputs.

If Julian explicitly chooses the safe sample number `757-831-2944` as the live destination, the harness also requires:

```bash
CLAPCHEEKS_LIVE_SEND_ALLOW_SAMPLE_2944="I CONFIRM 757-831-2944 IS THE LIVE DESTINATION"
```

## Safe Sample No-Send Preflight

To prove the final live-send gate can become ready for the `757-831-2944` sample path without sending anything, run:

```bash
npm run test:e2e:live:sample-preflight
```

Expected result:

- `Sample live-send preflight: READY`
- `No send performed: true`
- Evidence written to `/tmp/clapcheeks-live-send-sample-preflight.json`
- Destination appears only as redacted `*******2944`
- The raw sample phone and raw message body are not written into evidence

## Preflight

Run the non-live readiness suite first:

```bash
npm run test:e2e:readiness:local
```

Expected result before live send:

- Browser proof passes.
- Safe scheduled dry-run passes.
- Live harness refuses safely.
- Completion audit says all non-live gates are proved.
- Completion remains `not complete` only because live send evidence is missing.

## Live Evidence Command

Start the env-backed dashboard in one terminal:

```bash
PORT=3002 CLAPCHEEKS_SELF_TEST_PHONE=+17578312944 npm run dev:runtime -- --hostname 127.0.0.1 --port 3002
```

Generate the redacted approval packet before asking Julian to confirm the final send:

```bash
npm run test:e2e:live:approval-packet
```

Expected result:

- `Live-send approval packet: READY_FOR_APPROVAL`
- Evidence written to `/tmp/clapcheeks-live-send-approval-packet-2026-05-18.json`
- It lists the missing env names, required permission phrase, sample `2944` override condition, and command sequence
- It does not write the raw phone number or raw message body

In a second terminal, run the no-send live preflight with Julian-confirmed values:

```bash
CLAPCHEEKS_LIVE_SEND_PERMISSION="SEND LIVE TO JULIAN" \
CLAPCHEEKS_LIVE_SEND_PHONE="<JULIAN_CONFIRMED_PHONE>" \
CLAPCHEEKS_LIVE_SEND_BODY="<JULIAN_CONFIRMED_EXACT_BODY>" \
CLAPCHEEKS_LIVE_SEND_EXPECTED_LAST4="<LAST4_OF_CONFIRMED_PHONE>" \
npm run test:e2e:live:preflight
```

Expected result: `Live-send preflight: READY`, `No send performed: true`, and a redacted plan in `/tmp/clapcheeks-live-send-preflight.json`.

Before running the live harness, compare the preflight fingerprint with the body Julian approved:

- `generated_at` is fresh. By default, the live harness rejects preflight evidence older than 900 seconds. Override only with explicit operator intent using `CLAPCHEEKS_LIVE_SEND_PREFLIGHT_MAX_AGE_SECONDS`.
- `validation.phone_redacted` matches the intended destination.
- `validation.message_length` matches the approved body length.
- `validation.message_sha256` is present and must match the live evidence after send.
- The raw message body is not written into the preflight evidence.
- Keep `/tmp/clapcheeks-live-send-preflight.json` in place. The live harness now refuses before creating any scheduled row unless that preflight is ready and matches the same destination last4, body length, and body SHA-256.

Then run the live evidence harness with the same Julian-confirmed values:

```bash
CLAPCHEEKS_LIVE_SEND_PERMISSION="SEND LIVE TO JULIAN" \
CLAPCHEEKS_LIVE_SEND_PHONE="<JULIAN_CONFIRMED_PHONE>" \
CLAPCHEEKS_LIVE_SEND_BODY="<JULIAN_CONFIRMED_EXACT_BODY>" \
CLAPCHEEKS_LIVE_SEND_EXPECTED_LAST4="<LAST4_OF_CONFIRMED_PHONE>" \
npm run test:e2e:live
```

Do not use `757-831-2944` for the final send-to-Julian proof unless Julian explicitly confirms that is the destination for the live test.

## Completion Check

After the live evidence harness succeeds:

```bash
npm run test:e2e:audit
```

Completion is proved only if `/tmp/clapcheeks-live-send-evidence.json` contains:

- `ok: true`
- `live_send_performed: true`
- `messages_db_verified: true`
- `phone_last4` matching the confirmed destination
- `message_sha256` matching `/tmp/clapcheeks-live-send-preflight.json`
- `message_length` matching `/tmp/clapcheeks-live-send-preflight.json`
- `send_provenance_verified: true`
- `send_provenance.source_label: clapcheeks_scheduled_messages_send_api`
- `send_provenance.route: POST /api/scheduled-messages/send`
- `send_provenance.phone_last4`, `send_provenance.message_length`, and `send_provenance.message_sha256` matching the live evidence fields

Then run:

```bash
npm exec -- node --test __tests__/*.test.mjs
```

## Evidence Files

- `/tmp/clapcheeks-live-send-evidence.json`
- `/tmp/clapcheeks-completion-audit-2026-05-18.json`

## Linear And Vault

After the live send is verified:

1. Update the Linear `clapcheeks.tech` project with the evidence paths and final status.
2. Append the result to `Projects/AI-Acrobatics/2026-05-18-clapcheeks-e2e-readiness.md`.
3. Only then mark the persistent goal complete.
