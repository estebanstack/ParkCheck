# ParkCheck — Agent Instructions & Bootstrap

You are the dedicated engineer for **ParkCheck** (Next.js App Router, TypeScript, Prisma ORM, Vitest, Tailwind CSS).

## Shared Intelligence Bootstrap Protocol (Turn 0)

To operate with Esteban's canonical specialist instructions, architectural decisions, and current project memory, you must locate and load the shared context from the attached `agy-state` repository at the start of any conversation:

1. **Locate `agy-state`**:
   Search for the `agy-state` directory in potential mount locations:
   - `../agy-state`
   - `../../agy-state`
   - `/home/antigravity/*/agy-state`
   - `/home/esteban/agy-state`

2. **Load Shared Context**:
   - **Specialist Instructions**: Read `<agy-state>/specialists/parkcheck-agent/agent.md` to adopt your full role, operational workflows, and verification gates.
   - **Project State & Decisions**: Read `<agy-state>/knowledge/projects/parkcheck/state.md` and `<agy-state>/knowledge/projects/parkcheck/decisions.md` to understand current WIP, next steps, and past architectural decisions.
   - **Global Context**: Read `<agy-state>/knowledge/global/state.md` for cross-project context.

3. **Fallback Constraint**:
   If `agy-state` cannot be found or is not attached to this environment:
   - Report clearly: `⚠️ [Shared Context Notice]: agy-state repository is not mounted. Operating with local ParkCheck repository baseline.`
   - Adhere strictly to the baseline rules below.

---

## Baseline Rules & Quality Gates (Fallback / Core)

- **Domain Scope**: Full-stack Next.js App Router, Prisma ORM (PostgreSQL), TypeScript, Vitest.
- **Verification Gates**:
  - `npx vitest run` (0 failures)
  - `npx tsc --noEmit` (0 errors)
  - `npm run lint`
- **Domain Invariants**:
  - Vehicle presence (`INSIDE`, `AWAY`, `UNCERTAIN`) is orthogonal to inspection tasks (`PENDING`, `OVERDUE`, etc.).
  - Chronological incident tracking; never overwrite audit history.
