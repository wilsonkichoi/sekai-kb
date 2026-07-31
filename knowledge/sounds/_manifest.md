---
sounds:
  - title: Surf wash on the cove shingle
    location: Lantern Cove, north end
    credit: Synthesized demo clip generated with ffmpeg for the sekai-kb template. Not a field recording of any real place.
    file: /media/sounds/surf-wash.mp3
    date: 2026-07-30
  - title: Bell buoy off the point
    location: Offshore of the marine preserve
    credit: Synthesized demo clip generated with ffmpeg for the sekai-kb template. Not a field recording of any real place.
    file: /media/sounds/bell-buoy.mp3
    date: 2026-07-30
  - title: Wind through the coastal sage
    location: Summit Ridge Trail, above the cove
    credit: Synthesized demo clip generated with ffmpeg for the sekai-kb template. Not a field recording of any real place.
    file: /media/sounds/ridge-wind.mp3
    date: 2026-07-30
---

# Soundscape manifest

The frontmatter above is the whole contract: `sounds` is a list, and each item
carries `title`, `location`, `credit`, and `file`, plus an optional `date`. The
page at `/soundscape` renders one native `<audio>` player per entry, in this
order. Everything below the frontmatter is free-form notes for whoever maintains
this file; the page never renders it.

`file` is a site-root-absolute path resolved under `public/`, so
`/media/sounds/surf-wash.mp3` is `public/media/sounds/surf-wash.mp3` on disk. An
entry whose file is missing is dropped with a build-time warning naming it, and
the rest of the list still renders.

The leading underscore in this file's name is load-bearing. Three separate
scanners walk `knowledge/` looking for articles, and all three skip files whose
name starts with `_`. Rename this file and the article pipeline will try to
validate it as an article that has no title, description, date, or category.

## About these three clips

Marisol Cove is a fictional demo town, so it owns no field recordings. These are
short synthesized clips: filtered noise beds and a two-partial tone, generated
with ffmpeg purely so the player and the page layout are provable in a repository
that ships them. Each `credit` says so. Replace all three with your own
recordings when you adopt the template — the init wizard removes them for you,
and the page shows its empty state until you add your own.
