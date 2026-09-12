async function maintenanceCore(operation, input, tsian, signal) {
  const SESSION = "save/maintenance/session.json";
  const FIELDS = "agents/stage-manager/skills/回合后维护/semantic-fields.json";
  const RUNTIME = "save/playthrough/runtime.json";
  const RECORDS = "save/memory/records.md";
  const SEEDS = "save/memory/seeds.md";
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const obj = value => value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const arr = value => Array.isArray(value) ? value : [];
  const clone = value => JSON.parse(JSON.stringify(value));
  function fail(message) { const error = new Error(message); error.code = "MAINTENANCE_REJECTED"; throw error; }
  function text(value, label, max = 10000) {
    if (typeof value !== "string" || !value.trim() || value.length > max) fail(`${label}需要明确的文字内容。`);
    return value.trim();
  }
  function pathFor(ref) {
    const match = /^(character|item|container|location|scene):([^:/\\\0]+)$/.exec(ref);
    if (!match || [".", ".."].includes(match[2])) fail(`资料标识无效：${ref}`);
    return match[1] === "scene" ? `save/scenes/${match[2]}.json` : `save/entities/${match[1]}/${match[2]}.json`;
  }
  async function raw(path) {
    signal.throwIfAborted();
    try { const file = await tsian.workspace.read({ scope: "effective", path }); return file ? file.content : null; }
    catch (error) { if (error && error.code === "WORKSPACE_FILE_NOT_FOUND") return null; throw error; }
  }
  function parse(value) { return value === null ? null : JSON.parse(value); }
  const session = parse(await raw(SESSION));
  if (!session || !Number.isSafeInteger(session.turn) || session.turn < 0 || !session.token || !session.baselines) fail("本轮资料尚未准备好，请重新发起整理。");
  if (session.turn === 0) {
    const opening = parse(await raw("save/playthrough/opening-state.json"));
    if (!opening || !opening.approved || !opening.published) fail("开局正文尚未落定，不能维护。");
  }
  const definitions = parse(await raw(FIELDS));
  // The platform's Skill validator checks top-level types only. Validate this
  // card's complete semantic protocol, using the declaration as the single source.
  const declaration = await raw("agents/stage-manager/skills/回合后维护/SKILL.md");
  const actions = JSON.parse(declaration.match(/```json tsian-actions\s*([\s\S]*?)```/)[1]);
  const action = actions.find(value => value.name === (operation === "lookup" ? "lookup" : "submit_changes"));
  function validate(schema, value, label) {
    if (schema.anyOf) {
      if (!schema.anyOf.some(candidate => { try { validate(candidate, value, label); return true; } catch { return false; } })) fail(`${label} 的内容类型不合适。`);
      return;
    }
    const types = schema.type === undefined ? [] : arr(schema.type).length ? schema.type : [schema.type];
    const matches = type => type === "null" ? value === null : type === "array" ? Array.isArray(value)
      : type === "object" ? value !== null && typeof value === "object" && !Array.isArray(value)
      : type === "integer" ? Number.isSafeInteger(value) : type === "number" ? typeof value === "number" && Number.isFinite(value) : typeof value === type;
    if (types.length && !types.some(matches)) fail(`${label} 的内容类型不合适。`);
    if (schema.enum && !schema.enum.includes(value)) fail(`${label} 的选项无效。`);
    if (typeof value === "string" && ((schema.minLength !== undefined && value.trim().length < schema.minLength) || (schema.maxLength !== undefined && value.length > schema.maxLength))) fail(`${label} 的文字过长。`);
    if (typeof value === "number" && ((schema.minimum !== undefined && value < schema.minimum) || (schema.maximum !== undefined && value > schema.maximum))) fail(`${label} 的数值超出范围。`);
    if (Array.isArray(value)) {
      if (schema.maxItems !== undefined && value.length > schema.maxItems) fail(`${label} 的条目过多。`);
      if (schema.items) value.forEach((item, index) => validate(schema.items, item, `${label}[${index}]`));
    } else if (value && typeof value === "object") {
      for (const key of schema.required || []) if (!own(value, key)) fail(`${label} 缺少 ${key}。`);
      for (const [key, item] of Object.entries(value)) {
        if (["__proto__", "prototype", "constructor"].includes(key)) fail(`${label} 的名称不可用。`);
        const property = obj(schema.properties)[key];
        if (!property && schema.additionalProperties === false) fail(`${label} 不接受 ${key}；请提交语义变化而不是内部字段。`);
        if (property || typeof schema.additionalProperties === "object") validate(property || schema.additionalProperties, item, `${label}.${key}`);
      }
    }
  }
  validate(action.inputSchema, input, "变化");

  const turnPath = `save/history/turns/turn-${String(session.turn).padStart(6, "0")}.json`;
  const history = parse(await raw(turnPath));
  if (!history || JSON.stringify(history.timeline) !== session.source) fail("本轮正文已经变化，请重新发起整理。");
  const receipt = obj(obj(history.meta).maintenance);
  if (receipt.token) {
    if (receipt.source !== session.source) fail("正文与已整理结果不一致，请回溯后重试。");
    return { status: "already_applied", summary: obj(obj(history.meta).recall)["摘要"] || "本轮资料已更新。" };
  }
  async function tracked(path, required = true) {
    const content = await raw(path);
    if (own(session.baselines, path) && session.baselines[path] !== content) fail("相关资料已经变化，请重新发起整理。");
    session.baselines[path] = content;
    if (content === null && required) fail("所需资料不存在，请先确认对象身份。");
    return parse(content);
  }
  function project(entity) {
    const result = { ref: entity.id, name: entity.name };
    for (const [name, source] of Object.entries(definitions.entityFields)) {
      if (name === "itemType" && !entity.id.startsWith("item:")) continue;
      if (entity[source] !== undefined) result[name] = entity[source];
    }
    for (const [name, source, keys] of [
      ["states", "status", ["id", "name", "description", "polarity"]],
      ["traits", "traits", ["id", "name", "description", "effects"]],
      ["gauges", "gauges", ["id", "name", "value", "min", "max", "unit"]],
    ]) result[name] = arr(entity[source]).map(value => Object.fromEntries(keys.filter(key => obj(value)[key] !== undefined).map(key => [key, obj(value)[key]])));
    result.experiences = arr(entity.history).map(value => typeof value === "string" ? value : obj(value).event).filter(value => typeof value === "string");
    result.attributes = obj(entity.attributes);
    for (const [name, field] of [["tier", "powerTier"], ["level", "powerLevel"], ["ratings", "ratings"]]) if (entity[field] !== undefined) result[name] = clone(entity[field]);
    result.containers = arr(entity.containers).map(value => obj(value).ref);
    result.contents = arr(entity.contents).map(value => ({ ref: obj(value).ref, quantity: obj(value).count ?? 1 }));
    result.equipment = entity.id.startsWith("character:") ? Object.entries(obj(entity.equipment)).flatMap(([slot, entries]) => arr(entries).map((value, index) => ({ slot, index, item: obj(value).ref ?? null }))) : [];
    if (entity.id.startsWith("item:") && entity.equipment) result.wearable = { slot: entity.equipment.slotType, add: entity.equipment.add, percent: entity.equipment.percent, effects: entity.equipment.effects };
    result.details = Object.fromEntries(Object.entries(obj(entity.extensions)).map(([name, value]) => [name, obj(value).value]));
    return result;
  }
  const normalized = name => String(name || "").normalize("NFKC").trim().toLocaleLowerCase().replace(/\s+/g, "");
  const namesOf = entity => [entity.name, ...arr(entity.aliases)].map(normalized).filter(Boolean);
  // Complete, paged enumeration: an output page limit is never proof of absence.
  async function inventory() {
    const result = [];
    for (const path of ["save/entities/character", "save/entities/item", "save/entities/container", "save/entities/location", "save/scenes"]) {
      let offset = 0;
      while (true) {
        const page = await tsian.workspace.list({ scope: "effective", path, recursive: false, offset, limit: 200 });
        for (const entry of arr(page.entries)) {
          if (entry.kind !== "file" || !entry.path.endsWith(".json")) continue;
          const entity = parse(await raw(entry.path));
          if (entity?.id) result.push(entity);
        }
        if (!page.truncated) break;
        if (!arr(page.entries).length) fail("无法完整检查名称候选；没有创建任何对象。请重试查询。");
        offset += page.entries.length;
      }
    }
    return result.sort((a, b) => a.id.localeCompare(b.id));
  }
  const sceneView = entity => ({ ref: entity.id, name: entity.name, aliases: arr(entity.aliases), location: obj(entity.location).ref, participants: arr(entity.present).map(value => value.ref), status: entity.status,
    situation: obj(obj(entity.extensions)["来客"]).value, time: obj(obj(entity.extensions)["时间"]).value });
  if (operation === "lookup") {
    const refs = new Set(arr(input.refs)), names = arr(input.names);
    if (!refs.size && !names.length) fail("请提供需要查询的对象或姓名。");
    const matchedNames = new Set();
    if (names.length) for (const entity of await inventory()) {
      for (const name of names) if (namesOf(entity).includes(normalized(name))) { refs.add(entity.id); matchedNames.add(name); }
    }
    const ordered = [...refs], offset = input.offset || 0, limit = input.limit || 20;
    const entities = [], scenes = [], relationships = [], missing = [];
    for (const ref of ordered.slice(offset, offset + limit)) {
      const entity = await tracked(pathFor(ref), false);
      if (!entity) { missing.push(ref); continue; }
      if (ref.startsWith("scene:")) scenes.push(sceneView(entity));
      else entities.push(project(entity));
      if (ref.startsWith("character:")) {
        const relation = await tracked(`save/relationships/character-${ref.slice(10)}.json`, false);
        for (const edge of arr(obj(relation).edges)) relationships.push({ from: ref, to: edge.to, kind: edge.type, description: edge.description || edge.note || "" });
      }
    }
    await tsian.workspace.write({ scope: "save-runtime", path: SESSION, content: JSON.stringify(session), mediaType: "application/json" });
    const nextOffset = offset + limit < ordered.length ? offset + limit : null;
    return { entities, scenes, relationships, missing, unmatchedNames: names.filter(name => !matchedNames.has(name)), searchComplete: true, truncated: nextOffset !== null, nextOffset, total: ordered.length };
  }
  if (operation !== "submit") fail("未知的维护动作。");
  // Verify the evidence before staging any business mutation. The runner also
  // rolls back its savepoint on execution/output failure, including failed SDK writes.
  for (const [path, before] of Object.entries(session.baselines)) if (await raw(path) !== before) fail("相关资料已经变化，请重新发起整理。");
  const staged = new Map();
  const aliases = new Map();
  async function doc(path, required = true) {
    if (staged.has(path)) return staged.get(path);
    const value = await tracked(path, required);
    return value === null ? null : clone(value);
  }
  function stage(path, value) { staged.set(path, value); }
  function resolve(value) {
    if (typeof value !== "string") fail("请使用明确的资料标识。");
    const ref = value.startsWith("@") ? aliases.get(value.slice(1)) : value;
    if (!ref) fail(`本轮新对象未定义：${value}`);
    pathFor(ref); return ref;
  }
  async function requireRef(value, types) {
    const ref = resolve(value);
    if (types && !types.includes(ref.split(":")[0])) fail(`对象类别不合适：${value}`);
    if (!await doc(pathFor(ref), false)) fail(`对象不存在：${value}`);
    return ref;
  }
  async function pointer(value, types) {
    const ref = await requireRef(value, types);
    const entity = await doc(pathFor(ref));
    return { ref, name: entity.name || ref };
  }
  function requireKnown(ref) {
    if (!own(session.baselines, pathFor(ref)) && ![...aliases.values()].includes(ref)) fail(`请先查询 ${ref} 的已有资料，再提交变化。`);
  }
  function applyItems(entity, field, prefix, changes) {
    if (!changes) return;
    const values = arr(entity[field]).map(clone);
    for (const id of arr(changes.end)) {
      const index = values.findIndex(value => value.id === id);
      if (index < 0) fail(`要结束的条目不存在：${id}`);
      values.splice(index, 1);
    }
    for (const patch of arr(changes.put)) {
      const name = text(patch.name, "条目名称", 100);
      let current = patch.id ? values.find(value => value.id === patch.id) : values.find(value => value.name === name);
      if (patch.id && !current) fail(`要修订的条目不存在：${patch.id}`);
      if (!current) { current = { id: `${prefix}:${crypto.randomUUID()}` }; values.push(current); }
      Object.assign(current, patch, { id: current.id, name });
    }
    entity[field] = values;
  }
  const newObjects = [...arr(input.entities), ...arr(input.scenes)].filter(change => !change.ref);
  if (newObjects.length) {
    const existing = await inventory(), conflicts = [];
    const newKeys = new Set();
    for (const change of newObjects) {
      const key = text(change.key, "新对象代号", 80);
      if (key.startsWith("@") || newKeys.has(key)) fail("新对象代号重复或以 @ 开头。");
      newKeys.add(key);
      text(change.name, "名称", 150);
    }
    for (const change of newObjects) {
      const names = namesOf(change);
      const candidates = [...existing, ...newObjects.filter(other => other !== change).map(other => ({ ...other, id: "@" + other.key }))]
        .filter(other => namesOf(other).some(name => names.includes(name)));
      const decisions = arr(change.distinctFrom);
      if (decisions.some(value => !candidates.some(other => other.id === value.ref))) fail("名称候选已变化，请重新查询后确认区别。");
      if (candidates.some(other => !decisions.some(value => value.ref === other.id && text(value.reason, "身份区别", 500)))) {
        conflicts.push({ key: change.key, candidates: candidates.slice(0, 20).map(other => ({ ref: other.id, name: other.name, aliases: arr(other.aliases).slice(0, 8), summary: String(other.brief || other.summary || "").slice(0, 400) })), total: candidates.length, truncated: candidates.length > 20 });
      }
    }
    if (conflicts.length) return { status: "candidates", conflicts: conflicts.slice(0, 1), remainingConflicts: Math.max(0, conflicts.length - 1), message: "整批未应用。请 lookup 并区分候选；同一对象用 ref，不同对象明确 distinctFrom。" };
  }
  // Allocate all new entities/scenes first, so @keys can reference each other.
  for (const [kind, changes] of [["entity", arr(input.entities)], ["scene", arr(input.scenes)]]) {
    for (const change of changes) {
      if (change.ref) {
        if (change.key || change.type) fail("已有对象只需 ref，不应同时声明新对象代号或类别。");
        continue;
      }
      if (kind === "scene" && !change.location) fail("新场景需要明确地点。");
      const key = text(change.key, "新对象代号", 80), name = text(change.name, "名称", 150);
      if (aliases.has(key)) fail(`新对象代号重复：${key}`);
      const type = kind === "scene" ? "scene" : change.type;
      if (!["character", "item", "container", "location", "scene"].includes(type)) fail("新对象需要明确类别。");
      const ref = `${type}:${crypto.randomUUID()}`;
      aliases.set(key, ref);
      stage(pathFor(ref), { id: ref, name, brief: "", ...(type === "character" ? { attributes: {} } : {}), ...(type === "item" ? { type: "other" } : {}), ...(type === "scene" ? { status: "active", present: [] } : { lifecycle: "active" }), ...(type === "container" ? { type: "container", contents: [] } : {}) });
    }
  }
  const runtime = await doc(RUNTIME);
  const worldSchema = await doc("save/schema/world.json", false);
  const attributeRefreshRefs = new Set();
  function completeCharacterAttributes(entity, change) {
    if (!worldSchema || !arr(worldSchema.dimensions).length) fail("人物属性需要已提交的世界维度与规则，不能猜测缺失的 schema。");
    const dimensions = worldSchema.dimensions, tiers = worldSchema.power.tiers;
    const previousTier = entity.powerTier, previousLevel = entity.powerLevel;
    const tier = change.tier ?? previousTier;
    if (change.tier !== undefined && !tiers.includes(change.tier)) fail("请使用世界规则中明确的力量阶梯。");
    // A new tier does not inherit the previous tier's intra-tier level.
    const level = change.level ?? (tier === previousTier ? previousLevel : undefined);
    if (level && level.current > level.total) fail("阶内等级超过总级数。");
    const positionChanged = tier !== previousTier || level?.current !== previousLevel?.current || level?.total !== previousLevel?.total;
    const previousRatings = obj(entity.ratings), ratings = { ...previousRatings };
    for (const name of Object.keys(obj(change.ratings))) if (!dimensions.some(d => d.name === name)) fail("人物评价包含未定义的属性。");
    const q = tiers.length > 1 ? Math.pow({ gentle: 4, moderate: 30, steep: 1000 }[worldSchema.power.scale], 1 / (tiers.length - 1)) : 1;
    function factor(dimension, atTier, atLevel) {
      if (dimension.kind === "talent" || !tiers.length) return 1;
      const index = tiers.indexOf(atTier);
      if (index < 0) fail(`${entity.name} 缺少属性换算所需的 tier；请依据已知境界或身份表现明确估档，不会默认最低阶。`);
      const fraction = atLevel && atLevel.total > 1 ? (atLevel.current - 1) / (atLevel.total - 1) : 0;
      return Math.pow(q, (index + fraction) * (dimension.kind === "hybrid" ? 0.5 : 1));
    }
    entity.attributes = { ...obj(entity.attributes) };
    for (const dimension of dimensions) {
      const name = dimension.name, current = entity.attributes[name];
      if (current !== undefined && !Number.isSafeInteger(current)) fail("已有属性不是可用的安全整数。");
      const supplied = own(obj(change.ratings), name), previousRating = previousRatings[name];
      const rating = supplied ? change.ratings[name] : previousRating ?? 5;
      const reestimate = supplied && rating !== previousRating;
      const rescale = positionChanged && dimension.kind !== "talent" && (previousTier !== undefined || !tiers.length);
      // Normal updates, repeated estimates and unrelated ratings preserve accepted values.
      if (current !== undefined && !reestimate && !rescale) continue;
      const scale = factor(dimension, tier, level), projected = Math.round(rating * scale);
      const applied = Object.values(obj(entity.equipment)).flatMap(arr).reduce((sum, slot) => sum + (obj(slot.applied)[name] || 0), 0);
      let next = projected + applied;
      if (current !== undefined) {
        const oldScaleKnown = dimension.kind === "talent" || !tiers.length || tiers.includes(previousTier);
        if (previousRating !== undefined && oldScaleKnown) {
          // Apply the change of the rating/tier projection, not a replacement of
          // the accepted stat: persistent training deltas and worn effects survive.
          next = current + projected - Math.round(previousRating * factor(dimension, previousTier, previousLevel));
        } else if (!supplied && oldScaleKnown) {
          // Existing numerical facts with no relative rating remain authoritative.
          next = Math.round((current - applied) * scale / factor(dimension, previousTier, previousLevel)) + applied;
        }
      }
      if (!Number.isSafeInteger(next)) fail("属性计算超出可用范围。");
      entity.attributes[name] = next;
      if (current === undefined || supplied || previousRating !== undefined) ratings[name] = rating;
      if (current !== next) attributeRefreshRefs.add(entity.id);
    }
    if (tier !== undefined) entity.powerTier = tier;
    if (level !== undefined) entity.powerLevel = clone(level);
    else if (tier !== previousTier) delete entity.powerLevel;
    // Internal game estimates are not a replacement for an explicit identity.realm.
    entity.ratings = ratings;
  }
  for (const change of arr(input.entities)) {
    const ref = resolve(change.ref || `@${change.key}`);
    requireKnown(ref);
    if (ref.startsWith("scene:")) fail("场景变化请使用场景资料分类。");
    const entity = await doc(pathFor(ref));
    const previousName = entity.name;
    if (change.name !== undefined) entity.name = text(change.name, "名称", 150);
    for (const [key, source] of Object.entries(definitions.entityFields)) {
      if (!own(change, key)) continue;
      if (key === "aliases") entity[source] = [...new Set([...arr(entity[source]), ...change[key]])];
      else if (["identity", "goals"].includes(key)) entity[source] = { ...obj(entity[source]), ...change[key] };
      else entity[source] = clone(change[key]);
    }
    if (previousName !== entity.name) entity.aliases = [...new Set([...arr(entity.aliases), previousName])];
    const hasNumericInput = change.tier !== undefined || change.ratings !== undefined || change.level !== undefined;
    if (ref.startsWith("character:")) completeCharacterAttributes(entity, change);
    else if (hasNumericInput) fail("人物评价只适用于人物。");
    if (ref.startsWith("character:") && !change.ref) {
      entity.containers = [];
      entity.equipment = Object.fromEntries(Object.entries(worldSchema?.equipmentSlots || {}).map(([slot, count]) => [slot, Array.from({ length: count }, () => ({ ref: null }))]));
    }
    if (own(change, "itemType") && !ref.startsWith("item:")) fail("物品种类只适用于物品。");
    applyItems(entity, "status", "status", change.states);
    applyItems(entity, "traits", "trait", change.traits);
    applyItems(entity, "gauges", "gauge", change.gauges);
    if (change.experiences) {
      entity.history = arr(entity.history).map(value => typeof value === "string" ? { event: value } : value);
      for (const value of change.experiences) {
        const event = text(value, "经历");
        if (!entity.history.some(value => value.event === event)) entity.history.push({ event });
      }
    }
    if (change.containers) {
      if (!ref.startsWith("character:")) fail("持有容器只适用于人物。");
      entity.containers = change.containers.map(value => ({ ref: resolve(value) }));
    }
    if (change.contents) {
      if (!ref.startsWith("container:")) fail("收纳内容只适用于容器。");
      entity.contents = change.contents.map(value => ({ ref: resolve(value.ref), count: value.quantity ?? 1 }));
    }
    if (change.wearable !== undefined) {
      if (!ref.startsWith("item:") || entity.type !== "equipment") fail("穿戴效果只适用于装备物品。");
      const { slot, ...effects } = change.wearable;
      entity.equipment = { slotType: text(slot, "适用槽位", 80), ...effects };
    }
    if (change.details) {
      entity.extensions = { ...obj(entity.extensions) };
      for (const [name, value] of Object.entries(change.details)) {
        if (value === null) delete entity.extensions[name];
        else entity.extensions[name] = { render: typeof value === "number" ? "number" : Array.isArray(value) ? "list" : "text", value };
      }
    }
    stage(pathFor(ref), entity);
  }

  for (const transfer of arr(input.transfers)) {
    const item = await requireRef(transfer.item, ["item"]);
    const from = await requireRef(transfer.from, ["container"]), to = await requireRef(transfer.to, ["container"]);
    if (from === to) fail("物品转移需要不同的来源和去向。");
    const source = await doc(pathFor(from)), target = await doc(pathFor(to));
    const position = arr(source.contents).findIndex(value => value.ref === item);
    const count = position < 0 ? 0 : source.contents[position].count ?? 1;
    if (count < transfer.quantity) fail("来源中的物品数量不足。");
    if (count === transfer.quantity) source.contents.splice(position, 1);
    else source.contents[position].count = count - transfer.quantity;
    target.contents = arr(target.contents);
    const found = target.contents.find(value => value.ref === item);
    if (found) found.count = (found.count ?? 1) + transfer.quantity;
    else target.contents.push({ ref: item, count: transfer.quantity });
    stage(pathFor(from), source); stage(pathFor(to), target);
  }
  for (const change of arr(input.scenes)) {
    const ref = resolve(change.ref || `@${change.key}`);
    if (!ref.startsWith("scene:")) fail("场景变化需要场景对象。");
    requireKnown(ref);
    const scene = await doc(pathFor(ref));
    const previousName = scene.name;
    if (change.name !== undefined) scene.name = text(change.name, "场景名称", 150);
    scene.aliases = [...new Set([...arr(scene.aliases), ...arr(change.aliases), ...(previousName !== scene.name ? [previousName] : [])])];
    if (change.location !== undefined) scene.location = await pointer(change.location, ["location"]);
    if (change.participants) scene.present = await Promise.all([...new Set(change.participants)].map(async value => ({ ref: await requireRef(value, ["character", "item", "container"]) })));
    if (change.status) scene.status = change.status;
    scene.extensions = { ...obj(scene.extensions) };
    if (change.situation !== undefined) scene.extensions["来客"] = { render: "text", value: change.situation };
    if (change.time !== undefined) scene.extensions["时间"] = { render: "text", value: change.time };
    scene.updatedTurn = session.turn; scene.updatedBy = "stage-manager";
    stage(pathFor(ref), scene);
    runtime.activeSceneRefs = arr(runtime.activeSceneRefs).filter(value => value.ref !== ref);
    if (scene.status === "active") runtime.activeSceneRefs.push({ ref, name: scene.name });
  }
  for (const change of arr(input.relationships)) {
    const kind = text(change.kind, "关系含义", 100);
    const from = await requireRef(change.from, ["character"]), to = await requireRef(change.to, ["character"]);
    if (from === to) fail("人物关系需要两个不同对象。");
    for (const [subject, other] of change.mutual ? [[from, to], [to, from]] : [[from, to]]) {
      const path = `save/relationships/character-${subject.slice(10)}.json`;
      const relation = await doc(path, false) || { subject, edges: [] };
      const edges = arr(relation.edges);
      const index = edges.findIndex(value => value.to === other && value.type === kind);
      if (change.end) {
        if (index < 0) fail("要结束的人物关系不存在。");
        edges.splice(index, 1);
      } else {
        const edge = { ...(index < 0 ? { since: session.turn } : edges[index]), to: other, type: kind,
          ...(change.description !== undefined ? { description: change.description } : {}) };
        if (index < 0) edges.push(edge); else edges[index] = edge;
      }
      stage(path, { ...relation, subject, edges, updatedTurn: session.turn, updatedBy: "stage-manager" });
    }
  }
  const world = obj(input.world);
  if (world.protagonist !== undefined) {
    const protagonist = await pointer(world.protagonist, ["character"]);
    if (session.turn !== 0 && protagonist.ref !== obj(runtime.protagonistRef).ref) fail("不能在普通维护中更换本局主角身份。");
    runtime.protagonistRef = protagonist;
  }
  if (world.time !== undefined) runtime.worldTime = world.time;
  if (world.weather !== undefined) runtime.weather = world.weather;
  if (world.location !== undefined) runtime.location = world.location === null ? null : await pointer(world.location, ["location"]);
  if (world.activeScenes) {
    runtime.activeSceneRefs = [];
    for (const value of [...new Set(world.activeScenes)]) {
      const entry = await pointer(value, ["scene"]);
      if ((await doc(pathFor(entry.ref))).status !== "active") fail("当前场景必须处于活跃状态。");
      runtime.activeSceneRefs.push(entry);
    }
  }
  if (world.details) {
    runtime.extensions = { ...obj(runtime.extensions) };
    for (const [name, value] of Object.entries(world.details)) {
      if (value === null) delete runtime.extensions[name];
      else runtime.extensions[name] = { render: typeof value === "number" ? "number" : Array.isArray(value) ? "list" : "text", value };
    }
  }
  // Keep denormalized display names attached to the authoritative refs.
  if (obj(runtime.location).ref) runtime.location = await pointer(runtime.location.ref, ["location"]);
  if (obj(runtime.protagonistRef).ref) runtime.protagonistRef = await pointer(runtime.protagonistRef.ref, ["character"]);
  runtime.activeSceneRefs = await Promise.all(arr(runtime.activeSceneRefs).map(entry => pointer(entry.ref, ["scene"])));
  if (session.turn === 0) {
    if (!obj(runtime.protagonistRef).ref || !obj(runtime.location).ref || !runtime.activeSceneRefs.length) fail("首次建档必须明确主角、当前地点与活跃场景。");
    let present = false;
    for (const entry of runtime.activeSceneRefs) {
      const scene = await doc(pathFor(entry.ref));
      if (scene.status !== "active") fail("起始场景必须活跃。");
      if (arr(scene.present).some(value => value.ref === runtime.protagonistRef.ref) && obj(scene.location).ref === runtime.location.ref) present = true;
    }
    if (!present) fail("首次建档中主角应在当前地点的活跃场景内。");
  }
  runtime.turn = session.turn + 1;
  runtime.updatedAtTurn = session.turn;
  runtime.updatedBy = "stage-manager";
  stage(RUNTIME, runtime);

  // Delegate numerical projection to the existing deterministic equipment core.
  const equipmentSdk = { ...tsian, workspace: {
    read: async request => {
      if (staged.has(request.path)) return { path: request.path, content: JSON.stringify(staged.get(request.path)) };
      const value = await tracked(request.path, false);
      return value === null ? null : { path: request.path, content: JSON.stringify(value) };
    },
    list: async request => {
      const entries = [], seen = new Set();
      let offset = 0;
      while (true) {
        const page = await tsian.workspace.list({ ...request, offset, limit: 200 });
        entries.push(...arr(page.entries));
        if (!page.truncated) break;
        if (!arr(page.entries).length) fail("无法完整检查物品归属。");
        offset += page.entries.length;
      }
      entries.forEach(entry => seen.add(entry.path));
      for (const path of staged.keys()) if (path.startsWith(request.path + "/") && !path.slice(request.path.length + 1).includes("/") && !seen.has(path)) {
        entries.push({ path, name: path.slice(request.path.length + 1), kind: "file" });
      }
      return { entries, truncated: false };
    },
    write: async request => { stage(request.path, JSON.parse(request.content)); return { path: request.path }; },
  } };
  for (const ref of attributeRefreshRefs) {
    try { await equipmentManagementCore("refresh", { characterRef: ref, attributeChanges: {} }, equipmentSdk, signal, { actionMode: false }); }
    catch (error) { fail(error.message || "人物属性计算失败。"); }
  }
  for (const change of arr(input.equipment)) {
    const ref = await requireRef(change.character, ["character"]);
    const character = await doc(pathFor(ref));
    const current = obj(arr(obj(character.equipment)[change.slot])[change.index]);
    const args = { characterRef: ref, ...(change.operation === "refresh" ? { attributeChanges: change.attributeChanges || {} } : {
      slotType: change.slot, slotIndex: change.index, expectedCurrentRef: current.ref ?? null,
      ...(change.operation === "equip" ? { itemRef: await requireRef(change.item, ["item"]) } : {}),
    }) };
    try { await equipmentManagementCore(change.operation, args, equipmentSdk, signal, { actionMode: false }); }
    catch (_error) { fail(`装备或属性变化无法应用，请检查 ${ref} 的持有物、槽位与已有属性。`); }
  }
  // Inventory movement / changed item effects invalidate derived equipment values.
  // The Agent does not need to discover owners or request physical repairs.
  if (arr(input.transfers).length || arr(input.entities).some(change => change.containers || change.contents || change.wearable || change.itemType)) {
    const listing = await equipmentSdk.workspace.list({ scope: "effective", path: "save/entities/character", recursive: false });
    for (const entry of listing.entries) {
      if (!entry.path.endsWith(".json")) continue;
      const character = await doc(entry.path);
      if (!Object.keys(obj(character.equipment)).length) continue;
      try { await equipmentManagementCore("refresh", { characterRef: character.id, attributeChanges: {} }, equipmentSdk, signal, { actionMode: false }); }
      catch (_error) { fail(`持有物变化无法应用，请检查 ${character.id} 的容器归属与穿戴效果。`); }
    }
  }
  // Validate the resulting entity reference graph, including same-batch creations.
  async function checkContainer(ref, ancestors) {
    if (ancestors.has(ref)) fail("容器不能循环包含自身。");
    const next = new Set(ancestors); next.add(ref);
    const container = await doc(pathFor(ref));
    const seen = new Set();
    for (const entry of arr(container.contents)) {
      if (seen.has(entry.ref)) fail("同一容器内的同种物品请合并数量。");
      seen.add(entry.ref);
      const child = await requireRef(entry.ref, ["item", "container"]);
      if (!Number.isSafeInteger(entry.count ?? 1) || (entry.count ?? 1) <= 0) fail("物品数量必须为正整数。");
      if (child.startsWith("container:")) await checkContainer(child, next);
    }
  }
  for (const [path, entity] of [...staged.entries()]) {
    if (!path.startsWith("save/entities/")) continue;
    if (entity.id.startsWith("character:")) {
      const roots = arr(entity.containers).map(entry => entry.ref);
      if (new Set(roots).size !== roots.length) fail("人物不能重复持有同一容器。");
      for (const ref of roots) await checkContainer(await requireRef(ref, ["container"]), new Set());
    }
    if (entity.id.startsWith("container:")) await checkContainer(entity.id, new Set());
    for (const gauge of arr(entity.gauges)) {
      if (gauge.min !== undefined && gauge.max !== undefined && gauge.min > gauge.max) fail("量表下限不能高于上限。");
    }
  }
  const singleLine = value => text(value, "记录内容").replace(/[\r\n]+/g, " ").replace(/;/g, "；");
  if (arr(input.records).length) {
    const before = session.baselines[RECORDS] || "# 回合记忆记录\n";
    let number = Math.max(0, ...[...before.matchAll(/^- \[(\d+)\]/gm)].map(match => Number(match[1])));
    const records = [...new Set(input.records.map(record => `${record.kind} 关键词: ${singleLine(record.keywords)}; 摘要: ${singleLine(record.summary)}`))];
    const lines = records.map(record => `- [${++number}] ${record}`);
    stage(RECORDS, before.trimEnd() + "\n" + lines.join("\n") + "\n");
  }
  if (arr(input.seeds).length) {
    const lines = (session.baselines[SEEDS] || "# 伏笔追踪\n").trimEnd().split(/\r?\n/);
    for (const seed of input.seeds) {
      const name = singleLine(seed.name).replace(/\[/g, "［").replace(/\]/g, "］");
      const index = lines.findIndex(line => line.startsWith(`- [${name}] 状态: `));
      const line = `- [${name}] 状态: ${seed.status}; 关联回合: ${session.turn}`;
      if (index < 0) lines.push(line); else lines[index] = line;
    }
    stage(SEEDS, lines.join("\n") + "\n");
  }
  const recall = input.recall;
  const summary = text(recall.summary, "回合摘要", 240);
  if (recall.events.some(value => !definitions.eventTypes.includes(value))) fail("回合事件类别无效。");
  const involved = [];
  for (const value of recall.entities) involved.push(await requireRef(value, ["character", "item", "container", "location"]));
  history.meta = { ...obj(history.meta), recall: {
    schema: "沉浸阅读器.turn-recall.v1", "摘要": summary,
    "涉及实体": [...new Set(involved)], "事件类型": [...new Set(recall.events)], "标签": [...new Set(recall.tags)],
    "重要节点": recall.important === true, "时间": String(runtime.worldTime || "").slice(0, 80),
  }, maintenance: { token: session.token, source: session.source } };
  // Recheck all documents read by the planner/validators before the first write.
  for (const [path, before] of Object.entries(session.baselines)) if (await raw(path) !== before) fail("相关资料已经变化，请重新发起整理。");
  stage(turnPath, history); // receipt is staged with, never independently of, the business state
  for (const [path, value] of staged) {
    signal.throwIfAborted();
    const content = typeof value === "string" ? value : JSON.stringify(value, null, 2) + "\n";
    await tsian.workspace.write({ scope: "save-runtime", path, content, mediaType: typeof value === "string" ? "text/markdown" : "application/json" });
  }
  return { status: "applied", summary, created: Object.fromEntries(aliases), updatedObjects: staged.size - 1 };
}
