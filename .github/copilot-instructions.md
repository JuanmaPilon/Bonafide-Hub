# Bonafide Platform - Copilot Instructions

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

## Text and Descriptions

Do not add descriptions, notes or explanatory copy unless they are really needed.

Rules:

1. No filler copy in the UI: no hints, no subtitles, no obvious clarifications, no "how it works" paragraphs.
2. No file or section descriptions that do not change a decision.
3. Code comments: only the non-obvious why (a trap, a limit, a Discord/API quirk).
4. Before writing a description, ask: does anyone need this to understand or use the feature? If not, leave it out.
5. If an existing description adds nothing, remove it.

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

- Pushing directly to main is allowed for any change, as long as the typecheck
  and the build pass before pushing.
- For changes that need review, use feature/fix/chore/docs branches and open a PR.
- Keep commits small and descriptive.
- Resolve comments before merge.

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

## UI Consistency (hub web)

The hub is one app with one visual language. When adding or touching a module,
reuse the shared pieces instead of inventing a local variant.

Rules:

1. **Module bar** — every list module starts with the panel's own header (the
   title comes from the panel, not from the module) and then a
   `.module-toolbar`: actions on the left with a Phosphor icon + label, the
   search `ListFilterBar` filling the rest and the order select to its right.
   Filter chips go on their own row below.
   Never put the primary action inside `ListFilterBar` (it ends up after the
   search box) and never leave a `ListFilterBar` inside a flex row with its
   default `width: 100%` / `margin-bottom`.
   **The action button is always `primary-button module-toolbar-button`** (icon
   at `size={16} weight="bold"`). `.module-toolbar-button` only aligns the icon
   with the label — it carries no colors, so a button with only that class
   renders as a bare grey box and stands out as "not from here". Same for the
   reverse: never add a bespoke `background`/`border` to a toolbar action.
2. **Chips** — one chip for the whole hub (`event-filter-chip`):
   - neutral chip (`Todos`, roles, types): dark surface, muted text, blue tint
     when active.
   - **color chip** (`event-filter-chip--color`, used by tags AND roster
     statuses): tinted at 22% with a 70% border when idle, **solid** with
     contrast text and a ✓ when selected. The colors are computed in JS
     (`chipColorVars` → `--chip-tint/--chip-border/--chip-color/--chip-text`),
     never with `color-mix` or `opacity` (they wash out in light theme).
     22% is the dark-theme tint; the light theme swaps to `--chip-tint-strong`
     (34%) in CSS, because 22% of a color on white is barely a color.
3. **Icons** — Phosphor, never emoji, for UI affordances (buttons, labels,
   types). Emoji are only allowed where they are shared vocabulary with
   Discord (signup statuses ✅ ⏰ 🪑 ❌, and the emojis the API sends inside the
   embed).
4. **Modals** — build on `.modal` + `.modal-head` (icon + title + round close
   button) + `.admin-save` footer. Wrap them in the `ModalPortal` helper (a
   `createPortal` to `document.body`): the content panel has `backdrop-filter`,
   which traps `position: fixed` children, so without it the overlay blurs just
   the panel box instead of the whole page (and Admin's `overflow: hidden`
   clips it).
5. **Forms** — `.form-grid` (two columns, `event-form-wide` for full rows) with
   the label above the control, and the hub's own `.input` / `.select`. Options
   that are on/off are a small `FormSwitch` grouped by theme in `.event-options`
   (one row per group, label on the left, no box around the group), never a
   `.module-toggle` card (those belong to the configuration panel). The switch
   is painted from the input's `:checked`, not from a `.checked` class: a switch
   outside `.module-toggle` looked off while its state was on.
6. **Light theme** — every new surface needs its light-theme counterpart. Do not
   write a broad light-theme selector that overrides a component's own computed
   colors (e.g. color chips): exclude those variants explicitly.
7. **Empty and loading states** — say "loading" while loading and "empty" only
   when the data actually arrived; never show "there is nothing" while the list
   is still being fetched.
8. **Page header** — a single record (one event, one member) and every module
   use the same centered header: `section-header--center` /
   `section-header--event` (three columns, title in the middle). Back button on
   the left, the gear (`GearSix`) on the right. The side columns must measure
   the same so the title sits on the panel's real center, and users without
   permission get a spacer instead of the gear.
9. **Custom dropdowns** (anything that shows images, e.g. class/spec with the
   server emoji): a trigger styled like `.select` plus a menu, never a native
   `<select>`. Render the menu through `createPortal` with `position: fixed`
   anchored to the trigger — cards use `overflow: hidden` and long menus get
   clipped. It closes on click-outside and Escape, and follows the trigger on
   scroll.
10. **Shell width** — `.topbar-inner`, `.page` and `.landing-main` share
    `--shell-max` (one variable). Never hardcode a max-width on one of them:
    the nav and the content have to line up on the same left/right edge. Adding
    nav items widens the header first — check it still fits on one line before
    bumping the variable, and cap what grows with the width (the event banner
    stops at 460px).
11. **Admin lives inside the profile dropdown**, not in the nav: the user chip
    (`.nav-item--profile`) opens a menu with "Mi perfil" on top and the Admin
    sections below, grouped under a `nav-submenu-label` and anchored to the right
    (`right: 0`) so it doesn't leave the screen. The nav holds only modules.
12. **Reuse before creating.** Before writing a button, field, chip, card, row or
    modal, find the existing one (`grep` the class in `styles.css` and the
    component in `main.tsx`) and use it. A new class is only justified when no
    existing one fits, and then it must take its colors from the tokens
    (`--panel-border`, `--line-*`, `--surface-card`, `--text`, `--muted`,
    `--accent`, `--tier-*`), never a literal hex. New surfaces get their light
    theme value through a token, not through a one-off selector.
13. **Borders and tints are per theme.** `--line-soft/mid/strong` and
    `--panel-border` exist because the dark palette (light blue at 10–28% alpha)
    is invisible on white. Use the tokens for any border; do not hardcode
    `rgba(...)`. A surface that is white on white (card on panel) is not a
    surface: use `--surface-card`.
14. **The light theme is verified, not assumed.** After touching colors, look at
    the screen in both themes (the harness with `?theme=` or the toggle) and
    check that borders are visible and the text/chip has contrast. "It looks
    fine in dark" is not a check.

## Learning-First Delivery

When implementing:

1. Explain what and why.
2. Implement a small step.
3. Show how to test.
4. Confirm expected result.
5. Propose next step.

Aim for: Understand + Build + Practice + Improve.
