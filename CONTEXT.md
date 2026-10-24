# dep-graph-maven-plugin

A Maven plugin that renders a build's resolved dependency tree as one interactive page, so a developer can see why Maven picked each version.

## Version resolution

**Conflict**:
A requested version that Maven's nearest-wins mediation dropped in favour of another version of the same artifact.
_Avoid_: clash, mismatch, dropped edge (in user-facing text)

**Managed override**:
A requested version replaced by a `dependencyManagement` pin from a BOM or parent. Never a conflict.
_Avoid_: managed conflict, pin conflict

**Exclusion**:
An artifact removed from the tree by an `<exclusion>` on a dependency; shown as a version-less ghost node, one per exclusion as written (wildcards stay a single `*:*` or `group:*` node).
_Avoid_: excluded conflict, missing dependency

**Version variant**:
The non-numeric suffix family of a version (`-android`, `-jdk11`, `-groovy-4.0`); `.Final`, `.RELEASE` and Guava's `-jre` count as no suffix. Newer releases are only compared within the same variant.
_Avoid_: flavor, classifier (a different Maven concept)

## Build

**Module**:
A project in the current Maven reactor; drawn as a green node.
_Avoid_: subproject, child

**Writer project**:
The single reactor project that writes the page: the execution root, else the last project built. Only its `skip` setting counts.
_Avoid_: aggregator, root module
