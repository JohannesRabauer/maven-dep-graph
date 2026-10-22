# Interactive Dependency Graph Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `dep-graph:graph` writes one offline, interactive HTML page of the whole reactor's dependency graph. The page shows conflicts, managed versions, scopes, latest versions and drift.

**Architecture:**
- **Java side:** the execution-root project's mojo collects a verbose dependency graph per reactor module with Maven Resolver. It maps those graphs into one model of nodes plus per-module edges and looks up latest versions in parallel. It then inlines JSON data, vendored Cytoscape/dagre, CSS and JS into a single HTML file.
- **Browser side:** a pure logic module (`graph-model.js`, tested with `node --test`) answers every "what is visible / what conflicts / which paths" question. `app.js` renders it with Cytoscape.

**Tech Stack:** Java 21, Maven 3.9.11 plugin API, Maven Resolver 1.9.x (provided by Maven), JUnit 5, maven-invoker-plugin, Cytoscape.js 3.30.x + dagre 0.8.5 + cytoscape-dagre 2.5.0 (MIT), plain ES2020 JS/CSS, Node 22 test runner.

**Spec:** `docs/superpowers/specs/2026-10-22-dep-graph-page-design.md`

## Global Constraints

- **Offline page:** the page needs no network, no server and no external fonts. No `src="http`, `href="http` or `@import url(` may appear in the output.
- **Goal and parameters:**
  - The goal stays `dep-graph:graph` with default phase `package`.
  - `depgraph.outputFile` stays and defaults to `${project.build.directory}/dep-graph.html`.
  - A new `depgraph.checkLatest` parameter defaults to `true`.
- **Output location:** only the execution-root project writes the page. It covers the modules in the current reactor (`session.getProjects()`).
- **Colours:**
  - background `#0F172A`, surface `#1B2336`, muted text `#94A3B8`, border `#475569`
  - modules `#22C55E`, conflicts `#EF4444`, managed `#A78BFA`, newer in same major `#06B6D4`, drift `#6B7FA8`
  - Red is used only for nearest-wins conflicts.
- **Fonts:** monospace `"JetBrains Mono", ui-monospace, Consolas, monospace`; sans `"IBM Plex Sans", system-ui, sans-serif`.
- **What counts as stable:** a version is unstable if it matches (case-insensitive) `SNAPSHOT|alpha|beta|M\d+|RC|CR|preview`.
- **Scope defaults:** compile and runtime on. Provided, test and system off.
- **Performance:**
  - The data must handle 300 modules and 5,000 G:A:V nodes, with the page interactive within about 2 s.
  - Warn before showing more than 2,000 visible nodes.
  - No node-by-node animation.
- **Vendored libraries:** keep their license headers and list them in `dep-graph-maven-plugin/THIRD-PARTY-NOTICES.md`.

## Review Focus

1. **Scope combinations:**
   - A node reachable through both a test and a compile path must stay visible when test is off.
   - A node reachable only through test must disappear.
   - Pinned by `graph-model.test.js › nodeVisibleIfAnyEnabledScopeReachesIt`.
2. **Text that breaks the page:** artifact coordinates or project names containing `</script>`, `<`, `&` or quotes must not break the page. Pinned by `HtmlPageWriterTest.escapesScriptCloseInData` and `escapesTitle`.
3. **Offline builds and failed lookups:**
   - With `mvn -o`, or when the repository has no metadata for an artifact, the build must not fail. The panel shows "not checked".
   - Pinned by `LatestVersionResolverTest.offlineSkipsLookup` and `failedLookupYieldsNotChecked`.
4. **The same conflict in many modules:**
   - It counts once in the badge, and the panel lists every module it occurs in.
   - A collapsed module's red count counts only its own conflicts.
   - Pinned by `graph-model.test.js › conflictTriplesDedupeAcrossModules`.
5. **Reactor modules as dependencies:** a sibling module that is also a dependency must be one green node, not a second external node. Pinned by `DependencyGraphMapperTest.siblingModuleIsSameNodeAndFlaggedModule`.

---

## File Structure

All paths below are under `dep-graph-maven-plugin/` unless stated otherwise.

```
pom.xml                                         (modify: junit, surefire, invoker)
THIRD-PARTY-NOTICES.md                          (create)
src/main/java/dev/rabauer/depgraph/
  DepGraphMojo.java                             (rewrite: wiring only)
  model/GraphModel.java                         (records: whole page data)
  model/EdgeStatus.java                         (enum KEPT, MANAGED, DROPPED)
  model/JsonWriter.java                         (minimal JSON serializer for the model)
  collect/ModuleGraphCollector.java             (verbose resolver collection per MavenProject)
  collect/DependencyGraphMapper.java            (DependencyNode tree -> nodes + edges)
  collect/ManagedSourceLookup.java              (GA -> BOM/parent model id via InputLocation)
  latest/VersionClassifier.java                 (stable check, same-major, latest picks)
  latest/LatestVersionResolver.java             (parallel VersionRangeRequests)
  page/HtmlPageWriter.java                      (assemble single HTML file)
src/main/resources/dev/rabauer/depgraph/page/
  template.html  app.css  app.js  graph-model.js
  vendor/cytoscape.min.js  vendor/dagre.min.js  vendor/cytoscape-dagre.js
src/test/java/dev/rabauer/depgraph/...          (unit tests mirroring main)
src/test/js/graph-model.test.js                 (node --test)
src/it/single-module/  src/it/multi-module/     (invoker ITs)
../README.md                                    (modify: multi-module usage, parameters)
```

---

### Task 1: Data model and JSON serialization

**Files:**
- Create: `model/GraphModel.java`, `model/EdgeStatus.java`, `model/JsonWriter.java`
- Modify: `pom.xml`: add `org.junit.jupiter:junit-jupiter:5.11.4` (test) and `maven-surefire-plugin:3.5.2`
- Test: `src/test/java/dev/rabauer/depgraph/model/JsonWriterTest.java`

**Interfaces:**
- Produces (all in `dev.rabauer.depgraph.model`):

  ```java
  public enum EdgeStatus { KEPT, MANAGED, DROPPED }

  public record GraphModel(String title, List<Module> modules, List<Node> nodes, List<Edge> edges) {
    public static String nodeId(String g, String a, String type, String classifier, String v);
    public record Module(String nodeId, String name) {}
    public record Node(String id, String groupId, String artifactId, String version,
                       String type, String classifier, boolean module, Latest latest) {}
    // latest == null means "not checked"
    public record Latest(String latestSameMajor, String latestOverall, boolean newerInSameMajor) {}
    public record Edge(String from, String to, String module, String scope, boolean optional,
                       EdgeStatus status, String requestedVersion, String managedBy) {}
  }

  public final class JsonWriter { public static String toJson(GraphModel m); }
  ```

- **Node id rule:** `g:a:v` when type is `jar` and classifier is empty, otherwise `g:a:type:classifier:v`.
- **Edge fields:**
  - `module` is the module node id.
  - `requestedVersion` is non-null only for MANAGED and DROPPED.
  - `managedBy` is non-null only for MANAGED.

- [ ] **Step 1: Write failing tests:**
  - `nodeIdOmitsDefaultJarType`: `nodeId("g","a","jar","","1")` equals `"g:a:1"`; `nodeId("g","a","test-jar","tests","1")` equals `"g:a:test-jar:tests:1"`.
  - `serializesNullLatestAsNull`: the output contains `"latest":null`.
  - `escapesControlAndQuotes`: a title of `a"b\c` followed by a newline serializes as `"a\"b\\c\n"`.
  - `enumsAsNames`: the output contains `"status":"DROPPED"`.
- [ ] **Step 2:** Run `mvn -q -f dep-graph-maven-plugin/pom.xml test -Dtest=JsonWriterTest`. It should FAIL to compile.
- [ ] **Step 3:** Implement the records and `JsonWriter`. Write a hand-written `StringBuilder` serializer and add no JSON library. Escape `"`, `\`, and control characters below 0x20 as `\uXXXX`, except `\n`, `\r` and `\t`.
- [ ] **Step 4:** Run the same command. It should PASS.
- [ ] **Step 5:** Commit: `feat(model): graph model records and JSON writer`.

### Task 2: Map a verbose resolver graph to nodes and edges

**Files:**
- Create: `collect/DependencyGraphMapper.java`, `collect/ManagedSourceLookup.java`
- Test: `src/test/java/dev/rabauer/depgraph/collect/DependencyGraphMapperTest.java`. It builds trees by hand with `org.eclipse.aether.graph.DefaultDependencyNode`; resolver API and util are on the test classpath via provided `maven-core`.

**Interfaces:**
- Consumes: Task 1 records and `GraphModel.nodeId`.
- Produces:

  ```java
  public interface ManagedSourceLookup {
    String sourceOf(String groupId, String artifactId);          // null if unknown
    static ManagedSourceLookup fromProject(MavenProject p);
  }
  public final class DependencyGraphMapper {
    public DependencyGraphMapper(Set<String> reactorNodeIds);
    /** Adds the subtree of one module's collection root (root.getDependency() == null). */
    public void addModuleGraph(String moduleNodeId, DependencyNode root, ManagedSourceLookup managed);
    public Map<String, GraphModel.Node> nodes();   // latest == null at this stage
    public List<GraphModel.Edge> edges();
  }
  ```

- **Mapping rules:**
  - **Parent:** the parent id is `moduleNodeId` for the root's children, otherwise the parent's node id.
  - **DROPPED:** the child has `getData().get(ConflictResolver.NODE_DATA_WINNER)` set to a `DependencyNode` winner. The edge goes to the winner's id, with `requestedVersion` set to the loser's version. Do not create a node for the loser and do not recurse into it.
  - **MANAGED:** otherwise, if `DependencyManagerUtils.getPremanagedVersion(child)` is non-null and differs from the child's version, the edge is MANAGED with `requestedVersion` set to the premanaged version. `managedBy` is `managed.sourceOf(g,a)`, falling back to the literal `"dependencyManagement"`.
  - **KEPT:** everything else.
  - **Scope and optional:** taken from `child.getDependency()`.
  - **Repeated edges:** add each `(from,to,module)` edge once, and recurse into each node id once per module. Use an iterative traversal.
  - **Modules:** a node whose id is in `reactorNodeIds` gets `module=true`.
- `fromProject` reads `p.getDependencyManagement().getDependencies()`. For each dependency, `d.getLocation("version")` → `getSource().getModelId()`. Any null along the way gives null.

- [ ] **Step 1: Write failing tests:**
  - `keptEdgeFromModuleRoot`: root → `g:a:1` yields exactly `Edge(module, "g:a:1", module, "compile", false, KEPT, null, null)`.
  - `droppedEdgePointsToWinnerWithRequestedVersion`: the loser `x:y:1.0` has its winner set to the node `x:y:2.0`, giving edge `to="x:y:2.0"`, `status=DROPPED`, `requestedVersion="1.0"`, and `nodes()` has no key `"x:y:1.0"`.
  - `managedEdgeCarriesPremanagedVersionAndSource`: premanaged `3.14.0` and actual `3.17.0`, with lookup returning `"org.springframework.boot:spring-boot-dependencies:4.1.1"`, give MANAGED with `requestedVersion="3.14.0"` and that `managedBy`.
  - `managedSourceFallsBackToDependencyManagement`: when the lookup returns null, `managedBy` is `"dependencyManagement"`.
  - `siblingModuleIsSameNodeAndFlaggedModule`: when a child's id is in `reactorNodeIds`, its node has `module=true`, and after two `addModuleGraph` calls `nodes()` holds that id once.
  - `sharedNodeHasEdgesPerModule`: modules m1 and m2 both depending on `g:a:1` give one node and two edges with `module` values `m1` and `m2`.
  - `cycleDoesNotRecurseForever`: a node that is its own descendant terminates and yields each edge once.
- [ ] **Step 2:** Run `mvn -q -f dep-graph-maven-plugin/pom.xml test -Dtest=DependencyGraphMapperTest`. It should FAIL.
- [ ] **Step 3:** Implement per the rules above.
- [ ] **Step 4:** Run it again. It should PASS.
- [ ] **Step 5:** Commit: `feat(collect): map verbose dependency graphs to nodes and per-module edges`.

### Task 3: Latest-version lookup

**Files:**
- Create: `latest/VersionClassifier.java`, `latest/LatestVersionResolver.java`
- Test: `latest/VersionClassifierTest.java`, `latest/LatestVersionResolverTest.java`. `RepositorySystem` is a `java.lang.reflect.Proxy` stub that answers only `resolveVersionRange` and counts calls.

**Interfaces:**
- Produces:

  ```java
  public final class VersionClassifier {
    public static boolean isStable(String v);
    public static String major(String v);   // leading digits, "" if none
    /** stableAscending may be null -> returns null ("not checked"). */
    public static GraphModel.Latest classify(String current, List<String> stableAscending);
  }
  public final class LatestVersionResolver {
    public LatestVersionResolver(RepositorySystem system, RepositorySystemSession session,
                                 List<RemoteRepository> repos, int threads);
    /** key "g:a" -> stable versions ascending; value null = not checked. Never throws for lookup failures. */
    public Map<String, List<String>> resolve(Set<String> groupArtifacts);
  }
  ```

- **How `classify` decides:**
  - `latestOverall` is the last element of the list.
  - `latestSameMajor` is the last element with `major(v).equals(major(current))`, or null.
  - `newerInSameMajor` is `latestSameMajor != null` and greater than `current`. Compare via `new GenericVersionScheme().parseVersion(...)`.
- **Lookup:** one `VersionRangeRequest` per GA, with artifact `DefaultArtifact(g, a, "jar", "[0,)")` and the given repos. Filter the results with `isStable`.
- **Offline:** if `session.isOffline()`, return every GA mapped to null and make no calls.
- **Threading:** run on `Executors.newFixedThreadPool(threads)`. Any exception for a GA maps that GA to null.

- [ ] **Step 1: Write failing tests:**
  - `isStable`: false for `2.0.0-SNAPSHOT`, `1.0.0-alpha1`, `3.0.0-M2`, `3.0.0-RC1`, `5.0.0.CR1`, `1.0.0-preview`, `2.0-beta`; true for `2.19.2` and `1.2.3.Final`.
  - `classifyPicksSameMajorAndOverall`: `classify("2.19.2", [2.17.0, 2.19.2, 2.20.1, 3.0.2])` equals `Latest("2.20.1","3.0.2",true)`.
  - `classifyUpToDate`: `classify("3.0.2", same list)` equals `Latest("3.0.2","3.0.2",false)`.
  - `classifyNullIsNotChecked`: `classify("1.0", null)` is null.
  - `offlineSkipsLookup`: an offline session gives all values null and the stub records zero calls.
  - `failedLookupYieldsNotChecked`: a stub throwing `VersionRangeResolutionException` for `g:bad` gives null for `g:bad`, while `g:good` gets its stable list.
- [ ] **Step 2:** Run `mvn -q -f dep-graph-maven-plugin/pom.xml test -Dtest='VersionClassifierTest,LatestVersionResolverTest'`. It should FAIL.
- [ ] **Step 3:** Implement as described.
- [ ] **Step 4:** Run it again. It should PASS.
- [ ] **Step 5:** Commit: `feat(latest): parallel latest-version lookup and classification`.

### Task 4: Single-file HTML page writer with vendored libraries

**Files:**
- Create: `page/HtmlPageWriter.java`, `resources/.../page/template.html`, an initial empty `app.css`, `app.js` and `graph-model.js` (filled in Tasks 6–8), `vendor/*`, and `THIRD-PARTY-NOTICES.md`
- Test: `page/HtmlPageWriterTest.java`

**Interfaces:**
- Consumes: `JsonWriter.toJson`.
- Produces: `public final class HtmlPageWriter { public static String render(GraphModel m) throws IOException; }`
- **Template placeholders:**
  - `{{TITLE}}`: HTML-escaped.
  - `/*{{CSS}}*/`
  - `/*{{VENDOR}}*/`: cytoscape, then dagre, then cytoscape-dagre, joined with `;\n`.
  - `/*{{MODEL}}*/`: `graph-model.js`.
  - `/*{{APP}}*/`
  - `{{DATA}}`: inside `<script type="application/json" id="dep-graph-data">`, with every `</` replaced by `<\/`.
- Resources are loaded from the classpath under `dev/rabauer/depgraph/page/`, as UTF-8.
- **Element IDs** the template must contain, which later tasks rely on:
  - `#topbar`, `#search`, `#scopes`, `#conflict-badge`, `#managed-toggle`, `#drift-toggle`, `#theme-toggle`
  - `#filter-bar`, `#cy`, `#panel` (hidden), `#context-menu` (hidden), `#warning-dialog` (hidden)

- [ ] **Step 1: Download the vendored libraries** into `src/main/resources/dev/rabauer/depgraph/page/vendor/`:
  - `https://unpkg.com/cytoscape@3.30.4/dist/cytoscape.min.js`
  - `https://unpkg.com/dagre@0.8.5/dist/dagre.min.js`
  - `https://unpkg.com/cytoscape-dagre@2.5.0/cytoscape-dagre.js`

  Make sure each file starts with a license comment, prepending the MIT notice if it doesn't. Write `THIRD-PARTY-NOTICES.md` with name, version, URL and license for each.
- [ ] **Step 2: Write failing tests:**
  - `inlinesEverythingNoExternalRefs`: the output contains no `src="http`, `href="http` or `@import url(`, and contains `cytoscape` and `id="dep-graph-data"`.
  - `escapesScriptCloseInData`: a node artifactId of `x</script><b>` makes the data block contain `x<\/script><b>`. The text between `id="dep-graph-data">` and the next `</script>` must parse as JSON with that artifactId restored.
  - `escapesTitle`: a title of `a<b&c` renders as `<title>Dependency Graph: a&lt;b&amp;c</title>`.
- [ ] **Step 3:** Run `mvn -q -f dep-graph-maven-plugin/pom.xml test -Dtest=HtmlPageWriterTest`. It should FAIL.
- [ ] **Step 4:** Implement `render` and the `template.html` skeleton.
- [ ] **Step 5:** Run it again. It should PASS.
- [ ] **Step 6:** Commit: `feat(page): single-file HTML writer with vendored Cytoscape and dagre`.

### Task 5: Mojo wiring, reactor collection and integration tests

**Files:**
- Create: `collect/ModuleGraphCollector.java`, `src/it/single-module/{pom.xml,verify.groovy}`, and `src/it/multi-module/{pom.xml,a/pom.xml,b/pom.xml,app/pom.xml,verify.groovy}`
- Rewrite: `DepGraphMojo.java`
- Modify: `pom.xml`: add `maven-invoker-plugin:3.9.0` with:
  - `cloneProjectsTo=${project.build.directory}/it`
  - `postBuildHookScript=verify`
  - `goals=package`
  - executions `install` and `run`
- Modify: `../README.md`

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces:

  ```java
  public final class ModuleGraphCollector {
    public ModuleGraphCollector(RepositorySystem system, RepositorySystemSession baseSession);
    /** Verbose collection of p's declared dependencies (all scopes) with p's dependencyManagement. */
    public DependencyNode collect(MavenProject p) throws DependencyCollectionException;
  }
  ```

- **Collector details:**
  - Copy the session with `new DefaultRepositorySystemSession(baseSession)`.
  - Set `ConflictResolver.CONFIG_PROP_VERBOSE` to `ConflictResolver.Verbosity.STANDARD` and `DependencyManagerUtils.CONFIG_PROP_VERBOSE` to `true`.
  - Build a `CollectRequest` with:
    - root artifact `RepositoryUtils.toArtifact(p.getArtifact())`
    - dependencies `p.getDependencies()`, converted with `RepositoryUtils.toDependency(d, session.getArtifactTypeRegistry())`
    - managed dependencies from `p.getDependencyManagement()`, converted the same way when present
    - repositories `p.getRemoteProjectRepositories()`
- **Mojo details:**
  - Annotate with `@Mojo(name="graph", defaultPhase=PACKAGE, threadSafe=true)` and drop `requiresDependencyResolution`.
  - Inject:
    - `@Parameter(defaultValue="${session}", readonly=true) MavenSession session`
    - `@Component RepositorySystem repositorySystem`
    - the existing `project` and `outputFile`
    - `@Parameter(property="depgraph.checkLatest", defaultValue="true") boolean checkLatest`
  - If `!project.isExecutionRoot()`, log at debug level and return.
  - Otherwise, the reactor ids are `GraphModel.nodeId(g,a,"jar","",v)` for each `session.getProjects()`. Each module's `Module` name is its `artifactId`.
  - For each project, call `mapper.addModuleGraph(id, collector.collect(p), ManagedSourceLookup.fromProject(p))`.
  - **Latest versions:** if `checkLatest`, call `new LatestVersionResolver(repositorySystem, session.getRepositorySession(), project.getRemoteProjectRepositories(), 8).resolve(...)` over the GAs of all non-module nodes. Each node gets `VersionClassifier.classify(node.version(), result.get(ga))`. Module nodes, and every node when `checkLatest` is false, get null.
  - `title` is the execution root's `artifactId`. Write the page with `Files.writeString` after creating the directories.
  - Log `Dependency graph written to <file> (<modules> modules, <nodes> artifacts)`.
- **IT fixtures** (they need network access to Maven Central):
  - **single-module:**
    - `org.apache.commons:commons-text:1.12.0`, whose transitive `commons-lang3` 3.14.0 is pinned to `3.17.0` by `dependencyManagement`, giving MANAGED
    - a direct `org.slf4j:slf4j-api:2.0.16` plus `ch.qos.logback:logback-classic:1.4.14`, which transitively requests 2.0.7, giving DROPPED
    - `junit:junit:4.13.2` in test scope
  - **multi-module:**
    - the root `pom` aggregator declares the plugin in `<build><plugins>`
    - modules `a` (`commons-lang3:3.14.0`) and `b` (`commons-lang3:3.17.0`)
    - module `app`, which depends on `a` and `b`
- **`verify.groovy`:**
  - **single-module:** checks `target/dep-graph.html` exists, contains `"status":"MANAGED"`, `"status":"DROPPED"` and `"scope":"test"`, and contains no `src="http`.
  - **multi-module:** checks the root `target/dep-graph.html` exists, `a/target/dep-graph.html` does **not**, the page contains the node ids of `a`, `b` and `app`, and an edge whose `"from"` is app's id and `"to"` is a's id.

- [ ] **Step 1:** Write both IT fixtures and their `verify.groovy` scripts.
- [ ] **Step 2:** Run `mvn -f dep-graph-maven-plugin/pom.xml verify`. Both ITs should FAIL.
- [ ] **Step 3:** Implement `ModuleGraphCollector` and the rewritten `DepGraphMojo`.
- [ ] **Step 4:** Run `mvn -f dep-graph-maven-plugin/pom.xml verify`. All unit tests and both ITs should PASS.
- [ ] **Step 5:** Update `README.md`:
  - declare the plugin in the root POM of a multi-module build
  - the page is written to the root's `target/dep-graph.html`
  - `-Ddepgraph.checkLatest=false`
  - offline builds skip the lookup
- [ ] **Step 6:** Commit: `feat: collect whole reactor and write one page from the execution root`.

### Task 6: Page logic module (`graph-model.js`)

**Files:**
- Modify: `src/main/resources/dev/rabauer/depgraph/page/graph-model.js`
- Test: `src/test/js/graph-model.test.js`

**Interfaces:**
- Consumes: the JSON shape from Task 1.
- Produces a UMD-style module (`globalThis.DepGraphModel`, plus `module.exports` when defined) with these functions:

  ```js
  createModel(data) -> model     // indexes: nodesById, outEdges[nodeId], inEdges[nodeId], moduleIds
  edgeEnabled(edge, scopes /*Set<string>*/) -> boolean
  visibleNodeIds(model, scopes, expanded /*Set*/, hidden /*Set*/) -> Set<string>
  conflictTriples(model, scopes) -> [{ga, winner, dropped, modules: string[]}]
  conflictCountForModule(model, moduleId, scopes) -> number
  managedCount(model, scopes) -> number          // distinct (to, requestedVersion) over MANAGED edges
  hiddenConflictCount(model, nodeId, scopes, visible /*Set*/) -> number
  pathsFromRoot(model, nodeId, scopes, limit = 50) -> string[][]
  descendants(model, nodeId, scopes) -> Set<string>
  driftGroups(model) -> Map<string /*g:a*/, [{version, nodeId, modules: string[]}]>
  mergedEdges(model, visible, scopes) -> [{from, to, status, optional, requestedVersions: string[], modules: string[]}]
  search(model, query, limit = 20) -> string[]   // case-insensitive substring on "g:a"
  nextConflict(triples, currentIndex) -> number  // wraps; -1 -> 0
  ```

- **How `visibleNodeIds` works:**
  1. Start from all module nodes.
  2. Add the targets of the enabled-scope out-edges of each visible node in `expanded`.
  3. Repeat until nothing changes.
  4. A node in `hidden` stays visible itself but contributes no children. Its descendants stay visible only if reachable another way.
- **`conflictTriples`:** DROPPED edges in enabled scopes, deduplicated by (`g:a` of `to`, `to` version, `requestedVersion`). `modules` is the sorted distinct `edge.module`.
- **`hiddenConflictCount`:** DROPPED triples on edges reachable below `nodeId` (enabled scopes) whose `from` is not in `visible`.
- **`mergedEdges`:** status priority DROPPED > MANAGED > KEPT. `optional` is true only if every merged edge is optional.
- **Traversal:** everything is iterative, with no recursion.

- [ ] **Step 1: Write failing tests** (run with `node --test`), using small inline fixtures:
  - `nodeVisibleIfAnyEnabledScopeReachesIt`: X is reachable via a test edge and a compile edge, so X is visible with `{compile}`. Y is reachable only via test, so Y is not.
  - `conflictTriplesDedupeAcrossModules`: the same DROPPED edge in m1 and m2 gives one triple with `modules = ['m1','m2']`. `conflictCountForModule(m1)` is 1.
  - `managedNotCountedAsConflict`: a MANAGED-only fixture gives `conflictTriples` length 0 and `managedCount` 1.
  - `hiddenConflictCountOnCollapsedNode`: with collapsed A and a DROPPED edge two levels below, the count is 1. After expanding down to it, the count is 0.
  - `pathsFromRootListsEveryModulePath`: a diamond gives two paths.
  - `hiddenNodeKeepsSharedDescendant`: hiding A keeps C visible when C is also reached via B.
  - `driftGroupsOnlyMultiVersion`: only GAs with more than one version appear.
  - `mergedEdgeStatusPriority`: DROPPED in m1 and KEPT in m2 merge to `DROPPED`.
  - `searchMatchesGroupAndArtifact`: `"jackson"` finds `com.fasterxml.jackson.core:jackson-databind:2.19.2`.
  - `stepConflictWraps`: `nextConflict([t1,t2], 1)` is 0.
  - `perf5000Nodes`: a synthetic model with 300 modules, 5,000 nodes and about 15,000 edges. `createModel` + `conflictTriples` + `visibleNodeIds` with all nodes expanded finish in under 500 ms.
- [ ] **Step 2:** Run `node --test dep-graph-maven-plugin/src/test/js/`. It should FAIL.
- [ ] **Step 3:** Implement the functions.
- [ ] **Step 4:** Run it again. It should PASS.
- [ ] **Step 5:** Commit: `feat(page): pure graph logic for visibility, conflicts, paths and drift`.

### Task 7: Graph canvas, top bar, scopes, theme and performance guard

**Files:**
- Modify: `app.js`, `app.css`, `template.html`
- Test: `src/test/java/dev/rabauer/depgraph/page/SyntheticPageTest.java`. It writes `target/synthetic-dep-graph.html` from a generated `GraphModel` with 300 modules, 5,000 nodes, about 15,000 edges, 40 DROPPED, 200 MANAGED and 60 drift GAs. It asserts the file exists and is under 5 MB.

**Interfaces:**
- Consumes: `DepGraphModel` (Task 6) and the element IDs (Task 4).
- Produces, for Task 8:

  ```js
  window.depGraph = { cy, model, state, render(), select(nodeId), reveal(nodeId) }
  state = { scopes: Set, expanded: Set, hidden: Set,
            focus: null | { kind: 'descendants' | 'paths', nodeId },
            showManaged: true, showDrift: false, theme: 'auto' | 'dark' | 'light', selected: null | string }
  ```

  `reveal(nodeId)` expands along `pathsFromRoot(...)[0]`, renders, selects and centres the node.

**Behaviour:**
- **Load:** parse the data from `#dep-graph-data` with `DepGraphModel.createModel`. Create the Cytoscape instance in `#cy` with `layout: { name: 'dagre', rankDir: 'TB', animate: false }`.
- **`render()`:**
  - recomputes `visibleNodeIds` and `mergedEdges`, applying `state.focus`:
    - `descendants`: intersect with `descendants` plus the node itself
    - `paths`: everything stays visible, and nodes off the paths get opacity 0.25
  - diffs the result into `cy` (add and remove, not rebuild) and runs layout on the visible set only
  - if a pending action would exceed 2,000 visible nodes, shows `#warning-dialog` with "This shows N artifacts and may be slow. Continue?" and applies the action only on confirm
- **Node styles:**
  - module: fill `#22C55E` with dark text
  - external: surface fill with a `#475569` border
  - a node with an incoming visible DROPPED edge: border `#EF4444` 2.5px plus a warning-triangle SVG data-URI icon
  - otherwise, a node with an incoming MANAGED edge and `showManaged`: border `#A78BFA` plus a diamond icon
  - `latest.newerInSameMajor`: a cyan `#06B6D4` corner dot
  - drift member with `showDrift`: a `#6B7FA8` corner dot
  - a collapsed node with `hiddenConflictCount > 0`: a red count badge (secondary label)
- **Edge styles:**
  - DROPPED: dashed `#EF4444`, labelled `wants <v>`
  - MANAGED (with `showManaged`): dashed `#A78BFA`, labelled `wants <v>`
  - optional: dotted
  - others: `#64748B` with arrowheads
- **Top bar:**
  - title and `N modules · M artifacts`
  - five scope chips (compile, runtime, provided, test, system) with `aria-pressed`, compile and runtime on by default
  - `#conflict-badge` showing `▲ N conflicts`, plus `#managed-toggle` showing `◆ N managed`, both recomputed on scope change
  - `#drift-toggle`
  - `#theme-toggle`, cycling auto → dark → light
- **Interaction:** clicking a node toggles it in `expanded` (modules and external nodes alike), then calls `render()` and `select(id)`.
- **Theme:** CSS custom properties for dark and light. `auto` follows `prefers-color-scheme`. Light uses the same accents on `#F8FAFC` with `#0F172A` text, at a contrast of 4.5:1 or better.
- **Motion:** under `prefers-reduced-motion`, there are no viewport animations; otherwise, centring animates for 200 ms.

- [ ] **Step 1:** Write `SyntheticPageTest`. Run `mvn -q -f dep-graph-maven-plugin/pom.xml test -Dtest=SyntheticPageTest`. It should PASS and produce the file.
- [ ] **Step 2:** Implement the behaviour above in `app.js` and `app.css`.
- [ ] **Step 3: Manual check.** Open `dep-graph-maven-plugin/target/synthetic-dep-graph.html` in the browser canvas.
  - The module overview appears within about 2 s.
  - Expanding a module lays out without animation.
  - Toggling `test` changes the badge counts.
  - Expanding past 2,000 visible nodes prompts the warning.
  - The theme toggle switches between dark and light.
  - No network requests appear.
- [ ] **Step 4: Demo check.** Run `mvn -q -f dep-graph-maven-plugin/pom.xml install`, then `mvn -q -f demo-project/pom.xml package`. Open `demo-project/target/dep-graph.html` and check that the green root and the Spring Boot dependencies render, and that managed nodes are violet.
- [ ] **Step 5:** Commit: `feat(page): Cytoscape canvas, scope switches, theme and size guard`.

### Task 8: Side panel, context menu, search, conflict stepping, drift and filter chips

**Files:**
- Modify: `app.js`, `app.css`

**Interfaces:**
- Consumes: `window.depGraph` (Task 7) and `DepGraphModel.search`, `nextConflict`, `pathsFromRoot`, `driftGroups` and `conflictTriples` (Task 6).

**Behaviour:**
- **Panel (`#panel`):** shown when `state.selected` is set, with a close button. Contents: group in muted mono, artifact in bold mono, then version, status pill and scope. Then these sections:
  - **Why this version:** `Managed by <managedBy>` (violet) and/or `Nearest wins` (red), taken from the node's incoming edges. Otherwise `Only version requested`.
  - **Requested versions:** one row per distinct (requested-or-actual version, parent artifactId). Overridden rows are struck through: red for DROPPED, violet for MANAGED. Each row lists its modules when there is more than one.
  - **Paths from root (N):** from `pathsFromRoot`, shown as `a → b → c` using artifactIds. If the limit of 50 is reached, show "+ more".
  - **Latest version:** `latest <major>.x: <v>` and `latest overall: <v>`, or `not checked` when `latest` is null.
  - **Version drift** (only with `showDrift` on and the GA in `driftGroups`): rows of module → version.
- **Context menu (`#context-menu`):** opened by right-click on a node, or by the `ContextMenu` key or `Shift+F10` on the selected node. Arrow keys move, Enter activates, Esc closes, and focus returns to the canvas afterwards. Items:
  - "Show only what this depends on" sets `focus={kind:'descendants', nodeId}` and expands all descendants (subject to the 2,000-node guard).
  - "Show all paths from root" sets `focus={kind:'paths', nodeId}` and expands along every path.
  - "Hide this subtree" adds the node to `hidden`.
  - "Reset view" clears `focus`, `hidden` and `expanded`.
- **Filter bar (`#filter-bar`):** shows one chip per active filter, e.g. `Filtered: depended on by <artifactId> ✕`, `Filtered: paths to <artifactId> ✕`, or `Hidden: <artifactId> subtree ✕`. ✕ removes that filter and re-renders. The bar is hidden when there are no filters.
- **Search (`#search`):** a dropdown of up to 20 `search` results, navigable with arrow keys and Enter. Choosing a result calls `reveal(id)`.
- **Conflict badge:** each click moves to `nextConflict(triples, i)` and calls `reveal(winnerId)`.
- **Keyboard:** all controls get a visible `:focus-visible` outline in `#22C55E`. Icons are inline SVG, never emoji.

- [ ] **Step 1:** Implement the behaviour above.
- [ ] **Step 2:** Run `node --test dep-graph-maven-plugin/src/test/js/` and `mvn -f dep-graph-maven-plugin/pom.xml verify`. Both should PASS.
- [ ] **Step 3: Manual check** on `dep-graph-maven-plugin/target/it/single-module/target/dep-graph.html`, `.../it/multi-module/target/dep-graph.html` and the demo page:
  - The panel shows the managed source and a struck-through `3.14.0` for `commons-lang3`, and a red `2.0.7` for `slf4j-api`.
  - The context menu works by mouse and by Shift+F10.
  - Filter chips appear and clear.
  - Search jumps to `commons-lang3`.
  - The conflict badge steps through conflicts and wraps.
  - The drift toggle shows `commons-lang3` 3.14.0 / 3.17.0 in the multi-module page.
- [ ] **Step 4:** Commit: `feat(page): side panel, context menu, search, conflict stepping and drift`.
