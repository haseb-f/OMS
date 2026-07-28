# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Initial project foundation: repository structure, tooling (ESLint, Prettier, Husky,
  lint-staged), documentation scaffolding, and environment variable template.
- Workspace bootstrap: `apps/web` (Next.js, App Router/TypeScript/Tailwind/ESLint),
  `apps/api` (NestJS, bootstrap-only), and `packages/{config,types,shared,ui}` linked
  into a single pnpm workspace with shared TypeScript config and `@mercury/*` path
  aliases. No business logic included.
