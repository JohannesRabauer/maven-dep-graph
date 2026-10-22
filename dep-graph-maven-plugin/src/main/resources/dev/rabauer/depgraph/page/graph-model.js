(function (root) {
  'use strict';

  const STATUS_RANK = { KEPT: 0, MANAGED: 1, DROPPED: 2 };

  function createModel(data) {
    const nodesById = new Map();
    const outEdges = new Map();
    const inEdges = new Map();
    const moduleIds = new Set();
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
    for (const e of data.edges || []) {
      if (!outEdges.has(e.from)) outEdges.set(e.from, []);
      if (!inEdges.has(e.from)) inEdges.set(e.from, []);
      if (!outEdges.has(e.to)) outEdges.set(e.to, []);
      if (!inEdges.has(e.to)) inEdges.set(e.to, []);
      outEdges.get(e.from).push(e);
      inEdges.get(e.to).push(e);
    }
    return { data, nodesById, outEdges, inEdges, moduleIds, modules: data.modules || [], edges: data.edges || [] };
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
    return triplesOf(model, model.edges.filter(function (e) { return edgeEnabled(e, scopes); }));
  }

  function conflictCountForModule(model, moduleId, scopes) {
    return conflictTriples(model, scopes).filter(function (t) { return t.modules.includes(moduleId); }).length;
  }

  function managedCount(model, scopes) {
    const seen = new Set();
    for (const e of model.edges) {
      if (e.status === 'MANAGED' && edgeEnabled(e, scopes)) seen.add(e.to + '\u0000' + e.requestedVersion);
    }
    return seen.size;
  }

  function descendants(model, nodeId, scopes) {
    const result = new Set();
    const stack = [nodeId];
    while (stack.length) {
      const id = stack.pop();
      for (const e of enabledOut(model, id, scopes)) {
        if (!result.has(e.to)) {
          result.add(e.to);
          stack.push(e.to);
        }
      }
    }
    return result;
  }

  function hiddenConflictCount(model, nodeId, scopes, visible) {
    const sources = descendants(model, nodeId, scopes);
    sources.add(nodeId);
    const edges = [];
    for (const id of sources) {
      if (visible.has(id)) continue;
      for (const e of enabledOut(model, id, scopes)) edges.push(e);
    }
    return triplesOf(model, edges).length;
  }

  const MAX_EXPANSIONS = 200000;

  function distancesTo(model, nodeId, moduleId, scopes) {
    const dist = new Map([[nodeId, 0]]);
    const queue = [nodeId];
    for (let i = 0; i < queue.length; i++) {
      const id = queue[i];
      for (const e of model.inEdges.get(id) || []) {
        if (e.module !== moduleId || !edgeEnabled(e, scopes) || dist.has(e.from)) continue;
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
        const outs = model.outEdges.get(last) || [];
        for (let k = outs.length - 1; k >= 0; k--) {
          const e = outs[k];
          if (e.module !== moduleId || !edgeEnabled(e, scopes) || !dist.has(e.to)
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
    for (const m of Array.from(model.moduleIds).sort()) {
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
    for (const e of model.edges) {
      if (!edgeEnabled(e, scopes) || !visible.has(e.from) || !visible.has(e.to)) continue;
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
    createModel, edgeEnabled, visibleNodeIds, conflictTriples, conflictCountForModule,
    managedCount, hiddenConflictCount, pathsFromRoot, descendants, driftGroups,
    mergedEdges, search, nextConflict
  };
  root.DepGraphModel = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
