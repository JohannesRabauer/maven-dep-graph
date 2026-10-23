package dev.rabauer.depgraph.page;

import static org.junit.jupiter.api.Assertions.assertTrue;

import dev.rabauer.depgraph.model.EdgeStatus;
import dev.rabauer.depgraph.model.GraphModel;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Test;

/**
 * Writes a page for a reactor at the size the design has to carry, so the result can be opened
 * manually and the inlined page stays within its size budget.
 *
 * <p>The shape is what a large corporate reactor really looks like: a layered shared library stack
 * that every module pulls in, plus sibling-module dependencies, and each module carries its
 * <em>full transitive closure</em> rather than a handful of direct edges. Everything is derived
 * from the indices, so the generated model is byte-for-byte reproducible.
 */
class SyntheticPageTest {

    private static final int MODULES = 300;
    /** Library layer sizes, leaves first; layer l only depends on layer l-1. */
    private static final int[] LAYERS = {2000, 1200, 800, 500, 200};
    private static final int FANOUT = 2;
    /** Leaf libraries below this index exist twice, in two versions, so the page shows drift. */
    private static final int DRIFT_GAS = 60;
    private static final int TOP_PER_MODULE = 3;
    private static final int MID_PER_MODULE = 2;
    private static final int DROPPED_EVERY = 375;
    private static final int MANAGED_EVERY = 75;
    private static final long MAX_BYTES = 5L * 1024 * 1024;
    private static final String[] SCOPES = {"compile", "compile", "compile", "runtime", "provided", "test"};

    private static String moduleId(int i) {
        return GraphModel.nodeId("com.example.shop", "service-" + i, "jar", "", "3.4.0-SNAPSHOT");
    }

    private static String libId(int layer, int index, int variant) {
        return GraphModel.nodeId("org.lib" + (layer * 100 + index % 97), "lib-" + layer + "-" + index,
                "jar", "", (variant == 0 ? "1." : "2.") + (index % 17) + ".0");
    }

    /** Leaf libraries alternate between their two versions depending on who pulls them in. */
    private static int variantOf(int layer, int index, int parentIndex) {
        return layer == 0 && index < DRIFT_GAS ? parentIndex % 2 : 0;
    }

    private record Synthetic(GraphModel model, int artifacts) {}

    private static Synthetic syntheticModel() {
        List<GraphModel.Module> modules = new ArrayList<>();
        List<GraphModel.Node> nodes = new ArrayList<>();
        Map<String, List<String>> children = new HashMap<>();

        for (int i = 0; i < MODULES; i++) {
            String id = moduleId(i);
            modules.add(new GraphModel.Module(id, "service-" + i));
            nodes.add(new GraphModel.Node(id, "com.example.shop", "service-" + i, "3.4.0-SNAPSHOT",
                    "jar", "", true, null));
        }

        for (int layer = 0; layer < LAYERS.length; layer++) {
            for (int i = 0; i < LAYERS[layer]; i++) {
                int variants = layer == 0 && i < DRIFT_GAS ? 2 : 1;
                for (int variant = 0; variant < variants; variant++) {
                    String id = libId(layer, i, variant);
                    String version = (variant == 0 ? "1." : "2.") + (i % 17) + ".0";
                    GraphModel.Latest latest = (layer + i) % 7 == 0
                            ? new GraphModel.Latest("1." + ((i % 17) + 3) + ".0", "4.0.0", true)
                            : new GraphModel.Latest(version, version, false);
                    nodes.add(new GraphModel.Node(id, "org.lib" + (layer * 100 + i % 97),
                            "lib-" + layer + "-" + i, version, "jar", "", false, latest));
                    List<String> kids = new ArrayList<>(FANOUT);
                    for (int k = 0; layer > 0 && k < FANOUT; k++) {
                        int j = (i * FANOUT + k * 7 + layer) % LAYERS[layer - 1];
                        kids.add(libId(layer - 1, j, variantOf(layer - 1, j, i)));
                    }
                    children.put(id, kids);
                }
            }
        }

        int top = LAYERS.length - 1;
        for (int i = 0; i < MODULES; i++) {
            List<String> kids = new ArrayList<>();
            for (int k = 0; k < TOP_PER_MODULE; k++) {
                int j = (i * TOP_PER_MODULE + k) % LAYERS[top];
                kids.add(libId(top, j, 0));
            }
            for (int k = 0; k < MID_PER_MODULE; k++) {
                int j = (i * MID_PER_MODULE + k) % LAYERS[top - 1];
                kids.add(libId(top - 1, j, 0));
            }
            // Siblings always point forward, so the reactor stays acyclic.
            for (int k = 0; k <= i % 2; k++) {
                int j = i + 50 + k * 37;
                if (j < MODULES) {
                    kids.add(moduleId(j));
                }
            }
            children.put(moduleId(i), kids);
        }

        List<GraphModel.Edge> edges = new ArrayList<>();
        for (int i = 0; i < MODULES; i++) {
            String module = moduleId(i);
            int n = 0;
            Set<String> seen = new HashSet<>();
            Deque<String> queue = new ArrayDeque<>();
            seen.add(module);
            queue.add(module);
            while (!queue.isEmpty()) {
                String from = queue.poll();
                for (String to : children.get(from)) {
                    String scope = SCOPES[(n + i) % SCOPES.length];
                    boolean optional = n % 23 == 0;
                    if (n % DROPPED_EVERY == 0) {
                        edges.add(new GraphModel.Edge(from, to, module, scope, optional,
                                EdgeStatus.DROPPED, "0.9.0", null));
                    } else if (n % MANAGED_EVERY == 37) {
                        edges.add(new GraphModel.Edge(from, to, module, scope, optional,
                                EdgeStatus.MANAGED, "0.8.0", "com.example:platform-bom:4.1.1"));
                    } else {
                        edges.add(new GraphModel.Edge(from, to, module, scope, optional,
                                EdgeStatus.KEPT, null, null));
                    }
                    n++;
                    if (seen.add(to)) {
                        queue.add(to);
                    }
                }
            }
        }
        return new Synthetic(new GraphModel("shop-platform", modules, nodes, edges), nodes.size() - MODULES);
    }

    @Test
    void writesLargePageWithinSizeBudget() throws IOException {
        Synthetic synthetic = syntheticModel();
        GraphModel model = synthetic.model();
        assertTrue(synthetic.artifacts() > 4500 && synthetic.artifacts() < 5000,
                "expected about 4700 artifacts, got " + synthetic.artifacts());
        assertTrue(model.edges().size() > 50_000,
                "a realistic closure should be far larger than the direct edges, got " + model.edges().size());

        Path out = Path.of("target", "synthetic-dep-graph.html");
        Files.createDirectories(out.getParent());
        String html = HtmlPageWriter.render(model);
        Files.writeString(out, html, StandardCharsets.UTF_8);

        long size = Files.size(out);
        System.out.println("[synthetic] modules=" + model.modules().size()
                + " artifacts=" + synthetic.artifacts()
                + " nodes=" + model.nodes().size()
                + " edges=" + model.edges().size()
                + " pageBytes=" + size
                + " (" + String.format("%.2f", size / (1024.0 * 1024.0)) + " MiB)");
        assertTrue(size < MAX_BYTES, "page is " + size + " bytes, over the " + MAX_BYTES + " byte budget");
    }
}
