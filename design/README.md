# design/ — what is here and what to do with it

The submission needs two prototypes by **23 October, 5pm**: a low-fi one and a hi-fi one, supporting
at least three distinct tasks, tested with three participants who are not friends or classmates.

This folder holds both, taken from the system that is actually built rather than drawn from memory.

| Open this | It is | Use it for |
| --- | --- | --- |
| [`lofi/wireframes.html`](lofi/wireframes.html) | 33 grey-box screens of the whole app at 393 × 852, each with its interactive targets listed underneath | The **low-fi** deliverable. Import into Figma, or present straight from the browser. |
| [`lofi/png/`](lofi/png/) | The same 33 screens exported: `WF-01.png` … `WF-33.png` at 786 × 1704 (2x), plus `sheet.png`, the whole document in one image | Dropping wireframe frames straight into Figma or a PDF without opening the HTML. |
| [`hifi/`](hifi/) | 34 photographs of the running app — every customer screen, every signed-out screen, every staff tab — plus [`hifi/INDEX.md`](hifi/INDEX.md) saying which is which | The **hi-fi** deliverable. Drag the PNGs into Figma and wire them. |
| [`PROTOTYPE-PLAN.md`](PROTOTYPE-PLAN.md) | The persona, the three tasks worded for a participant, the frame-to-frame wiring table, and how the design answers each marking criterion | The write-up, and the list of arrows to draw in Figma. |
| [`USABILITY-TEST.md`](USABILITY-TEST.md) | Where to find three suitable participants, the consent script, the session plan, the data sheet to copy, and how to analyse three runs | The testing half of the brief. |
| [`FIGMA-HANDOFF.md`](FIGMA-HANDOFF.md) | Figma from zero: every click, in order, for both files, with the failure table at the end | Reading first, if Figma has never been opened. |
| [`capture.mjs`](capture.mjs) | The script that photographs the live app: it signs in, fills a basket, places an order, collects the cash, ships it, then walks the staff console | Re-shooting after the app changes: `npm run dev`, then `node design/capture.mjs`. |
| [`capture-lofi.mjs`](capture-lofi.mjs) | The script that turns `lofi/wireframes.html` into `lofi/png/`, one file per frame at 2x, by driving a headless Chrome over the DevTools protocol | Re-exporting after the wireframes change: `node design/capture-lofi.mjs` — no server needed, it opens the local file. |

## Two things worth knowing before you start

**The pictures are the product, not a mock-up.** `capture.mjs` drives a real browser against the
running app, so what the participants click is what a customer gets — including the parts that are
deliberately unpolished. `PROTOTYPE-PLAN.md` ends with the weaknesses we would rather name ourselves
than have a participant find.

**The hi-fi set is generated, so keep it in step.** If a screen changes, re-run the capture instead
of editing a picture. It wipes `hifi/` first, on purpose: an old frame in a new set is worse than a
missing one, because it looks like it was checked. `capture-lofi.mjs` clears the `WF-*.png` and
`sheet.png` files it owns before writing, for the same reason — the HTML is still the source of truth
for the low-fi set, and the page's own "Download" buttons do the same job by hand if you prefer them.
