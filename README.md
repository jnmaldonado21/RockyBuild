# Cut list tracker

Three pages for the build, hosted free on GitHub Pages, with a Google Sheet as the shared database.

- **Crew page** (`index.html`): everything the crew needs on the shop floor.
  - The checklist, where they track and sign off on cuts with their name and a photo.
  - Board-by-board cut plans that use spare wood first.
  - A form for counting the spare wood pile.
  - The labeling and bundling guide.
  - An optional safety check-in.
  - A first-run tour of how to use the app.
  - Sign-up with a 4-digit PIN, so every save is tied to a real person.
  - An "I'm on it" button so people can see who's working on what.
  - A Build tab showing which units have all their parts and are ready to assemble.
  - Messages to leadership.
- **Leadership page** (`leadership.html`): the overview for you and the directors.
  - Progress overall and per area.
  - What to buy after the spare wood is used.
  - Lines the crew flagged as Need to Purchase.
  - Who's working on what right now, and assembly status for every unit.
  - The crew list, with PIN resets.
  - The question inbox and safety check-ins.
  - A photo feed of every sign-off.
  - A button to email yourself the summary.
- **QR signs** (`signs.html`): printable signs, one for each area's stack and one for the saw station.

```
index.html            Crew page
leadership.html       Leadership page
signs.html            Printable QR signs
assets/config.js      The only file you edit (API URL, title, bundle size, kerf)
assets/planner.js     Cut planner (also copied into the bottom of Code.gs)
assets/common.js      Shared code
assets/crew.js        Crew page
assets/leadership.js  Leadership page
assets/qrcode.js      QR encoder (Kazuhiko Arase, MIT license)
assets/styles.css     Shared styles
assets/demo-data.js   Your cut list, used only in demo mode
SETUP.md              Step-by-step setup
apps-script/Code.gs   Backend; goes in the Google Sheet, not on GitHub
```

Every page runs in demo mode until `config.js` has an API URL. In demo mode, all features work, but data stays in that browser. The demo leadership PIN is `1234`.

## Setup

Follow **[SETUP.md](SETUP.md)**. It covers the Google Sheet, the Apps Script backend, GitHub Pages, a test run, and how to make changes later.

## Features

### Spare wood and cut plans

The crew counts the spare wood pile on the crew page (**Cut plan > Count spare wood**). They pick a size, then enter usable lengths and counts, like "74" ×6" or "96" ×25".

- **A full recount** replaces what's on file for that size.
- **More boards** adds to it. Use this for deliveries.

The cut plan then fits every piece still to cut into that wood and puts the rest on new 8' boards.

- **Kerf:** Every cut allows 1/8" for the blade. Twelve 8" pieces need two boards; eleven fit on one.
- **Mixed areas:** Areas share boards to save lumber. A colored stripe on each piece shows which area's stack it goes to.
- **Area view:** Choosing an area shows only boards that include that area's pieces. There's a link to show every board in the shop.
- **Order:** Spare wood boards are listed first. Offcuts 2' or longer are flagged as worth keeping.
- **How the plan is built:** The planner tries three strategies and keeps whichever needs the fewest new boards. It was checked against 200 random spare-wood piles, and every plan was valid.

### Lumber to buy

On the leadership page, **To buy** = new boards the plan needs + the extra % from the Lumber tab. There's no separate "purchased" count. When a delivery arrives, the crew adds it with **Count spare wood > More boards**.

**Recount before you buy.** The spare count is a snapshot. As the crew cuts, they use up spare wood, but the count on file doesn't change. The leadership page and the daily email warn you when sign-offs have happened since the last count.

The "8' studs" at most stores are precut to 92 5/8", which is too short for the 96" pieces. Buy true 96" boards, and count any precut studs in the pile at 92 5/8". There's a quick-add button for that.

### First-run tour

The first time someone opens the crew page on a device, a short tour explains the app in 10 slides, organized as **Tackle** (claim a task and cut it), **Track** (update as you go), and **Complete** (sign off with a photo). Each slide shows a copy of the actual button or screen it describes.

- **Getting around:** people can move through it with Next and Back, the dots, swiping on a phone, or the arrow keys.
- **Skipping:** anyone can skip it.
- **Finishing:** the last slide opens sign-in if they haven't joined yet.
- **Replaying:** **How to use TTC** at the top of the page replays it anytime.
- **The saw-station sign:** scanning that sign opens the safety check-in instead of the tour.

The app name comes from `appName` and `appShort`, which default to "Tackle, Track, Complete" and "TTC". To change them, add either one to `config.js`.

### Crew sign-in

Crew members join from the crew page: they tap **I'm new**, enter their name, and get a random 4-digit PIN. The phone remembers them after that. On another phone, or after signing out, they pick their name and enter the PIN.

**What needs a PIN:** looking at the checklist, cut plan, and guides doesn't. Saving does, including sign-offs, claims, messages, safety check-ins, and spare-wood counts. The server checks name and PIN on every save, so no one can sign off as someone else.

**Protections:**
- **Duplicate names:** Joining with a name that's already taken is refused, with a suggestion to add a middle initial.
- **Guessing:** After 5 wrong PINs, that name is locked for 15 minutes.

**Where PINs live:** PINs are stored in the **Crew** tab so leadership can look one up, and the website never sends them out. They're assigned randomly, not chosen, so nobody's reusing a PIN they use elsewhere. Leadership can issue a new PIN from the leadership page's **Crew** section.

### Who's working on what

Every checklist line and every unit has an **I'm on it** button.

- **Tapping it:** Your name shows on that item for everyone within about 20 seconds, and on the leadership page under "Who's working on what."
- **Two people at once:** If two people tap the same item at the same moment, the server gives it to the first one and tells the second.
- **Editing someone else's item:** Changing a line someone else claimed asks "Sam is working on C. Make changes anyway?" It doesn't block you, since people often work in pairs.
- **When claims clear:** A claim clears when that person signs off the line as Bundled (or the unit as Built), taps **Done for now**, or after 6 hours. **Take over** is for when someone leaves without clearing theirs.

Pages refresh every 20 seconds and whenever someone comes back to the tab. That isn't instant push, which would need a paid real-time database, but it's enough to keep a shop from doubling up.

### Assembly (Build tab)

The **Units** tab lists the things that get built and the pieces each one uses, like `4' door #1 | F×2, G×2, H×2`. `setup()` fills in a starting list:

- the front wall framing, the front wall MDF, and the upper back wall MDF;
- two 4' doors and four 2' doors;
- the lower roof, upper roof, and railing;
- the Mausoleum;
- the rolling platform, the King Cake frame, and the jaw frame.

**How readiness works:** Bundled pieces are assigned to units in order, and units already being built go first. A unit shows as **Ready to build** once all of its pieces are covered. The Build tab groups units into Ready to build, Being built, Waiting on parts, and Built.

**Stages:** Not started → Building → Built → Finished → Loaded in. Changing a stage requires a sign-off with a name and photo, the same as cuts.

To change a unit, edit the Units tab: one row per physical unit, with parts written as `Label×count` and separated by commas. Labels are looked up in that unit's own area tab.

### Signing off

- **What's required:** Changes stay on the phone as "Not saved yet" until someone signs off. Signing off needs a name and a photo. A note is optional.
- **Edit conflicts:** If someone else changed the same line in the meantime, that change is blocked instead of overwriting theirs.
- **Where it's recorded:** Every save is written to the Log tab.

### Safety check-in (optional)

The crew page offers a one-minute check-in at the start of each day. The saw-station sign opens it directly.

- **Checklist:** safety glasses, hearing protection, dust collection running, no gloves at the saw (gloves are for carrying lumber), shop clothing, guards in place, unplug before blade changes, trained on today's tools, and a clear work area.
- **Reference:** Each item links to a reference section with the relevant OSHA general industry standard (1910.133, 1910.95, 1910.132/138, 1910.213, 1910.242/243, and 1910.22). It notes that OSHA legally covers employers, and the shop follows these rules as its standard.
- **Records:** Check-ins are saved to the Safety tab, and leadership sees who checked in today.

### Daily summary email

The daily email goes to you, so you can edit it and forward it to the directors. It includes:

- progress and pieces bundled since the last email, with thanks to whoever did the work;
- per-area status;
- flagged lines and open questions;
- lumber still to buy, with cost, and a recount warning when the spare wood count is out of date;
- safety check-ins and each sign-off, with photo links.

It skips days with no activity unless you change that in Settings. **Email me a summary** on the leadership page sends one immediately. That button needs the PIN.

## Limits and security

- **Load:** About 30 people is comfortably within Google's free limits.
- **Who can change things:** Anyone with the crew link can sign off. The name and photo requirement, plus the Log tab, make every change traceable, but it isn't a login.
- **Who can read things:** Anyone with the leadership link can read it. Only replying to messages and sending the summary need the PIN.
