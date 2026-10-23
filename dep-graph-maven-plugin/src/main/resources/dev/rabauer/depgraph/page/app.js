(function () {
  'use strict';

  const M = globalThis.DepGraphModel;
  const MAX_VISIBLE = 2000;
  const AUTO_EXPAND_MODULES = 20;
  const PATH_LIMIT = 50;
  const SEARCH_LIMIT = 20;
  const MIN_INITIAL_ZOOM = 0.5;
  // Keeps a small graph at a natural size instead of blowing a handful of nodes up to fill the screen.
  const MAX_FIT_ZOOM = 1.5;
  const INITIAL_FOCUS_MODULES = 5;
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
  // The arrow keeps "newer release" readable without relying on the cyan alone.
  const NEWER_DOT = icon('<circle cx="7" cy="7" r="6.5" fill="' + NEWER + '"/><path d="M7 2.6 10.6 6.4H8.1v4.6H5.9V6.4H3.4Z" fill="#0F172A"/>');
  const DRIFT_DOT = icon('<circle cx="7" cy="7" r="6" fill="' + DRIFT + '"/>');

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
    expandAll: document.getElementById('expand-all'),
    collapseAll: document.getElementById('collapse-all'),
    themeToggle: document.getElementById('theme-toggle'),
    filterBar: document.getElementById('filter-bar'),
    cy: document.getElementById('cy'),
    badges: document.getElementById('badges'),
    legendItems: document.getElementById('legend-items'),
    panel: document.getElementById('panel'),
    menu: document.getElementById('context-menu'),
    live: document.getElementById('a11y-live'),
    warning: document.getElementById('warning-dialog')
  };

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const CROSS_PATH = 'M3.5 3.5 10.5 10.5M10.5 3.5 3.5 10.5';

  function elt(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function iconEl(d) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 14 14');
    svg.setAttribute('width', '12');
    svg.setAttribute('height', '12');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '1.6');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('fill', 'none');
    svg.appendChild(path);
    return svg;
  }

  function iconButton(label, className) {
    const button = elt('button', className || 'icon-button');
    button.type = 'button';
    button.setAttribute('aria-label', label);
    button.appendChild(iconEl(CROSS_PATH));
    return button;
  }

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
    selected: null,
    revealedPath: null,
    focused: null
  };

  const drift = M.driftGroups(model);
  const driftMembers = new Set();
  for (const entries of drift.values()) {
    for (const e of entries) driftMembers.add(e.nodeId);
  }

  let cy = null;
  let scopeCache = null;
  let lastGood = snapshot();
  let pendingConfirm = null;
  let warningReturnFocus = null;
  let searchIndex = -1;
  let conflictIndex = -1;

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
    syncFilterBar();
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
      onPath = ancestorsOf(focus.nodeId);
    }
    return { visible: visible, onPath: onPath, edges: M.mergedEdges(model, visible, state.scopes) };
  }

  /**
   * Every node on any path from a module root to `nodeId`, which is exactly the node's ancestor
   * set in the enabled scopes, walked per module. Enumerating the paths themselves is bounded on
   * purpose, because their number can grow exponentially.
   */
  function ancestorsOf(nodeId) {
    return M.ancestorsOf(model, nodeId, state.scopes);
  }

  /**
   * The red count of every visible, closed node: the conflicts below it that the canvas does not
   * show, counted per module so one module's conflict under a shared artifact is never credited to
   * another module.
   */
  function computeBadges(visible) {
    return M.collapsedConflictCounts(model, state.scopes, visible, state.expanded, state.hidden);
  }

  const MARKER_ICONS = {
    conflict: WARNING_ICON,
    managed: DIAMOND_ICON,
    newer: NEWER_DOT,
    drift: DRIFT_DOT
  };

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
    const marks = M.nodeMarkers({
      dropped: dropped,
      managed: managed,
      newer: !!(n && n.latest && n.latest.newerInSameMajor),
      drift: state.showDrift && driftMembers.has(id)
    });
    for (const mark of marks) {
      images.push(MARKER_ICONS[mark.marker]);
      xs.push(mark.x);
      ys.push(mark.y);
      offX.push(mark.offX);
      offY.push(mark.offY);
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

  function edgeElement(e, ctx) {
    const wants = e.requestedVersions.length ? 'wants ' + e.requestedVersions.join(', ') : '';
    const managed = e.status === 'MANAGED' && state.showManaged;
    const dimmed = ctx.onPath && (!ctx.onPath.has(e.from) || !ctx.onPath.has(e.to));
    return {
      group: 'edges',
      data: {
        id: e.from + '\u0000' + e.to,
        source: e.from,
        target: e.to,
        status: e.status,
        managed: managed ? 1 : 0,
        optional: e.optional ? 1 : 0,
        dim: dimmed ? 1 : 0,
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
      const data = edgeElement(e, ctx);
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

  let layoutPending = false;
  let layoutQueue = [];

  /** Runs `fn` once the current layout has applied its positions, or straight away if none runs. */
  function afterLayout(fn) {
    if (layoutPending) layoutQueue.push(fn);
    else fn();
  }

  /**
   * The layout applies its positions asynchronously, and its own fit lands after a reveal has
   * centred the node, so the fit is switched off and viewport work is queued behind `layoutstop`.
   */
  function runLayout() {
    const layout = cy.layout({
      name: 'dagre',
      rankDir: 'TB',
      animate: false,
      fit: false,
      // The default network-simplex ranker costs minutes on a few thousand nodes.
      ranker: 'tight-tree',
      nodeDimensionsIncludeLabels: true,
      rankSep: 60,
      nodeSep: 20
    });
    layoutPending = true;
    layout.one('layoutstop', function () {
      layoutPending = false;
      const queued = layoutQueue;
      layoutQueue = [];
      for (const fn of queued) fn();
    });
    layout.run();
  }

  function paintBadges(counts) {
    el.badges.textContent = '';
    // Below this zoom the nodes are smaller than the badge, so the badges would only form a blur.
    if ((!counts.size && !childCounts.size) || cy.zoom() < 0.6) return;
    const fragment = document.createDocumentFragment();
    let painted = 0;
    const paint = function (map, className, text, atBottom) {
      for (const entry of map) {
        if (!entry[1] || painted >= BADGE_RENDER_LIMIT) continue;
        const node = cy.getElementById(entry[0]);
        if (node.empty()) continue;
        const pos = node.renderedPosition();
        const span = document.createElement('span');
        span.className = className;
        span.textContent = text(entry[1]);
        // The "+N" pill hangs below the node's border, clear of its version line.
        span.style.left = (atBottom ? pos.x : pos.x + node.renderedWidth() / 2) + 'px';
        span.style.top = (atBottom ? pos.y + node.renderedOuterHeight() / 2 + 4 : pos.y - node.renderedHeight() / 2) + 'px';
        fragment.appendChild(span);
        painted++;
      }
    };
    // Conflicts first, so the render limit never drops a red count in favour of a "+N".
    paint(counts, 'badge', String, false);
    paint(childCounts, 'badge more', function (n) { return '+' + n; }, true);
    el.badges.appendChild(fragment);
  }

  let badgeCounts = new Map();
  let childCounts = new Map();
  let focusing = false;

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
    if (structureChanged) {
      // A reveal centres the node itself, so the fit is skipped there.
      const fit = !focusing;
      runLayout();
      afterLayout(function () {
        if (fit) {
          cy.fit();
          if (cy.zoom() > MAX_FIT_ZOOM) {
            cy.zoom(MAX_FIT_ZOOM);
            cy.center();
          }
        }
        paintBadges(badgeCounts);
      });
    }
    badgeCounts = computeBadges(view.visible);
    childCounts = M.collapsedChildCounts(model, state.scopes, view.visible, state.expanded, state.hidden);
    paintBadges(badgeCounts);
    applySelection();
    syncFilterBar();
    if (state.selected) renderPanel(state.selected);
    lastGood = snapshot();
    return true;
  }

  function closeWarning() {
    el.warning.hidden = true;
    el.warning.textContent = '';
    const done = pendingConfirm;
    const previous = warningReturnFocus;
    pendingConfirm = null;
    warningReturnFocus = null;
    if (previous && previous.focus) previous.focus();
    return done;
  }

  /**
   * The newest request wins: a confirm that arrives while the dialog is open replaces the pending
   * one, and its `after` callback travels with it. Cancelling the newest restores `lastGood`, which
   * also undoes the superseded state, so no stale callback is left behind.
   */
  function confirmLarge(count, done) {
    if (!pendingConfirm) warningReturnFocus = document.activeElement;
    pendingConfirm = done;
    el.warning.textContent = '';
    const text = elt('p', null, 'This shows ' + count + ' artifacts and may be slow. Continue?');
    text.id = 'warning-text';
    const actions = elt('div', 'actions');
    for (const act of [['cancel', 'Cancel'], ['confirm', 'Continue']]) {
      const button = elt('button', null, act[1]);
      button.type = 'button';
      button.dataset.act = act[0];
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
    const done = closeWarning();
    if (done) done(act === 'confirm');
  });

  // Keeps focus inside the modal dialog and lets Esc cancel it.
  el.warning.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      const done = closeWarning();
      if (done) done(false);
      return;
    }
    if (ev.key !== 'Tab') return;
    const buttons = el.warning.querySelectorAll('button');
    if (!buttons.length) return;
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    if (ev.shiftKey && document.activeElement === first) {
      ev.preventDefault();
      last.focus();
    } else if (!ev.shiftKey && document.activeElement === last) {
      ev.preventDefault();
      first.focus();
    }
  });

  function applySelection() {
    cy.nodes('.selected').removeClass('selected');
    if (state.selected) cy.getElementById(state.selected).addClass('selected');
    cy.nodes('.kb-focus').removeClass('kb-focus');
    if (state.focused) cy.getElementById(state.focused).addClass('kb-focus');
    cy.elements('.on-revealed-path').removeClass('on-revealed-path');
    const path = state.revealedPath;
    if (!path) return;
    for (let i = 0; i < path.length; i++) {
      cy.getElementById(path[i]).addClass('on-revealed-path');
      if (i) cy.getElementById(path[i - 1] + '\u0000' + path[i]).addClass('on-revealed-path');
    }
  }

  function announce(text) {
    if (el.live) el.live.textContent = text;
  }

  /** Moves the keyboard focus ring, keeps the node in view and announces it to screen readers. */
  function focusNode(id) {
    if (!id) return;
    const node = cy.getElementById(id);
    if (node.empty()) return;
    state.focused = id;
    applySelection();
    const pos = node.renderedPosition();
    if (pos.x < 0 || pos.y < 0 || pos.x > cy.width() || pos.y > cy.height()) cy.center(node);
    paintBadges(badgeCounts);
    const n = model.nodesById.get(id);
    const label = n ? (n.artifactId + (n.version ? ' ' + n.version : '')) : id;
    const hasChildren = (model.outEdges.get(id) || []).some(function (e) {
      return M.edgeEnabled(e, state.scopes);
    });
    const open = state.expanded.has(id) && !state.hidden.has(id);
    announce(label + (hasChildren ? (open ? ', expanded' : ', collapsed') : ', no dependencies'));
  }

  function firstFocusable() {
    const modules = cy.nodes('[kind = "module"]');
    const pool = modules.length ? modules : cy.nodes();
    return pool.length ? pool.map(function (n) { return n.id(); }).sort()[0] : null;
  }

  function sortedIds(collection) {
    return collection.map(function (n) { return n.id(); }).sort();
  }

  function siblingIds(id) {
    const parents = cy.getElementById(id).incomers('node');
    return sortedIds(parents.length ? parents[0].outgoers('node') : cy.nodes('[kind = "module"]'));
  }

  /** Arrow keys walk the drawn graph: down to a child, up to a parent, left/right between siblings. */
  function moveFocus(key) {
    const current = state.focused && !cy.getElementById(state.focused).empty() ? state.focused : null;
    if (!current) {
      focusNode(firstFocusable());
      return;
    }
    let next = null;
    if (key === 'ArrowDown') next = sortedIds(cy.getElementById(current).outgoers('node'))[0];
    else if (key === 'ArrowUp') next = sortedIds(cy.getElementById(current).incomers('node'))[0];
    else {
      const group = siblingIds(current);
      if (group.length) {
        const at = Math.max(group.indexOf(current), 0);
        next = group[(at + (key === 'ArrowRight' ? 1 : group.length - 1)) % group.length];
      }
    }
    if (next) focusNode(next);
  }

  function toggleExpansion(id) {
    state.revealedPath = null;
    if (state.expanded.has(id)) state.expanded.delete(id);
    else state.expanded.add(id);
    const done = function () {
      select(id);
      focusNode(id);
    };
    if (render(false, done)) done();
  }

  function select(nodeId) {
    state.selected = nodeId;
    applySelection();
    if (depGraph.onSelect) depGraph.onSelect(nodeId);
  }

  /**
   * Brings a revealed node into the part of the canvas the panel does not cover, at a zoom that is
   * still legible. The panel is its own grid column, so the canvas has to be re-measured first:
   * opening it shrinks the container and would otherwise leave the node behind the panel.
   */
  function centre(nodeId) {
    afterLayout(function () {
      const node = cy.getElementById(nodeId);
      if (node.empty()) return;
      cy.resize();
      const zoom = Math.max(cy.zoom(), MIN_INITIAL_ZOOM);
      const pos = node.position();
      const pan = { x: cy.width() / 2 - pos.x * zoom, y: cy.height() / 2 - pos.y * zoom };
      // The jump is instant rather than animated, which also keeps it free of motion for readers
      // who ask for reduced motion. The zoom is set before the pan so the pan can target the
      // final coordinates exactly.
      cy.zoom(zoom);
      cy.pan(pan);
      paintBadges(badgeCounts);
    });
  }

  function reveal(nodeId) {
    const path = M.pathsFromRoot(model, nodeId, state.scopes, 1)[0];
    if (path) {
      for (let i = 0; i < path.length - 1; i++) state.expanded.add(path[i]);
    }
    // The spec asks search to expand *and highlight* the path it took, so the route stays readable
    // once the node is on screen.
    state.revealedPath = path && path.length > 1 ? path : null;
    // Only select once the node is really on the canvas: the draw can be deferred by the guard, and
    // a node that no enabled scope reaches stays invisible even after a successful draw.
    const done = function () {
      if (cy.getElementById(nodeId).empty()) return false;
      select(nodeId);
      centre(nodeId);
      return true;
    };
    focusing = true;
    const drawn = render(false, done);
    focusing = false;
    return drawn ? done() : false;
  }

  function artifactIdOf(id) {
    const n = model.nodesById.get(id);
    return n ? n.artifactId : id;
  }

  function enabledIn(id) {
    return (model.inEdges.get(id) || []).filter(function (e) { return M.edgeEnabled(e, state.scopes); });
  }

  function sectionBody(parent, title) {
    parent.appendChild(elt('h2', 'section-title', title));
    const body = elt('div', 'section-body');
    parent.appendChild(body);
    return body;
  }

  function panelHead(id, node, ins) {
    const head = elt('div', 'panel-head');
    const coords = elt('div', 'coords');
    coords.appendChild(elt('div', 'mono muted', node ? node.groupId : ''));
    coords.appendChild(elt('div', 'mono artifact', artifactIdOf(id)));
    if (node && node.type && node.type !== 'jar') coords.appendChild(elt('div', 'mono muted', node.type));
    if (node && node.classifier) coords.appendChild(elt('div', 'mono muted', node.classifier));
    const meta = elt('div', 'meta');
    if (node && node.version) meta.appendChild(elt('span', 'mono', node.version));
    const isModule = model.moduleIds.has(id);
    const dropped = ins.some(function (e) { return e.status === 'DROPPED'; });
    const managed = ins.some(function (e) { return e.status === 'MANAGED'; });
    if (isModule) meta.appendChild(elt('span', 'pill pill-module', 'module'));
    else if (dropped) meta.appendChild(elt('span', 'pill pill-conflict', 'conflict'));
    else if (managed) meta.appendChild(elt('span', 'pill pill-managed', 'managed'));
    else meta.appendChild(elt('span', 'pill', 'kept'));
    if (node && node.latest && node.latest.newerInSameMajor) {
      meta.appendChild(elt('span', 'pill pill-newer', '\u2191 update available'));
    }
    const scopes = Array.from(new Set(ins.map(function (e) { return e.scope || 'compile'; }))).sort();
    if (scopes.length) meta.appendChild(elt('span', 'muted', scopes.join(', ')));
    if (ins.some(function (e) { return e.optional; })) meta.appendChild(elt('span', 'muted', 'optional'));
    coords.appendChild(meta);
    head.appendChild(coords);
    const close = iconButton('Close panel');
    close.addEventListener('click', function () {
      state.selected = null;
      applySelection();
      renderPanel(null);
      el.cy.focus();
    });
    head.appendChild(close);
    return head;
  }

  function whySection(panel, ins) {
    const body = sectionBody(panel, 'Why this version');
    const managedBy = [];
    for (const e of ins) {
      if (e.status !== 'MANAGED') continue;
      const by = e.managedBy || 'dependencyManagement';
      if (!managedBy.includes(by)) managedBy.push(by);
    }
    for (const by of managedBy) body.appendChild(elt('div', 'why why-managed', 'Managed by ' + by));
    if (ins.some(function (e) { return e.status === 'DROPPED'; })) {
      body.appendChild(elt('div', 'why why-conflict', 'Nearest wins'));
    }
    if (!body.children.length) body.appendChild(elt('div', 'muted', 'Only version requested'));
  }

  function requestedSection(panel, node, ins) {
    const body = sectionBody(panel, 'Requested versions');
    const rows = new Map();
    for (const e of ins) {
      const version = e.requestedVersion != null ? e.requestedVersion : (node ? node.version : '');
      const parent = artifactIdOf(e.from);
      const key = version + '\u0000' + parent;
      let row = rows.get(key);
      if (!row) rows.set(key, row = { version: version, parent: parent, status: e.status, modules: new Set() });
      if (e.status === 'DROPPED' || (e.status === 'MANAGED' && row.status !== 'DROPPED')) row.status = e.status;
      row.modules.add(e.module);
    }
    if (!rows.size) {
      body.appendChild(elt('div', 'muted', 'No requesting dependency'));
      return;
    }
    for (const row of rows.values()) {
      const line = elt('div', 'req');
      const version = elt('span', 'mono req-version req-' + String(row.status).toLowerCase(), row.version);
      line.appendChild(version);
      line.appendChild(elt('span', 'muted', 'via ' + row.parent));
      body.appendChild(line);
      // The module matters as soon as the build has more than one, even for a single occurrence.
      if (row.modules.size && model.modules.length > 1) {
        const names = Array.from(row.modules).map(artifactIdOf).sort();
        body.appendChild(elt('div', 'muted modules', names.join(', ')));
      }
    }
  }

  function pathsSection(panel, id) {
    const paths = M.pathsFromRoot(model, id, state.scopes, PATH_LIMIT);
    const truncated = paths.length >= PATH_LIMIT;
    const count = truncated ? 'showing ' + PATH_LIMIT + ' of many' : String(paths.length);
    const body = sectionBody(panel, 'Paths from root (' + count + ')');
    for (const path of paths) {
      body.appendChild(elt('div', 'mono path', path.map(artifactIdOf).join(' \u2192 ')));
    }
    if (!paths.length) body.appendChild(elt('div', 'muted', 'No path in the enabled scopes'));
    else if (truncated) body.appendChild(elt('div', 'muted', 'shortest ' + PATH_LIMIT + ' paths only'));
  }

  function latestSection(panel, node) {
    const body = sectionBody(panel, 'Latest version');
    const latest = node ? node.latest : null;
    if (!latest) {
      body.appendChild(elt('div', 'muted', 'not checked'));
      return;
    }
    const current = node.version || '';
    const major = majorOf(current);
    const majorLabel = (major == null ? String(current).split('.')[0] : major) + '.x';
    const overallMajor = majorOf(latest.latestOverall);
    const newMajor = major != null && overallMajor != null && overallMajor > major;

    const status = elt('div', 'latest-status');
    if (latest.newerInSameMajor) {
      status.classList.add('latest-outdated');
      status.appendChild(elt('strong', null, '\u2191 Update available'));
      status.appendChild(elt('span', 'mono', current + ' \u2192 ' + latest.latestSameMajor));
      status.appendChild(elt('span', 'muted', 'Same major version, usually a drop-in upgrade.'));
    } else {
      status.classList.add('latest-current');
      status.appendChild(elt('strong', null, '\u2713 Latest ' + majorLabel + ' release'));
      if (newMajor) status.appendChild(elt('span', 'muted', 'A newer major version exists; it may need code changes.'));
    }
    body.appendChild(status);

    const table = elt('dl', 'latest-table');
    function row(label, value, cls, tag) {
      table.appendChild(elt('dt', 'muted', label));
      const dd = elt('dd', 'mono' + (cls ? ' ' + cls : ''), value || 'none');
      if (tag) dd.appendChild(elt('span', 'tag', tag));
      table.appendChild(dd);
    }
    row('In use', current, latest.newerInSameMajor ? 'version-old' : null);
    row('Latest ' + majorLabel, latest.latestSameMajor, latest.newerInSameMajor ? 'version-new' : null,
      latest.newerInSameMajor ? 'newer' : null);
    if (latest.latestOverall && latest.latestOverall !== latest.latestSameMajor) {
      row('Latest overall', latest.latestOverall, null, newMajor ? 'new major' : null);
    }
    body.appendChild(table);
  }

  function majorOf(version) {
    const match = /^(\d+)/.exec(String(version || ''));
    return match ? Number(match[1]) : null;
  }

  function driftSection(panel, node) {
    if (!state.showDrift || !node) return;
    const entries = drift.get(node.groupId + ':' + node.artifactId);
    if (!entries) return;
    const body = sectionBody(panel, 'Version drift');
    for (const entry of entries) {
      for (const moduleId of entry.modules) {
        body.appendChild(elt('div', 'mono drift-row', artifactIdOf(moduleId) + ' \u2192 ' + entry.version));
      }
    }
  }

  function renderPanel(id) {
    el.panel.textContent = '';
    if (!id) {
      el.panel.hidden = true;
      return;
    }
    const node = model.nodesById.get(id);
    const ins = enabledIn(id);
    el.panel.appendChild(panelHead(id, node, ins));
    whySection(el.panel, ins);
    latestSection(el.panel, node);
    requestedSection(el.panel, node, ins);
    pathsSection(el.panel, id);
    driftSection(el.panel, node);
    el.panel.hidden = false;
  }

  const MENU_ITEMS = [
    {
      label: 'Expand everything below',
      run: function (id) {
        state.expanded.add(id);
        for (const child of M.descendants(model, id, state.scopes)) state.expanded.add(child);
      }
    },
    {
      label: 'Show only what this depends on',
      run: function (id) {
        state.focus = { kind: 'descendants', nodeId: id };
        state.expanded.add(id);
        for (const child of M.descendants(model, id, state.scopes)) state.expanded.add(child);
      }
    },
    {
      label: 'Show all paths from root',
      run: function (id) {
        state.focus = { kind: 'paths', nodeId: id };
        for (const ancestor of ancestorsOf(id)) {
          if (ancestor !== id) state.expanded.add(ancestor);
        }
      }
    },
    {
      label: 'Hide this subtree',
      run: function (id) { state.hidden.add(id); }
    },
    {
      label: 'Reset view',
      run: function () {
        state.focus = null;
        state.hidden.clear();
        state.expanded.clear();
      }
    }
  ];

  function closeMenu(returnFocus) {
    if (el.menu.hidden) return;
    el.menu.hidden = true;
    el.menu.textContent = '';
    if (returnFocus) el.cy.focus();
  }

  function menuItems() {
    return Array.prototype.slice.call(el.menu.querySelectorAll('[role="menuitem"]'));
  }

  function openMenu(nodeId, x, y) {
    el.menu.textContent = '';
    for (const item of MENU_ITEMS) {
      const button = elt('button', 'menu-item', item.label);
      button.type = 'button';
      button.setAttribute('role', 'menuitem');
      button.tabIndex = -1;
      button.addEventListener('click', function () {
        closeMenu(true);
        item.run(nodeId);
        render();
      });
      el.menu.appendChild(button);
    }
    el.menu.hidden = false;
    const width = el.menu.offsetWidth || 220;
    const height = el.menu.offsetHeight || 120;
    el.menu.style.left = Math.max(0, Math.min(x, window.innerWidth - width - 4)) + 'px';
    el.menu.style.top = Math.max(0, Math.min(y, window.innerHeight - height - 4)) + 'px';
    const first = menuItems()[0];
    if (first) first.focus();
  }

  function openMenuForNode(nodeId) {
    if (!nodeId) return;
    const node = cy.getElementById(nodeId);
    if (node.empty()) return;
    const box = el.cy.getBoundingClientRect();
    const pos = node.renderedPosition();
    openMenu(nodeId, box.left + pos.x, box.top + pos.y);
  }

  el.menu.addEventListener('keydown', function (ev) {
    const items = menuItems();
    const index = items.indexOf(document.activeElement);
    if (ev.key === 'Escape' || ev.key === 'Tab') {
      ev.preventDefault();
      closeMenu(true);
    } else if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      const step = ev.key === 'ArrowDown' ? 1 : items.length - 1;
      items[(Math.max(index, 0) + step) % items.length].focus();
    }
  });

  el.menu.addEventListener('focusout', function (ev) {
    if (!el.menu.hidden && !el.menu.contains(ev.relatedTarget)) closeMenu(false);
  });

  function filterChips() {
    const chips = [];
    if (state.focus && state.focus.kind === 'descendants') {
      chips.push({
        text: 'Filtered: depended on by ' + artifactIdOf(state.focus.nodeId),
        label: 'Remove filter',
        clear: function () { state.focus = null; }
      });
    } else if (state.focus && state.focus.kind === 'paths') {
      chips.push({
        text: 'Filtered: paths to ' + artifactIdOf(state.focus.nodeId),
        label: 'Remove filter',
        clear: function () { state.focus = null; }
      });
    }
    for (const id of state.hidden) {
      chips.push({
        text: 'Hidden: ' + artifactIdOf(id) + ' subtree',
        label: 'Show subtree again',
        clear: function () { state.hidden.delete(id); }
      });
    }
    return chips;
  }

  function syncFilterBar() {
    el.filterBar.textContent = '';
    for (const chip of filterChips()) {
      const box = elt('span', 'chip filter-chip');
      box.appendChild(elt('span', null, chip.text));
      const remove = iconButton(chip.label, 'icon-button chip-remove');
      remove.addEventListener('click', function () {
        chip.clear();
        render();
      });
      box.appendChild(remove);
      el.filterBar.appendChild(box);
    }
  }

  function closeSearch() {
    el.searchResults.hidden = true;
    el.searchResults.textContent = '';
    el.search.setAttribute('aria-expanded', 'false');
    el.search.removeAttribute('aria-activedescendant');
    searchIndex = -1;
  }

  function highlightSearch(index) {
    const options = el.searchResults.children;
    if (!options.length) return;
    searchIndex = (index + options.length) % options.length;
    for (let i = 0; i < options.length; i++) options[i].classList.toggle('active', i === searchIndex);
    el.search.setAttribute('aria-activedescendant', options[searchIndex].id);
  }

  function chooseSearch(index) {
    const option = el.searchResults.children[index];
    if (!option) return;
    const id = option.dataset.id;
    closeSearch();
    reveal(id);
  }

  function updateSearch() {
    const hits = M.search(model, el.search.value, SEARCH_LIMIT);
    el.searchResults.textContent = '';
    if (!hits.length) {
      closeSearch();
      return;
    }
    hits.forEach(function (id, i) {
      const node = model.nodesById.get(id);
      const option = elt('div', 'search-option');
      option.id = 'search-option-' + i;
      option.setAttribute('role', 'option');
      option.dataset.id = id;
      option.appendChild(elt('span', 'mono', node ? node.groupId + ':' + node.artifactId : id));
      if (node && node.version) option.appendChild(elt('span', 'muted', node.version));
      option.addEventListener('mousedown', function (ev) { ev.preventDefault(); });
      option.addEventListener('click', function () { chooseSearch(i); });
      el.searchResults.appendChild(option);
    });
    const box = el.search.getBoundingClientRect();
    el.searchResults.style.left = box.left + 'px';
    el.searchResults.style.top = box.bottom + 2 + 'px';
    el.searchResults.style.minWidth = box.width + 'px';
    el.searchResults.hidden = false;
    el.search.setAttribute('aria-expanded', 'true');
    highlightSearch(0);
  }

  function stepConflict() {
    const triples = scopeInfo().triples;
    if (!triples.length) return;
    conflictIndex = M.nextConflict(triples, conflictIndex);
    const winner = triples[conflictIndex].winner;
    // A winner that no enabled scope reaches cannot be centred, but the panel can still explain it.
    if (!reveal(winner)) select(winner);
  }

  /**
   * With hundreds of module roots a plain fit produces an unreadable strip, so the opening view
   * keeps a legible zoom and centres on the first few modules instead.
   */
  function clampInitialView() {
    afterLayout(function () {
      if (cy.zoom() >= MIN_INITIAL_ZOOM) return;
      const modules = cy.nodes('[kind = "module"]');
      cy.zoom(MIN_INITIAL_ZOOM);
      cy.center(modules.length ? modules.slice(0, INITIAL_FOCUS_MODULES) : cy.nodes());
      paintBadges(badgeCounts);
    });
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
      { selector: 'node.on-revealed-path', style: { 'underlay-color': palette.module, 'underlay-opacity': 0.35, 'underlay-padding': 5, 'opacity': 1 } },
      { selector: 'node.selected', style: { 'outline-color': '#22C55E', 'outline-width': 3, 'outline-opacity': 1, 'outline-offset': 2 } },
      { selector: 'node.kb-focus', style: { 'overlay-color': palette.text, 'overlay-opacity': 0.22, 'overlay-padding': 5 } },
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
      { selector: 'edge[dim = 1]', style: { 'opacity': 0.2 } },
      { selector: 'edge.on-revealed-path', style: { 'line-color': palette.module, 'target-arrow-color': palette.module, 'width': 2.6, 'opacity': 1 } },
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
    el.conflictBadge.textContent = '\u25B2 ' + info.triples.length
      + (info.triples.length === 1 ? ' conflict' : ' conflicts');
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
    el.search.setAttribute('role', 'combobox');
    el.search.setAttribute('aria-expanded', 'false');
    el.search.setAttribute('aria-controls', 'search-results');
    el.search.setAttribute('aria-autocomplete', 'list');

    el.searchResults = elt('div', null);
    el.searchResults.id = 'search-results';
    el.searchResults.setAttribute('role', 'listbox');
    el.searchResults.hidden = true;
    document.body.appendChild(el.searchResults);

    el.search.addEventListener('input', updateSearch);
    el.search.addEventListener('blur', function () { closeSearch(); });
    el.search.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') {
        closeSearch();
      } else if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
        if (el.searchResults.hidden) updateSearch();
        else highlightSearch(searchIndex + (ev.key === 'ArrowDown' ? 1 : -1));
        ev.preventDefault();
      } else if (ev.key === 'Enter') {
        ev.preventDefault();
        if (el.searchResults.hidden) updateSearch();
        else chooseSearch(searchIndex < 0 ? 0 : searchIndex);
      }
    });

    for (const scope of SCOPE_NAMES) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'chip';
      button.dataset.scope = scope;
      button.textContent = scope;
      button.addEventListener('click', function () {
        if (state.scopes.has(scope)) state.scopes.delete(scope);
        else state.scopes.add(scope);
        state.revealedPath = null;
        syncTopbar();
        render();
      });
      el.scopes.appendChild(button);
    }

    el.conflictBadge.className = 'chip';
    el.managedToggle.className = 'chip';
    el.driftToggle.className = 'chip';
    el.expandAll.className = 'chip';
    el.collapseAll.className = 'chip';
    el.expandAll.textContent = '\u229E Expand all';
    el.collapseAll.textContent = '\u229F Collapse all';
    el.expandAll.title = 'Open every node in the enabled scopes';
    el.collapseAll.title = 'Back to the modules and their direct dependencies';
    el.expandAll.addEventListener('click', function () {
      state.revealedPath = null;
      for (const id of model.nodesById.keys()) state.expanded.add(id);
      render();
    });
    el.collapseAll.addEventListener('click', function () {
      state.revealedPath = null;
      state.expanded.clear();
      initialExpansion();
      render();
    });
    el.themeToggle.className = 'chip';
    el.driftToggle.textContent = 'Version drift';
    el.conflictBadge.addEventListener('click', stepConflict);

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

  /** Explains every visual mark on the canvas, so no colour or icon has to be guessed. */
  function buildLegend() {
    const list = el.legendItems;
    if (!list) return;
    function item(key, label) {
      const li = elt('li');
      li.appendChild(key);
      li.appendChild(elt('span', null, label));
      list.appendChild(li);
    }
    function img(src) {
      const image = elt('img', 'key-icon');
      image.src = src;
      image.alt = '';
      return image;
    }
    let outdated = 0;
    for (const n of model.nodesById.values()) if (n.latest && n.latest.newerInSameMajor) outdated++;
    item(elt('span', 'key key-module'), 'Module of this build');
    item(elt('span', 'key key-conflict'), 'Version conflict: a requested version was dropped');
    item(elt('span', 'key key-managed'), 'Version pinned by dependencyManagement');
    item(img(NEWER_DOT), 'Newer release available' + (outdated ? ' (' + outdated + ' artifacts)' : ''));
    if (model.modules.length > 1) item(img(DRIFT_DOT), 'Version differs between modules (Drift on)');
    item(elt('span', 'badge', '1'), 'Conflicts hidden below a closed node');
    item(elt('span', 'badge more', '+N'), 'Dependencies hidden below; click to expand');
  }

  function init() {
    buildTopbar();
    buildLegend();
    cy = cytoscape({
      container: el.cy,
      elements: [],
      layout: { name: 'dagre', rankDir: 'TB', animate: false },
      style: style(PALETTES[effectiveTheme()]),
      wheelSensitivity: 0.2,
      textureOnViewport: true,
      // Draw at the display's real density, or HiDPI and scaled screens stay blurry after every
      // redraw; 2x is enough for crisp text and keeps big expanded graphs fast.
      pixelRatio: Math.min(globalThis.devicePixelRatio || 1, 2)
    });
    depGraph.cy = cy;
    applyTheme();
    syncTopbar();

    cy.on('tap', 'node', function (ev) {
      const id = ev.target.id();
      closeMenu(false);
      state.focused = id;
      toggleExpansion(id);
    });
    cy.on('cxttap', 'node', function (ev) {
      const id = ev.target.id();
      select(id);
      state.focused = id;
      const ori = ev.originalEvent || {};
      openMenu(id, ori.clientX || 0, ori.clientY || 0);
    });
    cy.on('pan zoom resize', function () { paintBadges(badgeCounts); });

    el.cy.tabIndex = 0;
    el.cy.setAttribute('role', 'application');
    el.cy.setAttribute('aria-label', 'Dependency graph');
    el.cy.setAttribute('aria-keyshortcuts', 'ArrowUp ArrowDown ArrowLeft ArrowRight Enter Shift+F10');
    el.cy.setAttribute('aria-describedby', 'cy-help');
    el.cy.addEventListener('contextmenu', function (ev) { ev.preventDefault(); });
    el.cy.addEventListener('focus', function () {
      if (!state.focused || cy.getElementById(state.focused).empty()) focusNode(firstFocusable());
    });
    el.cy.addEventListener('keydown', function (ev) {
      if (ev.key === 'ArrowUp' || ev.key === 'ArrowDown' || ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') {
        ev.preventDefault();
        moveFocus(ev.key);
      } else if (ev.key === 'Enter' || ev.key === ' ' || ev.key === 'Spacebar') {
        ev.preventDefault();
        if (state.focused) toggleExpansion(state.focused);
      } else if (ev.key === 'Escape' && el.menu.hidden && state.selected) {
        ev.preventDefault();
        state.selected = null;
        state.revealedPath = null;
        applySelection();
        renderPanel(null);
      }
    });
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'ContextMenu' || (ev.key === 'F10' && ev.shiftKey)) {
        // Only from the canvas itself, and never over the modal warning or an open menu.
        if (!el.menu.hidden || !el.warning.hidden || ev.target !== el.cy) return;
        const target = state.focused || state.selected;
        if (!target) return;
        ev.preventDefault();
        openMenuForNode(target);
      } else if (ev.key === 'Escape' && !el.menu.hidden) {
        closeMenu(true);
      }
    });
    document.addEventListener('mousedown', function (ev) {
      if (!el.menu.hidden && !el.menu.contains(ev.target)) closeMenu(false);
    });

    depGraph.onSelect = renderPanel;
    initialExpansion();
    const beforeRender = performance.now();
    render(true);
    document.body.dataset.firstRenderMs = String(Math.round(performance.now() - beforeRender));
    clampInitialView();
  }

  // The UMD build registers itself when a global cytoscape is present; this covers the other case.
  if (typeof cytoscape !== 'undefined' && typeof cytoscapeDagre === 'function') {
    cytoscape.use(cytoscapeDagre);
  }

  try {
    init();
    document.body.dataset.ready = 'true';
    document.body.dataset.readyMs = String(Math.round(performance.now()));
  } catch (err) {
    document.body.dataset.error = String((err && err.message) || err);
    el.filterBar.textContent = 'Failed to render the dependency graph: ' + document.body.dataset.error;
  }
})();
