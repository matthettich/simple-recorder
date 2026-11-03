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

Recordings stay on the phone (in the browser's storage). Emailing a take is the way to keep a copy somewhere else;
takes that haven't been emailed yet say so in the list. If the browser won't promise to keep its storage, the note at
the bottom of the page says so.

## Safety nets

- **Nothing is lost if the app dies mid-take.** The sound is saved to the phone every second while recording. If the app
  is closed, crashes or the battery dies, the take is put back together the next time the app opens, marked *(rescued)*.
- **If the phone can't store a take** (out of space), it goes to Downloads instead.
- **Taps:** a double-tap on REC or STOP counts as one tap.
- **Mic:** Automatic uses a USB mic when one is plugged in, never Bluetooth earbuds. If the mic goes away mid-take
  (unplugged, a phone call), the take stops and is kept.
- **WAV:** a mic that's really mono (most phone mics) is saved as mono, so files are half the size.
- **Email:** if the phone won't share the file type, a WAV is made instead, decided fresh each time.

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

The tests cover the failure paths too: double taps, STOP-then-REC, a crash mid-take, a full phone, a mic that goes away,
share refusals, a dead network, and moving recordings from the old storage layout.
