# Smelter

Restaurant operations for small independent restaurants: staff order stock from suppliers, count stock, record tips, and (new) take guest orders at the table and send them to the kitchen.

## Language

### Supply side (existing)

**Supply Order**:
A request for stock that an employee builds and a manager sends to a supplier. This is what the codebase currently calls an "order".
_Avoid_: Order (unqualified), purchase order

**Kitchen Request**:
A chef asking the back kitchen for a prepped ingredient (e.g. two tubs of sushi rice). Internal to staff; never appears on a guest's bill.
_Avoid_: Ticket, kitchen order

### Guest side (new)

**Tab**:
Everything one party at one Table asks for during one visit. It is the bill; it is paid once at the end.
_Avoid_: Order, check, cart

**Line**:
One menu item, its quantity, and its modifiers on a Tab. Every re-order of a drink is a new Line; there are no free refills.
_Avoid_: Order item, entry

**Ticket**:
The kitchen-bound Lines of a Tab released to the kitchen in one Send. Drinks never appear on a Ticket; they are Lines on the Tab only.
_Avoid_: Order, kitchen order, kitchen request

**Send**:
The waiter's explicit act of releasing drafted Lines: kitchen-bound Lines become a Ticket, bill-only Lines land on the Tab. Nothing reaches the kitchen or the bill without a Send.
_Avoid_: Submit, fire

**Draft Line**:
A Line proposed by voice or typed by staff that has not been Sent yet. Staff can edit or discard it freely.
_Avoid_: Pending item, suggestion

**Table**:
A fixed, numbered place in a location where a party sits. A Table has at most one open Tab at a time.
_Avoid_: Seat, section

**Menu Item**:
Something a guest can order, with a fixed name and size (e.g. "Asahi Large"). Distinct from an inventory item, which is how the same thing is stocked and bought.
_Avoid_: Product, inventory item, SKU

**Modifier**:
A spoken or tapped change to a Line's Menu Item, such as "no corn" or "extra meat".
_Avoid_: Note, option, special request

**Kitchen Display**:
The shared screen in the kitchen that shows Tickets in the order they were Sent.
_Avoid_: KDS, kitchen app

### Voice

**Dictation**:
A staff member taps the mic and states one or more Tables and their Lines ("table 4, two Asahi Large"). Only the staff member is recorded.
_Avoid_: Push-to-talk, voice order

**Ambient Listening**:
The waiter's phone transcribes the conversation with a party at their Table while the waiter is present, producing Draft Lines as items are spoken.
_Avoid_: Live mode, always-on
