# Simple recorder

Record guitar on your phone, play it back, and email a take to yourself.

Open it at **https://matthettich.github.io/simple-recorder/**

## Using it

- **Record:** press **REC**. Press **STOP** when done. The take is saved straight away.
- **Email:** tap *Email to myself*, then pick Gmail (or Mail). A new email opens with the recording attached.
- **Delete:** tap the bin. Tap **Undo** at the bottom if it was a mistake. Deleted takes also sit under
  *Recently deleted* for 30 days, where they can be restored.
- **Listen:** tap any recording; it plays just that one. Settings → *Play the next recording* carries on down the list.
- **Rename:** tap **Name**.

Recordings stay on the phone (in the browser's storage). Emailing a take is the way to keep a copy somewhere else.

## Install it

**Android:** open the link in Chrome. A card at the top offers **Install app**; tap it.
**iPhone:** open the link in Safari, tap Share, then **Add to Home Screen**.

## Later ideas

- **Email without the share menu:** a small Google Apps Script could send each take straight to his inbox,
  with his address already filled in, so Email is one tap. For now the share menu opens Gmail with the file attached.
- A playlist view with shuffle/repeat, and multitrack recording.

## Updating the app

After you change `index.html`, open `sw.js` and bump `CACHE` (for example `simple-recorder-v2`).
Installed copies then show **New version ready · tap to update**.

## Tests

A phone-sized Chromium with a fake microphone:

```
npm i -D playwright && npx playwright install chromium   # once
node tests/app.test.mjs
```
