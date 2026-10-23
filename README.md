# maven-dep-graph

A Maven plugin that writes one interactive HTML page of a project's dependency graph during the build.
Built live with Pasha Finkelshteyn at the JUG Oberpfalz live coding session
"From Design to Spec to Code: Building a Real UI With AI Agents" (2026-10-22).

## Layout

| Folder | What it is |
|---|---|
| `dep-graph-maven-plugin/` | The plugin (goal `dep-graph:graph`, bound to `package`) |
| `demo-project/` | An independent project that uses the plugin: "Zipper", a small Spring Boot + Thymeleaf app where you drop files on a page and download them as one zip |

The two projects are deliberately not a multi-module build: the demo consumes the plugin
the way any other user would, from the local Maven repository.

## Try it

```bash
mvn -f dep-graph-maven-plugin/pom.xml install
mvn -f demo-project/pom.xml package
```

Then open `demo-project/target/dep-graph.html`.

To run the demo app itself on http://localhost:8080:

```bash
mvn -f demo-project/pom.xml spring-boot:run
```

## Using it in a multi-module build

Declare the plugin once, in the root POM of the build:

```xml
<plugin>
    <groupId>dev.rabauer</groupId>
    <artifactId>dep-graph-maven-plugin</artifactId>
    <version>0.1.0-SNAPSHOT</version>
    <executions>
        <execution>
            <goals>
                <goal>graph</goal>
            </goals>
        </execution>
    </executions>
</plugin>
```

The goal runs in every module, but the page is written exactly once, covering every module of the
current reactor. Normally the top-level project writes it, to `target/dep-graph.html` next to the
root POM. With `-pl` or `-rf` the top-level project is not part of the reactor; the last project to
build writes the page instead, still to `target/dep-graph.html` under the directory you started
Maven in. An explicit `-Ddepgraph.outputFile=...` always wins.

## Options

| Option | Default | What it does |
|---|---|---|
| `-Ddepgraph.outputFile=...` | `${project.build.directory}/dep-graph.html` | Where the page is written |
| `-Ddepgraph.checkLatest=false` | `true` | Skips the lookup of the latest released versions |

The latest-version lookup asks the remote repositories for available versions, so it needs network
access. Offline builds (`mvn -o`) skip the lookup automatically, and the page then shows no
"newer version" hints.
