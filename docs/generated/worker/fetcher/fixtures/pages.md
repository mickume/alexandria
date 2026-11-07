# worker/fetcher/fixtures/pages

## Variables

### blogArticle

> `const` **blogArticle**: `string`

A blog article surrounded by the site's chrome.

***

### docsPage

> `const` **docsPage**: `string`

A documentation page with code blocks and nested lists.

***

### imagesOnly

> `const` **imagesOnly**: "\<!doctype html\>\<html\>\<head\>\<title\>Gallery\</title\>\</head\>\\n\<body\>\<article\>\<img src=\\"/1.jpg\\"\>\<img src=\\"/2.jpg\\"\>\<img src=\\"/3.jpg\\"\>\</article\>\</body\>\</html\>"

A page of nothing but images.

***

### relativeArticle

> `const` **relativeArticle**: `string`

An article whose images and links are relative.

## Functions

### articleWithText()

> **articleWithText**(`chars`): `string`

A page whose article text has exactly `chars` characters.

#### Parameters

##### chars

`number`

#### Returns

`string`

***

### longArticle()

> **longArticle**(`chars`): `string`

An article whose text is about `chars` characters long.

#### Parameters

##### chars

`number`

#### Returns

`string`
