I am creating a new "Generate card from template" feature:

# In the frontend:

- Add link/button inside the card creation page. Only display the button on the creation mode but not on the editing mode.

Contains the following form in the frontend:

1. Label=Template, type=dropdown, always disabled
   Options= "Create phrases for words" default selected

2. Front Language. Type=dropdown. Populate list from the languages API endpoint. Default=english.

3. Back Language. Type=dropdown. Populate list from the languages API endpoint. Default=deutsch.

Include the language emoji fro the API response in the dropdowns.
Language dropdowns can't have the same selection.

4. Word or expression. Type=text

5. Number of cards to generate. Dropdown. 1 to 5.

All fields required.

Upon submission, we continue to a page previewing the cards to be generated. We can confirm the generation, regenerate the previews or cancel.

# API:

Some APIs to generate cards from a template still dont exist.
For the "create phrases from words" template, it will do the following:

1. Generate previews

   Using the OpenAI API, request the generation of N phrases in the back of the card language using the inputted word.
   Then translate the phrases to the front of the card language.
   Output as cards previews.
   All the phrases should have the requested word and its translation highlighted in markdown bold (double asterisk).

2. Persisting the previews

   No new APIs need to be created. The frontend will use the already existing card creation APIs.
