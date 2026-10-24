# Spoilit

A Chrome extension that hides Reddit posts and comments about movies, shows and games you haven't caught up on yet, without muting whole communities. Hidden items show as dark bars; click one to reveal it.

## Install

There is no build step. The extension is plain JavaScript loaded as is.

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick this folder.
4. Pin the Spoilit icon from the puzzle-piece menu so the popup is one click away.

After editing any file, click the reload icon on the extension's card, then reload open Reddit tabs. Popup changes show up the next time you open it.

## Use

1. Click the icon and type a title. Pick a result, or "Just hide posts that say ..." for a plain keyword.
2. Spoilit looks the topic up once (a few seconds to a minute) and saves the terms it finds.
3. Browse Reddit as usual. The badge on the icon counts what's hidden on the current tab.

Comments are checked one by one, so a comment naming a character gets hidden anywhere. On the page of a post that matched, the whole comment section is covered too, since most replies never name anything. Click the cover to reveal it.

In the popup you can switch topics on and off, pause everything, edit the term and subreddit lists, look a topic up again, or remove it. **Settings** has the comment-hiding toggle, a test box to see what a piece of text would match, and an optional Claude API key.

## How it finds terms

When a topic is added, `background.js` collects terms from:

- **Wikidata**: titles, aliases, sequels and parts, characters, cast, episode titles and official subreddits.
- **The topic's Fandom wiki**: page titles such as characters, places, bosses and items. Spoilit uses the wiki listed on Wikidata, or guesses one and checks that it really covers the topic.
- **Claude (optional)**: only if an API key is set in Settings. Without a key, "Copy chatbot prompt" lets you ask any chatbot and paste its reply back in.

Single common words ("hopper", "rose", "finale") are dropped using `words.js`, so they only count as part of a longer name.

Terms are saved in `chrome.storage.local` and never refreshed automatically. Click **Look up again** to add new ones; your manual edits are kept. Matching on Reddit is fully local and makes no network requests.

## Files

| File | What it does |
| --- | --- |
| `manifest.json` | Extension manifest (MV3) |
| `background.js` | Service worker: topic storage, lookups, badge |
| `sources.js` | Wikidata, Fandom and Claude lookups |
| `match.js` | Keyword matcher shared by every page |
| `words.js` | Common words and first names to ignore on their own (generated, see below) |
| `content.js`, `content.css` | Hides and reveals items on reddit.com |
| `popup.*` | Toolbar popup for managing topics |
| `options.*` | Settings page |
| `ui.css` | Shared styles and colors |

## words.js

`words.js` is generated and checked in, so there's nothing to run. It was built from:

- The 10,000 most common English words ([google-10000-english](https://github.com/first20hours/google-10000-english), 20k list).
- The 1,200 most common US male and female first names (census lists).
- A hand-written list of words used about any show or game (finale, trailer, spoiler, boss, dlc...).

To change it, edit the `Set` in the file directly.

## Limits

- Images and memes with no matching text get through, unless they're posted in a subreddit on the topic's list.
- Matching is aggressive, so some unrelated posts get hidden too. They're one click away.
- Reddit's markup changes now and then; the selectors live at the top of `content.js`.
