package dev.rabauer.depgraph.collect;

import dev.rabauer.depgraph.model.EdgeStatus;
import dev.rabauer.depgraph.model.GraphModel;
import org.eclipse.aether.artifact.Artifact;
import org.eclipse.aether.graph.Dependency;
import org.eclipse.aether.graph.DependencyNode;
import org.eclipse.aether.util.graph.manager.DependencyManagerUtils;
import org.eclipse.aether.util.graph.transformer.ConflictResolver;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

public final class DependencyGraphMapper {

    private final Set<String> reactorNodeIds;
    private final Map<String, GraphModel.Node> nodes = new LinkedHashMap<>();
    private final List<GraphModel.Edge> edges = new ArrayList<>();
    private final Set<GraphModel.Edge> seenEdges = new HashSet<>();

    public DependencyGraphMapper(Set<String> reactorNodeIds) {
        this.reactorNodeIds = reactorNodeIds;
    }

    public void addModuleGraph(String moduleNodeId, DependencyNode root, ManagedSourceLookup managed) {
        Artifact ra = root.getArtifact();
        nodes.putIfAbsent(moduleNodeId, new GraphModel.Node(moduleNodeId, ra.getGroupId(),
                ra.getArtifactId(), ra.getVersion(), "jar", "", true, null));

        Set<String> visited = new HashSet<>();
        visited.add(moduleNodeId);
        Deque<Pending> stack = new ArrayDeque<>();
        stack.push(new Pending(moduleNodeId, root));
        while (!stack.isEmpty()) {
            Pending current = stack.pop();
            for (DependencyNode child : current.node().getChildren()) {
                visit(moduleNodeId, current.id(), child, managed, visited, stack);
            }
        }
    }

    private void visit(String module, String parentId, DependencyNode child, ManagedSourceLookup managed,
                       Set<String> visited, Deque<Pending> stack) {
        Artifact a = child.getArtifact();
        Dependency dep = child.getDependency();
        String scope = dep == null ? null : dep.getScope();
        boolean optional = dep != null && dep.isOptional();
        String childId = idOf(a);

        Object winnerData = child.getData().get(ConflictResolver.NODE_DATA_WINNER);
        if (winnerData instanceof DependencyNode winner) {
            Artifact wa = winner.getArtifact();
            if (!wa.getVersion().equals(a.getVersion())) {
                addEdge(new GraphModel.Edge(parentId, idOf(wa), module, scope, optional,
                        EdgeStatus.DROPPED, a.getVersion(), null));
                return;
            }
            addEdge(keptOrManaged(parentId, idOf(wa), module, scope, optional, child, managed));
            return;
        }

        addEdge(keptOrManaged(parentId, childId, module, scope, optional, child, managed));
        boolean isModule = reactorNodeIds.contains(childId);
        nodes.computeIfAbsent(childId, id -> new GraphModel.Node(id, a.getGroupId(), a.getArtifactId(),
                a.getVersion(), isModule ? "jar" : a.getExtension(), isModule ? "" : a.getClassifier(),
                isModule, null));
        if (visited.add(childId)) {
            stack.push(new Pending(childId, child));
        }
    }

    private GraphModel.Edge keptOrManaged(String from, String to, String module, String scope, boolean optional,
                                          DependencyNode child, ManagedSourceLookup managed) {
        Artifact a = child.getArtifact();
        String premanaged = DependencyManagerUtils.getPremanagedVersion(child);
        if (premanaged != null && !premanaged.equals(a.getVersion())) {
            String source = managed.sourceOf(a.getGroupId(), a.getArtifactId());
            return new GraphModel.Edge(from, to, module, scope, optional, EdgeStatus.MANAGED, premanaged,
                    source != null ? source : "dependencyManagement");
        }
        return new GraphModel.Edge(from, to, module, scope, optional, EdgeStatus.KEPT, null, null);
    }

    private void addEdge(GraphModel.Edge edge) {
        if (seenEdges.add(edge)) {
            edges.add(edge);
        }
    }

    private String idOf(Artifact a) {
        // A reactor sibling consumed as war/pom/test-jar is still the same module node, so match
        // reactor membership on g:a:v and keep it a single green node.
        String gav = a.getGroupId() + ":" + a.getArtifactId() + ":" + a.getVersion();
        if (reactorNodeIds.contains(gav)) {
            return gav;
        }
        return GraphModel.nodeId(a.getGroupId(), a.getArtifactId(), a.getExtension(), a.getClassifier(),
                a.getVersion());
    }

    public Map<String, GraphModel.Node> nodes() {
        return nodes;
    }

    public List<GraphModel.Edge> edges() {
        return edges;
    }

    private record Pending(String id, DependencyNode node) {}
}
