# Contributing

Keep changes focused on the component involved. Discuss substantial architecture or training work before implementing it, and document the resulting behavior in the component's README.

## Development conventions

- Keep credentials in ignored environment files. Server-only modules must not be imported into client components.
- Access dashboard state through `useApp()` and derive analytics from the same records.
- Reuse shared UI primitives. Preserve keyboard access, readable light and dark themes, and mobile layouts.
- Label model detections suspected until human review; label simulated examples explicitly.
- Show unavailable measurements with a reason rather than inventing a value.
- Use `lib/id.ts` for browser IDs, including plain-HTTP deployments where `crypto.randomUUID` may be unavailable.
- Do not commit videos, downloaded datasets, weights, generated caches, or private configuration.
- Do not add generated-by notices or AI co-author trailers to commits or pull requests.

## Checks

For web app changes:

```bash
cd webapp
npm run lint
npm run typecheck
```

For upload, review, detections, analytics, or storage changes, also run:

```bash
npm run test:e2e:ci
```

The isolated E2E setup uses mocked model calls and a fake notification service. Do not replace these with paid providers in tests. Check any generated `next-env.d.ts` change before committing.

Data-preparation checks run from the repository root:

```bash
python3 -m unittest discover -s model/sonakshi/data_prep/tests
```

MERL tests require the optional scientific Python dependencies; report skips and environment limitations. GPU jobs require the [shared-resource checks](../../ops/README.md).

## Documentation changes

Use `README.md` for each maintained component. Keep links relative, commands copyable, and examples free of secrets. Separate implemented behavior from proposals and release claims from historical metrics. Update documentation references when moving a file.

Review `git diff --check` and confirm relative links resolve. Documentation-only work does not require starting GPU services, calling paid APIs, or sending notifications.

## Model work

Preserve the exact base revision, adapter checksum, data splits, training configuration, and evaluation outputs. Never train on the bake-off cohorts or locked study test set. Select settings on validation data or a declared cross-validation procedure. Human-review proposed training annotations before treating them as ground truth.
