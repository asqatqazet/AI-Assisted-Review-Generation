# 00 · Harness setup — mattpocock/skills

## Correction first

There is **no `/engineering:system-design`** skill. The pack is flat-namespaced — no `engineering:`
prefix exists. The skills that do that job are `codebase-design`, `domain-modeling`,
`decision-mapping` and `improve-codebase-architecture`.

Sources: [skills.sh/mattpocock/skills](https://skills.sh/mattpocock/skills) ·
[github.com/mattpocock/skills](https://github.com/mattpocock/skills) ·
[aihero.dev setup guide](https://www.aihero.dev/skills-setup-matt-pocock-skills)

## Install

```bash
npx skills@latest add mattpocock/skills
```

Interactive. It asks two things:

1. **Which skills** — see the selection below.
2. **Which agents** — writes to `~/.claude/skills/` for Claude Code, `~/.agents/skills/` for Codex and
   any other harness following the Agent Skills standard. Select both if you want the two-harness story.

> **On "install into ChatGPT":** Agent Skills work in **Codex** (OpenAI's coding agent, CLI and IDE),
> not in the chatgpt.com web app. If you meant Codex, it is supported and installing into both Claude
> Code and Codex is exactly the multi-harness evidence the assignment rewards. If you meant the web app,
> that path does not exist — use Codex instead.

Then, inside the repo, run the bootstrap:

```
/setup-matt-pocock-skills
```

It is deliberately non-invokable by other skills — you must type it. It is prompt-driven: it inspects
the repo, asks you to confirm what it found, and writes `docs/agents/issue-tracker.md`,
`docs/agents/domain.md`, and an `## Agent skills` block into `CLAUDE.md` or `AGENTS.md`.

### One trap that will bite you

The file-selection rule is *"edit `CLAUDE.md` if it exists, else `AGENTS.md`"*. The assignment requires
**`AGENTS.md`** as the cross-harness document and `CLAUDE.md` only as a Claude-specific complement.

**Create `AGENTS.md` first and do not create `CLAUDE.md` until after `/setup-matt-pocock-skills` has
run.** Otherwise the pack writes its block into `CLAUDE.md` and your cross-harness document is the one
without it — precisely backwards from what is being evaluated.

## Which skills to select

| Skill | Used for | When |
|---|---|---|
| `setup-matt-pocock-skills` | mandatory bootstrap | once, first |
| `domain-modeling` | settle entities, invariants, ubiquitous language | before any code |
| `codebase-design` | module boundaries, package graph | before any code |
| `decision-mapping` | force the real trade-off out of a decision | per ADR |
| `grill-me` | adversarial interrogation of your own design | after each design doc |
| `to-spec` | turn the decided design into a written spec | feeds `SPEC.md` |
| `to-tickets` | turn the spec into executable tickets | feeds `stories/` |
| `tdd` | red → green → refactor loop | every domain story |
| `implement` | the build loop | every story |
| `code-review` / `review` | review gate | every story |
| `qa` | verification pass | every story |
| `handoff` | context transfer between sessions | end of each day |
| `wayfinder` | orient in an unfamiliar area of the repo | as needed |
| `diagnose` | debugging loop | when something breaks |
| `ubiquitous-language` | keep naming consistent | when terms drift |

Skip: the writing/article skills, `obsidian-vault`, `scaffold-exercises`, `caveman`, `migrate-to-shoehorn`.

## The loop you will actually run, per story

```
domain-modeling / codebase-design   → only at the start, and when a boundary is genuinely in question
decision-mapping                    → when a story carries an architectural choice; output an ADR
tdd                                 → domain stories: failing test committed first
implement                           → the build
review                              → self-review before you look at it
qa                                  → verification against the story's acceptance criteria
handoff                             → written at the end of each working day
```

Commit the artifacts each stage produces under `docs/workflow/<TS-id>/`. **The artifacts are the
evidence** — the assignment says so explicitly: *"not a prose essay in SPEC.md, but evidence the
workflow ran."*

## Two-harness setup, done honestly

Claude Code drives. Codex reviews. After each story, run the adversarial prompt in
`02-ARCHITECTURE-DIALOGUE.md` §5 inside Codex, and commit its output to
`docs/workflow/<TS-id>/review-adversarial.md` **with your accept/reject reasoning appended.**

The rejections demonstrate judgment better than the acceptances do. That is real multi-harness fluency
with a purpose, rather than a checkbox.
