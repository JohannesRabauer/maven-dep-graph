# maven-dep-graph

A Maven plugin that writes one interactive HTML page of a project's dependency graph during the build.
Built live with Pasha Finkelshteyn at the JUG Oberpfalz live coding session
"From Design to Spec to Code: Building a Real UI With AI Agents" (2026-10-22).

## Layout

| Folder | What it is |
|---|---|
| `dep-graph-maven-plugin/` | The plugin (goal `dep-graph:graph`, bound to `package`) |
| `demo-project/` | An independent project that uses the plugin |

The two projects are deliberately not a multi-module build: the demo consumes the plugin
the way any other user would, from the local Maven repository.

## Try it

```bash
mvn -f dep-graph-maven-plugin/pom.xml install
mvn -f demo-project/pom.xml package
```

Then open `demo-project/target/dep-graph.html`.
