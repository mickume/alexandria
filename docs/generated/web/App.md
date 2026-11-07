# web/App

## Functions

### App()

> **App**(): `Element`

The website: one page per path.

#### Returns

`Element`

***

### Link()

> **Link**(`__namedParameters`): `Element`

A link within the website, followed without a reload.

#### Parameters

##### \_\_namedParameters

###### children

`ReactNode`

###### className?

`string`

###### to

`string`

#### Returns

`Element`

***

### navigate()

> **navigate**(`path`): `void`

Moves to `path` within the website without a reload.

#### Parameters

##### path

`string`

#### Returns

`void`

***

### usePath()

> **usePath**(): `string`

The current path of the page, following history navigation.

#### Returns

`string`
