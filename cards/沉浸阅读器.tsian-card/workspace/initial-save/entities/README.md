# Entities

Store semantic entities as JSON files at `save/entities/<type>/<localId>.json`.

Character and equipment example:

```json
{
  "id": "character:萧玄",
  "name": "萧玄",
  "brief": "青玄门外门弟子，当前卷入山门冲突。",
  "gender": "男",
  "attributes": { "体魄": 7, "悟性": 6, "气运": 4, "根骨": 5, "法力": 5, "魅力": 5 },
  "containers": [{ "ref": "container:萧玄行囊" }],
  "equipment": {
    "武器": [{ "ref": "item:粗铁短剑", "applied": { "体魄": 2 } }],
    "护甲": [{ "ref": null }]
  }
}
```

Equipment is grouped by slot type. Every value is a non-empty array whose existing length is fixed capacity; exact empty slots are `{ "ref": null }`. `attributes` contains current effective safe integers, while an occupied slot's optional `applied` records its current non-zero safe-integer contribution.

Container example (`save/entities/container/<localId>.json`):

```json
{
  "id": "container:萧玄行囊",
  "name": "外门弟子行囊",
  "brief": "入门时统一发放的青灰色布囊。",
  "type": "container",
  "contents": [
    { "ref": "item:清心丹", "count": 3 },
    { "ref": "item:粗铁短剑" }
  ]
}
```

Item example (`save/entities/item/<localId>.json`):

```json
{
  "id": "item:粗铁短剑",
  "name": "粗铁短剑",
  "brief": "制式短剑，刃口有小豁。",
  "type": "equipment",
  "tags": ["制式", "近战"],
  "equipment": {
    "slotType": "武器",
    "add": { "体魄": 2 },
    "percent": { "法力": 10 },
    "effects": ["近身搏斗时略微提高威胁"]
  }
}
```

An equipped item remains reachable through the character's exclusive `containers` graph and recursive `container.contents`; do not move it into a virtual equipment container. `slotType` must match the target slot type. `add` and `percent` are safe-integer maps over existing character attributes; `effects` are narrative only. Use the equipment management capability to preview, equip, replace, unequip, or refresh the projection.

`item.type` uses one of `equipment` / `material` / `consumable` / `special` / `other`. Quantity is stored on the containing container.contents[*].count, not on the item itself.

`localId` may be Chinese, but must not contain path separators, colon, NUL, empty path segments, `.`, or `..`.
