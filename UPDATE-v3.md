# SawHorse v3: projects, build steps and the buy list

This update makes the app match the instruction packets. Every letter, door name and step number in the app is the same as in the printed packet.

## What changes in the sheet

The one-time function `migrateToV3()` does all of this for you:

- **Retired:** the Framing, Frank Float, King Cake and old 6'×6' Mausoleum tabs are renamed "… (old)" and hidden. Nothing is deleted. To get one back, right-click the tab bar and unhide it.
- **One tab per project**, with letters that match its packet:

  | Tab | Status | Tape | Packet |
  |---|---|---|---|
  | Door S | Active | Green | Double doors, Door S parts (saloon pair) |
  | Door R | Active | Purple | Double doors, Door R parts (two regular pairs) |
  | Mausoleum | Active | Yellow | Mausoleum (6'×4') |
  | Roofs | Active | Red | Roofs build booklet + blueprint set |
  | Railing | Plans coming | Orange | Not drawn yet |
  | Cake Topper | Done | Blue | Bundt cake frame |
  | Platform Topper | Done | Blue | Rolling platform upper frame |

- **New tabs:**
  - **Projects:** each area's status (Active, Plans coming or Done) plus links to its instructions.
  - **Steps:** every build step for every unit, numbered like the packets.
  - **Buy:** hardware and supplies per project.
- **Units** are replaced with: the six doors (S-L, S-R, R1-L, R1-R, R2-L, R2-R), Mausoleum, Roofs, plus the two finished toppers.
- **Lumber:**
  - 2x4 now comes in 8' and 12' boards. The Board length cell reads `96, 144`.
  - New sheet sizes: luan, OSB and plywood.
  - Prices already in the tab are kept.
- **Claims:** old "I'm on it" claims are cleared.
- **Kept as they are:** the Crew, Log, Messages, Safety, Stock and Settings tabs.

Letters now repeat between projects (every packet starts at A). That's intended: the tape color tells bundles apart. The app only warns when a letter repeats inside one project.

## Update steps

1. **Apps Script.**
   1. In the Google Sheet, open **Extensions › Apps Script**.
   2. Select everything in `Code.gs`, paste in the new `apps-script/Code.gs`, and save.
2. **Move the sheet to v3.**
   1. In the function dropdown, pick **migrateToV3** and click **Run**.
   2. Approve if asked.
   3. The log ends with `Done. Projects: Door S (Active), …`.
   4. Running it again does nothing, so a double-click can't damage anything.
3. **Deploy.** Go to **Deploy › Manage deployments › Edit (pencil) › Version: New version › Deploy**. This keeps the same URL.
4. **GitHub.** Upload these files over the old ones:
   - `index.html`
   - `leadership.html`
   - `signs.html`
   - `assets/planner.js`
   - `assets/common.js`
   - `assets/crew.js`
   - `assets/leadership.js`
   - `assets/styles.css`
   - `assets/demo-data.js`
   - `apps-script/Code.gs`

   Don't touch `assets/config.js`.
5. **Check it.**
   1. Open `…/exec?view=version` and confirm it says `2026-10-09a`.
   2. Open the crew page and refresh. The area menu should show the new projects, with "(done)" and "(plans coming)" tags.

## Do these after updating

- **Prices.** In the Lumber tab:
  - Add the 12' 2x4 price after the 8' one, for example `3.35, 5.48`.
  - Add prices for luan and plywood.
- **Tape colors.** Check the Tape Colors tab against the tape you actually have.
- **Instruction links.** The links in the Projects tab point to the packets. The crew can only open them once each packet is shared: **Share › Anyone with the link**. Or clear the link cell to hide it.

## What the crew sees

- **Area menu:** each project, with "(done)" or "(plans coming)" where it applies.
- **Banner:** the tape color, the project status, and links to its instructions.
- **Build tab:** each unit has its packet's steps as checkboxes.
  - Checking off a step stages it. It's saved with the usual sign-off (name, PIN, photo).
  - The unit moves to Building at the first step and to Built when every step is done.
- **Buy tab:**
  - Lumber still needed, for this project alone and for the whole shop (8' and 12' boards listed separately).
  - The hardware list. Mark an item Bought and sign off with a photo of the receipt.
  - Bought lumber goes in through **Count spare wood**, and the list shrinks.
- **Leadership page:** a Projects table (status, cut progress, steps, hardware), a steps column in Assembly, and a Hardware panel.
- **Daily email:** step progress and the hardware still to buy.
