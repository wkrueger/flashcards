I want to create a learning flashcards app focused on vocabulary learning. This is a greenfield project.

This will be a web app focused on mobile interaction. When accessing the app through a computer browser, the width of the pages will be constrained to low widths, in order to simplify the development of the UI and reduce size variants.

About the stack:

- trpc on the backend. prisma ORM.
- sqlite
- tanstack on the frontend
- shadcn UI base, include dark mode switch

## Rough overview of the entities:

### Languages

Name and emoji. Seed initially with English and Deutsch.
This an admin record. Since "admin" roles are currently out of scope, this record will currenly have no API and UI mutation. If I want to add new languages, I will directly edit on sqlite.

### Decks:

Decks which will contain the flashcards. All decks are private to the user.

Contains: name (unique)

### Flashcards:

Each flashcard has

- a card subject (relation)
- front side (markdown string).
- back side (markdown string)
- last time seen
- number of times seen

Unique composite key: card subject + front side. As the markdown text may be long, add a hash of it to the key.

### Card subjects:

A "card subject" groups cards by subject. It contains

- A subject (usually this will be a word). Unique.
- last time seen
- number of times seen
- fixation level (1-5, string)
- cooldown (timestamp with the time of the next time the card can be shown)

Fixation levels:

- 5: 1 week cooldown
- 4: 2 days cooldown
- 3: 12h cooldown
- 2: 10min cooldown
- 1: 2min cooldown

The idea is that the same word may have multiple cards associated with it.

### Pickup logic

Get the 30% of the subjects with oldest cooldown resets. Randomly pick one within this scope. Then, pick inside this subject, the card with oldest last time seen.

After a card is completed, update the stats for the card and the cooldown.

### Card reading UI

- Text is stored as markdown
- Display "front" at the upper half
- Display "back" on the lower half, after clicking on "Reveal".
- After revealing, display 4 options for the next cooldown. If the previous cooldown stored on the subject was 4 or 5, display 2-3-4-5, otherwise display 1-2-3-4.
- Update the card and subject stats, then display the next card.
- Display a button for immediately editind the current card

### Card editing UI

- In the markdown fields, there is no need for a text formatting UI. Just display them as plain text.
- There will be no subject input page. On the card input UI, display the subject fields as a free autocomplete. If the subject still does not exist, create it transparently.

## Stage 2: new Word UI with AI

- Input a word or expression
- Input a "front" language and a "back" language in dropdowns.
- Number of cards, defaults to 4
- After confirming, the app proposes N cards to be generated and shows the output for user approval;
- On approval, the cards are created

The card creation follows the following template:

- Generate a phrase on the front side of the card. Make the input word bold in the phrase.
- Fill in the back side of the card with the translation. Make the word in context bold in the phrase.

For generating the phrases, use the OpenAPI API.
