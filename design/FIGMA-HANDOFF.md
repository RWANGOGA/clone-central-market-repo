# Putting this into Figma — no experience needed

Two files are due on 23 October at 5pm: the **low-fi prototype** and the **hi-fi prototype**. They
can live in the *same* Figma file as two pages, which is easier: you wire the hi-fi once and the
low-fi can be submitted as the sheet plus a shorter wiring.

Everything you need is already on disk in `design/`:

```
design/
  lofi/wireframes.html      open in Chrome → 33 grey-box frames, all screens
  hifi/*.png                34 photographs of the running app, 786 × 1704 (= 393 × 852 at 2×)
  hifi/INDEX.md             which picture is which screen
  PROTOTYPE-PLAN.md         the three tasks and the exact arrows to wire
  USABILITY-TEST.md         the participant pack
  capture.mjs              re-shoot every screen from the live app: node design/capture.mjs
```

Do the hi-fi first. It is the one that carries the marks for visual design, and it is almost
mechanical: drop in pictures, draw arrows.

---

## Part 1 — the hi-fi prototype (about 40 minutes)

### 1.1 Make the file

1. Go to **figma.com** → *Sign up* → the free plan is enough (log in with Google if you like).
2. Left sidebar → **New design file**. Name it top-left: `CSC3119 — Mu Katale prototype`.
3. Top-left of the canvas, rename **Page 1** to `Hi-fi`. Click the **+** next to it and name the new
   page `Lo-fi` (you will fill that in Part 2).

### 1.2 Put the screens on the canvas

1. Open `design/hifi/` in Finder.
2. Select **all 34 PNGs** and drag them onto the Figma canvas. Drop them in a rough line, left to
   right, in the numbered order (`01-home`, `02-home-below-fold`, `02a-menu-drawer`, `03-…`).
   Figma imports each as an image inside a frame, already named after the file — which is why the
   files are named the way they are.
3. Select them all (`Cmd+A`), and in the right-hand panel set the **W** (width) field to `393`. Press
   Tab; the height follows. Every screen is now the size of the phone it was built for.
4. Space them out with roughly one screen-width of gap so the arrows between them are readable.
   Nothing else about layout matters.

### 1.3 Wire the flows

1. Top-right toolbar: the dropdown that says **Design** → switch it to **Prototype**. The canvas goes
   a little darker and each frame gets four blue handles on its edges.
2. Decide what is clickable. A whole frame is *not* one button, so draw a hot spot over the real
   target: select a frame, press **K**, then drag a rectangle over the button or card the user would
   tap. Rename the hot spot in the left panel (`card → product`, `☰ → drawer`, `Proceed to payment`).
3. Hover the hot spot: a small **⊕** appears at its edge. Click it, **drag** to the destination frame,
   let go. A setup card opens — set it to:
   - **Interaction:** *Navigate to*
   - **Animation:** *Dissolve* (or *Smart Animate* for the drawer, which slides)
   - **Scroll position:** *Start at top*, unless the target is a scrolled view of the same page
     (`02-home-below-fold`, `31-staff-orders-scrolled`) — then *Remember scroll position*.
4. Work down the table in **PROTOTYPE-PLAN.md → "Frame map"**. It is 25 rows; the three tasks need
   about 14 of them, the rest is the staff console. Do not invent flows the table does not list.
5. Check it: press **Play** (top-right, or `Shift+Space`). Click through Task 1 from `01-home` to
   `08b-payment-number-entered`. If a click does nothing, you wired the frame instead of the hot
   spot, or the hot spot is behind the image — nudge it in the left panel.

### 1.4 Make it testable on a real phone

- Press **Publish/Share** → *Copy link* → set **Anyone with the link → Can view**.
- On your phone install **Figma** (App Store / Play) and open that link: the prototype runs at true
  phone size, which is what participants need. Screen-record the phone while they work
  (iOS: Control Centre → Screen Recording; Android: the built-in recorder) — that recording is your
  evidence, and it is far better than writing notes while someone is trying to concentrate.

---

## Part 2 — the low-fi prototype (about 25 minutes)

The grey-box sheet is a single HTML file. Figma cannot open HTML directly, so use the free community
plugin that converts it into editable layers.

### 2.1 Serve the file locally (Figma plugins cannot read `file://`)

```bash
cd design/lofi && npx --yes serve -l 3007 .
```

Then open **http://localhost:3007/wireframes.html** in Chrome and check all 33 frames look right.

### 2.2 Import it

1. Back in Figma, switch to the **Lo-fi** page.
2. Right-click the canvas → **Plugins** → **Browse plugins** → search **html.to.design** → *Install*.
3. Right-click the canvas → **Plugins** → **html.to.design** → **Import from URL**.
4. Paste `http://localhost:3007/wireframes.html`, choose viewport **Desktop 1280**, import.
5. The whole sheet arrives as frames and text you can move. Delete the intro text and the legend if
   you want only the screens, or leave them in — a marker reading the submission will thank you.
6. If the plugin mis-renders something (it sometimes drops the diagonal crosses in image
   placeholders), the fallback is honest and quick: in Chrome, open the page, press `F12` → the
   device toolbar → set the width to `393`, scroll to each frame and take a screenshot; paste those
   onto the Lo-fi page. Grey boxes import perfectly as pictures; the plugin is only needed if you
   want to edit the boxes.

### 2.3 Wire the same three tasks

Do not re-wire everything. Wire **Task 1** end to end (WF-01 → WF-04 → WF-05 → WF-07 → WF-08 →
WF-09 → WF-10) and add hot spots for the drawer and the account tabs. A low-fi that runs one task
cleanly demonstrates the flow; the hi-fi carries the rest.

---

## Part 3 — submitting

1. Rename the file exactly as your course asks, and put your names in the first frame of each page.
2. **File → Export frames to PDF** (select the frames first, or Figma exports the whole page) — keep
   the PDF as the backup in case the link breaks on the marker's machine.
3. Paste the prototype link into the submission, set to *Anyone with the link → Can view*.
4. Attach the three filled test sheets and the three findings from `USABILITY-TEST.md §5`, and say
   what you would change first. The brief rewards the test, not just the pictures.

## If something goes wrong

| Symptom | What it actually is |
| --- | --- |
| Arrows do nothing in Present mode | You wired the frame's edge handle instead of the hot spot. Delete the interaction and drag from the hot spot. |
| A hot spot never triggers | It is behind the image — select it in the left panel and press `]` to bring it forward, or it is smaller than the tap target. |
| Frames imported at the wrong size | Set **W** to `393` again with all frames selected; do not resize one at a time. |
| html.to.design says "network error" | The `npx serve` window was closed, or the URL has a typo. The page must open in Chrome first. |
| Prototype is slow on a phone | That is the 2× images. Select the frames, Export → PNG at **1×**, and replace them. |
| You want the pictures again after changing the app | `npm run dev`, then `node design/capture.mjs` — it re-shoots every screen from the running system, including the staff console. |
