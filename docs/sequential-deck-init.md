Implement "sequential decks"

"Sequential deck" is a deck property. The checkbox to toggle it will stay in an "Options" submenu. The options submenu is placed below the "Edit deck" option in deck detail. By default it is false.

When "Sequential deck" is active:

- Deck is shown in sequential order, subjects > cards.
- In the review page, go through all cards from a subject
- Add an order column to "Card" and "Subject". Default null. Also add it to xls import and export.
- Since the xls import/export is expanded by cards, card order and subject order must have different column names. This also opens the possibility of inconsistent subject order input (since the same subject may have 2 different orders in the spreadsheet.) In that case, the "subject order" column of the 1st subject appearance wins;
- In the subject detail page, when the deck has sequential order, add ordering buttons (up, down) to each card, before the existing trash button. When ordered, update the new order field;
- The order field stays null until edited in the subject detail page
- We currently wont have any UI to reorder subjects. Either they are added in the correct order, either the order is edited through XLS import
- Order the subjects and cards by 'order, createdAt'
  . So that when order is null, createdAt is used.
- Only display the fixation buttons on the last card of a subject. Otherwise, display "Next". "Next" updates the last seen date but not the fixation (similar to what happens with inverse review)
- There is no inverse review
- In review page, add a "previous card" button before the "edit card" button. Also add a "restart" button. The restart button should be guarded from accidental clicks by a confirmation prompt. Only dislay those buttons when in sequential mode.
- When starting the review, start from the last seen card. If no card was ever seen, start from the start (according to the ordering);
