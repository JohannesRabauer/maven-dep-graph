# Interactive dependency graph page: design

Date: 2026-10-22
Status: approved 2026-10-22

## Intent

`dep-graph-maven-plugin` writes one self-contained, interactive HTML page of a build's dependency graph.
A developer opens it after `mvn package` to answer three questions:

1. **What does my build depend on?** Shown as a graph, not a list.
2. **Which version was selected, and why?** Either nearest wins or a managed version.
3. **Where are the version conflicts?**

It must still work for very large multi-module builds: hundreds of modules and thousands of artifacts, all in **one page for the whole build**.

Today `DepGraphMojo` is a placeholder that writes a flat `<ul>` from `project.getArtifacts()`.
That list has no edges, no dropped versions, and no information about managed versions, so it cannot answer any of the three questions.

## Goals

- One HTML file that works offline. It needs no network, no server and no external fonts. JS, CSS and data are all inlined.
- One page per build. In a multi-module build, it covers every module. Single-module projects keep working.
- A graph-first layout (mockup "A"). The graph fills the page, and clicking a node opens a side panel that explains it.
- Version decisions are shown in two separate categories, each with its own colour:
  - **Conflict (red):** nearest wins dropped a requested version because a nearer path asked for a different one.
  - **Managed (violet):** `dependencyManagement` (a BOM or parent) replaced the version a library asked for. This is usually a deliberate pin, so it is kept apart from conflicts and never shown in red.
- Scope switches for compile, runtime, provided, test and system.
- A context menu to narrow the view to part of the graph.
- Latest-version information for each artifact.
- An optional neutral "version drift" view across modules.
- Stays smooth with very large builds.

## Non-goals

- EAR packaging semantics (skinny WARs and similar). Cross-module differences are never red conflicts, see Drift.
- Editing POMs or suggesting fixes.
- License, vulnerability (CVE) or download-size data.
- A live server mode, IDE integration or Gradle support.

## Anti-goals (failure even if it "works")

- The page needs internet access to render.
- Red is used for anything other than conflicts.
- The page freezes or becomes unusable on a big build.
- Nodes are hidden without the user being able to see that a filter is active.
- The build gets noticeably slower and the user has no way to turn off the slow part.

## Constraints

- Java 21, Maven 3.9.x (current plugin POM). Use the Maven Resolver API that Maven 3.9 provides.
- The plugin goal stays `dep-graph:graph`, bound to `package` by default. `depgraph.outputFile` stays.
- `mvn package` run from the top-level project must produce the single page for the whole build.
- Vendored JS libraries must be permissively licensed. Their notices ship with the plugin and are included in the page.

## Approaches considered

| Approach | Trade-off |
|---|---|
| **1. Cytoscape.js + layered (dagre) layout, inlined** (chosen) | A mature MIT library with built-in grouping and collapse/expand. Canvas rendering stays smooth for a few thousand visible nodes, and a top-down layout reads as "who pulls in whom". Costs about 0.5 MB per page, and layout slows down past about 5,000 visible nodes. |
| 2. Sigma.js (WebGL) + force-directed layout | Scales to tens of thousands of nodes and gives the smallest file. The "hairball" layout loses the who-pulls-whom reading, and collapse/expand would be hand-built. |
| 3. Hand-built SVG + D3 | Total control and a tiny file. SVG gets sluggish around 2,000 elements, and everything has to be built from scratch. |

The user picked **1**. Showing only what is expanded keeps the visible graph well below Cytoscape's limits. Its grouping covers the module overview.

## What the user decided

### Page layout (mockup A)

- **Top bar:**
  - project name
  - artifact search
  - scope switches
  - a red "N conflicts" badge
  - a violet "N managed" toggle
  - a "Version drift" toggle
  - filter chips whenever a focus or hide is active
- **Canvas:** the graph fills the rest of the page.
- **Side panel:** opens when a node is clicked.

### Side panel contents

- The full coordinates (`groupId:artifactId`, plus type/classifier if not the default jar), the selected version and the scope.
- **Why this version:** "Managed by `<BOM or parent>`" (violet), "Nearest wins" (red, when a version was dropped), or both.
- **Requested versions:** every version requested for this artifact, each with the path that requested it. Dropped versions are struck through.
- **Paths from root:** every path from a reactor module down to this node, as text.
- **Latest version:** `2.19.2 · latest 2.x: 2.20.1 · latest overall: 3.0.2`, or "not checked" if the lookup was skipped or failed.
- **Drift** (only when the drift view is on): which module resolves which version.

### Conflicts (red)

- **What counts:** only versions dropped by nearest wins, within one module's resolved graph.
- **Both at once:** if a node was both managed and had a version dropped by nearest wins, it is a conflict (red), and the panel shows both reasons.
- **Node and edge styling:** a conflicting node gets a red outline and a warning icon. The dropped requesting edge is dashed red and labelled with the requested version.
- **At every zoom level:** red stays visible. A collapsed module, or a collapsed node, shows a red count if a conflict is hidden inside it.
- **The badge:** the "N conflicts" badge counts conflicts within the currently enabled scopes. Clicking it steps through them one at a time, expanding and centring each.

### Managed (violet)

- A node whose version came from `dependencyManagement` and differs from what at least one path requested gets a violet outline.
- The requesting edge is dashed violet and labelled with the requested version.
- The "N managed" chip in the top bar toggles the violet styling on and off. It is **on** by default and counts within enabled scopes.
- Managed is never counted in the red conflict badge.

### Scopes

- Switches for compile, runtime, provided, test and system. The data for all scopes is always in the page.
- **Defaults:** compile and runtime on. Test, provided and system off.
- **Switching a scope off:** hides artifacts that are reachable only through that scope. An artifact still needed by another enabled scope stays visible.

### Multi-module and opening view

- **Opening view:** a module overview. Reactor modules are **green** nodes, with edges between modules where one depends on another.
- **Expanding:** clicking a module expands its direct external dependencies. Clicking a node expands that node's children.
- **Search:** jumps to any artifact, expanding and highlighting the path to it.
- **Shared artifacts:** an artifact used by several modules appears once, with edges from each module that uses it.

### Context menu

Opened by right-click, or by the keyboard context-menu key or Shift+F10 on the focused node.

- **Show only what this depends on:** the node plus its descendants. Everything else is hidden.
- **Show all paths from root:** every path from reactor modules to this node is highlighted, and everything else is dimmed.
- **Hide this subtree.**
- **Reset view.**

While a focus or hide is active, a chip such as `Filtered: depended on by slf4j-api ✕` stays visible in the top bar.

### Version drift (neutral)

- Off by default, controlled by a top-bar toggle.
- When on, an artifact that resolves to different versions in different modules gets a neutral blue/grey marker, never red.
- The panel lists module → version.
- Drift is never counted as a conflict. If modules are packaged together, one module normally depends on the others, so a real clash already shows up as a red conflict inside that module.

### Latest version

- **When:** looked up at build time. The page itself stays offline.
- **Where from:** the build's own configured repositories, mirrors and credentials.
- **Both numbers:** the panel shows the newest stable release in the same major version **and** the newest stable release overall.
- **Skipping:** offline builds (`mvn -o`) skip the lookup and show "not checked". So does `depgraph.checkLatest=false`.
- **Speed:** lookups must run in parallel. Results are cached for about a day, and the resolver's default daily metadata update policy may already provide this.

## Builder's calls already made (by me, not the user)

- **Node identity:** a node is `groupId:artifactId:version` (plus type/classifier when not the default).
  - The same G:A:V used by several modules is one node.
  - Different resolved versions are different nodes, and the drift view links them.
  - Dropped versions are **not** nodes. They appear as dashed red edges into the winning node, labelled with the requested version.
- **Outdated marker:** a small, non-red marker on the node, shown only when a newer stable version exists **in the same major version**. A newer major version appears only as panel text.
- **What counts as stable:** a version is stable unless it contains (case-insensitive) `SNAPSHOT`, `alpha`, `beta`, `M<n>`, `RC`, `CR` or `preview`.
- **Per-module edges:** every edge records which modules it belongs to, along with its scope, requested version and status (kept, dropped by nearest wins, managed) in each.
  - Expanding a node under a module shows only that module's subgraph.
  - "Paths from root", the red and violet styling, and scope filtering are always computed per module, so the page never shows a combination that exists in no module.
- **Naming the managing source:** the panel names the BOM or parent that supplied a managed version when Maven's model location tracking provides it cheaply. Otherwise it says "Managed by dependencyManagement". Full effective-model analysis is out of scope.
- **Conflict count:** the badge counts distinct (`groupId:artifactId`, winning version, dropped version) triples across the build. The same jackson conflict in 300 modules counts once.
  - Stepping through the conflicts visits each triple once, and the panel lists every module it occurs in.
  - A collapsed module's red count is that module's own number of triples.
- **Coverage and output location:**
  - The page covers the modules in the current reactor, so partial builds (`-pl`, `-rf`, a submodule directory) cover only what was built.
  - It is written once, to the execution-root project's `target/dep-graph.html`, or to `depgraph.outputFile`.
  - Individual modules do not write their own pages.
- **Optional dependencies:** included, drawn with a dotted edge, and marked "optional" in the panel.
- **Theme:** dark and light themes. The page follows the OS `prefers-color-scheme` setting, and a toggle in the top bar overrides it.
  - Palette (from ui-ux-pro-max, "developer tool"): background `#0F172A`, surface `#1B2336`, muted text `#94A3B8`, border `#475569`.
  - Accents:
    - reactor modules: `#22C55E`
    - conflicts: `#EF4444`
    - managed: violet `#A78BFA`
    - newer version in the same major: cyan `#06B6D4`
    - drift: neutral slate blue `#6B7FA8`
  - Light theme: the same accents on a light slate background, at 4.5:1 text contrast or better.
- **Fonts:** system font stacks only, with no web fonts (offline). Monospace for coordinates (`"JetBrains Mono", ui-monospace, Consolas, monospace`) and sans for UI text (`"IBM Plex Sans", system-ui, sans-serif`).
- **Accessibility:**
  - visible keyboard focus
  - context menu reachable by keyboard
  - reduced motion when the OS asks for it
  - no emoji as icons; inline SVG icons instead
- **Performance targets:**
  - The data must handle at least 300 modules and 5,000 distinct G:A:V nodes.
  - The page is interactive within about 2 s on a typical laptop.
  - Layout runs once per expand, with no node-by-node animation.
  - If an action would make more than about 2,000 nodes visible, the page warns before laying them out.
- **Graph library:** Cytoscape.js with dagre and cytoscape-dagre (all MIT). They are vendored as minified files in the plugin's resources, and their license text is included in the page's source.
- **Embedded data:** JSON in a `<script type="application/json">` block, with `</` escaped.
- **Demo:** `demo-project` stays single-module.
  - Multi-module behaviour is verified with plugin integration tests (maven-invoker-plugin).
  - Large-build page performance is verified with a synthetic 300-module / 5,000-node data set, generated by a test and rendered in a browser.

## Left to the builder

- **Collecting the whole build's data:** how the plugin gathers per-module graphs and writes one page at the top-level project. Possible routes are an aggregator goal over the reactor, or per-module collection with the last reactor project writing the page. The constraint is that `mvn package` from the root produces the page and single-module builds still work.
- **Resolver details:** the exact resolver setup for the conflict data. Verbose conflict resolution keeps dropped nodes, and verbose dependency management keeps the versions requested before management.
- **Version lookup:** how latest versions are fetched, e.g. a version-range request over the project's remote repositories, and how parallelism is bounded.
- **Code layout:** the JS/CSS structure and how the page template is assembled.
- **Test strategy details:** within the integration-test constraint above.
