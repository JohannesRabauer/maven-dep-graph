package dev.rabauer.depgraph.page;

import static org.junit.jupiter.api.Assertions.assertTrue;

import dev.rabauer.depgraph.model.EdgeStatus;
import dev.rabauer.depgraph.model.GraphModel;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Random;
import org.junit.jupiter.api.Test;

/**
 * Writes a page for a reactor at the size the design has to carry, so the result can be opened
 * manually and the inlined page stays within its size budget.
 */
class SyntheticPageTest {

    private static final int MODULES = 300;
    private static final int DRIFT_GAS = 60;
    private static final int EXTERNALS = 4700;
    private static final int EDGES = 15000;
    private static final int DROPPED_EVERY = 375;
    private static final int MANAGED_EVERY = 75;
    private static final long MAX_BYTES = 5L * 1024 * 1024;
    private static final String[] SCOPES = {"compile", "compile", "compile", "runtime", "provided", "test"};

    private static GraphModel syntheticModel() {
        Random random = new Random(42);
        List<GraphModel.Module> modules = new ArrayList<>();
        List<GraphModel.Node> nodes = new ArrayList<>();
        for (int i = 0; i < MODULES; i++) {
            String id = GraphModel.nodeId("com.example.shop", "service-" + i, "jar", "", "3.4.0-SNAPSHOT");
            modules.add(new GraphModel.Module(id, "service-" + i));
            nodes.add(new GraphModel.Node(id, "com.example.shop", "service-" + i, "3.4.0-SNAPSHOT",
                    "jar", "", true, null));
        }

        List<String> externalIds = new ArrayList<>();
        int plainGas = EXTERNALS - DRIFT_GAS;
        for (int i = 0; i < EXTERNALS; i++) {
            // The first DRIFT_GAS group:artifact pairs appear twice, with two different versions.
            int ga = i < plainGas ? i : i - plainGas;
            String groupId = "org.lib" + (ga % 120);
            String artifactId = "lib-" + ga;
            String version = (i < plainGas ? "1." : "2.") + (ga % 17) + ".0";
            String id = GraphModel.nodeId(groupId, artifactId, "jar", "", version);
            GraphModel.Latest latest = i % 7 == 0
                    ? new GraphModel.Latest("1." + ((ga % 17) + 3) + ".0", "4.0.0", true)
                    : new GraphModel.Latest(version, version, false);
            nodes.add(new GraphModel.Node(id, groupId, artifactId, version, "jar", "", false, latest));
            externalIds.add(id);
        }

        List<GraphModel.Edge> edges = new ArrayList<>();
        for (int i = 0; i < EDGES; i++) {
            String module = modules.get(i % MODULES).nodeId();
            String from = i < MODULES * 10 ? module : externalIds.get(random.nextInt(EXTERNALS));
            String to = externalIds.get(random.nextInt(EXTERNALS));
            if (from.equals(to)) {
                continue;
            }
            String scope = SCOPES[random.nextInt(SCOPES.length)];
            boolean optional = i % 23 == 0;
            if (i % DROPPED_EVERY == 0) {
                edges.add(new GraphModel.Edge(from, to, module, scope, optional,
                        EdgeStatus.DROPPED, "0.9.0", null));
            } else if (i % MANAGED_EVERY == 37) {
                edges.add(new GraphModel.Edge(from, to, module, scope, optional,
                        EdgeStatus.MANAGED, "0.8.0", "com.example:platform-bom:4.1.1"));
            } else {
                edges.add(new GraphModel.Edge(from, to, module, scope, optional, EdgeStatus.KEPT, null, null));
            }
        }
        return new GraphModel("shop-platform", modules, nodes, edges);
    }

    @Test
    void writesLargePageWithinSizeBudget() throws IOException {
        Path out = Path.of("target", "synthetic-dep-graph.html");
        Files.createDirectories(out.getParent());
        String html = HtmlPageWriter.render(syntheticModel());
        Files.writeString(out, html, StandardCharsets.UTF_8);

        assertTrue(Files.exists(out), "page was not written");
        long size = Files.size(out);
        assertTrue(size < MAX_BYTES, "page is " + size + " bytes, over the " + MAX_BYTES + " byte budget");
    }
}
