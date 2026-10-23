'use strict';
const test = require('node:test');
const assert = require('node:assert');
const M = require('../../main/resources/dev/rabauer/depgraph/page/graph-model.js');

const compile = new Set(['compile']);
const all = new Set(['compile', 'test']);

function node(id, version) {
  const [groupId, artifactId] = id.split(':');
  return { id: id + ':' + version, groupId, artifactId, version, type: 'jar', classifier: null, module: false, latest: null };
}
function mod(id) {
  return { id, groupId: 'app', artifactId: id, version: '1', type: 'pom', classifier: null, module: true, latest: null };
}
function edge(from, to, module, extra) {
  return Object.assign({ from, to, module, scope: 'compile', optional: false, status: 'KEPT', requestedVersion: null, managedBy: null }, extra);
}
function model(modules, nodes, edges) {
  return M.createModel({ title: 't', modules: modules.map(m => ({ nodeId: m, name: m })), nodes: [...modules.map(mod), ...nodes], edges });
}

test('nodeVisibleIfAnyEnabledScopeReachesIt', () => {
  const x = node('g:x', '1'), y = node('g:y', '1');
  const m = model(['m1'], [x, y], [
    edge('m1', x.id, 'm1', { scope: 'test' }), edge('m1', x.id, 'm1'),
    edge('m1', y.id, 'm1', { scope: 'test' })]);
  const v = M.visibleNodeIds(m, compile, new Set(['m1']), new Set());
  assert.ok(v.has(x.id));
  assert.ok(!v.has(y.id));
});

test('missing scope counts as compile', () => {
  assert.ok(M.edgeEnabled({ scope: null }, compile));
  assert.ok(M.edgeEnabled({}, compile));
  assert.ok(!M.edgeEnabled({ scope: 'test' }, compile));
});

test('conflictTriplesDedupeAcrossModules', () => {
  const a = node('g:a', '2');
  const m = model(['m1', 'm2'], [a], [
    edge('m1', a.id, 'm1', { status: 'DROPPED', requestedVersion: '1' }),
    edge('m2', a.id, 'm2', { status: 'DROPPED', requestedVersion: '1' })]);
  assert.deepStrictEqual(M.conflictTriples(m, compile), [{ ga: 'g:a', winner: a.id, dropped: '1', modules: ['m1', 'm2'] }]);
  assert.strictEqual(M.conflictCountForModule(m, 'm1', compile), 1);
  assert.strictEqual(M.conflictCountForModule(m, 'm3', compile), 0);
});

test('managedNotCountedAsConflict', () => {
  const a = node('g:a', '2');
  const m = model(['m1'], [a], [edge('m1', a.id, 'm1', { status: 'MANAGED', requestedVersion: '1', managedBy: 'bom' })]);
  assert.strictEqual(M.conflictTriples(m, compile).length, 0);
  assert.strictEqual(M.managedCount(m, compile), 1);
  assert.strictEqual(M.managedCount(m, new Set(['test'])), 0);
});

test('collapsedConflictCountsCountsHiddenConflicts', () => {
  const a = node('g:a', '1'), b = node('g:b', '1'), c = node('g:c', '1'), d = node('g:d', '2');
  const m = model(['m1'], [a, b, c, d], [
    edge('m1', a.id, 'm1'), edge(a.id, b.id, 'm1'), edge(b.id, c.id, 'm1'),
    edge(b.id, d.id, 'm1', { status: 'DROPPED', requestedVersion: '1' })]);
  let expanded = new Set(['m1']);
  let v = M.visibleNodeIds(m, compile, expanded, new Set());
  assert.deepStrictEqual([...v].sort(), ['m1', a.id].sort());
  let counts = M.collapsedConflictCounts(m, compile, v, expanded, new Set());
  assert.strictEqual(counts.get(a.id), 1);
  assert.strictEqual(counts.get('m1'), undefined, 'an expanded module gets no badge');
  expanded = new Set(['m1', a.id, b.id]);
  v = M.visibleNodeIds(m, compile, expanded, new Set());
  counts = M.collapsedConflictCounts(m, compile, v, expanded, new Set());
  assert.strictEqual(counts.get(a.id), undefined, 'the conflict edge is on the canvas');
});

test('collapsedConflictCountsIncludesVisibleCollapsedSources', () => {
  // app -> b is on the canvas, but b is collapsed, so b -> t (dropped) is not.
  const b = node('g:b', '1'), t = node('g:t', '2');
  const m = model(['m1'], [b, t], [
    edge('m1', b.id, 'm1'), edge(b.id, t.id, 'm1', { status: 'DROPPED', requestedVersion: '1' })]);
  const expanded = new Set(['m1']);
  const v = M.visibleNodeIds(m, compile, expanded, new Set());
  const counts = M.collapsedConflictCounts(m, compile, v, expanded, new Set());
  assert.strictEqual(counts.get(b.id), 1);
});

test('collapsedConflictCountsStayPerModule', () => {
  // Both modules use shared, but only m1 has a conflict under it.
  const shared = node('g:shared', '1'), t = node('g:t', '2');
  const m = model(['m1', 'm2'], [shared, t], [
    edge('m1', shared.id, 'm1'), edge('m2', shared.id, 'm2'),
    edge(shared.id, t.id, 'm1', { status: 'DROPPED', requestedVersion: '1' })]);
  const expanded = new Set(['m1', 'm2']);
  const v = M.visibleNodeIds(m, compile, expanded, new Set());
  const counts = M.collapsedConflictCounts(m, compile, v, expanded, new Set());
  assert.strictEqual(counts.get(shared.id), 1);
  assert.strictEqual(counts.get('m1'), undefined);
  assert.strictEqual(counts.get('m2'), undefined);
});

test('collapsedConflictCountsGiveCollapsedModulesTheirOwnConflicts', () => {
  const shared = node('g:shared', '1'), t = node('g:t', '2');
  const m = model(['m1', 'm2'], [shared, t], [
    edge('m1', shared.id, 'm1'), edge('m2', shared.id, 'm2'),
    edge(shared.id, t.id, 'm1', { status: 'DROPPED', requestedVersion: '1' })]);
  const expanded = new Set();
  const v = M.visibleNodeIds(m, compile, expanded, new Set());
  const counts = M.collapsedConflictCounts(m, compile, v, expanded, new Set());
  assert.strictEqual(counts.get('m1'), 1);
  assert.strictEqual(counts.get('m2'), undefined, 'm2 has no conflict of its own');
});

test('collapsedConflictCountsDedupeTheSameConflictAcrossModules', () => {
  const shared = node('g:shared', '1'), t = node('g:t', '2');
  const m = model(['m1', 'm2'], [shared, t], [
    edge('m1', shared.id, 'm1'), edge('m2', shared.id, 'm2'),
    edge(shared.id, t.id, 'm1', { status: 'DROPPED', requestedVersion: '1' }),
    edge(shared.id, t.id, 'm2', { status: 'DROPPED', requestedVersion: '1' })]);
  const expanded = new Set(['m1', 'm2']);
  const v = M.visibleNodeIds(m, compile, expanded, new Set());
  const counts = M.collapsedConflictCounts(m, compile, v, expanded, new Set());
  assert.strictEqual(counts.get(shared.id), 1, 'one conflict triple, not one per module');
});

test('ancestorsOfWalksPerModule', () => {
  // a -> b in m1 and b -> t in m2: no module has a path from a to t.
  const a = node('g:a', '1'), b = node('g:b', '1'), t = node('g:t', '1');
  const m = model(['m1', 'm2'], [a, b, t], [
    edge('m1', a.id, 'm1'), edge(a.id, b.id, 'm1'),
    edge('m2', b.id, 'm2'), edge(b.id, t.id, 'm2')]);
  assert.deepStrictEqual([...M.ancestorsOf(m, t.id, compile)].sort(), [t.id, b.id, 'm2'].sort());
});

test('ancestorsOfUnionsOverModules', () => {
  const a = node('g:a', '1'), t = node('g:t', '1');
  const m = model(['m1', 'm2'], [a, t], [
    edge('m1', a.id, 'm1'), edge(a.id, t.id, 'm1'), edge('m2', t.id, 'm2')]);
  assert.deepStrictEqual([...M.ancestorsOf(m, t.id, compile)].sort(), [t.id, a.id, 'm1', 'm2'].sort());
});

test('descendantsWalkPerModule', () => {
  const a = node('g:a', '1'), b = node('g:b', '1'), t = node('g:t', '1');
  const m = model(['m1', 'm2'], [a, b, t], [
    edge('m1', a.id, 'm1'), edge(a.id, b.id, 'm1'),
    edge('m2', b.id, 'm2'), edge(b.id, t.id, 'm2')]);
  assert.deepStrictEqual([...M.descendants(m, a.id, compile)], [b.id]);
});

test('nodeMarkersShowDriftAndNewerTogether', () => {
  const marks = M.nodeMarkers({ dropped: false, managed: false, newer: true, drift: true });
  assert.deepStrictEqual(marks.map(x => x.marker), ['newer', 'drift']);
  const slots = marks.map(x => x.x + '/' + x.y);
  assert.strictEqual(new Set(slots).size, 2, 'the two markers must not share a slot');
});

test('nodeMarkersConflictBeatsManagedInTheSameSlot', () => {
  assert.deepStrictEqual(M.nodeMarkers({ dropped: true, managed: true }).map(x => x.marker), ['conflict']);
  assert.deepStrictEqual(M.nodeMarkers({ managed: true }).map(x => x.marker), ['managed']);
  assert.deepStrictEqual(M.nodeMarkers({}), []);
  assert.deepStrictEqual(M.nodeMarkers({ dropped: true, drift: true }).map(x => x.marker), ['conflict', 'drift']);
});

test('decodesIndexEncodedEdges', () => {
  const a = node('g:a', '1'), b = node('g:b', '2');
  const data = {
    title: 't',
    modules: [{ nodeId: 'm1', name: 'm1' }],
    nodes: [mod('m1'), a, b],
    scopeNames: ['compile', 'test'],
    versions: ['1.0'],
    managedBys: ['com.example:bom:1'],
    edges: [[0, 1, 0, 0, 0], [1, 2, 0, 1, 4 | 2, 0], [0, 2, 0, -1, 1, 0, 0]]
  };
  const m = M.createModel(data);
  assert.deepStrictEqual(m.edges[0], { from: 'm1', to: a.id, module: 'm1', scope: 'compile', optional: false, status: 'KEPT', requestedVersion: null, managedBy: null });
  assert.deepStrictEqual(m.edges[1], { from: a.id, to: b.id, module: 'm1', scope: 'test', optional: true, status: 'DROPPED', requestedVersion: '1.0', managedBy: null });
  assert.deepStrictEqual(m.edges[2], { from: 'm1', to: b.id, module: 'm1', scope: null, optional: false, status: 'MANAGED', requestedVersion: '1.0', managedBy: 'com.example:bom:1' });
  assert.strictEqual(m.droppedEdges.length, 1);
  assert.strictEqual(m.managedEdges.length, 1);
  assert.ok(M.edgeEnabled(m.edges[2], compile), 'a null scope still means compile');
});

test('pathsFromRootListsEveryModulePath', () => {
  const a = node('g:a', '1'), b = node('g:b', '1'), c = node('g:c', '1');
  const m = model(['m1'], [a, b, c], [
    edge('m1', a.id, 'm1'), edge('m1', b.id, 'm1'),
    edge(a.id, c.id, 'm1'), edge(b.id, c.id, 'm1')]);
  assert.deepStrictEqual(M.pathsFromRoot(m, c.id, compile), [['m1', a.id, c.id], ['m1', b.id, c.id]]);
  assert.deepStrictEqual(M.pathsFromRoot(m, 'm1', compile), [['m1']]);
  assert.strictEqual(M.pathsFromRoot(m, c.id, compile, 1).length, 1);
});

test('pathsFromRoot returns [] quickly for unreachable target in layered diamonds', () => {
  const nodes = [], edges = [];
  let prev = ['m1'];
  for (let i = 0; i < 30; i++) {
    const l = node('g:l' + i, '1'), r = node('g:r' + i, '1'), j = node('g:j' + i, '1');
    nodes.push(l, r, j);
    for (const p of prev) edges.push(edge(p, l.id, 'm1'), edge(p, r.id, 'm1'));
    edges.push(edge(l.id, j.id, 'm1'), edge(r.id, j.id, 'm1'));
    prev = [j.id];
  }
  const target = node('g:target', '1');
  nodes.push(target);
  edges.push(edge('m1', target.id, 'm1', { scope: 'test' }));
  const m = model(['m1'], nodes, edges);
  const start = performance.now();
  assert.deepStrictEqual(M.pathsFromRoot(m, target.id, compile), []);
  assert.ok(performance.now() - start < 1000);
});

test('pathsFromRoot reaches far target in layered diamonds with limit', () => {
  const nodes = [], edges = [];
  let prev = 'm1';
  for (let i = 0; i < 30; i++) {
    const l = node('g:l' + i, '1'), r = node('g:r' + i, '1'), j = node('g:j' + i, '1');
    nodes.push(l, r, j);
    edges.push(edge(prev, l.id, 'm1'), edge(prev, r.id, 'm1'), edge(l.id, j.id, 'm1'), edge(r.id, j.id, 'm1'));
    prev = j.id;
  }
  const m = model(['m1'], nodes, edges);
  const start = performance.now();
  const paths = M.pathsFromRoot(m, prev, compile, 5);
  assert.strictEqual(paths.length, 5);
  assert.ok(paths.every(p => p.length === 61 && p[0] === 'm1' && p[60] === prev));
  assert.ok(performance.now() - start < 1000);
});

test('pathsFromRoot handles cycles', () => {
  const a = node('g:a', '1'), b = node('g:b', '1'), c = node('g:c', '1');
  const m = model(['m1'], [a, b, c], [
    edge('m1', a.id, 'm1'), edge(a.id, b.id, 'm1'), edge(b.id, a.id, 'm1'), edge(b.id, c.id, 'm1')]);
  assert.deepStrictEqual(M.pathsFromRoot(m, c.id, compile), [['m1', a.id, b.id, c.id]]);
});

test('pathsFromRoot isolates edges by module', () => {
  const a = node('g:a', '1'), c = node('g:c', '1');
  const m = model(['m1', 'm2'], [a, c], [
    edge('m1', a.id, 'm1'), edge(a.id, c.id, 'm2')]);
  assert.deepStrictEqual(M.pathsFromRoot(m, c.id, compile), []);
});

test('pathsFromRoot honours scope filter', () => {
  const a = node('g:a', '1'), c = node('g:c', '1');
  const m = model(['m1'], [a, c], [
    edge('m1', a.id, 'm1'), edge(a.id, c.id, 'm1', { scope: 'test' })]);
  assert.deepStrictEqual(M.pathsFromRoot(m, c.id, compile), []);
  assert.deepStrictEqual(M.pathsFromRoot(m, c.id, all), [['m1', a.id, c.id]]);
});

test('pathsFromRoot orders shortest first and applies limit', () => {
  const a = node('g:a', '1'), b = node('g:b', '1'), c = node('g:c', '1');
  const m = model(['m1'], [a, b, c], [
    edge('m1', a.id, 'm1'), edge(a.id, b.id, 'm1'), edge(b.id, c.id, 'm1'),
    edge('m1', c.id, 'm1', { status: 'DROPPED', requestedVersion: '0' })]);
  assert.deepStrictEqual(M.pathsFromRoot(m, c.id, compile), [['m1', c.id], ['m1', a.id, b.id, c.id]]);
  assert.deepStrictEqual(M.pathsFromRoot(m, c.id, compile, 1), [['m1', c.id]]);
});

test('hiddenNodeKeepsSharedDescendant', () => {
  const a = node('g:a', '1'), b = node('g:b', '1'), c = node('g:c', '1'), d = node('g:d', '1');
  const m = model(['m1'], [a, b, c, d], [
    edge('m1', a.id, 'm1'), edge('m1', b.id, 'm1'),
    edge(a.id, c.id, 'm1'), edge(a.id, d.id, 'm1'), edge(b.id, c.id, 'm1')]);
  const v = M.visibleNodeIds(m, compile, new Set(['m1', a.id, b.id]), new Set([a.id]));
  assert.ok(v.has(a.id));
  assert.ok(v.has(c.id));
  assert.ok(!v.has(d.id));
});

test('descendants handles cycles and scopes', () => {
  const a = node('g:a', '1'), b = node('g:b', '1');
  const m = model(['m1'], [a, b], [edge('m1', a.id, 'm1'), edge(a.id, b.id, 'm1'), edge(b.id, a.id, 'm1', { scope: 'test' })]);
  assert.deepStrictEqual([...M.descendants(m, a.id, compile)], [b.id]);
  assert.deepStrictEqual([...M.descendants(m, a.id, all)].sort(), [a.id, b.id].sort());
});

test('driftGroupsOnlyMultiVersion', () => {
  const a1 = node('g:a', '1.9'), a2 = node('g:a', '1.10'), b = node('g:b', '1');
  const m = model(['m1', 'm2'], [a1, a2, b], [
    edge('m1', a1.id, 'm1'), edge('m2', a2.id, 'm2'), edge('m1', b.id, 'm1')]);
  const d = M.driftGroups(m);
  assert.deepStrictEqual([...d.keys()], ['g:a']);
  assert.deepStrictEqual(d.get('g:a'), [
    { version: '1.9', nodeId: a1.id, modules: ['m1'] },
    { version: '1.10', nodeId: a2.id, modules: ['m2'] }]);
});

test('mergedEdgeStatusPriority', () => {
  const a = node('g:a', '2');
  const m = model(['m1', 'm2'], [a], [
    edge('m1', a.id, 'm1', { status: 'DROPPED', requestedVersion: '1', optional: true }),
    edge('m1', a.id, 'm1', { status: 'KEPT', optional: true }),
    edge('m2', a.id, 'm2', { status: 'KEPT', optional: true })]);
  const merged = M.mergedEdges(m, new Set(['m1', 'm2', a.id]), compile);
  const e = merged.find(x => x.from === 'm1');
  assert.strictEqual(e.status, 'DROPPED');
  assert.strictEqual(e.optional, true);
  assert.deepStrictEqual(e.requestedVersions, ['1']);
  assert.strictEqual(merged.find(x => x.from === 'm2').status, 'KEPT');
  assert.strictEqual(M.mergedEdges(m, new Set(['m1']), compile).length, 0);
});

test('searchMatchesGroupAndArtifact', () => {
  const j = node('com.fasterxml.jackson.core:jackson-databind', '2.19.2');
  const m = model(['m1'], [j, node('g:other', '1')], []);
  assert.deepStrictEqual(M.search(m, 'JACKSON'), [j.id]);
  assert.deepStrictEqual(M.search(m, ''), []);
  assert.deepStrictEqual(M.search(m, 'm1'), ['m1']);
  assert.deepStrictEqual(M.search(m, '2.19'), []);
  assert.deepStrictEqual(M.search(m, ':jar'), []);
});

test('stepConflictWraps', () => {
  assert.strictEqual(M.nextConflict([{}, {}], 1), 0);
  assert.strictEqual(M.nextConflict([{}, {}], 0), 1);
  assert.strictEqual(M.nextConflict([{}, {}], -1), 0);
  assert.strictEqual(M.nextConflict([], -1), -1);
});

test('perf5000Nodes', () => {
  const modules = [], nodes = [], edges = [];
  for (let i = 0; i < 300; i++) modules.push('m' + i);
  for (let i = 0; i < 4700; i++) nodes.push(node('g' + (i % 1500) + ':a' + (i % 1500), String(i)));
  const ids = [...modules, ...nodes.map(n => n.id)];
  for (let i = 0; i < 15000; i++) {
    const from = i < 4700 ? modules[i % 300] : ids[(i * 7) % ids.length];
    const to = nodes[(i * 31) % nodes.length].id;
    edges.push(edge(from, to, modules[i % 300], i % 9 === 0 ? { status: 'DROPPED', requestedVersion: '0' } : {}));
  }
  const start = performance.now();
  const m = model(modules, nodes, edges);
  M.conflictTriples(m, compile);
  M.visibleNodeIds(m, compile, new Set(m.nodesById.keys()), new Set());
  const ms = performance.now() - start;
  assert.ok(ms < 500, 'took ' + ms + 'ms');
});
