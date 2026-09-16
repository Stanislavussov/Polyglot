# Release notes

What a user actually reads after a deploy. One short, friendly line per change, written by
the developer to a person — not a commit log, not a spec.

Today they reach the `admin` and `tester` audience groups only (`RELEASE_AUDIENCE_GROUPS`
in `deploy.yml`); everything here is written as if the whole product read it, because one
day it will.

## Where they live

```
@docs/releases/
  languages.json      required languages — English plus every language our users read
  unreleased/
    en.md             the spine: one bullet per change, English always
    ru.md             the same bullets, same order, translated
```

`unreleased/` is the queue of notes that have not reached a given reader yet. It is not a
per-release folder: a note is delivered per *note*, not per deploy (see below), so the same
file survives many releases. Archive a batch into `@docs/releases/<YYYY-MM-DD>/` when the
queue gets long — archived files are history and are never delivered again.

## Writing one

**The reader is a customer, never a developer or a tester.** They do not know the codebase,
they did not read the ticket, and they will never see the admin panel. The bar for a note is
that someone using the bot reads it and thinks *"о, прикольная штука!"* — a small, pleasant
thing they can go and try. If a bullet only means something to someone who has seen the
code, it is not a release note.

- One `- ` bullet, one sentence, one change. If it needs a second sentence, spend it on what
  the reader gets, never on how it was built.
- Say what a person can now do, in their words: "Карточки теперь сами выбирают слова,
  которые вы забываете." Write it the way you would tell a friend who uses the bot.
- Banned from the text: table and column names, file paths, migrations, ticket ids, the
  admin panel, tests, refactors, deploys, models, prompts, "API", "schema", "fix".
- No note at all is better than an honest one nobody can use. An internal change gets the
  escape hatch below, not a bullet nobody outside the team can read.
- Same bullets, same order, in every required language. `en.md` is the spine: a translated
  file with a different bullet count is ignored wholesale and everyone gets English.

Example:

```markdown
# Unreleased — en

- Cards now pick the words you keep forgetting, not random ones.
- The daily word asks a different question each time.
```

## How a note reaches a reader

Each note's id is a hash of its **English** text, so a note is announced to each user
exactly once, no matter how many deploys go out afterwards (`release_announcement_deliveries`,
with `release_id = note:<hash>`). Editing an English bullet mints a new id and re-announces
it — edit freely before a release, deliberately after one.

The reader gets the note in their interface language, falling back to their native language
and then to English. The bot renders them under one localized header (`releaseNotesHeader`).

**Nothing is announced automatically.** Releases go out several times a day, and a reader
must not get several messages a day — so a deploy ships the notes and says nothing. An
editor opens **📣 Release notes** in the admin panel, picks the notes worth telling people
about, edits the wording if it needs it, and presses send; the panel writes a job row and
the bot (the only service holding the bot token) carries it out within seconds and reports
back what was delivered. An edit made there is what gets sent — it never travels back into
the repository. Testers and admins can re-read the current queue at any time with `/changes`.

## Required languages

`languages.json` lists what CI enforces: English plus every language our users read. Refresh
it from the production database when the audience changes:

```sql
select distinct lang from (
  select interface_lang as lang from user_language_settings s
  join users u on u.id = s.user_id where u.is_active
  union
  select native_lang from user_language_settings s
  join users u on u.id = s.user_id where u.is_active
) l order by lang;
```

A language the bot has no locale file for cannot be a required language — the header would
be English anyway. Supported codes: `en ru cs de fr es it pt uk pl kk`.

## The CI gate

`pnpm lint:release-notes` (a step in `ci.yml`) fails when:

- a required language file is missing, empty, or has a different bullet count than `en.md`;
- a change touches code (`apps/`, `packages/`, `deploy/`, `scripts/`, workflows, root
  config) without touching `@docs/releases/unreleased/`.

Escape hatch for a change no user can see: put `[skip notes]` in the commit message. It is
read from the commits in the diff, so it never hides a later change.
