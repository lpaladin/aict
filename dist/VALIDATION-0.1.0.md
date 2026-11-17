# AICT 0.1.0 validation

## Artifact

- APK: `aict-demo-0.1.0.apk`
- SHA-256: `a77ca392b3b79243454814f1484061070a497f7b1da17e11a26ea04e4b98484c`
- Size: 54,736,077 bytes
- ABI: arm64-v8a
- minSdk: 26; targetSdk: 29 (pinned upstream independent runtime)
- Package: `org.autojs.autojs6.inrt`; launcher: `dev.aict.container.MainActivity`
- APK signature schemes v2/v3 verified successfully.
- 10 expected runtime method signatures found in actual final APK DEX.
- Embedded endpoint and identity presence verified without printing private key.

## Passed

Eight gateway integration tests passed:

1. HTTP CONNECT forwarding through authenticated SSH.
2. HTTP page, binary POST round trip and Set-Cookie forwarding.
3. Server-initiated RPC round trip to explicitly simulated device.
4. SSH shell and unregistered direct forwarding rejection.
5. SSE streaming.
6. WebSocket text and binary round trips.
7. Incorrect server host key rejection.
8. Incorrect user private key rejection.

Browser SDK tests passed: per-frame correlation, result/error delivery,
safe reinjection, and missing-native error handling.

The JSch 0.2.26 JVM probe, using the same library and credentials as the APK,
successfully authenticated to the actual running local SSH server, verified its
host key, loaded HTTP health through the SSH-forwarded proxy and registered a
control channel. This is transport validation, not Android runtime validation.

## Remaining external/runtime checks

- `zhyzbklqx.gicp.net:19198` connection attempt from this computer returned
  `Connection refused`. The local independent service listens on `0.0.0.0:19198`.
  The external TCP mapping and a phone-side connection remain unverified.
- `adb devices -l` returned no attached devices. APK launch, Toast, permission
  dialogs, WebView behavior, accessibility, screenshots and camera use have not
  been demonstrated on a phone.
- The scope is a development build, not a claim that every Android API or every
  desktop-web feature works. Known download/background/target-SDK limits are
  documented in the project README.

Local service at handoff: PID recorded in `server/run/server.pid`;
HTTP test page at `http://127.0.0.1:18765/`.
