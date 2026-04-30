# Contributing

## Local setup

```bash
pnpm install
pnpm run lint
pnpm run build
pnpm run test:all
```

## Release

```bash
npm login
pnpm run release
```

This package intentionally uses `configWithoutCloudSupport` because it depends on external runtime libraries such as JSONata and AJV.
