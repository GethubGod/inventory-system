# Route matrix checkpoint

The source inventory contains 72 non-layout screen routes. The matrix at
`docs/release-readiness/route-inventory.json` now records the evidence without
turning shared screen coverage into a claim that every role-specific mutation
passed.

| Status | Count | Meaning in this pass |
| --- | ---: | --- |
| Pass | 14 | A route or a documented shared implementation rendered and its recorded state was inspected on the signed simulator. |
| Partial | 12 | A route rendered in a read-only or fixture-dependent state; a toggle, mutation, or role transition remains unproved. |
| Not yet exercised | 46 | No simulator evidence was recorded for that route in this bounded pass. |

The passed set covers name-login, welcome/logout return, manager home, manager
simple order, cart, fulfillment, fulfillment history, manager settings/profile,
shared history, receiving empty state, and checklist redirect. The partial set
covers manager Quick Order text entry, the manager credential profile while
the modal host race was being repaired, employee order-history/stock/past-check
read-only screens, and common settings read-only screens.

The four existing fixture inventory rows were observed through Browse Inventory
(`Fixture Salmon`, `Fixture Rice`, `Fixture Nori`, `Fixture Avocado`). Advanced
Quick Order starts empty because its parser catalog is the separate `qo_items`
relation; the fixture does not contain those links. The unexecuted
`seed-local-mobile-quick-order-catalog.sql` file adds only links to those same
known rows and is intentionally waiting for the explicit local write approval.

The matrix does not claim App Store approval. Physical microphone/camera,
push delivery, email/invite delivery, supplier send, production API
configuration, and unexercised routes remain release checks outside the
recorded local evidence.
