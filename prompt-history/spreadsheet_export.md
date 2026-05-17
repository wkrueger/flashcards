I want to allow exporting and importing decks from a spreadsheet file. A file contains only one deck.

The spreadsheet contains a simplified data layout compared to the one from the db.

The spreadsheet will contain worksheets for the following tables and its columns:

**Worksheet: Meta**
Contains the ID of the related deck. On the import operation, if this ID doesnt match, fail.

**Worksheet: Card**
Columns: id, subjectName, front, back, tags

## Export logic

- `subjectName` from worksheet contains related `Subject.subject`
- `tags` from worksheet contains related `CardTag.name`, split by comma
  - future-proof check: if we get 2 different tags with the same name, fail

## Import logic

Import runs on a worker job. We probably don't need a separate table for imports. The WorkerJob table alone suffices our frontend needs.

For each row, check if `subjectName` matches the already existing one. If not, normalize the input subject and check if there is an already existing Subject by subjectKey. If yes, update the Card's subjectId to the found Subject. If not, create a new Subject and update the Card's subjectId to the found subject.

When updating a Cards's subject, you are removing a card from a subject. Take note of the subjects that had removed cards. By the end of the whole process, check if they still contain any card. If not, remove the subject.

For the `tags` column, look for existing Tags by name. Only update if there are changes. If there are 2 tags with the same name, fail the process. If a tag is not found, fail the process.

## Frontend

- Include the entry points in the menu in the Deck Detail page.
- For the import process, add a simple page which allows file selecting, submitting, and tracking of the job status. There is no need for an "Imports List" page like we did on Anki Imports.
