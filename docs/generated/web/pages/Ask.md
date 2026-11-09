# web/pages/Ask

## Functions

### Ask()

> **Ask**(): `Element`

The Ask page: a question to the library, answered by the owner's own AI
provider from passages of their links. The answer streams in as Markdown
with each [n] a link to its source, the sources listed under it, and a
refusal or a failure of the stream shown under whatever part of the answer
arrived. Once it has arrived, Copy puts the answer and its sources on the
clipboard, and Tell me more asks the same question again for a detailed
answer, which replaces it. Nothing is kept: asking again, or leaving the
page, loses the answer.

#### Returns

`Element`
