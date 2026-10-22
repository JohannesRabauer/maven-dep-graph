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

test('hiddenConflictCountOnCollapsedNode', () => {
  const a = node('g:a', '1'), b = node('g:b', '1'), c = node('g:c', '1'), d = node('g:d', '2');
  const m = model(['m1'], [a, b, c, d], [
    edge('m1', a.id, 'm1'), edge(a.id, b.id, 'm1'), edge(b.id, c.id, 'm1'),
    edge(b.id, d.id, 'm1', { status: 'DROPPED', requestedVersion: '1' })]);
  let v = M.visibleNodeIds(m, compile, new Set(['m1']), new Set());
  assert.deepStrictEqual([...v].sort(), ['m1', a.id].sort());
  assert.strictEqual(M.hiddenConflictCount(m, a.id, compile, v), 1);
  v = M.visibleNodeIds(m, compile, new Set(['m1', a.id, b.id]), new Set());
  assert.strictEqual(M.hiddenConflictCount(m, a.id, compile, v), 0);
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
