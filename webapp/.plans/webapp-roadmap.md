# KryptonxWatch web app coverage and roadmap

## Recorded-video first release
The Next.js dashboard includes local MP4/WebM upload and playback, a searchable recording library, timestamped simulated sample annotations, bounding boxes, review states, detection filters, analytics, CSV export, a demo contextual assistant, theme settings, and sample playback alerts. It uses IndexedDB for local recording data.

The sample videos are generated synthetic footage. Their annotations demonstrate the interface and do not assert actual events in the footage. User uploads show no detections until a service is connected.

## Reference feature mapping
The [Treehacks2025 HawkWatch project](https://github.com/Grace-Shao/Treehacks2025) has upload analysis, saved recordings, timestamp navigation, statistics, a contextual assistant, real-time camera review, account pages, and notifications. The recorded-video interactions have equivalents in this release; live and connected service features follow below.

## Later phases
1. Connect an authenticated video and detection backend with real analysis jobs, evidence storage, service-generated summaries, and a connected contextual assistant. Replace the demo adapters without changing UI domain types.
2. Add secure account flows, access control, and external email or phone notifications.
3. Add live multicamera streaming, real-time analytics, and connected incident alerts.
4. Build a React Native app for iOS and Android that can view camera streams, broadcast the phone camera as a source, and display the detection log.

Real detection categories should include robbery, theft, shoplifting, pickpocketing, guns, queue tracking, kiosk nonpayment, medical emergencies, and suspicious activity. A human must review all suspected security incidents before they are treated as confirmed.
