# web/components/AddLinks

## Functions

### AddLinks()

> **AddLinks**(`__namedParameters`): `Element`

The add input at the top of the stream. When the owner presses Enter, the
paste is read as an import file is (`urlLines`): line by line, lines
starting with # skipped, and the first http or https address of each other
line kept. Those addresses go as one batch; `onAdded` receives the added and
boosted links. A paste without one sends nothing and stays in the box.

#### Parameters

##### \_\_namedParameters

###### onAdded

(`links`) => `void`

#### Returns

`Element`
