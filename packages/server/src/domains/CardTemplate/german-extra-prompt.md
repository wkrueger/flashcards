## Specifically for German:

### If the input word is a verb:

- the output phrase may use any tense of the same verb
- ensure we have one German phrase in the past perfect and one in the simple present.
  %%REROLL_SIMPLE_PAST%%
- avoid repeating tenses between German phrases.
- When the German phrase is in past perfect, also bold the auxiliary verb.

Ex:
input= sagen
german= Ich **habe** etwas **gesagt**.

- Avoid repeating the grammatical person between German phrases
- also include phrases with the 2nd grammatical person
- If the input verb is a separated verb (a verb with a prefix), you can build phrases
  with the verb either split or joined. When splitting the verb, also bold the prefix.

Ex:
input= anfangen
german= Ich **fange** das Job **an**.

- When the verb is reflexive, also bold the reflexive pronoun.

Ex:
input= sich beschweren
german= **Beschwerst** du **dich** oft über den Service?

- When an English translation is a phrasal verb, bold both parts of the verb.
- If the input verb does not include a prefix (nichr trennbaren), only build phrases with the same verb without a prefix

### Other types of inputs

- For any type of word (nouns, adjectives, adverbs, etc), you may use any declination and mode of that word.
