# shared — cross-device contract (source of truth)

The agreement both device halves must honor. Changes here ripple to **both**
`firmware-x4/` and `ios/`; update this first, then both consumers.

## `protocol/`

BLE/Wi-Fi event schemas exchanged between X4 and iPhone (spec §15, Appendix A):
`device.hello`, `reading.position`, `playback.toggle/state`,
`narration.active_span`, `discussion.begin/end`, `voice_note.begin/end`,
`selection.changed`, `agent.state`, `sync.position`, `annotation.committed`.

Design rules (spec §15.1): small messages suited to BLE GATT; versioned schema +
capability negotiation; idempotent commands where possible; sequence numbers for
ordering/reconnect; acks only for state-changing commands; JSON acceptable for
MVP debugging, migrate to CBOR/binary only if BLE throughput requires.

## `canonicalization/`

The normalization rules and conformance fixtures that make a **canonical
locator** identical on firmware and iPhone (spec §9):

```
CanonicalLocator {
  book_id: SHA256(canonical EPUB content)
  spine_index
  char_start, char_end          # normalized character offsets
  context_hash: SHA256(normalized surrounding text)[0:16]
  optional_epub_cfi
}
```

Normalize Unicode, whitespace, soft hyphens, and renderer-only artifacts
identically on both sides. `fixtures/` holds text/hash snapshots both
implementations must reproduce.

> This is the foundational technical decision of the product. Page numbers are
> not stable; everything anchors to normalized book text.
