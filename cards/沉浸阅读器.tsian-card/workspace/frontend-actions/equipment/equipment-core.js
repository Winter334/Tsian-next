async function equipmentManagementCore(operation, input, tsian, signal, options) {
  const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
  const MIN_SAFE = -MAX_SAFE;
  const ITEM_TYPES = new Set(["equipment", "material", "consumable", "special", "other"]);
  const STALE_REASONS = new Set(["missing", "unreachable", "not-equipment", "slot-type-mismatch"]);

  function isRecord(value) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  function exactKeys(value, required, optional) {
    const allowed = new Set(required.concat(optional || []));
    const keys = Object.keys(value);
    return required.every((key) => Object.prototype.hasOwnProperty.call(value, key))
      && keys.every((key) => allowed.has(key));
  }

  function failure(code, message, details) {
    const error = { code, message };
    if (details !== undefined) error.details = details;
    Object.defineProperty(error, "__equipmentBusinessFailure", { value: true });
    return error;
  }

  function fail(code, message, details) {
    throw failure(code, message, details);
  }

  function invalid(characterRef, area, field) {
    const details = { characterRef, area };
    if (field !== undefined) details.field = field;
    fail("EQUIPMENT_DATA_INVALID", "Equipment data is invalid.", details);
  }

  function validName(value) {
    return typeof value === "string" && value.length > 0 && value === value.trim() && value.length <= 80;
  }

  function parseRef(value, expectedType, characterRef, area) {
    if (typeof value !== "string" || value.length === 0 || value !== value.trim() || value.length > 120) {
      invalid(characterRef || (typeof value === "string" ? value : ""), area || "ref");
    }
    const firstColon = value.indexOf(":");
    if (firstColon <= 0 || firstColon !== value.lastIndexOf(":")) invalid(characterRef || value, area || "ref");
    const type = value.slice(0, firstColon);
    const localId = value.slice(firstColon + 1);
    const badSegment = (segment) => !validName(segment)
      || segment === "."
      || segment === ".."
      || segment.includes("/")
      || segment.includes("\\")
      || segment.includes(":")
      || segment.includes("\0");
    if (badSegment(type) || badSegment(localId) || type !== expectedType) {
      invalid(characterRef || value, area || "ref");
    }
    return { id: value, type, localId, path: "save/entities/" + type + "/" + localId + ".json" };
  }

  function safeBigInt(value, characterRef, area, field) {
    if (!Number.isSafeInteger(value)) invalid(characterRef, area, field);
    return BigInt(value);
  }

  function checkedNumber(value, characterRef, stage, attribute) {
    if (value < MIN_SAFE || value > MAX_SAFE) {
      const details = { characterRef, stage };
      if (attribute !== undefined) details.attribute = attribute;
      fail("EQUIPMENT_INTEGER_OVERFLOW", "Equipment arithmetic exceeds the safe integer range.", details);
    }
    return Number(value);
  }

  function parseJsonFile(file, characterRef, area) {
    if (!file || typeof file.content !== "string") return null;
    try {
      const value = JSON.parse(file.content);
      if (!isRecord(value)) invalid(characterRef, area);
      return value;
    } catch (error) {
      if (error && error.code) throw error;
      invalid(characterRef, area);
    }
  }

  async function readOutcome(path) {
    signal.throwIfAborted();
    try {
      const file = await tsian.workspace.read({ scope: "effective", path });
      return file && typeof file.content === "string" ? { found: true, file } : { found: false };
    } catch (error) {
      signal.throwIfAborted();
      if (error && (error.code === "WORKSPACE_FILE_NOT_FOUND" || error.code === "WORKSPACE_READ_NOT_FOUND")) return { found: false };
      throw error;
    }
  }

  function parseEntry(raw, expected, characterRef, area) {
    if (!isRecord(raw) || !exactKeys(raw, ["ref"], ["count"])) invalid(characterRef, area);
    const parsed = parseRef(raw.ref, expected, characterRef, "ref");
    let count = 1n;
    if (raw.count !== undefined) {
      if (!Number.isSafeInteger(raw.count) || raw.count <= 0) invalid(characterRef, "count");
      count = BigInt(raw.count);
      if (expected === "container" && count !== 1n) invalid(characterRef, "count");
    }
    return { parsed, count };
  }

  function parseRoots(character, characterRef, ownershipArea) {
    if (character.containers === undefined) return [];
    if (!Array.isArray(character.containers)) invalid(characterRef, ownershipArea || "container");
    try {
      return character.containers.map((entry) => parseEntry(entry, "container", characterRef, ownershipArea || "container"));
    } catch (error) {
      if (ownershipArea && error && error.__equipmentBusinessFailure === true) invalid(characterRef, ownershipArea);
      throw error;
    }
  }

  function parseAttributes(character, characterRef) {
    if (!isRecord(character.attributes)) invalid(characterRef, "character", "attributes");
    const names = Object.keys(character.attributes);
    const values = {};
    for (const name of names) {
      if (!validName(name)) invalid(characterRef, "character", "attributes");
      values[name] = safeBigInt(character.attributes[name], characterRef, "character", name);
    }
    return { names, values };
  }

  function parseEquipment(character, characterRef, attributes) {
    const rawEquipment = character.equipment === undefined ? {} : character.equipment;
    if (!isRecord(rawEquipment)) invalid(characterRef, "equipment");
    const equipment = {};
    const oldAppliedTotals = Object.fromEntries(attributes.names.map((name) => [name, 0n]));
    for (const slotType of Object.keys(rawEquipment)) {
      if (!validName(slotType)) invalid(characterRef, "equipment", slotType);
      const rawSlots = rawEquipment[slotType];
      if (!Array.isArray(rawSlots) || rawSlots.length === 0) invalid(characterRef, "equipment", slotType);
      const slots = [];
      for (let slotIndex = 0; slotIndex < rawSlots.length; slotIndex += 1) {
        const rawSlot = rawSlots[slotIndex];
        if (!isRecord(rawSlot) || !exactKeys(rawSlot, ["ref"], ["applied"])) invalid(characterRef, "equipment", slotType);
        if (rawSlot.ref === null) {
          if (!exactKeys(rawSlot, ["ref"], [])) invalid(characterRef, "equipment", slotType);
          slots.push({ ref: null });
          continue;
        }
        const ref = parseRef(rawSlot.ref, "item", characterRef, "ref").id;
        const slot = { ref };
        if (rawSlot.applied !== undefined) {
          if (!isRecord(rawSlot.applied)) invalid(characterRef, "applied", slotType);
          const applied = {};
          for (const attribute of Object.keys(rawSlot.applied)) {
            if (!Object.prototype.hasOwnProperty.call(attributes.values, attribute)) {
              fail("EQUIPMENT_UNKNOWN_ATTRIBUTE", "Equipment refers to an unknown attribute.", {
                characterRef,
                source: "applied",
                attributes: [attribute].sort(),
              });
            }
            const value = safeBigInt(rawSlot.applied[attribute], characterRef, "applied", attribute);
            applied[attribute] = value;
            oldAppliedTotals[attribute] += value;
          }
          if (Object.keys(applied).length > 0) slot.applied = applied;
        }
        slots.push(slot);
      }
      equipment[slotType] = slots;
    }
    return { equipment, oldAppliedTotals };
  }

  function recoverBaseline(attributes, oldAppliedTotals, characterRef) {
    const baseline = {};
    for (const attribute of attributes.names) {
      const value = attributes.values[attribute] - oldAppliedTotals[attribute];
      checkedNumber(value, characterRef, "recovered-baseline", attribute);
      baseline[attribute] = value;
    }
    return baseline;
  }

  function parseItemDocument(raw, parsedRef, characterRef) {
    if (!isRecord(raw) || raw.id !== parsedRef.id || !ITEM_TYPES.has(raw.type)) invalid(characterRef, "item");
    let equipment = null;
    if (raw.equipment !== undefined) {
      if (!isRecord(raw.equipment) || !exactKeys(raw.equipment, ["slotType"], ["add", "percent", "effects"])) {
        invalid(characterRef, "item", "equipment");
      }
      if (!validName(raw.equipment.slotType)) invalid(characterRef, "item", "slotType");
      equipment = { slotType: raw.equipment.slotType, add: {}, percent: {} };
      for (const mapName of ["add", "percent"]) {
        if (raw.equipment[mapName] === undefined) continue;
        if (!isRecord(raw.equipment[mapName])) invalid(characterRef, "item", mapName);
        for (const attribute of Object.keys(raw.equipment[mapName])) {
          if (!validName(attribute)) invalid(characterRef, "item", mapName);
          equipment[mapName][attribute] = safeBigInt(raw.equipment[mapName][attribute], characterRef, "item", attribute);
        }
      }
      if (raw.equipment.effects !== undefined) {
        if (!Array.isArray(raw.equipment.effects) || raw.equipment.effects.some((entry) => typeof entry !== "string")) {
          invalid(characterRef, "item", "effects");
        }
        equipment.effects = raw.equipment.effects.slice();
      }
    }
    if (raw.type === "equipment" && equipment === null) invalid(characterRef, "item", "equipment");
    return { type: raw.type, equipment };
  }

  function validateItemAttributes(item, attributes, characterRef, source) {
    if (!item.equipment) return;
    const unknown = new Set();
    for (const mapName of ["add", "percent"]) {
      for (const attribute of Object.keys(item.equipment[mapName])) {
        if (!Object.prototype.hasOwnProperty.call(attributes.values, attribute)) unknown.add(attribute);
      }
    }
    if (unknown.size > 0) {
      fail("EQUIPMENT_UNKNOWN_ATTRIBUTE", "Equipment refers to an unknown attribute.", {
        characterRef,
        source,
        attributes: Array.from(unknown).sort(),
      });
    }
  }

  async function loadItem(itemRef, characterRef, cache) {
    if (cache.has(itemRef)) return cache.get(itemRef);
    const parsed = parseRef(itemRef, "item", characterRef, "ref");
    const outcome = await readOutcome(parsed.path);
    if (!outcome.found) {
      if (outcome.readFailed) invalid(characterRef, "item");
      const result = { status: "missing", parsed };
      cache.set(itemRef, result);
      return result;
    }
    const raw = parseJsonFile(outcome.file, characterRef, "item");
    const result = { status: "ready", parsed, item: parseItemDocument(raw, parsed, characterRef) };
    cache.set(itemRef, result);
    return result;
  }

  async function buildTargetGraph(character, characterRef) {
    const available = new Map();
    const targetContainers = new Set();
    const completed = new Set();
    const active = [];

    async function walk(containerRef) {
      if (active.includes(containerRef)) {
        const start = active.indexOf(containerRef);
        fail("EQUIPMENT_CONTAINER_CYCLE", "The character container graph contains a cycle.", {
          characterRef,
          containerRefs: active.slice(start).concat(containerRef),
        });
      }
      if (completed.has(containerRef)) return;
      const parsed = parseRef(containerRef, "container", characterRef, "ref");
      const outcome = await readOutcome(parsed.path);
      if (!outcome.found) invalid(characterRef, "container");
      const raw = parseJsonFile(outcome.file, characterRef, "container");
      if (raw.id !== parsed.id || raw.type !== "container" || !Array.isArray(raw.contents)) invalid(characterRef, "container");
      targetContainers.add(containerRef);
      active.push(containerRef);
      for (const rawEntry of raw.contents) {
        if (!isRecord(rawEntry) || !exactKeys(rawEntry, ["ref"], ["count"])) invalid(characterRef, "container");
        if (typeof rawEntry.ref !== "string") invalid(characterRef, "ref");
        const colon = rawEntry.ref.indexOf(":");
        const type = colon > 0 ? rawEntry.ref.slice(0, colon) : "";
        if (type === "container") {
          const entry = parseEntry(rawEntry, "container", characterRef, "container");
          await walk(entry.parsed.id);
        } else if (type === "item") {
          const entry = parseEntry(rawEntry, "item", characterRef, "container");
          available.set(entry.parsed.id, (available.get(entry.parsed.id) || 0n) + entry.count);
        } else {
          invalid(characterRef, "ref");
        }
      }
      active.pop();
      completed.add(containerRef);
    }

    for (const root of parseRoots(character, characterRef)) await walk(root.parsed.id);
    return { available, targetContainers };
  }

  async function proveExclusiveOwnership(characterRef, targetContainers) {
    signal.throwIfAborted();
    let listing;
    try {
      listing = await tsian.workspace.list({ scope: "effective", path: "save/entities/character" });
    } catch (_error) {
      invalid(characterRef, "ownership");
    }
    if (!isRecord(listing) || !Array.isArray(listing.entries)) invalid(characterRef, "ownership");
    const sharedCharacters = new Set();
    const sharedContainers = new Set();

    for (const entry of listing.entries) {
      if (!isRecord(entry) || entry.kind !== "file" || typeof entry.name !== "string" || !entry.name.endsWith(".json")) continue;
      const localId = entry.name.slice(0, -5);
      let parsedCharacterRef;
      try {
        parsedCharacterRef = parseRef("character:" + localId, "character", characterRef, "ownership");
      } catch (_error) {
        invalid(characterRef, "ownership");
      }
      const outcome = await readOutcome(parsedCharacterRef.path);
      if (!outcome.found) invalid(characterRef, "ownership");
      const other = parseJsonFile(outcome.file, characterRef, "ownership");
      if (other.id !== parsedCharacterRef.id) invalid(characterRef, "ownership");
      if (parsedCharacterRef.id === characterRef) continue;
      const completed = new Set();
      const active = new Set();

      async function walkForeign(containerRef) {
        if (targetContainers.has(containerRef)) {
          sharedCharacters.add(parsedCharacterRef.id);
          sharedContainers.add(containerRef);
          return;
        }
        if (active.has(containerRef) || completed.has(containerRef)) return;
        const parsed = parseRef(containerRef, "container", characterRef, "ownership");
        const containerOutcome = await readOutcome(parsed.path);
        if (!containerOutcome.found) invalid(characterRef, "ownership");
        const raw = parseJsonFile(containerOutcome.file, characterRef, "ownership");
        if (raw.id !== parsed.id || raw.type !== "container" || !Array.isArray(raw.contents)) invalid(characterRef, "ownership");
        active.add(containerRef);
        for (const rawEntry of raw.contents) {
          if (!isRecord(rawEntry) || !exactKeys(rawEntry, ["ref"], ["count"]) || typeof rawEntry.ref !== "string") {
            invalid(characterRef, "ownership");
          }
          const colon = rawEntry.ref.indexOf(":");
          const type = colon > 0 ? rawEntry.ref.slice(0, colon) : "";
          if (type === "container") {
            const child = parseEntry(rawEntry, "container", characterRef, "ownership");
            await walkForeign(child.parsed.id);
          } else if (type === "item") {
            parseRef(rawEntry.ref, "item", characterRef, "ownership");
          } else {
            invalid(characterRef, "ownership");
          }
        }
        active.delete(containerRef);
        completed.add(containerRef);
      }

      for (const root of parseRoots(other, characterRef, "ownership")) await walkForeign(root.parsed.id);
    }

    if (sharedCharacters.size > 0) {
      fail("EQUIPMENT_SHARED_CONTAINER", "A character container is shared by another character.", {
        characterRef,
        otherCharacterRefs: Array.from(sharedCharacters).sort(),
        containerRefs: Array.from(sharedContainers).sort(),
      });
    }
  }

  function normalizeInput(operationName, rawInput, actionMode) {
    if (!isRecord(rawInput)) invalid("", "ref");
    const action = Boolean(actionMode);
    const mode = action ? rawInput.mode : "commit";
    if (action && mode !== "preview" && mode !== "commit") invalid(typeof rawInput.characterRef === "string" ? rawInput.characterRef : "", "ref");
    const common = action ? ["mode", "operation", "characterRef"] : ["characterRef"];
    if (action && rawInput.operation !== operationName) invalid(typeof rawInput.characterRef === "string" ? rawInput.characterRef : "", "ref");
    if (operationName === "equip") {
      const required = common.concat(["slotType", "slotIndex", "expectedCurrentRef", "itemRef"]);
      if (!exactKeys(rawInput, required, [])) invalid(typeof rawInput.characterRef === "string" ? rawInput.characterRef : "", "ref");
    } else if (operationName === "unequip") {
      const required = common.concat(["slotType", "slotIndex", "expectedCurrentRef"]);
      if (!exactKeys(rawInput, required, [])) invalid(typeof rawInput.characterRef === "string" ? rawInput.characterRef : "", "ref");
    } else if (operationName === "refresh") {
      if (action || !exactKeys(rawInput, ["characterRef"], ["attributeChanges"])) invalid(typeof rawInput.characterRef === "string" ? rawInput.characterRef : "", "ref");
    } else {
      invalid("", "ref");
    }
    const parsedCharacter = parseRef(rawInput.characterRef, "character", typeof rawInput.characterRef === "string" ? rawInput.characterRef : "", "ref");
    if (operationName === "equip" || operationName === "unequip") {
      if (!validName(rawInput.slotType) || !Number.isSafeInteger(rawInput.slotIndex) || rawInput.slotIndex < 0) invalid(parsedCharacter.id, "ref");
      if (rawInput.expectedCurrentRef !== null) parseRef(rawInput.expectedCurrentRef, "item", parsedCharacter.id, "ref");
      if (operationName === "unequip" && rawInput.expectedCurrentRef === null) invalid(parsedCharacter.id, "ref");
      if (operationName === "equip") parseRef(rawInput.itemRef, "item", parsedCharacter.id, "ref");
    }
    if (operationName === "refresh" && rawInput.attributeChanges !== undefined) {
      if (!isRecord(rawInput.attributeChanges)) invalid(parsedCharacter.id, "character", "attributeChanges");
      for (const attribute of Object.keys(rawInput.attributeChanges)) {
        if (!validName(attribute) || !Number.isSafeInteger(rawInput.attributeChanges[attribute])) {
          invalid(parsedCharacter.id, "character", "attributeChanges");
        }
      }
    }
    return { parsedCharacter, mode };
  }

  signal.throwIfAborted();
  const normalized = normalizeInput(operation, input, options && options.actionMode);
  const characterRef = normalized.parsedCharacter.id;
  const characterOutcome = await readOutcome(normalized.parsedCharacter.path);
  if (!characterOutcome.found) {
    if (characterOutcome.readFailed) invalid(characterRef, "character");
    fail("EQUIPMENT_CHARACTER_NOT_FOUND", "Character was not found.", { characterRef });
  }
  const character = parseJsonFile(characterOutcome.file, characterRef, "character");
  if (character.id !== characterRef || typeof character.name !== "string" || typeof character.brief !== "string") {
    invalid(characterRef, "character");
  }

  const attributes = parseAttributes(character, characterRef);
  const parsedEquipment = parseEquipment(character, characterRef, attributes);
  const baseline = recoverBaseline(attributes, parsedEquipment.oldAppliedTotals, characterRef);

  let targetSlot = null;
  let beforeRef = null;
  if (operation === "equip" || operation === "unequip") {
    const slots = parsedEquipment.equipment[input.slotType];
    if (!slots || input.slotIndex >= slots.length) {
      fail("EQUIPMENT_SLOT_NOT_FOUND", "Equipment slot was not found.", {
        characterRef,
        slotType: input.slotType,
        slotIndex: input.slotIndex,
      });
    }
    targetSlot = slots[input.slotIndex];
    beforeRef = targetSlot.ref;
    if (beforeRef !== input.expectedCurrentRef) {
      fail("EQUIPMENT_EXPECTED_REF_MISMATCH", "Equipment slot changed before this operation.", {
        characterRef,
        slotType: input.slotType,
        slotIndex: input.slotIndex,
        expectedCurrentRef: input.expectedCurrentRef,
        actualCurrentRef: beforeRef,
      });
    }
  }

  const graph = await buildTargetGraph(character, characterRef);
  await proveExclusiveOwnership(characterRef, graph.targetContainers);

  const itemCache = new Map();
  const liveByPosition = new Map();
  const staleSlots = [];
  for (const slotType of Object.keys(parsedEquipment.equipment)) {
    const slots = parsedEquipment.equipment[slotType];
    for (let slotIndex = 0; slotIndex < slots.length; slotIndex += 1) {
      const slot = slots[slotIndex];
      if (slot.ref === null) continue;
      let reason = null;
      let loaded = null;
      if (!graph.available.has(slot.ref)) {
        reason = "unreachable";
      } else {
        loaded = await loadItem(slot.ref, characterRef, itemCache);
        if (loaded.status === "missing") reason = "missing";
        else if (loaded.item.type !== "equipment") reason = "not-equipment";
        else if (loaded.item.equipment.slotType !== slotType) reason = "slot-type-mismatch";
      }
      if (reason !== null) {
        if (!STALE_REASONS.has(reason)) invalid(characterRef, "equipment");
        staleSlots.push({ slotType, slotIndex, ref: slot.ref, reason });
      } else {
        validateItemAttributes(loaded.item, attributes, characterRef, slot.ref);
        liveByPosition.set(slotType + "\0" + slotIndex, loaded.item);
      }
    }
  }

  if (operation !== "refresh" && staleSlots.length > 0) {
    fail("EQUIPMENT_REFRESH_REQUIRED", "Equipment projections must be refreshed before changing a slot.", {
      characterRef,
      staleSlots,
    });
  }

  let candidateItem = null;
  if (operation === "equip") {
    if (!graph.available.has(input.itemRef)) {
      fail("EQUIPMENT_ITEM_NOT_REACHABLE", "Equipment item is not reachable from the character inventory.", {
        characterRef,
        itemRef: input.itemRef,
      });
    }
    const loaded = await loadItem(input.itemRef, characterRef, itemCache);
    if (loaded.status === "missing") {
      fail("EQUIPMENT_ITEM_NOT_FOUND", "Equipment item was not found.", { characterRef, itemRef: input.itemRef });
    }
    if (loaded.item.type !== "equipment") {
      invalid(characterRef, "item");
    }
    if (loaded.item.equipment.slotType !== input.slotType) {
      fail("EQUIPMENT_SLOT_TYPE_MISMATCH", "The selected item does not match this slot type.", {
        characterRef,
        itemRef: input.itemRef,
        expectedSlotType: input.slotType,
        actualSlotType: loaded.item.equipment.slotType,
      });
    }
    validateItemAttributes(loaded.item, attributes, characterRef, input.itemRef);
    candidateItem = loaded.item;
  }

  const postBaseline = { ...baseline };
  if (operation === "refresh" && input.attributeChanges !== undefined) {
    const unknown = Object.keys(input.attributeChanges).filter((name) => !Object.prototype.hasOwnProperty.call(attributes.values, name)).sort();
    if (unknown.length > 0) {
      fail("EQUIPMENT_UNKNOWN_ATTRIBUTE", "Attribute changes refer to unknown attributes.", {
        characterRef,
        source: "attributeChanges",
        attributes: unknown,
      });
    }
    for (const name of Object.keys(input.attributeChanges)) {
      postBaseline[name] += BigInt(input.attributeChanges[name]);
      checkedNumber(postBaseline[name], characterRef, "changed-baseline", name);
    }
  }

  const desiredRefs = {};
  for (const slotType of Object.keys(parsedEquipment.equipment)) {
    desiredRefs[slotType] = parsedEquipment.equipment[slotType].map((slot, slotIndex) => {
      if (operation === "refresh" && staleSlots.some((stale) => stale.slotType === slotType && stale.slotIndex === slotIndex)) return null;
      if (operation === "equip" && slotType === input.slotType && slotIndex === input.slotIndex) return input.itemRef;
      if (operation === "unequip" && slotType === input.slotType && slotIndex === input.slotIndex) return null;
      return slot.ref;
    });
  }

  const demanded = new Map();
  for (const slotType of Object.keys(desiredRefs)) {
    for (const ref of desiredRefs[slotType]) if (ref !== null) demanded.set(ref, (demanded.get(ref) || 0n) + 1n);
  }
  for (const [itemRef, demand] of demanded) {
    const available = graph.available.get(itemRef) || 0n;
    const publicAvailable = checkedNumber(available, characterRef, "reachable-quantity");
    const publicDemand = checkedNumber(demand, characterRef, "reachable-quantity");
    if (demand > available) {
      fail("EQUIPMENT_QUANTITY_EXHAUSTED", "Not enough reachable item quantity is available.", {
        characterRef,
        itemRef,
        available: publicAvailable,
        demanded: publicDemand,
      });
    }
  }

  function contributionFor(item, attribute) {
    const add = item.equipment.add[attribute] || 0n;
    const percent = item.equipment.percent[attribute] || 0n;
    const absoluteBaseline = postBaseline[attribute] < 0n ? -postBaseline[attribute] : postBaseline[attribute];
    const numerator = 100n * add + absoluteBaseline * percent;
    const magnitude = numerator < 0n ? -numerator : numerator;
    let quotient = magnitude / 100n;
    if ((magnitude % 100n) * 2n >= 100n) quotient += 1n;
    const contribution = numerator < 0n ? -quotient : quotient;
    checkedNumber(contribution, characterRef, "slot-contribution", attribute);
    return contribution;
  }

  const afterEquipment = {};
  const contributionTotals = Object.fromEntries(attributes.names.map((name) => [name, 0n]));
  for (const slotType of Object.keys(desiredRefs)) {
    afterEquipment[slotType] = [];
    for (let slotIndex = 0; slotIndex < desiredRefs[slotType].length; slotIndex += 1) {
      const ref = desiredRefs[slotType][slotIndex];
      if (ref === null) {
        afterEquipment[slotType].push({ ref: null });
        continue;
      }
      let item;
      if (operation === "equip" && slotType === input.slotType && slotIndex === input.slotIndex) {
        item = candidateItem;
      } else {
        item = liveByPosition.get(slotType + "\0" + slotIndex);
      }
      if (!item) invalid(characterRef, "equipment");
      const applied = {};
      for (const attribute of attributes.names) {
        const value = contributionFor(item, attribute);
        if (value !== 0n) applied[attribute] = Number(value);
        contributionTotals[attribute] += value;
      }
      const slot = { ref };
      if (Object.keys(applied).length > 0) slot.applied = applied;
      afterEquipment[slotType].push(slot);
    }
  }

  const beforeAttributes = {};
  const afterAttributes = {};
  const delta = {};
  for (const attribute of attributes.names) {
    beforeAttributes[attribute] = Number(attributes.values[attribute]);
    const value = postBaseline[attribute] + contributionTotals[attribute];
    afterAttributes[attribute] = checkedNumber(value, characterRef, "final-attribute", attribute);
    const difference = value - attributes.values[attribute];
    if (difference !== 0n) delta[attribute] = checkedNumber(difference, characterRef, "output-delta", attribute);
  }

  let output;
  if (operation === "refresh") {
    output = {
      kind: "refresh",
      characterRef,
      attributes: { before: beforeAttributes, after: afterAttributes, delta },
      equipment: afterEquipment,
      clearedSlots: staleSlots.map((slot) => ({
        slotType: slot.slotType,
        slotIndex: slot.slotIndex,
        previousRef: slot.ref,
        reason: slot.reason,
      })),
    };
  } else {
    const mutation = {
      kind: "mutation",
      operation,
      characterRef,
      slot: {
        slotType: input.slotType,
        slotIndex: input.slotIndex,
        beforeRef,
        afterRef: operation === "equip" ? input.itemRef : null,
      },
      attributes: { before: beforeAttributes, after: afterAttributes, delta },
      equipment: afterEquipment,
    };
    output = options && options.actionMode ? { ...mutation, mode: normalized.mode } : mutation;
  }

  JSON.stringify(output);
  const updatedCharacter = { ...character, attributes: afterAttributes, equipment: afterEquipment };
  const content = JSON.stringify(updatedCharacter, null, 2) + "\n";
  const currentContent = characterOutcome.file.content;
  signal.throwIfAborted();
  if (!(options && options.actionMode && normalized.mode === "preview") && content !== currentContent) {
    await tsian.workspace.write({
      scope: "save-runtime",
      path: normalized.parsedCharacter.path,
      content,
      mediaType: "application/json",
    });
  }
  return output;
}

globalThis.__tsianEquipmentActionCore = equipmentManagementCore;
