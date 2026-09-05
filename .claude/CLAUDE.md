# bedrock

This project uses **bedrock** as a small project cockpit for AI-agent work.
All project context lives in `./bedrock/`.

## Project cockpit

- `Memory/` = what the project knows
- `Work/` = what matters now
- `Views/` = generated human inspection views

Legacy folders such as `History/`, `Evidence/`, `Outputs/`, or `Sessions/`
may still exist for compatibility. They are not the main user-facing model.

## On session start

If `./bedrock/` does not exist but `./agent-knowledge/` does, this project needs migration:

```bash
bedrock migrate-vault && bedrock refresh-system
```

Otherwise:

1. Read `./bedrock/STATUS.md`
2. If `onboarding: pending` -- read `AGENTS.md` and perform First-Time Onboarding
3. If `onboarding: complete` -- read `./bedrock/Memory/PROJECT.md`
4. Read `./bedrock/Work/NOW.md`
5. Load only the relevant Memory branches for the task

## After meaningful work

- Update stable project knowledge in `./bedrock/Memory/`
- Update current priorities and open loops in `./bedrock/Work/`
- Run `/memory-update`

## Periodic

- Run `/system-update` every few sessions to refresh integration files

## When the context window is getting long

- Run `/compact-context`

## Generated site

`bedrock view` builds a styled HTML site from the vault with emoji icons, TOC, Mermaid diagram rendering, and wikilink navigation. These are HTML-only features — plain-text rules (no emojis in code/responses) do not apply to the generated site.

## Git sync protocol (every session, any device — Mac, Cowork cloud, phone)

GitHub is the source of truth between the owner's Mac and Claude sessions.

- **Session start:** `git pull` (then the bedrock reads above).
- **After meaningful work / session end:** update `./bedrock/` (Memory + Work/NOW.md) and the
  project docs (PRD / NOTES), then `git commit` and **`git push`** — never leave work unpushed.
- Commits are authored as Oran Weisz <oranwv@gmail.com>.
- From the Cowork device sandbox, pushes authenticate with the owner's GitHub fine-grained token
  stored OUTSIDE the repos at `../.claude-git-token` (i.e. `~/Projects/.claude-git-token`);
  `.git/config` of this repo already points its credential helper there. Never copy that file
  into the repo, never print it, never commit it.
- Work in this repo through the `~/Projects/<repo>` path so the relative token path resolves.
