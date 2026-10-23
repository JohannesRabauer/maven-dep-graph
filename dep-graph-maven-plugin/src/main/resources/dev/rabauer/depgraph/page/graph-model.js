(function (root) {
  'use strict';

  const STATUS_RANK = { KEPT: 0, MANAGED: 1, DROPPED: 2 };
  const STATUS_NAMES = ['KEPT', 'MANAGED', 'DROPPED'];
  const OPTIONAL_FLAG = 4;

  /**
   * Index-encoded edges: `[fromIdx, toIdx, moduleIdx, scopeIdx, flags, requestedVersionIdx?,
   * managedByIdx?]`, where the trailing two entries are omitted when they are absent. Repeating
   * the full coordinate strings on every edge costs about ten times as much on a large reactor.
   */
  function decodeEdges(data) {
    const ids = (data.nodes || []).map(function (n) { return n.id; }).concat(data.extraIds || []);
    const moduleIds = (data.modules || []).map(function (m) { return m.nodeId; });
    const scopes = data.scopeNames || [];
    const versions = data.versions || [];
    const managedBys = data.managedBys || [];
    const statuses = data.statusNames || STATUS_NAMES;
    return data.edges.map(function (a) {
      return {
        from: ids[a[0]],
        to: ids[a[1]],
        module: moduleIds[a[2]],
        scope: a[3] < 0 ? null : scopes[a[3]],
        optional: (a[4] & OPTIONAL_FLAG) !== 0,
        status: statuses[a[4] & 3],
        requestedVersion: a.length > 5 && a[5] >= 0 ? versions[a[5]] : null,
        managedBy: a.length > 6 && a[6] >= 0 ? managedBys[a[6]] : null
      };
    });
  }

  function edgesOf(data) {
    const raw = data.edges || [];
    return raw.length && Array.isArray(raw[0]) ? decodeEdges(data) : raw;
  }

  function createModel(data) {
    const nodesById = new Map();
    const outEdges = new Map();
    const inEdges = new Map();
    const moduleIds = new Set();
    const droppedEdges = [];
    const managedEdges = [];
    for (const m of data.modules || []) moduleIds.add(m.nodeId);
    for (const n of data.nodes || []) {
      nodesById.set(n.id, n);
      outEdges.set(n.id, []);
      inEdges.set(n.id, []);
    }
    for (const id of moduleIds) {
      if (!outEdges.has(id)) outEdges.set(id, []);
      if (!inEdges.has(id)) inEdges.set(id, []);
    }
    const edges = edgesOf(data);
    for (const e of edges) {
      if (!outEdges.has(e.from)) outEdges.set(e.from, []);
      if (!inEdges.has(e.from)) inEdges.set(e.from, []);
      if (!outEdges.has(e.to)) outEdges.set(e.to, []);
      if (!inEdges.has(e.to)) inEdges.set(e.to, []);
      outEdges.get(e.from).push(e);
      inEdges.get(e.to).push(e);
      if (e.status === 'DROPPED') droppedEdges.push(e);
      else if (e.status === 'MANAGED') managedEdges.push(e);
    }
    return {
      data: data, nodesById: nodesById, outEdges: outEdges, inEdges: inEdges, moduleIds: moduleIds,
      modules: data.modules || [], edges: edges, droppedEdges: droppedEdges, managedEdges: managedEdges,
      byModule: null
    };
  }

  /**
   * Per-module adjacency, built once on first use. Every per-module walk would otherwise rescan
   * the global neighbour lists of shared artifacts, which carry one entry per depending module.
   */
  function moduleIndex(model) {
    if (model.byModule) return model.byModule;
    const out = new Map();
    const into = new Map();
    for (const e of model.edges) {
      const ok = e.module + '\u0000' + e.from;
      const ik = e.module + '\u0000' + e.to;
      let list = out.get(ok);
      if (!list) out.set(ok, list = []);
      list.push(e);
      list = into.get(ik);
      if (!list) into.set(ik, list = []);
      list.push(e);
    }
    model.byModule = { out: out, in: into };
    return model.byModule;
  }

  function moduleOut(model, moduleId, nodeId) {
    return moduleIndex(model).out.get(moduleId + '\u0000' + nodeId) || [];
  }

  function moduleIn(model, moduleId, nodeId) {
    return moduleIndex(model).in.get(moduleId + '\u0000' + nodeId) || [];
  }

  function modulesOut(model, nodeId, scopes) {
    const mods = new Set();
    for (const e of model.outEdges.get(nodeId) || []) {
      if (edgeEnabled(e, scopes)) mods.add(e.module);
    }
    return mods;
  }

  function modulesIn(model, nodeId, scopes) {
    const mods = new Set();
    for (const e of model.inEdges.get(nodeId) || []) {
      if (edgeEnabled(e, scopes)) mods.add(e.module);
    }
    return mods;
  }

  function edgeEnabled(edge, scopes) {
    return scopes.has(edge.scope || 'compile');
  }

  function enabledOut(model, id, scopes) {
    return (model.outEdges.get(id) || []).filter(function (e) { return edgeEnabled(e, scopes); });
  }

  function visibleNodeIds(model, scopes, expanded, hidden) {
    const visible = new Set(model.moduleIds);
    const queue = Array.from(visible);
    const done = new Set();
    while (queue.length) {
      const id = queue.pop();
      if (done.has(id)) continue;
      done.add(id);
      if (!expanded.has(id) || hidden.has(id)) continue;
      for (const e of enabledOut(model, id, scopes)) {
        if (!visible.has(e.to)) visible.add(e.to);
        if (!done.has(e.to)) queue.push(e.to);
      }
    }
    return visible;
  }

  function gaOf(model, id) {
    const n = model.nodesById.get(id);
    return n ? n.groupId + ':' + n.artifactId : id;
  }

  function cmp(a, b) { return a < b ? -1 : a > b ? 1 : 0; }

  function triplesOf(model, edges) {
    const map = new Map();
    for (const e of edges) {
      if (e.status !== 'DROPPED') continue;
      const ga = gaOf(model, e.to);
      const key = ga + '\u0000' + e.to + '\u0000' + e.requestedVersion;
      let t = map.get(key);
      if (!t) {
        t = { ga: ga, winner: e.to, dropped: e.requestedVersion, modules: [] };
        map.set(key, t);
      }
      if (!t.modules.includes(e.module)) t.modules.push(e.module);
    }
    const list = Array.from(map.values());
    for (const t of list) t.modules.sort();
    list.sort(function (a, b) { return cmp(a.ga, b.ga) || cmp(String(a.dropped), String(b.dropped)) || cmp(a.winner, b.winner); });
    return list;
  }

  function conflictTriples(model, scopes) {
    return triplesOf(model, model.droppedEdges.filter(function (e) { return edgeEnabled(e, scopes); }));
  }

  function conflictCountForModule(model, moduleId, scopes) {
    return conflictTriples(model, scopes).filter(function (t) { return t.modules.includes(moduleId); }).length;
  }

  function managedCount(model, scopes) {
    const seen = new Set();
    for (const e of model.managedEdges) {
      if (edgeEnabled(e, scopes)) seen.add(e.to + '\u0000' + e.requestedVersion);
    }
    return seen.size;
  }

  /**
   * Everything the node depends on, as the union of the per-module reaches. A chain that only
   * exists by combining two modules is not a dependency of anything the build actually produces.
   */
  function descendants(model, nodeId, scopes) {
    const result = new Set();
    for (const moduleId of modulesOut(model, nodeId, scopes)) {
      const stack = [nodeId];
      const seen = new Set([nodeId]);
      while (stack.length) {
        const id = stack.pop();
        for (const e of moduleOut(model, moduleId, id)) {
          if (!edgeEnabled(e, scopes)) continue;
          result.add(e.to);
          if (!seen.has(e.to)) {
            seen.add(e.to);
            stack.push(e.to);
          }
        }
      }
    }
    return result;
  }

  function moduleReverseReach(model, moduleId, startId, scopes, cache) {
    const key = moduleId + '\u0000' + startId;
    let reach = cache && cache.get(key);
    if (reach) return reach;
    reach = new Set([startId]);
    const stack = [startId];
    while (stack.length) {
      const id = stack.pop();
      for (const e of moduleIn(model, moduleId, id)) {
        if (!edgeEnabled(e, scopes) || reach.has(e.from)) continue;
        reach.add(e.from);
        stack.push(e.from);
      }
    }
    if (cache) cache.set(key, reach);
    return reach;
  }

  /**
   * Every node on a path from a module root to `nodeId`, as the union of the per-module ancestor
   * sets. Only a module that requests the node directly somewhere can have a path to it, so the
   * walk never starts in a module that cannot reach it.
   */
  function ancestorsOf(model, nodeId, scopes) {
    const result = new Set([nodeId]);
    for (const moduleId of modulesIn(model, nodeId, scopes)) {
      for (const id of moduleReverseReach(model, moduleId, nodeId, scopes, null)) result.add(id);
    }
    return result;
  }

  /** A node is open when its own out-edges are drawn; everything below a closed node is hidden. */
  function isOpen(id, expanded, hidden) {
    return expanded.has(id) && !hidden.has(id);
  }

  /**
   * The red count of every visible, closed node: the conflicts that sit below it and are not on
   * the canvas. Counted per module, so a conflict that only one module has under a shared artifact
   * is never credited to the other modules that use the same artifact.
   */
  function collapsedConflictCounts(model, scopes, visible, expanded, hidden) {
    const counts = new Map();
    const bySource = new Map();
    for (const e of model.droppedEdges) {
      if (!edgeEnabled(e, scopes)) continue;
      if (visible.has(e.from) && isOpen(e.from, expanded, hidden)) continue;
      const sourceKey = e.module + '\u0000' + e.from;
      let source = bySource.get(sourceKey);
      if (!source) bySource.set(sourceKey, source = { module: e.module, from: e.from, keys: new Set() });
      source.keys.add(gaOf(model, e.to) + '\u0000' + e.to + '\u0000' + e.requestedVersion);
    }
    if (!bySource.size) return counts;
    const cache = new Map();
    const seen = new Map();
    for (const source of bySource.values()) {
      for (const id of moduleReverseReach(model, source.module, source.from, scopes, cache)) {
        if (!visible.has(id) || isOpen(id, expanded, hidden)) continue;
        let keys = seen.get(id);
        if (!keys) seen.set(id, keys = new Set());
        for (const key of source.keys) keys.add(key);
      }
    }
    for (const entry of seen) counts.set(entry[0], entry[1].size);
    return counts;
  }

  /** How many distinct direct dependencies each visible, closed node would reveal when opened. */
  function collapsedChildCounts(model, scopes, visible, expanded, hidden) {
    const counts = new Map();
    for (const id of visible) {
      if (isOpen(id, expanded, hidden)) continue;
      const children = new Set();
      for (const e of enabledOut(model, id, scopes)) children.add(e.to);
      if (children.size) counts.set(id, children.size);
    }
    return counts;
  }

  /**
   * The marker slots of one node. Conflict and managed share the top-left corner because they are
   * mutually exclusive; "newer version" and "version drift" get a corner each, so a drifting node
   * that also has a newer release still shows both.
   */
  function nodeMarkers(flags) {
    const marks = [];
    if (flags.dropped) marks.push({ marker: 'conflict', x: '0%', y: '0%', offX: -3, offY: -3 });
    else if (flags.managed) marks.push({ marker: 'managed', x: '0%', y: '0%', offX: -3, offY: -3 });
    if (flags.newer) marks.push({ marker: 'newer', x: '100%', y: '0%', offX: 3, offY: -3 });
    if (flags.drift) marks.push({ marker: 'drift', x: '100%', y: '100%', offX: 3, offY: 3 });
    return marks;
  }

  const MAX_EXPANSIONS = 200000;

  function distancesTo(model, nodeId, moduleId, scopes) {
    const dist = new Map([[nodeId, 0]]);
    const queue = [nodeId];
    for (let i = 0; i < queue.length; i++) {
      const id = queue[i];
      for (const e of moduleIn(model, moduleId, id)) {
        if (!edgeEnabled(e, scopes) || dist.has(e.from)) continue;
        dist.set(e.from, dist.get(id) + 1);
        queue.push(e.from);
      }
    }
    return dist;
  }

  // Best-first enumeration: partial paths are ordered by length plus the exact remaining
  // distance, so complete paths come out shortest first and dead ends are never extended.
  function modulePaths(model, moduleId, nodeId, scopes, max) {
    const dist = distancesTo(model, nodeId, moduleId, scopes);
    if (!dist.has(moduleId)) return [];
    const buckets = [];
    function push(path) {
      const f = path.length - 1 + dist.get(path[path.length - 1]);
      (buckets[f] || (buckets[f] = [])).push(path);
    }
    push([moduleId]);
    const found = [];
    let expansions = 0;
    for (let f = 0; f < buckets.length && found.length < max; f++) {
      const bucket = buckets[f];
      while (bucket && bucket.length && found.length < max && expansions++ < MAX_EXPANSIONS) {
        const path = bucket.pop();
        const last = path[path.length - 1];
        if (last === nodeId) {
          found.push(path);
          continue;
        }
        const tried = new Set();
        const outs = moduleOut(model, moduleId, last);
        for (let k = outs.length - 1; k >= 0; k--) {
          const e = outs[k];
          if (!edgeEnabled(e, scopes) || !dist.has(e.to)
              || tried.has(e.to) || path.includes(e.to)) continue;
          tried.add(e.to);
          push(path.concat(e.to));
        }
      }
      if (expansions >= MAX_EXPANSIONS) break;
    }
    return found;
  }

  function pathsFromRoot(model, nodeId, scopes, limit) {
    const max = limit === undefined ? 50 : limit;
    const out = [];
    const seen = new Set();
    // Only a module that requests the node somewhere can have a path to it.
    const candidates = modulesIn(model, nodeId, scopes);
    if (model.moduleIds.has(nodeId)) candidates.add(nodeId);
    for (const m of Array.from(candidates).sort()) {
      const paths = m === nodeId ? [[m]] : modulePaths(model, m, nodeId, scopes, max);
      for (const p of paths) {
        const key = p.join('\u0000');
        if (!seen.has(key)) {
          seen.add(key);
          out.push(p);
        }
      }
    }
    out.sort(function (a, b) { return a.length - b.length; });
    return out.slice(0, max);
  }
  function versionCompare(a, b) {
    const pa = String(a).split(/[.\-]/);
    const pb = String(b).split(/[.\-]/);
    const n = Math.max(pa.length, pb.length);
    for (let i = 0; i < n; i++) {
      const x = pa[i], y = pb[i];
      if (x === undefined) return -1;
      if (y === undefined) return 1;
      const nx = /^\d+$/.test(x), ny = /^\d+$/.test(y);
      if (nx && ny) {
        const d = Number(x) - Number(y);
        if (d) return d;
      } else if (x !== y) {
        return cmp(x, y);
      }
    }
    return 0;
  }

  function driftGroups(model) {
    const byGa = new Map();
    for (const n of model.nodesById.values()) {
      if (model.moduleIds.has(n.id)) continue;
      const ga = n.groupId + ':' + n.artifactId;
      if (!byGa.has(ga)) byGa.set(ga, []);
      byGa.get(ga).push(n);
    }
    const result = new Map();
    for (const ga of Array.from(byGa.keys()).sort()) {
      const nodes = byGa.get(ga);
      if (new Set(nodes.map(function (n) { return n.version; })).size < 2) continue;
      const entries = nodes.map(function (n) {
        const mods = new Set((model.inEdges.get(n.id) || []).map(function (e) { return e.module; }));
        return { version: n.version, nodeId: n.id, modules: Array.from(mods).sort() };
      });
      entries.sort(function (a, b) { return versionCompare(a.version, b.version); });
      result.set(ga, entries);
    }
    return result;
  }

  function mergedEdges(model, visible, scopes) {
    const map = new Map();
    // Only the out-edges of visible nodes can produce a visible edge, so the whole edge list is
    // never scanned per render.
    for (const from of visible) {
      for (const e of model.outEdges.get(from) || []) {
        if (!edgeEnabled(e, scopes) || !visible.has(e.to)) continue;
        const key = e.from + '\u0000' + e.to;
        let m = map.get(key);
        if (!m) {
          m = { from: e.from, to: e.to, status: e.status, optional: true, requestedVersions: new Set(), modules: new Set() };
          map.set(key, m);
        }
        if ((STATUS_RANK[e.status] || 0) > (STATUS_RANK[m.status] || 0)) m.status = e.status;
        if (!e.optional) m.optional = false;
        if (e.requestedVersion != null) m.requestedVersions.add(e.requestedVersion);
        m.modules.add(e.module);
      }
    }
    return Array.from(map.values()).map(function (m) {
      m.requestedVersions = Array.from(m.requestedVersions).sort();
      m.modules = Array.from(m.modules).sort();
      return m;
    });
  }

  function search(model, query, limit) {
    const max = limit === undefined ? 20 : limit;
    const q = (query || '').trim().toLowerCase();
    if (!q) return [];
    const hits = [];
    for (const n of model.nodesById.values()) {
      const text = model.moduleIds.has(n.id) ? n.id : n.groupId + ':' + n.artifactId;
      if (text.toLowerCase().includes(q)) hits.push(n.id);
    }
    hits.sort(function (a, b) {
      return (model.moduleIds.has(b) - model.moduleIds.has(a)) || cmp(a, b);
    });
    return hits.slice(0, max);
  }

  function nextConflict(triples, currentIndex) {
    if (!triples.length) return -1;
    return currentIndex < 0 || currentIndex + 1 >= triples.length ? 0 : currentIndex + 1;
  }

  const api = {
    createModel, decodeEdges, edgeEnabled, visibleNodeIds, conflictTriples, conflictCountForModule,
    managedCount, collapsedConflictCounts, collapsedChildCounts, nodeMarkers, pathsFromRoot, descendants, ancestorsOf,
    driftGroups, mergedEdges, search, nextConflict
  };
  root.DepGraphModel = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
