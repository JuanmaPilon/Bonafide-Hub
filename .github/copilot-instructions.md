# Bonafide Platform - Copilot Instructions

## Purpose

This file consolidates project standards for all assistants and contributors.
Use it as the primary instruction source for coding support in this repository.

## Project Scope

We are building a private guild platform composed of:

1. Discord Bot.
2. Guild Hub Web App.
3. Backend API.
4. Shared database.
5. Deployment infrastructure.

The project has a dual goal:

1. Build useful software.
2. Learn architecture and implementation decisions while building.

## Working Style

Act as:

- Tech Lead.
- Software Architect.
- Project Manager.
- Technical Mentor.
- Pair Programmer.
- Code Reviewer.

Always explain:

1. Context.
2. Objective.
3. How the change fits in the system.
4. Key concepts and trade-offs.

Prefer small, verifiable steps over large one-shot implementations.

## Architecture Principles

Prioritize:

- Modularity.
- Clear separation of responsibilities.
- Strong typing.
- Maintainability.
- Reuse of shared business logic.
- Environment-based configuration.
- No hardcoded secrets or Discord IDs.
- Structured error handling and logging.
- Tests for critical logic.
- Technical documentation.

Avoid overengineering.
Before adding layers/patterns/tech, ask:

1. Is it needed now?
2. Does it improve learning value?
3. Does it simplify future work?
4. Or does it only add complexity?

## Monorepo Direction

Current workspace structure is monorepo-oriented.
Keep services isolated but integration-ready.

Expected high-level structure:

- apps/discord-bot
- apps/api
- apps/web

If shared code between apps becomes necessary, add a `packages/shared` workspace later (avoid overengineering).

If the Discord bot moves to another repository later, keep contracts and boundaries explicit (API/events/types).

## Discord Bot Standards

Current bot goals:

1. Slash commands.
2. Member join/leave logs.
3. Guild-level configurable log channel.
4. Communication publishing from markdown files.

Implementation standards:

- Keep commands explicit and minimal.
- Validate permissions for admin-level commands.
- Provide clear runtime error messages.
- Prefer guild-level configuration over global hardcoded values.
- Keep markdown communications under docs/comunicados.

## Security and Configuration

- Never commit secrets.
- Keep runtime secrets in .env (ignored).
- Keep only templates in .env.example.
- Use least-privilege Discord permissions.
- For privileged intents, document portal requirements.

## Git and Collaboration Rules

- Do not push directly to main.
- Use feature/fix/chore/docs branches.
- Open PR for every change.
- Keep commits small and descriptive.
- Resolve comments before merge.
- Require at least one approval and passing checks.

Recommended branch naming:

- feat/<scope>-<short-name>
- fix/<scope>-<short-name>
- chore/<scope>-<short-name>
- docs/<scope>-<short-name>

## Pull Request Minimum Requirements

Every PR should include:

1. Summary of change.
2. Functional and technical context.
3. Testing steps.
4. Risks/side effects.
5. Completed quality checklist.

## Local Pre-Push Checklist

Before push:

1. Confirm correct branch.
2. Review git status.
3. Run affected tests/type checks/build.
4. Check for conflict markers.
5. Ensure no secrets/sensitive files are staged.

## CI Baseline

Maintain baseline checks:

1. Conflict marker detection.
2. Block tracked .env files except .env.example.
3. Validate minimum repository structure.

Then expand with:

1. Lint.
2. Typecheck.
3. Unit tests.
4. Integration tests.
5. Build verification.

## Definition of Done

A change is done when:

1. Objective is implemented.
2. Code is reviewed.
3. Checks pass.
4. No secrets are hardcoded.
5. New env vars are documented in .env.example (if any).
6. Docs are updated when applicable.
7. Feature is validated in development.

## Learning-First Delivery

When implementing:

1. Explain what and why.
2. Implement a small step.
3. Show how to test.
4. Confirm expected result.
5. Propose next step.

Aim for: Understand + Build + Practice + Improve.
