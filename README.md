# Live Slides

Upload a Canva deck, project the host screen, and let the audience scan a QR code. Every phone shows the same slide full screen, and when you change slides, draw, highlight, or use the laser pointer, it appears on their phones within a fraction of a second.

It's a static site, like Our City. GitHub Pages hosts the files and Firebase Realtime Database carries the live sync. There is no server to run.

## Files

| File | What it is |
| --- | --- |
| `index.html` | The only page. Host, phones and home screen are all served from it. |
| `app.js` | The whole app. `FIREBASE_URL` at the top points to your database. |
| `app.css`, `tailwind.config.js` | Same look as Our City. |
| `database.rules.json` | The Firebase rules this app needs. |
| `.nojekyll` | Tells GitHub Pages to serve the files as they are. |

## Setup (about 10 minutes, one time)

### 1. Firebase

`app.js` already points at the Our City database (`our-city-gcks`). The slides use their own paths (`slideRooms/` and `slideRoomIndex/`), so they never touch the game's data.

1. Open the [Firebase console](https://console.firebase.google.com), choose the project, then **Build → Realtime Database → Rules**.
2. Add the two entries from `database.rules.json` (`slideRooms` and `slideRoomIndex`) inside your existing `"rules": { … }` block, next to what's already there, and click **Publish**. If your rules are already `".read": true, ".write": true` at the top level, you can skip this.

To use a separate Firebase project instead, create one, add a Realtime Database (Spark plan is free), paste `database.rules.json` into its Rules tab, and put its URL in `FIREBASE_URL` in `app.js`.

### 2. GitHub Pages

1. Create a new repository and upload all the files in this folder (including `.nojekyll`).
2. **Settings → Pages → Build and deployment**: Source **Deploy from a branch**, branch **main**, folder **/ (root)**. Save.
3. After a minute your site is live at `https://<your-username>.github.io/<repo-name>/`.

For a custom domain like `slides.nguyeningproductions.com`, add it under **Settings → Pages → Custom domain** and add a CNAME record at your DNS provider, the same way `city.` is set up. Don't copy the CNAME file from Our City; each site needs its own.

## Exporting from Canva

**Share → Download → PDF Standard**, and tick **Flatten PDF** so fonts and effects render exactly as designed. (PNG works too: download all pages, unzip, and select all the images. They're ordered by file name.)

Animations, transitions and videos don't carry over; each slide shows its final frame. Slides are stored at 1920 px wide, so they're sharp on a 1080p projector.

## Presenting

1. Open the site on the computer connected to the projector, add a title, choose the PDF, and click **Create room**.
2. The lobby shows the QR code, a four-letter code, and how many phones have joined. Phones start downloading every slide while they wait, so changes are instant once you begin.
3. Click **Start presentation** and press **F** for full screen.

Move the mouse to bring up the toolbar along the bottom; it hides itself when the mouse rests. With no tool selected, clicking the slide goes to the next one. Presentation clickers work because they send Page Down and Page Up.

| Key | Action |
| --- | --- |
| → ↓ Space Page Down | Next slide |
| ← ↑ Page Up Backspace | Previous slide |
| P / H / E / L | Pen, highlighter, eraser, laser pointer (press again to turn off) |
| Z or Ctrl+Z | Undo last drawing |
| C | Clear drawings on this slide |
| Q | Show the join screen again (latecomers) |
| F | Full screen |
| Esc | Put the tool down, or close the join screen |

Drawings stay on their slide, so when you go back to a slide, your notes are still there, on every phone. Someone who joins late sees the current slide and its drawings immediately.

If the host browser is refreshed or closed, open the site again and click **Resume room**. Everything picks up where it was.

**End** (the power button) deletes the room and its slides for everyone; phones see a "presentation has ended" screen.

## Notes

**Phones.** A grey **Fullscreen** button stays in the top right corner of every phone until they tap it. Android phones and iPads use the browser's normal full screen. iPhones don't allow that for web pages, so on iPhone the button plays a live copy of the slide (with your drawing and laser) in iPhone's own full-screen video player. Tapping the screen in that player shows the video controls for a moment, which is normal.

The iPhone video mode is on by default. Turn it off with the **Full screen on iPhones** checkbox when you create the room, or later on the join screen (press **Q** during the talk). The change reaches phones immediately. When it's off, iPhone viewers are told to turn the phone sideways instead.

**Capacity.** Firebase's free plan allows 100 simultaneous connections and 10 GB of downloads a month. A 30-slide deck is roughly 8 to 12 MB per phone, so a 20-person session uses about 200 MB. Rooms are deleted automatically two days after they're created (the clean-up runs whenever a new room is made).

**Security.** Like Our City, there are no logins. Anyone with the code can watch, which is the point. The rules don't stop a technically skilled person from writing to a room's data directly, so don't put anything confidential in a deck. If you ever need that, the next step is Firebase Anonymous Authentication with rules that let only the host's account change the slide.

**Screens stay awake.** Phones (and the host computer) are kept from dimming or locking for as long as the page is open, in full screen or not. On iPhone this uses a tiny silent looping video in addition to the browser's wake lock, so it works on older iOS versions too. If a phone's Low Power Mode is on, iOS may still dim it.
