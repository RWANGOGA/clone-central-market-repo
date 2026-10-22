# Prototype plan — Mu Katale

**Coursework:** *Project Design: Low-fi prototype* and *Design project: Hi-fi prototype*, both due
23 October, 5pm. One flexible prototype, at least three distinct end-to-end tasks, then tested with
three participants who are neither friends nor classmates.

**What the prototype is.** Not a drawing of an idea — the running system itself. The low-fi sheet
(`lofi/wireframes.html`, 33 frames) is every screen laid out as grey boxes; the hi-fi set
(`hifi/`, 34 photographs of the live app at 393 × 852) is the same screens as shoppers see them.
Both use the same frame numbers, so a marker can hold the two side by side and see exactly what was
designed and what was built.

**Who it is for.** Sarah Namukasa, 38, owns and directs a small school near Kampala. Once a week
she buys produce for the school's feeding programme: bananas, garlic, kale, avocados — enough for
about 200 children, on a budget she has to account for. She buys on a phone, often between lessons,
and she needs three things from any market: the real price, the real stock, and proof of what she
ordered and paid.

**The design idea the tasks test.** A market that tells the truth while you shop: the stock figure
on the card is the number left in the crate, the delivery fee is named with the place it goes to,
the tracking screen shows what the market has actually done with your order, and nothing is claimed
that the market cannot do (no imaginary courier, no invented delivery window).

---

## The three tasks

Each task is written the way it will be read out during the test — an instruction, not a hint. The
wrong way to run these is to say *how*. The frames in the middle column are the ones the task walks
through; the last column is what counts as finished.

| # | The instruction given to the participant | Frames | Done looks like |
| --- | --- | --- | --- |
| **1** | *"Sarah's school needs bananas, garlic and avocados for the week. Find all three, and get as far as being ready to pay — but do not actually pay."* | WF-01 → WF-04 → WF-05 → WF-07 → WF-08 → WF-09 → WF-10 | A basket with the three items, quantities chosen deliberately, the delivery cascade answered down to parish, and the payment screen showing the amount she is about to pay. |
| **2** | *"You placed an order on Monday and the bursar wants to know whether it has left the market, and whether you have been charged. Show me."* | WF-17 → WF-13 → WF-14 → WF-12 | The order found in the account's order list, opened, and both questions answered out loud from the tracking screen: the stage it is at and the money state beside it. |
| **3** | *"The school moved its delivery point to Ntinda, and your phone number changed. Change what the market has on file so the next order goes to the right place."* | WF-15 → WF-08 | Details saved with the new address and phone, the checkout showing the new location, and — if she tries a number another account already holds — the message that refuses it. |

**Optional fourth task, if a participant finishes early** (this is the staff side, and it is what
makes the customer-side promises true):

| # | Instruction | Frames |
| --- | --- | --- |
| **4** | *"You are the market assistant. This order has been paid in cash at the gate — get it on its way, then show me that the stock that left the shelves is recorded."* | WF-22 → WF-23 → WF-24 → WF-26 |

### Why these three and not others

- They are **distinct** in what they exercise: browse-and-buy (input-heavy), read-and-verify
  (output-heavy), change-and-commit (validation-heavy). A task list of three shopping variants
  would test one thing three times.
- They cover the whole customer surface: 11 of the 13 customer screens, the geography cascade, the
  money state and the account.
- Each has a **failure the system can actually produce** — an out-of-range district, a phone number
  already taken, an order that cannot be cancelled once picked — so the test measures whether the
  app's honesty works on a stranger, not whether it works on us.

---

## Frame map: what connects to what

This is the wiring list. In Figma's prototype mode, drag from the source frame's hot area to the
target frame; the trigger is *on click* unless the row says otherwise. `hifi/` file names are in
brackets so the hi-fi pass can be wired from the same table.

| From | On | To |
| --- | --- | --- |
| WF-01 home `01-home.png` | a product card | WF-04 `03-product-detail.png` |
| WF-01 | the ⊕ on a card | WF-05 `04-added-to-basket.png` |
| WF-01 | ☰ | WF-03 `02a-menu-drawer.png` |
| WF-01 | scroll | WF-02 `02-home-below-fold.png` |
| WF-03 drawer | My Page | WF-13 `10-account-overview.png` |
| WF-03 drawer | Basket | WF-06 `04a-basket-empty.png` or WF-07 `05-basket.png` |
| WF-03 drawer | Coverage map | WF-19 `22-delivery-map.png` |
| WF-03 drawer | Newsstand / Who we are | WF-20 `23-newsstand.png` / WF-21 `24-about.png` |
| WF-04 product | "Add … to basket" | WF-05 |
| WF-05 added | Go to basket | WF-07 |
| WF-07 basket | Proceed to checkout | WF-08 `06-checkout.png` |
| WF-08 checkout | Proceed to payment | WF-09 `08-payment.png` |
| WF-09 payment | number typed | WF-10 `08b-payment-number-entered.png` |
| WF-10 | Pay now | WF-11 `07-order-confirmation.png` |
| WF-11 placed | Track this order | WF-12 `09-order-tracking-timeline.png` |
| WF-17 sign in | Sign in | WF-13 |
| WF-17 | Create an account | WF-18 `21-signup.png` |
| WF-18 sign up | Create account | WF-01 (signed in) |
| WF-13 overview | an order row | WF-12 |
| WF-13 → WF-16 | the four tabs | `10`→`11`→`12`→`13` |
| WF-15 details | Save changes | WF-15, with the 409 message when the number is taken |
| WF-22 staff sign in | Sign in | WF-23 `30-staff-orders.png` |
| WF-23 queue | an order row | WF-24 `32-staff-order-detail.png` |
| WF-23 | the tab strip | WF-25…WF-33 `40`…`48` |
| WF-24 order | Collect cash / Advance | WF-24 again, with the next stage on the timeline |

Frames with no incoming arrow are entry points: WF-01, WF-17, WF-22.

---

## How the design answers the marking criteria

Worth reading before the write-up, because each line is defensible with a screenshot.

**UI software architecture.** One shell, thirteen customer screens, one staff console; every screen
reads from the same three providers (cart, session, catalogue), so the basket count in the header is
never wrong and the staff queue and the customer's tracking screen are the same rows. Screens are
routes, not stacked views — the back button works, and a link to an order can be sent on WhatsApp.

**Output.** Numbers with their unit and their source: `90 each remaining` rather than `in stock`;
`USh 3,524 each` in the currency the market trades in; the delivery fee named with the district it
applies to; the money state (`unpaid`, `cod due`, `paid`, `refunded`) kept separate from the
fulfilment state (`pending`, `shipped`, `delivered`) because they answer different questions. Empty
states are written (`Nothing chosen yet`), not left as blank space.

**Input.** The geography cascade is the central input decision: a shopper cannot type a village the
market cannot reach, because each level is a list from the server's own delivery tables and the next
level unlocks only after the one above it. Phone numbers are normalised as typed, so `0772` and
`+256772` reach the same account. The quantity stepper changes the label of the button under it, so
the price being agreed is on the control that commits it.

**Visual design, layout, colour, typography.** One green (`#426b1f`) used only for things that are
actionable or confirmed, one grey (`#757575`) for anything explanatory, and a warm amber for
"nothing recorded yet" — colour carries meaning, not decoration. Newsreader for the market's own
voice (wordmark, screen titles), Inter for anything a person has to read carefully. A 4/8 px spacing
rhythm, cards at 12–16 px radii, and one sticky footer per screen so there is exactly one primary
action in view at any time.

**Accessibility.** Body text at 13 px minimum against white, primary buttons at 14 px on a 44 px
touch target; the drawer's close button and the header's icons carry `aria-label`s; nothing is
communicated by colour alone (a cancelled order says `cancelled`, a paid one says `paid`).
**Honest gap:** contrast on the grey helper text is the weakest point in the set, and the staff
tables are dense at phone width. Both are on the fix list after testing.

**Internationalisation.** English now, and the geography is Uganda-only by design — the market
cannot deliver elsewhere, so the app does not pretend to. Currency is UGX everywhere and formatted
in one place, so a second currency is a formatter change rather than a hunt through screens.

---

## Known weaknesses to show the marker

A prototype with no acknowledged faults is not a prototype anyone tested.

1. **No password recovery.** Registration is open and the phone number is the only sign-in key, so
   a forgotten password locks a real customer out. The sign-up screen says "your phone number is
   what you sign in with" instead of promising a reset link that does not exist. This is the highest
   priority fix and it is next on the roadmap.
2. **Contacts are collected, not verified.** No OTP: an email or number can be entered that the
   owner never checks, which is fine for a market that phones the buyer before delivery and not fine
   for anything else.
3. **Cancellation is offered only while an order is pending.** Once the farm has picked it, the
   button is gone rather than greyed — correct behaviour, but it needs testing to see whether
   shoppers find that out by clicking or by asking.
4. **The staff tables were built for a laptop.** Inventory and purchase orders now fit the phone —
   the reference and the supplier moved under the first column instead of owning columns of their
   own, which is what the tab strip's own width cannot do. The customers and activity tables are
   still denser than they should be on a 393 px screen.
5. **A panel that cannot load says nothing useful.** When the staff console's list endpoints were
   returning the wrong shape, six of the nine tabs went blank with no message at all. That is fixed,
   but the lesson stands: the failure state of a table needs as much design as the table.
6. **The three-step strip names only the step you are on.** Checkout and payment both read
   `1 Payment 2 3` — the circles for two and three carry numbers and never a word, so a shopper
   cannot see what is coming before they get there. Task 1 ends on exactly that screen, so expect a
   participant to ask; the fix is a label under each badge, not a redesign.
