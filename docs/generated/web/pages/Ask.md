# web/pages/Ask

## Functions

### Ask()

> **Ask**(): `Element`

The Ask page: a question to the library, answered by the owner's own AI
provider from passages of their links. The answer streams in with each [n] a
link to its source, the sources listed under it, and a refusal or a failure
of the stream shown under whatever part of the answer arrived. Once it has
arrived, Tell me more asks the same question again for a detailed answer,
shown under the first with the sources it read, and Copy puts the answers
and their sources on the clipboard. Nothing is kept: asking again, or
leaving the page, loses the answer.

#### Returns

`Element`
