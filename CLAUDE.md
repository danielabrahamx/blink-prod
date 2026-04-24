# Blink (Sibrox) — Project Context

@../SibroxVault/claude-context/sibrox-overview.md
@../SibroxVault/claude-context/blink.md

---

## v2 architecture note (supersedes the vault doc where they disagree)

As of `v2-browser-demo` (2026-04-21), Blink is a browser-only demo. The
vault's blink.md is still correct for historical v1 real-mode context
but describes a system that no longer ships publicly.

- No Electron. No backend. No Postgres. No x402 or Circle at runtime.
- Everything at `/live` runs in the tab against
  `frontend/src/lib/simulationClient.ts`.
- Desktop work from the founder-dogfood era is preserved at the
  `v0.1.0-founder-dogfood` tag and is not on `main`.
- The only rater is the location band (home/near/away) defined in
  `frontend/src/lib/rulebookV2.ts`. Battery is a display flag only.
- All accrual math is integer µ-USDC (USDC's 6-decimal floor). GBP is
  a display conversion only, never settled on.

Read `docs/STATUS.md` for what shipped, what was verified, and what
smoke-gates remain. Read `.gstack/projects/danielabrahamx-blink/
BUILD-PLAN-V2-HANDOFF.md` for the canonical v2 spec.

---

## Workflow Orchestration

### 1. Plan Mode Default

- Enter plan mode for ANY non-trivial task (3+ steps or architectural decisions)
- If something goes sideways, STOP and re-plan immediately - don't keep pushing
- Use plan mode for verification steps, not just building
- Write detailed specs upfront to reduce ambiguity

### 2. Subagent Strategy to keep main context window clean

- Offload research, exploration, and parallel analysis to subagents
- For complex problems, throw more compute at it via subagents
- One task per subagent for focused execution
- **Always dispatch independent subagents in parallel** — single message, multiple Agent tool calls. Serial dispatch is a bug, not a choice. If 2+ agents have no shared state, they run concurrently.

### 3. Self-Improvement Loop

- After ANY correction from the user: update 'tasks/lessons.md' with the pattern
- Write rules for yourself that prevent the same mistake
- Ruthlessly iterate on these lessons until mistake rate drops
- Review lessons at session start for relevant project

### 4. Verification Before Done

- Never mark a task complete without proving it works
- Diff behavior between main and your changes when relevant
- Ask yourself: "Would a staff engineer approve this?"
- Run tests, check logs, demonstrate correctness

### 5. Demand Elegance (Balanced)

- For non-trivial changes: pause and ask "is there a more elegant way?"
- If a fix feels hacky: "Knowing everything I know now, implement the elegant solution"
- Skip this for simple, obvious fixes - don't over-engineer
- Challenge your own work before presenting it

### 6. Autonomous Bug Fixing

- When given a bug report: just fix it. Don't ask for hand-holding
- Point at logs, errors, failing tests -> then resolve them
- Zero context switching required from the user
- Go fix failing CI tests without being told how

## Task Management

1. **Plan First**: Write plan to 'tasks/todo.md' with checkable items
2. **Verify Plan**: Check in before starting implementation
3. **Track Progress**: Mark items complete as you go
4. **Explain Changes**: High-level summary at each step
5. **Document Results**: Add review to 'tasks/todo.md'
6. **Capture Lessons**: Update 'tasks/lessons.md' after corrections

## Core Principles

- **Simplicity First**: Make every change as simple as possible. Impact minimal code.
- **No Laziness**: Find root causes. No temporary fixes. Senior developer standards.
- **Minimal Impact**: Changes should only touch what's necessary. Avoid introducing bugs.