# Setup guide

About 45 minutes from start to a working site. You'll need:

- a **personal Google account** (not a university one; see Part 1, step 1);
- a **GitHub account**;
- this repo, unzipped: `cut-tracker.zip`;
- the corrected spreadsheet: `Cut_list_updated.xlsx`.

The crew doesn't need Google or GitHub accounts. They open the link, tap **I'm new**, and get a 4-digit PIN.

---

## Part 1: The Google Sheet (5 minutes)

1. **Sign in to your personal Google account.** University Google Workspace accounts usually block "anyone with the link" sharing, and that setting is what lets sign-off photos show up on the leadership page.

2. **Upload the corrected spreadsheet.** In Google Drive, choose **New > File upload**, then pick `Cut_list_updated.xlsx`. It has two changes from your original:
   - The Frank Float labels are now **AR, AS, AT**. They used to be AP, AQ, AR, which clashed with King Cake.
   - Frank Float has a **Jaw Frame** section heading, like the other tabs.

   If you'd rather edit your original instead, make those two changes by hand before going on.

3. **Convert it to a Google Sheet.** Open the uploaded file and choose **File > Save as Google Sheets**. A new tab opens with the Google Sheets version. Work only in this one from now on. You can delete the .xlsx from Drive.

4. **Rename the spreadsheet.** Click the title and name it something like **Bourbon & Bone Cut List**. The daily email uses this name as its subject line.

Don't add any columns or tabs yourself. The script does that in Part 2.

---

## Part 2: The Google Apps Script (15 minutes)

### Paste in the code

1. In the Google Sheet, choose **Extensions > Apps Script**. A new tab opens with a file called `Code.gs` containing `function myFunction() {}`.
2. Click **Untitled project** at the top and rename it **Cut list tracker**.
3. Select everything in `Code.gs` and delete it.
4. Open `apps-script/Code.gs` from the repo in any text editor, copy **all** of it (about 1,350 lines), and paste it in.
5. Save with **Ctrl+S** (Cmd+S on a Mac).

### Run setup once

6. In the toolbar, find the function dropdown (it may say `doGet`). Choose **setup**, then click **Run**.
7. Google asks for permission. Click **Review permissions**, pick your account, and you'll see **"Google hasn't verified this app."** That warning is normal for a script you wrote yourself. Click **Advanced**, then **Go to Cut list tracker (unsafe)**, then **Allow**. The script asks for four things:
   - **This spreadsheet:** to read cuts and write statuses.
   - **Google Drive:** to store sign-off photos in a "Cut list photos" folder.
   - **Send email as you:** for the daily summary, which goes only to you.
   - **Run on a schedule:** so the summary sends itself each evening.
8. When the run finishes, the **Execution log** at the bottom shows:
   `Setup complete. Leadership PIN: 123456`
   Copy the PIN. You and the directors use it to reply to crew questions and to send the summary on demand. To change it later, go to **Project Settings** (gear icon) **> Script properties > LEAD_PIN**.

### Check the new tabs

9. Go back to the Google Sheet. Each cut tab now has five new columns: **Status, Done, Updated, Updated By, Photo**. There are also these new tabs:

   | Tab | What to do now |
   |---|---|
   | **Crew** | Leave it empty. People add themselves from the crew page, and each gets a random 4-digit PIN. You can also type names here and run **setup** again to give each a PIN. Set **Active** to No to turn someone off. |
   | **Tape Colors** | Check that it reads Framing = Red, Mausoleum = Yellow, King Cake = Blue, Frank Float = Green. |
   | **Lumber** | Enter **Price each** for 2x4, 2x6, and 4'x8'. Board length is already 96 for lumber and blank for the MDF sheets. **Spare %** is extra on new boards for miscuts; set it to 0 to buy exactly the plan. |
   | **Units** | Already filled in with the units we agreed on. No changes needed. |
   | **Settings** | **Summary email** is already your address. **Summary hour** is 20, meaning 8 PM. You'll fill in **Leadership page URL** in Part 3. |
   | **Stock, Log, Messages, Safety, Claims** | Leave these empty. The tool fills them in. |

### Deploy it as a web app

10. Back in Apps Script, click **Deploy > New deployment**.
11. Next to **Select type**, click the gear icon and choose **Web app**. Set:
    - **Description:** `v1`
    - **Execute as:** **Me**
    - **Who has access:** **Anyone**. Choose "Anyone," not "Anyone with Google account," or the crew would need to sign in.
12. Click **Deploy**. If it asks for permission again, allow it.
13. Copy the **Web app URL**. It looks like `https://script.google.com/macros/s/AKfy…/exec`.
14. **Test it:** paste the URL into a browser tab, add `?view=crew` to the end, and press Enter. You should see text starting with `{"ok":true,"sheets":[`. If you see an error page instead, check that access is set to **Anyone**.

---

## Part 3: The GitHub repo and site (15 minutes)

### Point the site at your sheet

1. Open `assets/config.js` in a text editor and fill in the top:
   ```js
   window.CUT_CONFIG = {
     apiUrl: 'https://script.google.com/macros/s/PASTE-YOURS-HERE/exec',
     title: 'Bourbon & Bone',
     sheetUrl: 'https://docs.google.com/spreadsheets/d/PASTE-YOURS-HERE/edit',
     pollSeconds: 20,
     maxBundle: 10,
     kerf: 0.125
   };
   ```
   - `apiUrl` is the web app URL from Part 2, step 13.
   - `sheetUrl` is the Google Sheet's address from your browser bar. It adds an "Open the Google Sheet" button to the leadership page.
   - Leave the rest as is.

### Create the repo

2. On GitHub, click **New repository**. Name it something like `bourbon-bone-build` and make it **Public**. On free GitHub accounts, Pages only works for public repos; a private repo needs GitHub Pro. Public means anyone could read the code, which is fine here, since nothing secret is in it and the PIN lives in Apps Script, not the repo. Don't add a README; the repo has one.

3. **Upload the files.** Do one of the following.

   **In the browser:** on the new repo's page, click **uploading an existing file**. Open the unzipped `cut-tracker` folder and drag in **what's inside it**, not the folder itself, so that `index.html` sits at the top level of the repo:
   - `index.html`
   - `leadership.html`
   - `signs.html`
   - `README.md` and `SETUP.md`
   - the `assets` and `apps-script` folders

   Then click **Commit changes**.

   **With git:**
   ```bash
   cd cut-tracker
   git init
   git add .
   git commit -m "Cut list tracker"
   git branch -M main
   git remote add origin https://github.com/YOUR-USERNAME/bourbon-bone-build.git
   git push -u origin main
   ```

### Turn on GitHub Pages

4. In the repo, go to **Settings > Pages**. Under **Build and deployment**:
   - set **Source** to **Deploy from a branch**;
   - set **Branch** to **main** and the folder to **/ (root)**;
   - click **Save**.
5. Wait a minute or two, then refresh. The top of the page shows **"Your site is live at `https://YOUR-USERNAME.github.io/bourbon-bone-build/`"**. Your links are:
   - **Crew page:** `https://YOUR-USERNAME.github.io/bourbon-bone-build/`
   - **Leadership page:** `https://YOUR-USERNAME.github.io/bourbon-bone-build/leadership.html`
   - **QR signs:** `https://YOUR-USERNAME.github.io/bourbon-bone-build/signs.html`
6. In the Google Sheet's **Settings** tab, paste the leadership page link into **Leadership page URL**. The daily email links to it.

---

## Part 4: Test it before the crew does (10 minutes)

Run through these on your phone. The crew page's status line should say **Up to date**, not "Demo."

1. **Join:** Open the crew page, tap **Sign in or join the crew**, then **I'm new**, and enter your name. Note the PIN it shows. In the sheet, the **Crew** tab should now have your name and that PIN.
2. **Sign off:**
   - Choose **Framing**.
   - Tap **+** once on line **C**, then tap **Sign off and save**.
   - Take a photo of anything and save. The form already knows who you are.
   - In the sheet, line C should now read *In Progress, 1*, with your name, the time, and a photo link. The **Log** tab gets a row, and the photo appears in Drive under **Cut list photos**.
3. **Claim:** Tap **I'm on it** on any line. On the leadership page, you should appear under **Who's working on what** within 20 seconds.
4. **Photos and replies:** On the leadership page, enter your name and PIN to unlock replies. Your test sign-off should show with a photo thumbnail. If the thumbnail is blank, see Troubleshooting.
5. **Email:** Click **Email me a summary** and check your inbox.
6. **Spare wood:** On the crew page, go to **Cut plan > Count spare wood** and enter one test count. The plan should add a "From spare wood" section.

7. **PIN reset:** In the leadership page's **Crew** section, click **Reset PIN** next to your name. On the crew page, sign out and sign back in with the new PIN.

**Clear the test data** afterward, directly in the sheet:
- Set line C back to **Not Started** with **Done** at **0**.
- Delete your rows from **Log**, **Claims**, and **Stock**.
- Delete the test photo from Drive.

---

## Part 5: Before the first build day

1. **Print the signs.** Open `/signs.html` on the **live site**, not a downloaded copy, and click **Print signs**. You get one sign per stack in its tape color, plus a saw-station sign that opens the safety check-in. Print on letter paper, and use color if you can.
2. **Count the spare wood first.** Have one or two people go through the spare pile with **Count spare wood**, choosing **A full recount** for each size. Until that's done, the cut plan assumes every piece needs a new board.
3. **Share the links.** Text the crew page link, or let people scan any stack sign. Everyone taps **I'm new** once and screenshots their PIN; their phone remembers them after that. Send the leadership link to the directors, and give them the leadership PIN if they'll answer questions or reset crew PINs.
4. **Make your first lumber run** from the leadership page's **Lumber to buy** table, right after the spare-wood count. When lumber comes back, add it with **Count spare wood > More boards**.

---

## Making changes later

| You want to… | Do this |
|---|---|
| Add or change a cut | Edit the cut tab in the sheet. Everyone sees it within 20 seconds. Keep every label unique across all tabs. |
| Add a whole new area | Add a tab with the same five headers (Label/ID, Use, Dimension, Length, Quantity), then run **setup** again in Apps Script. That adds its tracking columns, a Tape Colors row, and any new Lumber sizes. |
| Change the email time | Change **Summary hour** in Settings, then run **setup** again. |
| Add a crew member | They join themselves from the crew page. To add someone yourself, type their name in the **Crew** tab and run **setup** to give them a PIN. |
| Someone forgot their PIN | Leadership page **> Crew > Reset PIN**, then tell them the new one in person. Or look it up in the **Crew** tab. |
| Remove someone | Set **Active** to No in the **Crew** tab. Their past sign-offs stay in the Log. |
| Change a unit or its parts | Edit the **Units** tab, using `Label×count` separated by commas. |
| Update the website files | Commit the changed file on GitHub. Pages redeploys within a minute or two; people may need to refresh. |
| Update `Code.gs` | Paste in the new code and save. Then go to **Deploy > Manage deployments**, click the pencil icon, set **Version** to **New version**, and click **Deploy**. This keeps the same URL. Choosing *New deployment* instead would give you a new URL, and you'd have to update `config.js`. |

---

## Troubleshooting

- **The crew page says "Can't reach the sheet."**
  1. Check that `apiUrl` in `config.js` is the `/exec` URL.
  2. In **Manage deployments**, check that **Who has access** is **Anyone**.
  3. Test the URL with `?view=crew` as in Part 2, step 14.
- **The page still says "Demo."** `apiUrl` is empty, or the browser is showing an old copy of `config.js`. Commit the change and do a hard refresh (Ctrl+Shift+R).
- **Photos save but don't show on the leadership page.** Your Google account blocks link sharing. Open the **Cut list photos** folder in Drive, click **Share**, and set **General access** to **Anyone with the link: Viewer**. If you can't change that setting, the account is managed by an organization; use a personal account.
- **"Authorization required" or "Exception: You do not have permission."** A code update started using a new Google service. Run **setup** once from the editor to re-authorize, then deploy a **New version**.
- **No daily email.**
  - The email skips days with no new sign-offs or messages unless **Send when nothing changed** is set to Yes in Settings.
  - Check spam, and check **Summary email** in Settings.
  - To test, run `sendSummaryNow` from the Apps Script editor.
- **"Too many wrong PINs."** After 5 wrong tries, that name is locked for 15 minutes. Resetting the PIN from the leadership page clears the lock right away.
- **Sign-offs say "Someone else updated this line."** Two people changed the same line, and the tool blocked the second change instead of overwriting the first. Reopen the list and redo the change if it's still needed.
- **Syntax errors when running setup.** Open **Project Settings** and make sure **Enable Chrome V8 runtime** is checked.
