(function () {
  'use strict';

  const M = globalThis.DepGraphModel;
  const MAX_VISIBLE = 2000;
  const AUTO_EXPAND_MODULES = 20;
  const BADGE_SOURCE_LIMIT = 200;
  const BADGE_RENDER_LIMIT = 300;
  const SCOPE_NAMES = ['compile', 'runtime', 'provided', 'test', 'system'];
  const THEMES = ['auto', 'dark', 'light'];

  const PALETTES = {
    dark: {
      text: '#F8FAFC', muted: '#94A3B8', surface: '#1E293B', border: '#475569',
      module: '#22C55E', onModule: '#0F172A', managedText: '#DDD6FE', managedFill: '#2E1065',
      edge: '#64748B',
      // Label colours: the strokes keep the accent hue, the text needs 4.5:1 on the surface.
      managedLabel: '#A78BFA', conflictLabel: '#F87171'
    },
    light: {
      text: '#0F172A', muted: '#475569', surface: '#FFFFFF', border: '#94A3B8',
      module: '#22C55E', onModule: '#0F172A', managedText: '#4C1D95', managedFill: '#EDE9FE',
      edge: '#475569',
      managedLabel: '#6D28D9', conflictLabel: '#B91C1C'
    }
  };
  const CONFLICT = '#EF4444';
  const MANAGED = '#A78BFA';
  const NEWER = '#06B6D4';
  const DRIFT = '#6B7FA8';

  function icon(svg) {
    return 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 14 14">' + svg + '</svg>');
  }

  const WARNING_ICON = icon('<path d="M7 1.5 13 12.5H1Z" fill="' + CONFLICT + '"/><path d="M6.3 5h1.4v4H6.3zM6.3 9.9h1.4v1.4H6.3z" fill="#0F172A"/>');
  const DIAMOND_ICON = icon('<path d="M7 1 13 7 7 13 1 7Z" fill="' + MANAGED + '"/>');
  const NEWER_DOT = icon('<circle cx="7" cy="7" r="6" fill="' + NEWER + '"/>');
  const DRIFT_DOT = icon('<circle cx="7" cy="7" r="6" fill="' + DRIFT + '"/>');

  const reducedMotion = globalThis.matchMedia
    ? globalThis.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  const lightScheme = globalThis.matchMedia
    ? globalThis.matchMedia('(prefers-color-scheme: light)') : { matches: false };

  const el = {
    topbar: document.getElementById('topbar'),
    title: document.getElementById('title'),
    stats: document.getElementById('stats'),
    search: document.getElementById('search'),
    scopes: document.getElementById('scopes'),
    conflictBadge: document.getElementById('conflict-badge'),
    managedToggle: document.getElementById('managed-toggle'),
    driftToggle: document.getElementById('drift-toggle'),
    themeToggle: document.getElementById('theme-toggle'),
    filterBar: document.getElementById('filter-bar'),
    cy: document.getElementById('cy'),
    badges: document.getElementById('badges'),
    warning: document.getElementById('warning-dialog')
  };

  const data = JSON.parse(document.getElementById('dep-graph-data').textContent);
  const model = M.createModel(data);

  const state = {
    scopes: new Set(['compile', 'runtime']),
    expanded: new Set(),
    hidden: new Set(),
    focus: null,
    showManaged: true,
    showDrift: false,
    theme: 'auto',
    selected: null
  };

  const driftMembers = new Set();
  for (const entries of M.driftGroups(model).values()) {
    for (const e of entries) driftMembers.add(e.nodeId);
  }

  let cy = null;
  let scopeCache = null;
  let lastGood = snapshot();
  let pendingConfirm = null;

  function scopeKey() {
    return Array.from(state.scopes).sort().join(',');
  }

  /** Conflict triples and the managed count only change when the scope selection changes. */
  function scopeInfo() {
    const key = scopeKey();
    if (!scopeCache || scopeCache.key !== key) {
      const triples = M.conflictTriples(model, state.scopes);
      scopeCache = { key: key, triples: triples, managed: M.managedCount(model, state.scopes) };
    }
    return scopeCache;
  }

  function snapshot() {
    return {
      scopes: new Set(state.scopes),
      expanded: new Set(state.expanded),
      hidden: new Set(state.hidden),
      focus: state.focus
    };
  }

  function restore(snap) {
    state.scopes = new Set(snap.scopes);
    state.expanded = new Set(snap.expanded);
    state.hidden = new Set(snap.hidden);
    state.focus = snap.focus;
    syncTopbar();
  }

  function gaOf(id) {
    const n = model.nodesById.get(id);
    return n ? n.groupId + ':' + n.artifactId : id;
  }

  function computeView() {
    let visible = M.visibleNodeIds(model, state.scopes, state.expanded, state.hidden);
    let onPath = null;
    const focus = state.focus;
    if (focus && focus.kind === 'descendants') {
      const keep = M.descendants(model, focus.nodeId, state.scopes);
      keep.add(focus.nodeId);
      const narrowed = new Set();
      for (const id of visible) if (keep.has(id)) narrowed.add(id);
      visible = narrowed;
    } else if (focus && focus.kind === 'paths') {
      onPath = new Set();
      for (const path of M.pathsFromRoot(model, focus.nodeId, state.scopes)) {
        for (const id of path) onPath.add(id);
      }
    }
    return { visible: visible, onPath: onPath, edges: M.mergedEdges(model, visible, state.scopes) };
  }

  function reverseReach(startId, cache) {
    let reach = cache.get(startId);
    if (reach) return reach;
    reach = new Set([startId]);
    const queue = [startId];
    while (queue.length) {
      const id = queue.pop();
      for (const e of model.inEdges.get(id) || []) {
        if (!M.edgeEnabled(e, state.scopes) || reach.has(e.from)) continue;
        reach.add(e.from);
        queue.push(e.from);
      }
    }
    cache.set(startId, reach);
    return reach;
  }

  function collapsed(id, visible) {
    return visible.has(id) && !state.expanded.has(id);
  }

  /**
   * Conflicts that sit below a collapsed node, counted once per (group:artifact, winner, dropped
   * version). Walking up from the few hidden DROPPED sources is far cheaper than asking for every
   * node's descendants.
   */
  function computeBadges(visible) {
    const bySource = new Map();
    for (const e of model.edges) {
      if (e.status !== 'DROPPED' || visible.has(e.from) || !M.edgeEnabled(e, state.scopes)) continue;
      const key = gaOf(e.to) + '\u0000' + e.to + '\u0000' + e.requestedVersion;
      let keys = bySource.get(e.from);
      if (!keys) bySource.set(e.from, keys = new Set());
      keys.add(key);
    }
    const counts = new Map();
    if (!bySource.size) return counts;
    if (bySource.size > BADGE_SOURCE_LIMIT) {
      for (const triple of scopeInfo().triples) {
        for (const moduleId of triple.modules) {
          if (collapsed(moduleId, visible)) counts.set(moduleId, (counts.get(moduleId) || 0) + 1);
        }
      }
      return counts;
    }
    const cache = new Map();
    const seen = new Map();
    for (const entry of bySource) {
      for (const id of reverseReach(entry[0], cache)) {
        if (!collapsed(id, visible)) continue;
        let keys = seen.get(id);
        if (!keys) seen.set(id, keys = new Set());
        for (const key of entry[1]) keys.add(key);
      }
    }
    for (const entry of seen) counts.set(entry[0], entry[1].size);
    return counts;
  }

  function nodeElement(id, ctx) {
    const n = model.nodesById.get(id);
    const isModule = model.moduleIds.has(id);
    const artifactId = n ? n.artifactId : id;
    const version = n ? n.version : '';
    const dropped = ctx.dropped.has(id);
    const managed = !dropped && state.showManaged && ctx.managed.has(id);
    const images = [];
    const xs = [];
    const ys = [];
    const offX = [];
    const offY = [];
    if (dropped) {
      images.push(WARNING_ICON);
      xs.push('0%');
      ys.push('0%');
      offX.push(-3);
      offY.push(-3);
    } else if (managed) {
      images.push(DIAMOND_ICON);
      xs.push('0%');
      ys.push('0%');
      offX.push(-3);
      offY.push(-3);
    }
    if (n && n.latest && n.latest.newerInSameMajor) {
      images.push(NEWER_DOT);
      xs.push('100%');
      ys.push('0%');
      offX.push(3);
      offY.push(-3);
    } else if (state.showDrift && driftMembers.has(id)) {
      images.push(DRIFT_DOT);
      xs.push('100%');
      ys.push('0%');
      offX.push(3);
      offY.push(-3);
    }
    return {
      group: 'nodes',
      data: {
        id: id,
        label: version ? artifactId + '\n' + version : artifactId,
        kind: isModule ? 'module' : 'external',
        dropped: dropped ? 1 : 0,
        managed: managed ? 1 : 0,
        images: images,
        imageX: xs,
        imageY: ys,
        imageOffX: offX,
        imageOffY: offY,
        dim: ctx.onPath && !ctx.onPath.has(id) ? 1 : 0
      }
    };
  }

  function edgeElement(e) {
    const wants = e.requestedVersions.length ? 'wants ' + e.requestedVersions.join(', ') : '';
    const managed = e.status === 'MANAGED' && state.showManaged;
    return {
      group: 'edges',
      data: {
        id: e.from + '\u0000' + e.to,
        source: e.from,
        target: e.to,
        status: e.status,
        managed: managed ? 1 : 0,
        optional: e.optional ? 1 : 0,
        label: e.status === 'DROPPED' || managed ? wants : ''
      }
    };
  }

  function updateData(ele, data) {
    for (const key in data) {
      if (key === 'id' || key === 'source' || key === 'target') continue;
      ele.data(key, data[key]);
    }
  }

  function diff(view) {
    const ctx = { dropped: new Set(), managed: new Set(), onPath: view.onPath };
    for (const e of view.edges) {
      if (e.status === 'DROPPED') ctx.dropped.add(e.to);
      else if (e.status === 'MANAGED') ctx.managed.add(e.to);
    }
    const wantedEdges = new Map();
    for (const e of view.edges) {
      const data = edgeElement(e);
      wantedEdges.set(data.data.id, data);
    }

    const add = [];
    let changed = false;
    cy.batch(function () {
      cy.nodes().forEach(function (n) {
        if (!view.visible.has(n.id())) {
          n.remove();
          changed = true;
        }
      });
      cy.edges().forEach(function (e) {
        if (!wantedEdges.has(e.id())) {
          e.remove();
          changed = true;
        }
      });
      for (const id of view.visible) {
        const existing = cy.getElementById(id);
        const element = nodeElement(id, ctx);
        if (existing.empty()) {
          add.push(element);
          changed = true;
        } else {
          updateData(existing, element.data);
        }
      }
      for (const entry of wantedEdges) {
        const existing = cy.getElementById(entry[0]);
        if (existing.empty()) {
          add.push(entry[1]);
          changed = true;
        } else {
          updateData(existing, entry[1].data);
        }
      }
      cy.add(add);
    });
    return changed;
  }

  function runLayout() {
    cy.layout({
      name: 'dagre',
      rankDir: 'TB',
      animate: false,
      // The default network-simplex ranker costs minutes on a few thousand nodes.
      ranker: 'tight-tree',
      nodeDimensionsIncludeLabels: true,
      rankSep: 60,
      nodeSep: 20
    }).run();
  }

  function paintBadges(counts) {
    el.badges.textContent = '';
    // Below this zoom the nodes are smaller than the badge, so the badges would only form a blur.
    if (!counts.size || cy.zoom() < 0.6) return;
    const fragment = document.createDocumentFragment();
    let painted = 0;
    for (const entry of counts) {
      if (!entry[1] || painted >= BADGE_RENDER_LIMIT) continue;
      const node = cy.getElementById(entry[0]);
      if (node.empty()) continue;
      const pos = node.renderedPosition();
      const span = document.createElement('span');
      span.className = 'badge';
      span.textContent = String(entry[1]);
      span.style.left = (pos.x + node.renderedWidth() / 2) + 'px';
      span.style.top = (pos.y - node.renderedHeight() / 2) + 'px';
      fragment.appendChild(span);
      painted++;
    }
    el.badges.appendChild(fragment);
  }

  let badgeCounts = new Map();

  /**
   * Draws the current state. Returns false when the size guard deferred the draw, so callers can
   * hold back anything that assumes the new elements are on the canvas. `after` runs once a
   * deferred draw has been confirmed and applied.
   */
  function render(force, after) {
    const view = computeView();
    if (!force && view.visible.size > MAX_VISIBLE) {
      confirmLarge(view.visible.size, function (ok) {
        if (!ok) {
          restore(lastGood);
          return;
        }
        if (render(true) && after) after();
      });
      return false;
    }
    const structureChanged = diff(view);
    if (structureChanged) runLayout();
    badgeCounts = computeBadges(view.visible);
    paintBadges(badgeCounts);
    applySelection();
    lastGood = snapshot();
    return true;
  }

  function confirmLarge(count, done) {
    pendingConfirm = done;
    el.warning.textContent = '';
    const text = document.createElement('p');
    text.textContent = 'This shows ' + count + ' artifacts and may be slow. Continue?';
    const actions = document.createElement('div');
    actions.className = 'actions';
    for (const act of [['cancel', 'Cancel'], ['confirm', 'Continue']]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.act = act[0];
      button.textContent = act[1];
      actions.appendChild(button);
    }
    el.warning.appendChild(text);
    el.warning.appendChild(actions);
    el.warning.hidden = false;
    const confirmButton = el.warning.querySelector('button[data-act="confirm"]');
    if (confirmButton.focus) confirmButton.focus();
  }

  el.warning.addEventListener('click', function (ev) {
    const act = ev.target.dataset ? ev.target.dataset.act : null;
    if (!act) return;
    el.warning.hidden = true;
    el.warning.textContent = '';
    const done = pendingConfirm;
    pendingConfirm = null;
    if (done) done(act === 'confirm');
  });

  function applySelection() {
    cy.nodes('.selected').removeClass('selected');
    if (state.selected) cy.getElementById(state.selected).addClass('selected');
  }

  function select(nodeId) {
    state.selected = nodeId;
    applySelection();
    if (depGraph.onSelect) depGraph.onSelect(nodeId);
  }

  function centre(nodeId) {
    const node = cy.getElementById(nodeId);
    if (node.empty()) return;
    if (reducedMotion.matches) cy.center(node);
    else cy.animate({ center: { eles: node } }, { duration: 200 });
  }

  function reveal(nodeId) {
    const path = M.pathsFromRoot(model, nodeId, state.scopes, 1)[0];
    if (path) {
      for (let i = 0; i < path.length - 1; i++) state.expanded.add(path[i]);
    }
    // Only select once the node is really on the canvas: the draw can be deferred by the guard, and
    // a node that no enabled scope reaches stays invisible even after a successful draw.
    const done = function () {
      if (cy.getElementById(nodeId).empty()) return false;
      select(nodeId);
      centre(nodeId);
      return true;
    };
    return render(false, done) ? done() : false;
  }

  function style(palette) {
    return [
      {
        selector: 'node',
        style: {
          'shape': 'round-rectangle',
          'width': 'label',
          'height': 'label',
          'padding': '8px',
          'label': 'data(label)',
          'text-wrap': 'wrap',
          'text-valign': 'center',
          'text-halign': 'center',
          'font-family': 'JetBrains Mono, ui-monospace, Consolas, monospace',
          'font-size': 10,
          'color': palette.text,
          'background-color': palette.surface,
          'border-color': palette.border,
          'border-width': 1,
          'background-image': 'data(images)',
          'background-image-containment': 'over',
          'background-clip': 'none',
          'background-fit': 'none',
          'background-width': '14px',
          'background-height': '14px',
          'background-position-x': 'data(imageX)',
          'background-position-y': 'data(imageY)',
          'background-offset-x': 'data(imageOffX)',
          'background-offset-y': 'data(imageOffY)'
        }
      },
      { selector: 'node[kind = "module"]', style: { 'background-color': palette.module, 'color': palette.onModule, 'border-color': palette.module, 'font-weight': 'bold' } },
      { selector: 'node[managed = 1]', style: { 'border-color': MANAGED, 'border-width': 2, 'background-color': palette.managedFill, 'color': palette.managedText } },
      { selector: 'node[dropped = 1]', style: { 'border-color': CONFLICT, 'border-width': 2.5 } },
      { selector: 'node[dim = 1]', style: { 'opacity': 0.25 } },
      { selector: 'node.selected', style: { 'outline-color': '#22C55E', 'outline-width': 3, 'outline-opacity': 1, 'outline-offset': 2 } },
      {
        selector: 'edge',
        style: {
          'width': 1.3,
          'curve-style': 'bezier',
          'line-color': palette.edge,
          'target-arrow-color': palette.edge,
          'target-arrow-shape': 'triangle',
          'arrow-scale': 0.7,
          'font-family': 'JetBrains Mono, ui-monospace, Consolas, monospace',
          'font-size': 9,
          'color': palette.muted,
          'text-background-color': palette.surface,
          'text-background-opacity': 0,
          'text-background-padding': 2,
          'label': 'data(label)'
        }
      },
      { selector: 'edge[optional = 1]', style: { 'line-style': 'dotted' } },
      { selector: 'edge[managed = 1]', style: { 'line-style': 'dashed', 'line-color': MANAGED, 'target-arrow-color': MANAGED, 'color': palette.managedLabel, 'text-background-opacity': 1 } },
      { selector: 'edge[status = "DROPPED"]', style: { 'line-style': 'dashed', 'line-color': CONFLICT, 'target-arrow-color': CONFLICT, 'color': palette.conflictLabel, 'text-background-opacity': 1 } }
    ];
  }

  function effectiveTheme() {
    return state.theme === 'auto' ? (lightScheme.matches ? 'light' : 'dark') : state.theme;
  }

  function applyTheme() {
    document.documentElement.setAttribute('data-theme', state.theme);
    el.themeToggle.textContent = '\u25D0 Theme: ' + state.theme;
    if (cy) cy.style(style(PALETTES[effectiveTheme()]));
  }

  function syncTopbar() {
    for (const button of el.scopes.children) {
      button.setAttribute('aria-pressed', String(state.scopes.has(button.dataset.scope)));
    }
    const info = scopeInfo();
    el.conflictBadge.textContent = '\u25B2 ' + info.triples.length + ' conflicts';
    el.conflictBadge.classList.toggle('has-conflicts', info.triples.length > 0);
    el.managedToggle.textContent = '\u25C6 ' + info.managed + ' managed';
    el.managedToggle.setAttribute('aria-pressed', String(state.showManaged));
    el.driftToggle.setAttribute('aria-pressed', String(state.showDrift));
  }

  function buildTopbar() {
    el.title.textContent = data.title || '';
    const artifacts = (data.nodes || []).filter(function (n) { return !n.module; }).length;
    const moduleCount = model.modules.length;
    el.stats.textContent = moduleCount + (moduleCount === 1 ? ' module \u00B7 ' : ' modules \u00B7 ')
      + artifacts + (artifacts === 1 ? ' artifact' : ' artifacts');
    el.search.placeholder = 'Search group:artifact\u2026';

    for (const scope of SCOPE_NAMES) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'chip';
      button.dataset.scope = scope;
      button.textContent = scope;
      button.addEventListener('click', function () {
        if (state.scopes.has(scope)) state.scopes.delete(scope);
        else state.scopes.add(scope);
        syncTopbar();
        render();
      });
      el.scopes.appendChild(button);
    }

    el.conflictBadge.className = 'chip';
    el.managedToggle.className = 'chip';
    el.driftToggle.className = 'chip';
    el.themeToggle.className = 'chip';
    el.driftToggle.textContent = 'Version drift';

    el.managedToggle.addEventListener('click', function () {
      state.showManaged = !state.showManaged;
      syncTopbar();
      render();
    });
    el.driftToggle.addEventListener('click', function () {
      state.showDrift = !state.showDrift;
      syncTopbar();
      render();
    });
    el.themeToggle.addEventListener('click', function () {
      state.theme = THEMES[(THEMES.indexOf(state.theme) + 1) % THEMES.length];
      applyTheme();
    });
    if (lightScheme.addEventListener) {
      lightScheme.addEventListener('change', function () {
        if (state.theme === 'auto') applyTheme();
      });
    }
  }

  function initialExpansion() {
    if (model.modules.length > AUTO_EXPAND_MODULES) return;
    for (const m of model.modules) state.expanded.add(m.nodeId);
    if (M.visibleNodeIds(model, state.scopes, state.expanded, state.hidden).size > MAX_VISIBLE) {
      state.expanded.clear();
    }
  }

  const depGraph = {
    cy: null,
    model: model,
    state: state,
    render: function () { return render(false); },
    select: select,
    reveal: reveal,
    onSelect: null
  };
  globalThis.depGraph = depGraph;

  function init() {
    buildTopbar();
    cy = cytoscape({
      container: el.cy,
      elements: [],
      layout: { name: 'dagre', rankDir: 'TB', animate: false },
      style: style(PALETTES[effectiveTheme()]),
      wheelSensitivity: 0.2,
      textureOnViewport: true,
      pixelRatio: 1
    });
    depGraph.cy = cy;
    applyTheme();
    syncTopbar();

    cy.on('tap', 'node', function (ev) {
      const id = ev.target.id();
      if (state.expanded.has(id)) state.expanded.delete(id);
      else state.expanded.add(id);
      const done = function () { select(id); };
      if (render(false, done)) done();
    });
    cy.on('pan zoom resize', function () { paintBadges(badgeCounts); });

    initialExpansion();
    render(true);
  }

  // The UMD build registers itself when a global cytoscape is present; this covers the other case.
  if (typeof cytoscape !== 'undefined' && typeof cytoscapeDagre === 'function') {
    cytoscape.use(cytoscapeDagre);
  }

  try {
    init();
    document.body.dataset.ready = 'true';
  } catch (err) {
    document.body.dataset.error = String((err && err.message) || err);
    el.filterBar.textContent = 'Failed to render the dependency graph: ' + document.body.dataset.error;
  }
})();
