# Margin canonical locator — `GET /api/reading`

The **canonical locator** is the single source of truth for "where in this book
are we right now." Both devices must agree on its fields; this file is the
contract.

## Response JSON

```json
{
  "active": true,
  "book":        "/books/the-great-gatsby.epub",
  "title":       "The Great Gatsby",
  "author":      "F. Scott Fitzgerald",
  "spine_index": 3,
  "char_offset": 1482,
  "progress":    0.127,
  "updated_ms":  45231
}
```

When no book is open: `{"active": false}`.

## Field semantics

| Field | Type | Meaning |
|-------|------|---------|
| `active` | bool | false when no book is open |
| `book` | string | SD card path as stored in CrossPoint's recent-books list |
| `title` | string | EPUB metadata title |
| `author` | string | EPUB metadata author |
| `spine_index` | uint16 | 0-based index into the EPUB spine (OPF reading order) |
| `char_offset` | uint32 | Visible codepoint offset of the first visible character on the current page within the spine item. Immune to re-pagination (font/margin changes). 0 if not yet captured. |
| `progress` | float32 | Rough book-level progress 0.0–1.0. `(spine_index + page/pageCount) / spineCount`. |
| `updated_ms` | uint32 | `millis()` on the device when this snapshot was last written. Wraps at ~49 days. |

## Normalization rule

`spine_index + char_offset` together uniquely identify a position across any
re-pagination. The iPhone uses these two fields to extract the correct paragraph
from the EPUB spine item file and begin narrating from that character.

## Endpoint

`GET http://<device-ip>/api/reading`

CORS headers are set by CrossPoint's web server for all `/api/*` routes.
