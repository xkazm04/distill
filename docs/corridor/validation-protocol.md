# Validation protocol: Czechia corridor

A script the owner runs with 5 to 10 real people to find out whether Distill helps a foreign resident of Czechia get
through Czech forms and letters. It tests the product, not the people. The form list it draws on is
[czechia.md](czechia.md).

## Privacy first

- **Never record what a participant types into a form.** No screen recording, no screenshots of filled fields, no
  copies of the pages after filling, no notes of names, numbers, addresses or dates. This follows the project Law:
  values never leave the device.
- Participants use **made-up data** from a printed persona card (below), never their own. If someone starts typing
  their real details, stop them politely and hand them the card.
- Tasks run on the **synthetic practice pages** (`packages/engine/test/corpus/*.html`, served locally) or on a real
  portal **only up to the last screen before submit**. Nothing is ever submitted to an office.
- The facilitator writes down only behaviour: time, clicks on controls, where the person paused, what they said about
  trust. Observations are anonymous (P1, P2, ...). Audio is optional, with consent, and is deleted after notes are
  written up.
- Get written consent that names these rules. Anyone may stop at any time.

## Who to recruit

- Lives in Czechia, has dealt with at least one Czech office in the last two years, or will within the next six months.
- Reads English or Ukrainian comfortably; reads Czech poorly or not at all (self-rated "I need a translator for an
  official letter").
- Uses a phone or computer for everyday tasks. Uses Chrome or an Android phone (the platforms Distill runs on).
- Mix: at least 2 Ukrainian readers with temporary protection, at least 2 English readers on a long-term visa or
  permit, at least 1 self-employed person. No one who works on Distill or knows its team.
- Not recruited: people currently in an urgent proceeding (for example a pending decision). The session must not add
  stress to a real case.

## Setup

- A laptop with Chrome and the Distill extension installed, and an Android phone with Envelope, both with the local
  model **available** (check before the session: the model state must read "available", not "downloadable").
- The practice pages and two printed synthetic letters (a call to remedy defects and a notice of deposited mail,
  written for the session, with no real person's data).
- A persona card per reader language: name, date of birth, birth number, passport number, address, employer, all
  fictional.
- A stopwatch and the observation sheet (one row per task with the columns below).

## Tasks (pick 4, keep each under 10 minutes)

1. **Change of address** (czechia.md row 5): "You moved last week. Use Distill to fill the address form with the
   card's new address." Page: `address-change.html`.
2. **Health insurance registration** (row 3): "You just started a job. Register with the health insurer." Page:
   `health-insurance.html`.
3. **Book a visit at the immigration office** (rows 7 and 10): "Book an appointment to extend your stay." Page:
   `custom-combobox.html` (custom dropdowns).
4. **Letter: call to remedy defects** (row 8): "This letter came. Take a photo with Envelope and tell me what it asks
   you to do and by when." Printed synthetic letter.
5. **Letter: notice of deposited mail** (row 1): "This slip was in your mailbox. What does it mean, and what happens
   if you do nothing?" Printed synthetic slip.

Read the task aloud once in the participant's language. Do not explain the product beyond "this tool may help".

## What to observe and measure

Per task:

| Measure | How |
| --- | --- |
| Completion | Done / done with help / not done. For a form: every field the persona card covers is in the original page, checked by the facilitator by looking at the page (not by reading values aloud or writing them down). For a letter: the person states the action and the deadline correctly. |
| Time | From first touch to "I'm done". |
| Errors | Count of fields that ended up wrong or empty, by field type only (for example "date: wrong", "dropdown: empty"), never the value. Count of times Distill said a field was filled when it was not. |
| Trust breaks | Moments the person hesitates, double-checks the original, says "is this right?", or switches to a translator app. Note the field type and what Distill showed at that moment. |
| Where it ran | Whether the screen showed "on device" or "in cloud" for each AI result, and whether the person noticed. |
| Return to original | Whether the person found the control that brings back the untouched page when they wanted it. |

After all tasks, ask three questions and note the answers in the person's words (no personal details):
"Would you use this for a real form? Why or why not?", "Where did you stop believing it?", "What would you need to see to
trust it with a real application?"

## Pass / fail for the product

The corridor **passes** when, across all participants:

- at least 80% of form tasks are completed without facilitator help;
- the letter tasks give the right action and deadline in at least 90% of attempts;
- **zero** cases where Distill showed a field as filled and the original was empty or wrong (a false claim). One false
  claim seen by a participant is a fail, whatever the other numbers say;
- the median person says they would use it for a real form, and names no trust break caused by a wrong label or
  wrong English or Ukrainian wording.

It **fails** on any false claim, on completion below 60%, or when more than a third of participants abandon a task
because they no longer trust it. Between those bounds: fix the top trust break and run again with new participants.

Compare the form-task failures with the benchmark (`npm run bench:forms`): a widget type that fails for people but
passes the benchmark means the corpus is missing a pattern; add a synthetic fixture for it.
