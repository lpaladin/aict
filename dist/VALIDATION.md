# AICT 0.2.0 validation

- APK: `aict-demo-0.2.0.apk`
- SHA256: `6c565cf11b540cc7249d07b2a8e3efcc9185fc970692ff17997af260f2739093`
- Size: 54752461 bytes; arm64-v8a; minSdk 26; targetSdk 29.
- Package unchanged; versionCode 2; prior signing certificate retained.
- Prior and current embedded SSH configuration are byte-identical.
- APK v2/v3 signatures and ZIP alignment verified.
- 15 expected runtime ABI methods verified in final DEX.
- Packaged client DEX and injected JS are byte-identical to current build inputs.

## Automated checks

- Server suite: 15 tests, 14 passed, 1 explicitly skipped live Codex test.
- Gateway-specific suite: 9 passed, including event forwarding without premature RPC completion, historical event retrieval and WebSocket delivery.
- Browser SDK: per-frame request IDs, success/errors, progress vs terminal results, unsubscribe, detached receipt, sequential screenshot stop, 600001-byte Blob chunk roundtrip and empty Blob all passed.
- Real production HTTP transfer core tested on JVM against actual HTTP fixtures: cookies, relative redirects, cancellation, validator-based Range resume, exact recovered bytes, 416 completion, full replacement after validator change, chunked bodies, cross-origin Authorization removal, invalid ranges and redirect loops.
- Real production ScriptTasks tested with explicit Android/engine boundary fixtures: JSON result capture, exactly-once completion, cancel-before-start, forceStop requests, truthful cancelling state, deadline, detached completion and retained result query. These are not Android runtime tests.

## Live evidence

- An Android 16 phone was observed connected over the public SSH endpoint.
- Running 0.1.0: deliberate JavaScript exception returned correctly.
- Running 0.1.0: application-private file write/read/delete with explicit failure assertions completed successfully.
- Found 0.1.0 successful expression result was null; fixed in 0.2.0 using host reportResult, tested as host logic and statically verified.
- Service update was followed by an observed automatic phone reconnection.

## Remaining device acceptance

0.2.0 has not yet been installed through adb; no adb-visible phone is attached. Its new camera, URI-provider access, gestures, sequential screenshots, task/event bridge and explicit script-result reporting require device acceptance after upgrade. Existing live-phone evidence is from 0.1.0, not proof of those new Android behaviors.

Use `/diagnostics` for native capability tests. See `API.md` for protocol semantics, cancellation and platform limits.
