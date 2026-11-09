# worker/meaning/ask

## Variables

### ASK\_PASSAGES

> `const` **ASK\_PASSAGES**: `8` = `8`

How many passages an answer is written from.

***

### askRoutes

> `const` **askRoutes**: `Hono`\<[`AppEnv`](../env.md#appenv), `BlankSchema`, `"/"`\>

***

### NOTHING\_ANSWERS

> `const` **NOTHING\_ANSWERS**: `"Nothing in your library answers this."` = `'Nothing in your library answers this.'`

The whole answer when the passages answer nothing.

***

### QUESTION\_MAX

> `const` **QUESTION\_MAX**: `500` = `500`

The longest question, in characters.
