# CLAUDE.md

Repository guidance lives in `AGENTS.md`, so that every coding agent reads the
same thing. It is imported here rather than duplicated.

@AGENTS.md

## Claude-specific

- `skills/*/SKILL.md` double as installable agent skills.
  `scripts/install-skill.sh` adds every one of them to your personal Claude or
  Codex skills directory; inside this repo you can just read them in place.
  `schwung-dsp-development` builds a module; `module-architect` designs one
  before any DSP exists; `sonic-reviewer` and `control-interaction` judge one
  from rendered evidence.
