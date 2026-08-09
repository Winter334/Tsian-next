async function commitOpening(input, tsian, signal) {
  try {
    signal.throwIfAborted();
    if (!isRecord(input)) fail('OPENING_COMMIT_INVALID', 'Commit input must be an object.');

    let serializedInput;
    try { serializedInput = JSON.stringify(input); } catch (error) { fail('OPENING_COMMIT_INVALID', 'Commit input must be JSON serializable.'); }
    if (serializedInput.length > 256000) fail('OPENING_COMMIT_TOO_LARGE', 'Commit input exceeds the 256000 character limit.', { length: serializedInput.length });

    function assertAllowedKeys(value, allowed, code, label) {
      const allowedSet = new Set(allowed);
      const unknown = Object.keys(value).filter((key) => !allowedSet.has(key));
      if (unknown.length) fail(code, label + ' contains unsupported fields.', { fields: unknown });
    }

    function strictInt(value, code, label, min, max) {
      if (!Number.isSafeInteger(value) || value < min || value > max) fail(code, label + ' must be a safe integer in range.', { value, min, max });
      return value;
    }

    function optionalText(value, code, label, maxLength, allowEmpty) {
      if (value === undefined) return undefined;
      if (typeof value !== 'string') fail(code, label + ' must be a string.');
      const text = value.trim();
      if (!allowEmpty && !text) fail(code, label + ' must not be empty.');
      if (text.length > maxLength) fail(code, label + ' is too long.', { maxLength, length: text.length });
      return text;
    }

    function normalizeStringList(value, code, label, maxItems, maxLength) {
      if (value === undefined) return undefined;
      if (!Array.isArray(value) || value.length > maxItems) fail(code, label + ' must be a bounded string array.', { maxItems });
      const seen = new Set();
      const result = [];
      for (let index = 0; index < value.length; index += 1) {
        const item = normalizeString(value[index], code, label + '[' + index + ']', maxLength);
        if (seen.has(item)) fail(code, label + ' must not contain duplicates.', { item });
        seen.add(item);
        result.push(item);
      }
      return result;
    }

    function normalizeExtensions(value, owner) {
      if (value === undefined) return undefined;
      if (!isRecord(value)) fail('OPENING_EXTENSIONS_INVALID', 'extensions must be an object.', { owner });
      const encoded = JSON.stringify(value);
      if (encoded.length > 16000) fail('OPENING_EXTENSIONS_TOO_LARGE', 'extensions are too large.', { owner, length: encoded.length });
      function visit(node, depth) {
        if (depth > 6) fail('OPENING_EXTENSIONS_INVALID', 'extensions nesting is too deep.', { owner });
        if (node === null || typeof node === 'boolean' || typeof node === 'string') {
          if (typeof node === 'string' && node.length > 1000) fail('OPENING_EXTENSIONS_INVALID', 'extension strings are too long.', { owner });
          return;
        }
        if (typeof node === 'number') {
          if (!Number.isSafeInteger(node)) fail('OPENING_EXTENSIONS_INVALID', 'extension numbers must be safe integers.', { owner, value: node });
          return;
        }
        if (Array.isArray(node)) {
          if (node.length > 64) fail('OPENING_EXTENSIONS_INVALID', 'extension arrays are too large.', { owner });
          node.forEach((item) => visit(item, depth + 1));
          return;
        }
        if (!isRecord(node)) fail('OPENING_EXTENSIONS_INVALID', 'extensions must contain JSON values only.', { owner });
        for (const [key, child] of Object.entries(node)) {
          if (key.length > 120) fail('OPENING_EXTENSIONS_INVALID', 'extension keys are too long.', { owner, key });
          if (/refs?$/i.test(key)) fail('OPENING_ENTITY_EXTENSION_REF_FORBIDDEN', 'Opening extensions must not contain ref-bearing fields.', { owner, key });
          visit(child, depth + 1);
        }
      }
      visit(value, 0);
      return value;
    }

    function normalizeAttributes(value, entityId) {
      if (value === undefined) return undefined;
      if (!isRecord(value) || Object.keys(value).length !== 6) fail('OPENING_ENTITY_ATTRIBUTES_INVALID', 'attributes must contain exactly six dimensions.', { entityId });
      const result = {};
      for (const [rawKey, rawValue] of Object.entries(value)) {
        const key = normalizeString(rawKey, 'OPENING_ENTITY_ATTRIBUTE_KEY_INVALID', 'attribute key', 80);
        result[key] = strictInt(rawValue, 'OPENING_ENTITY_ATTRIBUTE_VALUE_INVALID', 'attribute value', -1000000, 1000000);
      }
      return result;
    }

    function normalizeIdentity(value, entityId) {
      if (value === undefined) return undefined;
      if (!isRecord(value)) fail('OPENING_ENTITY_IDENTITY_INVALID', 'identity must be an object.', { entityId });
      assertAllowedKeys(value, ['age', 'gender', 'role', 'affiliation', 'realm'], 'OPENING_ENTITY_IDENTITY_INVALID', 'identity');
      const result = {};
      if (value.age !== undefined) {
        if (typeof value.age === 'number') result.age = strictInt(value.age, 'OPENING_ENTITY_IDENTITY_INVALID', 'identity.age', 0, 1000000);
        else result.age = normalizeString(value.age, 'OPENING_ENTITY_IDENTITY_INVALID', 'identity.age', 80);
      }
      for (const key of ['gender', 'role', 'affiliation', 'realm']) {
        if (value[key] !== undefined) result[key] = normalizeString(value[key], 'OPENING_ENTITY_IDENTITY_INVALID', 'identity.' + key, 160);
      }
      return result;
    }

    function normalizeGauges(value, entityId) {
      if (value === undefined) return undefined;
      if (!Array.isArray(value) || value.length > 32) fail('OPENING_ENTITY_GAUGES_INVALID', 'gauges must be a bounded array.', { entityId });
      const seen = new Set();
      return value.map(function (raw, index) {
        if (!isRecord(raw)) fail('OPENING_ENTITY_GAUGE_INVALID', 'Each gauge must be an object.', { entityId, index });
        assertAllowedKeys(raw, ['id', 'name', 'value', 'max', 'min', 'unit', 'tone'], 'OPENING_ENTITY_GAUGE_INVALID', 'gauge');
        const id = normalizeString(raw.id, 'OPENING_ENTITY_GAUGE_ID_REQUIRED', 'gauge id', 120);
        if (seen.has(id)) fail('OPENING_ENTITY_GAUGE_ID_DUPLICATE', 'Gauge ids must be unique.', { entityId, id });
        seen.add(id);
        const gauge = {
          id,
          name: normalizeString(raw.name, 'OPENING_ENTITY_GAUGE_NAME_REQUIRED', 'gauge name', 120),
          value: strictInt(raw.value, 'OPENING_ENTITY_GAUGE_VALUE_INVALID', 'gauge value', -1000000000, 1000000000),
        };
        if (raw.min !== undefined) gauge.min = strictInt(raw.min, 'OPENING_ENTITY_GAUGE_VALUE_INVALID', 'gauge min', -1000000000, 1000000000);
        if (raw.max !== undefined) gauge.max = strictInt(raw.max, 'OPENING_ENTITY_GAUGE_VALUE_INVALID', 'gauge max', -1000000000, 1000000000);
        if (gauge.min !== undefined && gauge.max !== undefined && gauge.min > gauge.max) fail('OPENING_ENTITY_GAUGE_VALUE_INVALID', 'gauge min must not exceed max.', { entityId, id });
        if (raw.unit !== undefined) gauge.unit = normalizeString(raw.unit, 'OPENING_ENTITY_GAUGE_INVALID', 'gauge unit', 40);
        if (gauge.min !== undefined && gauge.value < gauge.min) fail('OPENING_ENTITY_GAUGE_VALUE_INVALID', 'gauge value must not be below min.', { entityId, id });
        if (gauge.max !== undefined && gauge.value > gauge.max) fail('OPENING_ENTITY_GAUGE_VALUE_INVALID', 'gauge value must not exceed max.', { entityId, id });
        if (raw.tone !== undefined) {
          const tone = normalizeString(raw.tone, 'OPENING_ENTITY_GAUGE_INVALID', 'gauge tone', 40);
          if (!['neutral', 'accent', 'success', 'warning', 'danger', 'muted'].includes(tone)) fail('OPENING_ENTITY_GAUGE_INVALID', 'gauge tone is invalid.', { entityId, id, tone });
          gauge.tone = tone;
        }
        return gauge;
      });
    }

    function normalizeStatuses(value, entityId) {
      if (value === undefined) return undefined;
      if (!Array.isArray(value) || value.length > 32) fail('OPENING_ENTITY_STATUS_INVALID', 'status must be a bounded array.', { entityId });
      const seen = new Set();
      return value.map(function (raw, index) {
        if (!isRecord(raw)) fail('OPENING_ENTITY_STATUS_INVALID', 'Each status must be an object.', { entityId, index });
        assertAllowedKeys(raw, ['id', 'name', 'description', 'polarity'], 'OPENING_ENTITY_STATUS_INVALID', 'status');
        const id = normalizeString(raw.id, 'OPENING_ENTITY_STATUS_ID_REQUIRED', 'status id', 120);
        if (seen.has(id)) fail('OPENING_ENTITY_STATUS_ID_DUPLICATE', 'Status ids must be unique.', { entityId, id });
        seen.add(id);
        const status = { id };
        if (raw.name !== undefined) status.name = normalizeString(raw.name, 'OPENING_ENTITY_STATUS_INVALID', 'status name', 120);
        if (raw.description !== undefined) status.description = normalizeString(raw.description, 'OPENING_ENTITY_STATUS_INVALID', 'status description', 1000);
        if (raw.polarity !== undefined) {
          if (!['positive', 'negative', 'neutral'].includes(raw.polarity)) fail('OPENING_ENTITY_STATUS_INVALID', 'status polarity is invalid.', { entityId, id, polarity: raw.polarity });
          status.polarity = raw.polarity;
        }
        return status;
      });
    }

    function normalizeTraits(value, entityId) {
      if (value === undefined) return undefined;
      if (!Array.isArray(value) || value.length > 32) fail('OPENING_ENTITY_TRAITS_INVALID', 'traits must be a bounded array.', { entityId });
      const seen = new Set();
      return value.map(function (raw, index) {
        if (!isRecord(raw)) fail('OPENING_ENTITY_TRAIT_INVALID', 'Each trait must be an object.', { entityId, index });
        assertAllowedKeys(raw, ['id', 'name', 'description', 'effects'], 'OPENING_ENTITY_TRAIT_INVALID', 'trait');
        const id = normalizeString(raw.id, 'OPENING_ENTITY_TRAIT_ID_REQUIRED', 'trait id', 120);
        if (!id.startsWith('trait:') || seen.has(id)) fail('OPENING_ENTITY_TRAIT_ID_INVALID', 'Trait ids must be unique trait:<localId> values.', { entityId, id });
        seen.add(id);
        const trait = { id, name: normalizeString(raw.name, 'OPENING_ENTITY_TRAIT_NAME_REQUIRED', 'trait name', 120) };
        if (raw.description !== undefined) trait.description = normalizeString(raw.description, 'OPENING_ENTITY_TRAIT_INVALID', 'trait description', 1000);
        const effects = normalizeStringList(raw.effects, 'OPENING_ENTITY_TRAIT_INVALID', 'trait effects', 16, 300);
        if (effects !== undefined) trait.effects = effects;
        return trait;
      });
    }

    function normalizeGoals(value, entityId) {
      if (value === undefined) return undefined;
      if (!isRecord(value)) fail('OPENING_ENTITY_GOALS_INVALID', 'goals must be an object.', { entityId });
      assertAllowedKeys(value, ['current', 'shortTerm', 'longTerm'], 'OPENING_ENTITY_GOALS_INVALID', 'goals');
      const goals = {};
      for (const key of ['current', 'shortTerm', 'longTerm']) {
        if (value[key] !== undefined) goals[key] = normalizeString(value[key], 'OPENING_ENTITY_GOALS_INVALID', 'goals.' + key, 1000);
      }
      return goals;
    }

    function normalizeHistory(value, entityId) {
      if (value === undefined) return undefined;
      if (!Array.isArray(value) || value.length > 32) fail('OPENING_ENTITY_HISTORY_INVALID', 'history must be a bounded array.', { entityId });
      return value.map(function (raw, index) {
        if (!isRecord(raw)) fail('OPENING_ENTITY_HISTORY_INVALID', 'Each history entry must be an object.', { entityId, index });
        assertAllowedKeys(raw, ['event'], 'OPENING_ENTITY_HISTORY_INVALID', 'history entry');
        return { event: normalizeString(raw.event, 'OPENING_ENTITY_HISTORY_INVALID', 'history event', 1000) };
      });
    }

    function normalizeOpeningEntity(raw, index) {
      if (!isRecord(raw)) fail('OPENING_ENTITY_INVALID', 'Each entity must be an object.', { index });
      const parsed = normalizeEntityId(raw.id, 'Entity id');
      if (parsed.type !== 'character' && parsed.type !== 'location') fail('OPENING_ENTITY_TYPE_INVALID', 'Opening entities are limited to character and location.', { id: parsed.id, type: parsed.type });
      const commonKeys = ['id', 'name', 'brief', 'tags', 'aliases', 'visibility', 'lifecycle', 'status', 'extensions'];
      const characterKeys = commonKeys.concat(['gender', 'identity', 'appearance', 'attributes', 'gauges', 'traits', 'goals', 'background', 'history']);
      assertAllowedKeys(raw, parsed.type === 'character' ? characterKeys : commonKeys, 'OPENING_ENTITY_FIELD_UNSUPPORTED', 'Entity ' + parsed.id);
      const entity = {
        id: parsed.id,
        name: normalizeString(raw.name, 'OPENING_ENTITY_NAME_REQUIRED', 'Entity name', 120),
        brief: normalizeString(raw.brief, 'OPENING_ENTITY_BRIEF_REQUIRED', 'Entity brief', 1000),
      };
      const tags = normalizeStringList(raw.tags, 'OPENING_ENTITY_TAGS_INVALID', 'tags', 32, 120);
      const aliases = normalizeStringList(raw.aliases, 'OPENING_ENTITY_ALIASES_INVALID', 'aliases', 32, 120);
      const status = normalizeStatuses(raw.status, parsed.id);
      const extensions = normalizeExtensions(raw.extensions, parsed.id);
      if (tags !== undefined) entity.tags = tags;
      if (aliases !== undefined) entity.aliases = aliases;
      if (raw.visibility !== undefined) {
        if (!['player-known', 'hidden', 'future-spoiler'].includes(raw.visibility)) fail('OPENING_ENTITY_VISIBILITY_INVALID', 'Entity visibility is invalid.', { id: parsed.id });
        entity.visibility = raw.visibility;
      }
      if (raw.lifecycle !== undefined) {
        if (!['candidate', 'active', 'background', 'retired'].includes(raw.lifecycle)) fail('OPENING_ENTITY_LIFECYCLE_INVALID', 'Entity lifecycle is invalid.', { id: parsed.id });
        entity.lifecycle = raw.lifecycle;
      }
      if (status !== undefined) entity.status = status;
      if (extensions !== undefined) entity.extensions = extensions;
      if (parsed.type === 'character') {
        const identity = normalizeIdentity(raw.identity, parsed.id);
        const attributes = normalizeAttributes(raw.attributes, parsed.id);
        const gauges = normalizeGauges(raw.gauges, parsed.id);
        const traits = normalizeTraits(raw.traits, parsed.id);
        const goals = normalizeGoals(raw.goals, parsed.id);
        const history = normalizeHistory(raw.history, parsed.id);
        if (raw.gender !== undefined) entity.gender = normalizeString(raw.gender, 'OPENING_ENTITY_GENDER_INVALID', 'gender', 80);
        if (identity !== undefined) entity.identity = identity;
        if (raw.appearance !== undefined) entity.appearance = normalizeString(raw.appearance, 'OPENING_ENTITY_APPEARANCE_INVALID', 'appearance', 2000);
        if (attributes !== undefined) entity.attributes = attributes;
        if (gauges !== undefined) entity.gauges = gauges;
        if (traits !== undefined) entity.traits = traits;
        if (goals !== undefined) entity.goals = goals;
        if (raw.background !== undefined) entity.background = normalizeString(raw.background, 'OPENING_ENTITY_BACKGROUND_INVALID', 'background', 2000);
        if (history !== undefined) entity.history = history;
      }
      return { id: parsed.id, type: parsed.type, localId: parsed.localId, path: 'save/entities/' + parsed.type + '/' + parsed.localId + '.json', entity };
    }

    function normalizeNamedRef(raw, label, entityById, requiredType) {
      if (!isRecord(raw)) fail('OPENING_REF_INVALID', label + ' must be { ref, name }.');
      assertAllowedKeys(raw, ['ref', 'name'], 'OPENING_REF_INVALID', label);
      const parsed = normalizeEntityId(raw.ref, label + ' ref');
      const target = entityById.get(parsed.id);
      if (!target) fail('OPENING_REF_UNKNOWN', label + ' must point to an entity in this commit.', { ref: parsed.id });
      if (requiredType && parsed.type !== requiredType) fail('OPENING_REF_TYPE_INVALID', label + ' has the wrong entity type.', { ref: parsed.id, expected: requiredType });
      const name = normalizeString(raw.name, 'OPENING_REF_NAME_REQUIRED', label + ' name', 120);
      if (name !== target.entity.name) fail('OPENING_REF_NAME_MISMATCH', label + ' ref/name must match the target entity.', { ref: parsed.id, expected: target.entity.name, actual: name });
      return { ref: parsed.id, name };
    }

    function normalizeOpeningScene(raw, index, entityById) {
      if (!isRecord(raw)) fail('OPENING_SCENE_INVALID', 'Each scene must be an object.', { index });
      assertAllowedKeys(raw, ['id', 'name', 'location', 'present', 'status', 'extensions'], 'OPENING_SCENE_FIELD_UNSUPPORTED', 'Scene');
      const parsed = normalizeEntityId(raw.id, 'Scene id');
      if (parsed.type !== 'scene') fail('OPENING_SCENE_TYPE_INVALID', 'Scene id must use scene:<localId>.', { id: parsed.id });
      if (!Array.isArray(raw.present) || raw.present.length === 0 || raw.present.length > 64) fail('OPENING_SCENE_PRESENT_REQUIRED', 'Scene present must be a bounded non-empty array.', { id: parsed.id });
      const seenPresent = new Set();
      const present = raw.present.map(function (item, presentIndex) {
        if (!isRecord(item)) fail('OPENING_SCENE_PRESENT_INVALID', 'Scene present entries must be { ref }.', { id: parsed.id, index: presentIndex });
        assertAllowedKeys(item, ['ref'], 'OPENING_SCENE_PRESENT_INVALID', 'Scene present entry');
        const ref = normalizeEntityId(item.ref, 'Scene present ref').id;
        if (!entityById.has(ref)) fail('OPENING_REF_UNKNOWN', 'Scene present ref must point to this commit.', { scene: parsed.id, ref });
        if (seenPresent.has(ref)) fail('OPENING_SCENE_PRESENT_DUPLICATE', 'Scene present refs must be unique.', { scene: parsed.id, ref });
        seenPresent.add(ref);
        return { ref };
      });
      const scene = {
        id: parsed.id,
        name: normalizeString(raw.name, 'OPENING_SCENE_NAME_REQUIRED', 'Scene name', 120),
        location: normalizeNamedRef(raw.location, 'Scene location', entityById, 'location'),
        present,
        status: raw.status === undefined ? 'active' : normalizeString(raw.status, 'OPENING_SCENE_STATUS_INVALID', 'Scene status', 40),
        updatedTurn: 0,
        updatedBy: 'world-architect',
      };
      if (scene.status !== 'active') fail('OPENING_SCENE_STATUS_INVALID', 'Opening scene status must be active.', { id: parsed.id, status: scene.status });
      const extensions = normalizeExtensions(raw.extensions, parsed.id);
      if (extensions !== undefined) scene.extensions = extensions;
      return { id: parsed.id, localId: parsed.localId, path: 'save/scenes/' + parsed.localId + '.json', scene };
    }

    function normalizeOpeningRelationships(value, entityById) {
      if (!Array.isArray(value) || value.length > 64) fail('OPENING_RELATIONSHIPS_INVALID', 'relationships must be a bounded array.');
      const seenSubjects = new Set();
      return value.map(function (raw, index) {
        if (!isRecord(raw)) fail('OPENING_RELATIONSHIP_INVALID', 'Each relationship must be an object.', { index });
        assertAllowedKeys(raw, ['subject', 'edges'], 'OPENING_RELATIONSHIP_INVALID', 'Relationship');
        const subject = normalizeEntityId(raw.subject, 'Relationship subject').id;
        const subjectEntity = entityById.get(subject);
        if (!subject.startsWith('character:') || !subjectEntity) fail('OPENING_RELATIONSHIP_SUBJECT_UNKNOWN', 'Relationship subject must be a character in this commit.', { subject });
        const scope = 'character-' + subject.slice('character:'.length);
        if (seenSubjects.has(scope)) fail('OPENING_RELATIONSHIP_DUPLICATE_SUBJECT', 'Duplicate relationship subject.', { subject });
        seenSubjects.add(scope);
        if (!Array.isArray(raw.edges) || raw.edges.length === 0 || raw.edges.length > 64) fail('OPENING_RELATIONSHIP_EDGES_REQUIRED', 'Relationship edges must be a bounded non-empty array.', { subject });
        const seenTargets = new Set();
        const edges = raw.edges.map(function (edge, edgeIndex) {
          if (!isRecord(edge)) fail('OPENING_RELATIONSHIP_EDGE_INVALID', 'Each relationship edge must be an object.', { subject, edgeIndex });
          assertAllowedKeys(edge, ['to', 'type', 'note'], 'OPENING_RELATIONSHIP_EDGE_INVALID', 'Relationship edge');
          const to = normalizeEntityId(edge.to, 'Relationship target').id;
          if (!to.startsWith('character:') || !entityById.has(to)) fail('OPENING_RELATIONSHIP_TO_UNKNOWN', 'Relationship target must be a character in this commit.', { subject, to });
          if (seenTargets.has(to)) fail('OPENING_RELATIONSHIP_TO_DUPLICATE', 'Relationship targets must be unique per subject.', { subject, to });
          seenTargets.add(to);
          const normalized = { to, type: normalizeString(edge.type, 'OPENING_RELATIONSHIP_TYPE_REQUIRED', 'Relationship type', 60), since: 0 };
          if (edge.note !== undefined) normalized.note = normalizeString(edge.note, 'OPENING_RELATIONSHIP_NOTE_INVALID', 'Relationship note', 1000);
          return normalized;
        });
        return { subject, scope, path: 'save/relationships/' + scope + '.json', file: { subject, edges, updatedTurn: 0, updatedBy: 'world-architect' } };
      });
    }

    function canonicalize(value) {
      if (Array.isArray(value)) return value.map(canonicalize);
      if (!isRecord(value)) return value;
      const result = {};
      for (const key of Object.keys(value).sort()) result[key] = canonicalize(value[key]);
      return result;
    }

    async function sha256Hex(value) {
      if (!globalThis.crypto || !globalThis.crypto.subtle) fail('OPENING_HASH_UNAVAILABLE', 'SHA-256 is unavailable in the action runtime.');
      const bytes = new TextEncoder().encode(JSON.stringify(canonicalize(value)));
      const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
      return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
    }

    function fnvHash(inputText) {
      let hash = 0x811c9dc5;
      for (let index = 0; index < inputText.length; index += 1) {
        hash ^= inputText.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
      }
      return (hash >>> 0).toString(16).padStart(8, '0');
    }

    async function readOptionalJson(path) {
      const file = await tsian.workspace.read({ scope: 'effective', path });
      if (!file || typeof file.content !== 'string') return null;
      return parseJson(file.content, path);
    }

    async function readOptionalFile(path) {
      return tsian.workspace.read({ scope: 'effective', path });
    }

    async function listMatches(pattern) {
      const result = await tsian.workspace.glob({ scope: 'effective', pattern, limit: 10000 });
      if (result && result.truncated) fail('OPENING_SAVE_NOT_CLEAN', 'Workspace match limit was exceeded.', { pattern });
      return Array.isArray(result && result.matches) ? result.matches : [];
    }

    async function listUnexpectedDirectoryFiles(root) {
      const pending = [root];
      const visited = new Set();
      const unexpected = [];
      while (pending.length) {
        signal.throwIfAborted();
        const path = pending.shift();
        if (visited.has(path)) continue;
        visited.add(path);
        if (visited.size > 512) fail('OPENING_SAVE_NOT_CLEAN', 'Formal model directory is too large to verify safely.', { root });
        const listing = await tsian.workspace.list({ scope: 'effective', path });
        if (!isRecord(listing) || !Array.isArray(listing.entries)) fail('OPENING_SAVE_NOT_CLEAN', 'Formal model directory could not be verified.', { path });
        for (const entry of listing.entries) {
          if (!isRecord(entry) || typeof entry.path !== 'string' || typeof entry.name !== 'string') {
            fail('OPENING_SAVE_NOT_CLEAN', 'Formal model directory contains an invalid entry.', { path });
          }
          if (entry.kind === 'directory') pending.push(entry.path);
          else if (entry.kind !== 'file' || (entry.name !== 'README.md' && entry.name !== '.keep')) unexpected.push(entry.path);
          if (unexpected.length > 128) fail('OPENING_SAVE_NOT_CLEAN', 'Formal model directory contains too many existing files.', { root, count: unexpected.length });
        }
      }
      return unexpected;
    }

    function normalizeAgentId(value) {
      const id = normalizeString(value, 'OPENING_PLAYER_TURN_AGENT_REQUIRED', 'playerTurn agent id', 120);
      if (id === '.' || id === '..' || /[\\/\x00-\x1f\x7f]/.test(id)) fail('OPENING_PLAYER_TURN_AGENT_INVALID', 'playerTurn agent id must be a safe path segment.', { id });
      return id;
    }

    function isPendingRuntime(value) {
      return isRecord(value)
        && Object.keys(value).sort().join('|') === ['activeSceneRefs', 'extensions', 'location', 'plotOrder', 'protagonistRef', 'turn', 'updatedAtTurn', 'updatedBy', 'weather', 'worldTime'].sort().join('|')
        && value.turn === 0 && value.worldTime === '' && value.plotOrder === 1 && value.location === null && value.weather === ''
        && Array.isArray(value.activeSceneRefs) && value.activeSceneRefs.length === 0 && value.protagonistRef === null
        && isRecord(value.extensions) && Object.keys(value.extensions).length === 0 && value.updatedAtTurn === 0 && value.updatedBy === null;
    }

    function isPendingFrontier(value) {
      if (!isRecord(value) || Object.keys(value).sort().join('|') !== ['extractedThrough', 'notes', 'sourceWindow', 'timeline'].sort().join('|')) return false;
      if (!isRecord(value.sourceWindow) || Object.keys(value.sourceWindow).sort().join('|') !== ['end', 'start'].sort().join('|')) return false;
      if (value.sourceWindow.start !== null || value.sourceWindow.end !== null || value.extractedThrough !== null || typeof value.notes !== 'string') return false;
      if (!Array.isArray(value.timeline) || value.timeline.length !== 1 || !isRecord(value.timeline[0])) return false;
      const anchor = value.timeline[0];
      return Object.keys(anchor).sort().join('|') === ['chapter', 'kind', 'label', 'order', 'time'].sort().join('|')
        && anchor.kind === 'source' && anchor.order === 1 && anchor.chapter === 1 && anchor.time === '元年' && anchor.label === '开局';
    }

    function isPendingUnderstanding(value) {
      return isRecord(value) && Object.keys(value).sort().join('|') === ['candidateCharacters', 'status', 'title'].sort().join('|')
        && value.status === 'pending' && value.title === null
        && Array.isArray(value.candidateCharacters) && value.candidateCharacters.length === 0;
    }

    function isPendingSetup(value) {
      return isRecord(value) && Object.keys(value).sort().join('|') === ['status', 'summary'].sort().join('|')
        && value.status === 'pending' && value.summary === null;
    }

    assertAllowedKeys(input, ['session', 'entities', 'scenes', 'relationships', 'runtime', 'frontier', 'summary', 'openingReply'], 'OPENING_COMMIT_INVALID', 'Commit input');
    if (!isRecord(input.session)) fail('OPENING_SESSION_MISMATCH', 'session must be an object.');
    assertAllowedKeys(input.session, ['sessionId', 'sourceHash', 'branch', 'revision', 'attemptId'], 'OPENING_SESSION_MISMATCH', 'session');
    const session = {
      sessionId: normalizeString(input.session.sessionId, 'OPENING_SESSION_MISMATCH', 'sessionId', 80),
      sourceHash: normalizeString(input.session.sourceHash, 'OPENING_SESSION_MISMATCH', 'sourceHash', 32),
      branch: input.session.branch,
      revision: strictInt(input.session.revision, 'OPENING_SESSION_MISMATCH', 'revision', 1, 999999),
      attemptId: normalizeString(input.session.attemptId, 'OPENING_SESSION_MISMATCH', 'attemptId', 100),
    };
    if (!/^opening-[a-f0-9]{8}$/.test(session.sessionId) || !/^[a-f0-9]{8}$/.test(session.sourceHash)
      || !/^attempt-[a-z0-9-]+$/.test(session.attemptId) || (session.branch !== 'canon' && session.branch !== 'original')) {
      fail('OPENING_SESSION_MISMATCH', 'session identifiers or branch are invalid.', { session });
    }

    if (!Array.isArray(input.entities) || input.entities.length === 0 || input.entities.length > 64) fail('OPENING_ENTITIES_REQUIRED', 'entities must be a bounded non-empty array.');
    const entities = input.entities.map(normalizeOpeningEntity);
    const entityById = new Map();
    const writePaths = new Set();
    for (const entity of entities) {
      if (entityById.has(entity.id) || writePaths.has(entity.path)) fail('OPENING_ENTITY_DUPLICATE', 'Duplicate entity id/path.', { id: entity.id, path: entity.path });
      entityById.set(entity.id, entity);
      writePaths.add(entity.path);
    }

    if (!Array.isArray(input.scenes) || input.scenes.length === 0 || input.scenes.length > 32) fail('OPENING_SCENES_REQUIRED', 'scenes must be a bounded non-empty array.');
    const scenes = input.scenes.map((raw, index) => normalizeOpeningScene(raw, index, entityById));
    const sceneById = new Map();
    for (const scene of scenes) {
      if (sceneById.has(scene.id) || writePaths.has(scene.path)) fail('OPENING_SCENE_DUPLICATE', 'Duplicate scene id/path.', { id: scene.id, path: scene.path });
      sceneById.set(scene.id, scene);
      writePaths.add(scene.path);
    }

    const relationships = normalizeOpeningRelationships(input.relationships, entityById);
    for (const relationship of relationships) {
      if (writePaths.has(relationship.path)) fail('OPENING_RELATIONSHIP_DUPLICATE_SUBJECT', 'Duplicate relationship path.', { path: relationship.path });
      writePaths.add(relationship.path);
    }

    if (!isRecord(input.runtime)) fail('OPENING_RUNTIME_INVALID', 'runtime must be an object.');
    assertAllowedKeys(input.runtime, ['protagonistRef', 'location', 'activeSceneRefs', 'worldTime', 'weather', 'extensions'], 'OPENING_RUNTIME_INVALID', 'runtime');
    const protagonistRef = normalizeNamedRef(input.runtime.protagonistRef, 'Runtime protagonist', entityById, 'character');
    const location = normalizeNamedRef(input.runtime.location, 'Runtime location', entityById, 'location');
    if (!Array.isArray(input.runtime.activeSceneRefs) || input.runtime.activeSceneRefs.length === 0 || input.runtime.activeSceneRefs.length > 32) {
      fail('OPENING_RUNTIME_ACTIVE_SCENES_REQUIRED', 'runtime.activeSceneRefs must be a bounded non-empty array.');
    }
    const activeSceneSeen = new Set();
    const activeSceneRefs = input.runtime.activeSceneRefs.map(function (raw, index) {
      if (!isRecord(raw)) fail('OPENING_RUNTIME_SCENE_INVALID', 'activeSceneRefs entries must be { ref, name }.', { index });
      assertAllowedKeys(raw, ['ref', 'name'], 'OPENING_RUNTIME_SCENE_INVALID', 'activeSceneRef');
      const parsed = normalizeEntityId(raw.ref, 'Active scene ref');
      const target = sceneById.get(parsed.id);
      if (parsed.type !== 'scene' || !target) fail('OPENING_RUNTIME_SCENE_UNKNOWN', 'Active scene must point to this commit.', { ref: parsed.id });
      if (activeSceneSeen.has(parsed.id)) fail('OPENING_RUNTIME_SCENE_DUPLICATE', 'Active scene refs must be unique.', { ref: parsed.id });
      activeSceneSeen.add(parsed.id);
      const name = normalizeString(raw.name, 'OPENING_RUNTIME_SCENE_NAME_REQUIRED', 'Active scene name', 120);
      if (name !== target.scene.name) fail('OPENING_REF_NAME_MISMATCH', 'Active scene ref/name must match the target scene.', { ref: parsed.id, expected: target.scene.name, actual: name });
      return { ref: parsed.id, name };
    });
    const runtimeExtensions = normalizeExtensions(input.runtime.extensions, 'runtime');
    const runtimeFile = {
      turn: 0,
      worldTime: optionalText(input.runtime.worldTime, 'OPENING_RUNTIME_INVALID', 'runtime.worldTime', 120, true) || '',
      plotOrder: 1,
      location,
      weather: optionalText(input.runtime.weather, 'OPENING_RUNTIME_INVALID', 'runtime.weather', 120, true) || '',
      activeSceneRefs,
      protagonistRef,
      extensions: runtimeExtensions || {},
      updatedAtTurn: 0,
      updatedBy: 'world-architect',
    };
    const activeScenes = activeSceneRefs.map((ref) => sceneById.get(ref.ref));
    if (!activeScenes.some((scene) => scene.scene.location.ref === location.ref && scene.scene.present.some((item) => item.ref === protagonistRef.ref))) {
      fail('OPENING_RUNTIME_CLOSURE_INVALID', 'At least one active scene must use runtime.location and contain the protagonist.', { protagonist: protagonistRef.ref, location: location.ref });
    }

    if (!isRecord(input.frontier)) fail('OPENING_FRONTIER_INVALID', 'frontier must be an object.');
    assertAllowedKeys(input.frontier, ['sourceWindow', 'extractedThrough', 'timeline', 'notes'], 'OPENING_FRONTIER_INVALID', 'frontier');
    if (!isRecord(input.frontier.sourceWindow)) fail('OPENING_FRONTIER_INVALID', 'frontier.sourceWindow must be an object.');
    assertAllowedKeys(input.frontier.sourceWindow, ['startIndex', 'endIndex', 'reason', 'chapters'], 'OPENING_WINDOW_INVALID', 'frontier.sourceWindow');
    const source = await loadSource(tsian);
    if (typeof source.manifest.importedAt !== 'string' || typeof source.manifest.normalizationVersion !== 'string'
      || typeof source.manifest.title !== 'string' || !source.manifest.title.trim()
      || source.manifest.chapterCount !== source.chapters.length || source.chapters.length === 0) {
      fail('OPENING_SOURCE_NOT_READY', 'Imported source manifest and chapter index do not describe the same ready source.');
    }
    const sourceByIndex = new Map(source.chapters.map((chapter) => [chapter.index, chapter]));
    if (sourceByIndex.size !== source.chapters.length) fail('OPENING_CHAPTER_INDEX_INVALID', 'Imported chapter indexes must be unique.');
    if (source.chapters.some((chapter, index) => chapter.index !== index + 1)) fail('OPENING_CHAPTER_INDEX_INVALID', 'Imported chapter indexes must be contiguous from 1.');
    const startIndex = strictInt(input.frontier.sourceWindow.startIndex, 'OPENING_WINDOW_INVALID', 'sourceWindow.startIndex', 1, 999999);
    const endIndex = strictInt(input.frontier.sourceWindow.endIndex, 'OPENING_WINDOW_INVALID', 'sourceWindow.endIndex', startIndex, 999999);
    const windowLength = endIndex - startIndex + 1;
    if (windowLength > 64) fail('OPENING_WINDOW_INVALID', 'sourceWindow may include at most 64 contiguous chapters.', { startIndex, endIndex });
    if (!Array.isArray(input.frontier.sourceWindow.chapters) || input.frontier.sourceWindow.chapters.length !== windowLength) {
      fail('OPENING_WINDOW_CHAPTERS_INVALID', 'sourceWindow.chapters must cover the full contiguous window.', { expected: windowLength });
    }
    const windowChapters = input.frontier.sourceWindow.chapters.map(function (raw, offset) {
      if (!isRecord(raw)) fail('OPENING_WINDOW_CHAPTER_INVALID', 'Window chapters must be objects.', { offset });
      assertAllowedKeys(raw, ['index', 'title', 'ref', 'path'], 'OPENING_WINDOW_CHAPTER_INVALID', 'Window chapter');
      const expectedIndex = startIndex + offset;
      const sourceChapter = sourceByIndex.get(expectedIndex);
      if (!sourceChapter) fail('OPENING_SOURCE_REF_UNKNOWN', 'Window chapter index is not in the imported source.', { index: expectedIndex });
      const index = strictInt(raw.index, 'OPENING_WINDOW_CHAPTER_INVALID', 'Window chapter index', 1, 999999);
      const title = normalizeString(raw.title, 'OPENING_WINDOW_CHAPTER_INVALID', 'Window chapter title', 300);
      const expectedRef = sourceRefForChapter(sourceChapter);
      const usesRef = isRecord(sourceChapter.source);
      const suppliedRef = usesRef
        ? (typeof raw.ref === 'string' && raw.ref.trim() && raw.path === undefined ? raw.ref.trim() : '')
        : (typeof raw.path === 'string' && raw.path.trim() && raw.ref === undefined ? raw.path.trim() : '');
      if (index !== expectedIndex || title !== sourceChapter.title || suppliedRef !== expectedRef) {
        fail('OPENING_SOURCE_REF_UNKNOWN', 'Window chapter identity must match the imported chapter index.', { index, title, ref: suppliedRef, expectedIndex, expectedTitle: sourceChapter.title, expectedRef });
      }
      const chapter = { index, title };
      if (usesRef) chapter.ref = expectedRef;
      else chapter.path = expectedRef;
      return chapter;
    });
    const reason = normalizeString(input.frontier.sourceWindow.reason, 'OPENING_WINDOW_REASON_REQUIRED', 'sourceWindow.reason', 1000);
    const lastWindowRef = sourceRefForChapter(sourceByIndex.get(endIndex));
    const extractedThrough = normalizeString(input.frontier.extractedThrough, 'OPENING_SOURCE_REF_UNKNOWN', 'frontier.extractedThrough', 240);
    if (extractedThrough !== lastWindowRef) fail('OPENING_SOURCE_REF_UNKNOWN', 'frontier.extractedThrough must equal the last window chapter ref.', { extractedThrough, expected: lastWindowRef });
    if (!Array.isArray(input.frontier.timeline) || input.frontier.timeline.length === 0 || input.frontier.timeline.length > 32) {
      fail('OPENING_TIMELINE_REQUIRED', 'frontier.timeline must contain a bounded source anchor array.');
    }
    let previousChapter = 0;
    const timeline = input.frontier.timeline.map(function (anchor, index) {
      if (!isRecord(anchor)) fail('OPENING_TIMELINE_ANCHOR_INVALID', 'Each timeline anchor must be an object.', { index });
      assertAllowedKeys(anchor, ['kind', 'order', 'chapter', 'time', 'label'], 'OPENING_TIMELINE_ANCHOR_INVALID', 'Timeline anchor');
      const chapter = strictInt(anchor.chapter, 'OPENING_TIMELINE_ANCHOR_INVALID', 'Timeline chapter', startIndex, endIndex);
      if (!sourceByIndex.has(chapter) || chapter < previousChapter) fail('OPENING_TIMELINE_ANCHOR_INVALID', 'Timeline chapters must be known and non-decreasing.', { chapter, previousChapter });
      previousChapter = chapter;
      if (anchor.kind !== 'source' || anchor.order !== index + 1) fail('OPENING_TIMELINE_ANCHOR_INVALID', 'Timeline anchors must be ordered source anchors.', { index, kind: anchor.kind, order: anchor.order });
      if (index === 0 && (chapter !== startIndex || anchor.time !== '元年')) fail('OPENING_TIMELINE_ANCHOR_INVALID', 'First source anchor must match the window start and use time 元年.', { chapter, startIndex, time: anchor.time });
      return {
        kind: 'source',
        order: index + 1,
        chapter,
        time: normalizeString(anchor.time, 'OPENING_TIMELINE_TIME_REQUIRED', 'Timeline time', 120),
        label: normalizeString(anchor.label, 'OPENING_TIMELINE_LABEL_REQUIRED', 'Timeline label', 120),
      };
    });
    const frontierFile = {
      sourceWindow: { start: startIndex, end: endIndex, chapters: windowChapters },
      extractedThrough,
      timeline,
      notes: optionalText(input.frontier.notes, 'OPENING_FRONTIER_INVALID', 'frontier.notes', 2000, false) || reason,
      updatedBy: 'world-architect',
    };

    const summary = normalizeString(input.summary, 'OPENING_SETUP_SUMMARY_REQUIRED', 'summary', 2000);
    const openingReply = normalizeString(input.openingReply, 'OPENING_REPLY_REQUIRED', 'openingReply', 24000);
    if (openingReply.includes('[[开局会话]]') || openingReply.includes('[[/开局会话]]')
      || openingReply.includes('[[开局选项]]') || openingReply.includes('[[/开局选项]]')) {
      fail('OPENING_REPLY_INVALID', 'openingReply must contain only formal story content and [[选项]].');
    }
    const formalChoiceBlocks = openingReply.match(/\[\[选项\]\][\s\S]*?\[\[\/选项\]\]/g) || [];
    if (formalChoiceBlocks.length !== 1 || !/\[\[选项\]\][\s\S]*?\[\[\/选项\]\]\s*$/.test(openingReply)) {
      fail('OPENING_REPLY_INVALID', 'openingReply must end with exactly one complete [[选项]] block.');
    }
    const projectedAssistant = await tsian.reply.project(openingReply);
    if (!projectedAssistant || typeof projectedAssistant.content !== 'string' || !projectedAssistant.content.trim()
      || typeof projectedAssistant.displayContent !== 'string' || !projectedAssistant.displayContent.trim()
      || !isRecord(projectedAssistant.projections) || !Array.isArray(projectedAssistant.projections.choices)
      || projectedAssistant.projections.choices.length === 0 || projectedAssistant.projections.choices.length > 12
      || projectedAssistant.projections.choices.some((choice) => typeof choice !== 'string' || !choice.trim() || choice.length > 300)) {
      fail('OPENING_REPLY_PROJECTION_FAILED', 'openingReply must project a visible story and 1-12 formal choices.');
    }

    const cardManifest = await readJson(tsian, 'game-card.json');
    const cardRuntime = isRecord(cardManifest.runtime) ? cardManifest.runtime : null;
    const entrypoints = cardRuntime && isRecord(cardRuntime.entrypoints) ? cardRuntime.entrypoints : null;
    const playerTurnAgentId = normalizeAgentId(entrypoints && entrypoints.playerTurn);
    const playerTurnAgent = await readJson(tsian, 'agents/' + playerTurnAgentId + '/agent.json');
    if (!isRecord(playerTurnAgent) || playerTurnAgent.id !== playerTurnAgentId) {
      fail('OPENING_PLAYER_TURN_AGENT_INVALID', 'playerTurn agent config identity does not match its entrypoint.', { playerTurnAgentId });
    }
    const playerTurnInstructions = await readText(tsian, 'agents/' + playerTurnAgentId + '/AGENT.md');
    if (!playerTurnInstructions.trim()) fail('OPENING_PLAYER_TURN_AGENT_INVALID', 'playerTurn agent instructions are empty.', { playerTurnAgentId });
    const turn0Path = 'save/history/turns/turn-000000.json';
    const playerContextPath = 'save/agents/' + playerTurnAgentId + '/context.json';
    const controlPath = 'save/playthrough/opening-interview.json';
    const fixedWritePaths = ['save/playthrough/runtime.json', 'save/playthrough/frontier.json', turn0Path, playerContextPath, controlPath, 'save/playthrough/setup-summary.json'];
    for (const path of fixedWritePaths) {
      if (writePaths.has(path)) fail('OPENING_WRITE_PATH_DUPLICATE', 'Planned write paths must be unique.', { path });
      writePaths.add(path);
    }

    const control = await readJson(tsian, controlPath);
    const sourceManifest = source.manifest;
    const sourceIdentity = {
      importedAt: sourceManifest.importedAt,
      normalizationVersion: sourceManifest.normalizationVersion,
      title: sourceManifest.title,
      chapterCount: sourceManifest.chapterCount,
    };
    const expectedSourceHash = fnvHash(JSON.stringify(sourceIdentity));
    const expectedSessionId = 'opening-' + expectedSourceHash;
    const expectedSessionSlot = 'opening-interview-' + expectedSourceHash;
    if (!isRecord(control) || control.schema !== 'novel-airp.opening-interview.v1' || !isRecord(control.source) || !isRecord(control.session)) fail('OPENING_SESSION_MISMATCH', 'Opening control file is invalid.');
    if (session.sourceHash !== expectedSourceHash || session.sessionId !== expectedSessionId
      || control.source.hash !== expectedSourceHash || control.source.importedAt !== sourceIdentity.importedAt
      || control.source.normalizationVersion !== sourceIdentity.normalizationVersion || control.source.title !== sourceIdentity.title
      || control.source.chapterCount !== sourceIdentity.chapterCount || control.session.id !== expectedSessionId
      || control.session.slot !== expectedSessionSlot || control.branch !== session.branch) {
      fail('OPENING_SESSION_MISMATCH', 'Session/source/branch does not match the imported source and opening control file.');
    }

    const normalizedPayload = {
      session,
      entities: entities.map((item) => item.entity),
      scenes: scenes.map((item) => item.scene),
      relationships: relationships.map((item) => item.file),
      runtime: runtimeFile,
      frontier: frontierFile,
      summary,
      openingReply,
    };
    const payloadHash = await sha256Hex(normalizedPayload);
    const setupSummary = await readOptionalJson('save/playthrough/setup-summary.json');
    const existingRuntimeBeforeCommit = await readOptionalJson('save/playthrough/runtime.json');
    const turnMatchesBeforeCommit = await listMatches('save/history/turns/turn-*.json');
    const progressedTurnPaths = turnMatchesBeforeCommit.filter((path) => path !== 'save/history/turns/turn-000000.json');
    if ((isRecord(setupSummary) && setupSummary.enteredPlay === true)
      || (isRecord(existingRuntimeBeforeCommit) && Number.isSafeInteger(existingRuntimeBeforeCommit.turn) && existingRuntimeBeforeCommit.turn > 0)
      || progressedTurnPaths.length > 0) {
      fail('OPENING_PLAY_ALREADY_STARTED', 'Formal play has already started; opening commit retries are no longer allowed.', {
        enteredPlay: Boolean(isRecord(setupSummary) && setupSummary.enteredPlay === true),
        runtimeTurn: isRecord(existingRuntimeBeforeCommit) ? existingRuntimeBeforeCommit.turn : null,
        progressedTurnPaths,
      });
    }
    const controlComplete = control.status === 'complete';
    const summaryComplete = isRecord(setupSummary) && setupSummary.status === 'complete';
    if (controlComplete || summaryComplete) {
      const controlReceipt = isRecord(control.receipt) ? control.receipt : null;
      const summaryReceipt = isRecord(setupSummary && setupSummary.receipt) ? setupSummary.receipt : null;
      if (controlComplete && summaryComplete && controlReceipt && summaryReceipt
        && control.session.revision === session.revision
        && controlReceipt.revision === session.revision && controlReceipt.payloadHash === payloadHash
        && summaryReceipt.revision === session.revision && summaryReceipt.payloadHash === payloadHash
        && controlReceipt.committedAt === summaryReceipt.committedAt
        && setupSummary.openingSessionId === session.sessionId) {
        return { status: 'complete', receipt: controlReceipt, writes: { entities: 0, scenes: 0, relationships: 0 } };
      }
      fail('OPENING_ALREADY_COMMITTED', 'Opening is already complete with a different or unknown receipt.');
    }
    if (control.status !== 'interviewing' || !Number.isSafeInteger(control.session.revision)
      || !isRecord(control.attempt) || typeof control.attempt.input !== 'string'
      || !Number.isSafeInteger(control.attempt.basedOnRevision) || typeof control.attempt.inputHash !== 'string'
      || control.attempt.status !== 'submitted'
      || control.attempt.id !== session.attemptId || control.attempt.basedOnRevision + 1 !== session.revision
      || control.session.revision !== control.attempt.basedOnRevision || control.attempt.inputHash !== fnvHash(control.attempt.input)) {
      fail('OPENING_SESSION_MISMATCH', 'revision/attempt does not match the current submitted attempt.');
    }

    const [
      entityMatches,
      sceneMatches,
      relationshipMatches,
      entityDirectoryData,
      sceneDirectoryData,
      relationshipDirectoryData,
      turnMatches,
      playerContextMatches,
      oldUnderstandingContext,
      oldPlaySetupContext,
      legacyOpeningNarrative,
      existingFrontier,
      existingUnderstanding,
    ] = await Promise.all([
      listMatches('save/entities/*/*.json'),
      listMatches('save/scenes/*.json'),
      listMatches('save/relationships/*.json'),
      listUnexpectedDirectoryFiles('save/entities'),
      listUnexpectedDirectoryFiles('save/scenes'),
      listUnexpectedDirectoryFiles('save/relationships'),
      Promise.resolve(turnMatchesBeforeCommit),
      listMatches('save/agents/' + playerTurnAgentId + '/context*.json'),
      readOptionalFile('save/agents/world-architect/context-understanding.json'),
      readOptionalFile('save/agents/world-architect/context-play-setup.json'),
      readOptionalFile('save/playthrough/opening-narrative.json'),
      readOptionalJson('save/playthrough/frontier.json'),
      readOptionalJson('save/playthrough/understanding-summary.json'),
    ]);
    if (!isPendingSetup(setupSummary) || entityMatches.length || sceneMatches.length || relationshipMatches.length
      || entityDirectoryData.length || sceneDirectoryData.length || relationshipDirectoryData.length
      || turnMatches.length || playerContextMatches.length || oldUnderstandingContext || oldPlaySetupContext
      || legacyOpeningNarrative || !isPendingRuntime(existingRuntimeBeforeCommit) || !isPendingFrontier(existingFrontier)
      || !isPendingUnderstanding(existingUnderstanding)) {
      fail('OPENING_SAVE_NOT_CLEAN', 'This save contains legacy or formal opening state. Use a new save.', {
        entities: entityMatches.length,
        scenes: sceneMatches.length,
        relationships: relationshipMatches.length,
        existingFormalFiles: {
          entities: entityDirectoryData.slice(0, 12),
          scenes: sceneDirectoryData.slice(0, 12),
          relationships: relationshipDirectoryData.slice(0, 12),
        },
        turns: turnMatches.length,
        playerContexts: playerContextMatches.length,
        oldContext: Boolean(oldUnderstandingContext || oldPlaySetupContext),
        legacyOpeningNarrative: Boolean(legacyOpeningNarrative),
        runtimePending: isPendingRuntime(existingRuntimeBeforeCommit),
        frontierPending: isPendingFrontier(existingFrontier),
        understandingPending: isPendingUnderstanding(existingUnderstanding),
        setupPending: isPendingSetup(setupSummary),
      });
    }

    const now = new Date().toISOString();
    const persistedFrontier = { ...frontierFile, updatedAt: now };
    const assistantItem = {
      kind: 'assistant',
      content: projectedAssistant.content,
      displayContent: projectedAssistant.displayContent,
      projections: projectedAssistant.projections,
    };
    const turn0Record = {
      schema: 'tsian.airp.history.turn.v2',
      turn: 0,
      createdAt: now,
      source: { kind: 'agent-runtime', entryAgentId: playerTurnAgentId },
      timeline: [assistantItem],
    };
    const playerContext = {
      schema: 'tsian.agent.context.v1',
      saveId: '',
      agentId: playerTurnAgentId,
      summary: null,
      recentTurns: [{ turn: 0, role: 'assistant', content: projectedAssistant.content }],
      lastCompressedTurn: null,
      updatedAt: now,
    };
    const receipt = { revision: session.revision, payloadHash, committedAt: now };
    const completedControl = {
      ...control,
      session: { ...control.session, revision: session.revision },
      status: 'complete',
      attempt: undefined,
      receipt,
    };
    const completedSummary = {
      status: 'complete',
      summary,
      committedAt: now,
      enteredPlay: false,
      openingSessionId: session.sessionId,
      receipt,
    };
    const writtenPaths = [];

    for (const entity of entities) {
      const file = await tsian.workspace.write({ scope: 'save-runtime', path: entity.path, content: JSON.stringify(entity.entity, null, 2) + '\n', mediaType: 'application/json' });
      writtenPaths.push(file.path);
    }
    for (const scene of scenes) {
      const file = await tsian.workspace.write({ scope: 'save-runtime', path: scene.path, content: JSON.stringify(scene.scene, null, 2) + '\n', mediaType: 'application/json' });
      writtenPaths.push(file.path);
    }
    for (const relationship of relationships) {
      const file = await tsian.workspace.write({ scope: 'save-runtime', path: relationship.path, content: JSON.stringify(relationship.file, null, 2) + '\n', mediaType: 'application/json' });
      writtenPaths.push(file.path);
    }
    for (const [path, value] of [
      ['save/playthrough/runtime.json', runtimeFile],
      ['save/playthrough/frontier.json', persistedFrontier],
      [turn0Path, turn0Record],
      [playerContextPath, playerContext],
      [controlPath, completedControl],
      ['save/playthrough/setup-summary.json', completedSummary],
    ]) {
      const file = await tsian.workspace.write({ scope: 'save-runtime', path, content: JSON.stringify(value, null, 2) + '\n', mediaType: 'application/json' });
      writtenPaths.push(file.path);
    }
    tsian.trace('opening_committed', { sessionId: session.sessionId, revision: session.revision, payloadHash, writes: writtenPaths });
    return {
      status: 'complete',
      receipt,
      writes: {
        entities: entities.length,
        scenes: scenes.length,
        relationships: relationships.length,
        turn0: turn0Path,
        playerContext: playerContextPath,
      },
    };
  } catch (error) {
    tsian.trace('opening_commit_failed', { code: error && error.code || 'OPENING_COMMIT_FAILED', message: error && error.message || String(error), details: error && error.details });
    throw error;
  }
}
return commitOpening(input, tsian, signal);
