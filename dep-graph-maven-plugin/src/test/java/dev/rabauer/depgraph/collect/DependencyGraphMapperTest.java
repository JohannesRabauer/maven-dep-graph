package dev.rabauer.depgraph.collect;

import dev.rabauer.depgraph.model.EdgeStatus;
import dev.rabauer.depgraph.model.GraphModel;
import dev.rabauer.depgraph.model.GraphModel.Edge;
import org.eclipse.aether.artifact.DefaultArtifact;
import org.eclipse.aether.graph.DefaultDependencyNode;
import org.eclipse.aether.graph.Dependency;
import org.eclipse.aether.graph.DependencyNode;
import org.eclipse.aether.util.graph.manager.DependencyManagerUtils;
import org.eclipse.aether.util.graph.transformer.ConflictResolver;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;

class DependencyGraphMapperTest {

    private static final ManagedSourceLookup NONE = (g, a) -> null;

    private static DefaultDependencyNode node(String g, String a, String v) {
        return new DefaultDependencyNode(new Dependency(new DefaultArtifact(g, a, "jar", v), "compile"));
    }

    private static DefaultDependencyNode root(String g, String a, String v) {
        return new DefaultDependencyNode(new DefaultArtifact(g, a, "jar", v));
    }

    private static void children(DependencyNode parent, DependencyNode... kids) {
        parent.setChildren(List.of(kids));
    }

    @Test
    void keptEdgeFromModuleRoot() {
        DefaultDependencyNode root = root("m", "m1", "1");
        children(root, node("g", "a", "1"));
        DependencyGraphMapper mapper = new DependencyGraphMapper(Set.of());
        mapper.addModuleGraph("m:m1:1", root, NONE);
        assertEquals(List.of(new Edge("m:m1:1", "g:a:1", "m:m1:1", "compile", false,
                EdgeStatus.KEPT, null, null)), mapper.edges());
    }

    @Test
    void droppedEdgePointsToWinnerWithRequestedVersion() {
        DefaultDependencyNode root = root("m", "m1", "1");
        DefaultDependencyNode winner = node("x", "y", "2.0");
        DefaultDependencyNode loser = node("x", "y", "1.0");
        loser.setData(Map.of(ConflictResolver.NODE_DATA_WINNER, winner));
        children(root, loser, winner);
        DependencyGraphMapper mapper = new DependencyGraphMapper(Set.of());
        mapper.addModuleGraph("m:m1:1", root, NONE);
        Edge dropped = mapper.edges().get(0);
        assertEquals("x:y:2.0", dropped.to());
        assertEquals(EdgeStatus.DROPPED, dropped.status());
        assertEquals("1.0", dropped.requestedVersion());
        assertFalse(mapper.nodes().containsKey("x:y:1.0"));
        assertTrue(mapper.nodes().containsKey("x:y:2.0"));
    }

    @Test
    void sameVersionLoserIsKeptNotDropped() {
        DefaultDependencyNode root = root("m", "m1", "1");
        DefaultDependencyNode winner = node("x", "y", "2.0");
        DefaultDependencyNode loser = node("x", "y", "2.0");
        loser.setData(Map.of(ConflictResolver.NODE_DATA_WINNER, winner));
        children(root, loser, winner);
        DependencyGraphMapper mapper = new DependencyGraphMapper(Set.of());
        mapper.addModuleGraph("m:m1:1", root, NONE);
        assertEquals(List.of(new Edge("m:m1:1", "x:y:2.0", "m:m1:1", "compile", false,
                EdgeStatus.KEPT, null, null)), mapper.edges());
    }

    private static DependencyGraphMapper managed(ManagedSourceLookup lookup) {
        DefaultDependencyNode root = root("m", "m1", "1");
        DefaultDependencyNode c = node("org.apache.commons", "commons-lang3", "3.17.0");
        c.setData(Map.of(DependencyManagerUtils.NODE_DATA_PREMANAGED_VERSION, "3.14.0"));
        c.setManagedBits(DependencyNode.MANAGED_VERSION);
        children(root, c);
        DependencyGraphMapper mapper = new DependencyGraphMapper(Set.of());
        mapper.addModuleGraph("m:m1:1", root, lookup);
        return mapper;
    }

    @Test
    void managedEdgeCarriesPremanagedVersionAndSource() {
        String src = "org.springframework.boot:spring-boot-dependencies:4.1.1";
        Edge e = managed((g, a) -> src).edges().get(0);
        assertEquals(EdgeStatus.MANAGED, e.status());
        assertEquals("3.14.0", e.requestedVersion());
        assertEquals(src, e.managedBy());
    }

    @Test
    void managedSourceFallsBackToDependencyManagement() {
        assertEquals("dependencyManagement", managed(NONE).edges().get(0).managedBy());
    }

    @Test
    void siblingModuleIsSameNodeAndFlaggedModule() {
        DefaultDependencyNode r1 = root("m", "m1", "1");
        children(r1, node("m", "m2", "1"));
        DefaultDependencyNode r2 = root("m", "m2", "1");
        DependencyGraphMapper mapper = new DependencyGraphMapper(Set.of("m:m1:1", "m:m2:1"));
        mapper.addModuleGraph("m:m1:1", r1, NONE);
        mapper.addModuleGraph("m:m2:1", r2, NONE);
        assertTrue(mapper.nodes().get("m:m2:1").module());
        assertEquals(2, mapper.nodes().size());
    }

    @Test
    void siblingConsumedAsWarCollapsesIntoTheModuleNode() {
        DefaultDependencyNode r1 = root("m", "m1", "1");
        DefaultDependencyNode war =
                new DefaultDependencyNode(new Dependency(new DefaultArtifact("m", "m2", "war", "1"), "compile"));
        children(r1, war);
        DependencyGraphMapper mapper = new DependencyGraphMapper(Set.of("m:m1:1", "m:m2:1"));
        mapper.addModuleGraph("m:m1:1", r1, NONE);
        mapper.addModuleGraph("m:m2:1", root("m", "m2", "1"), NONE);
        assertEquals(2, mapper.nodes().size());
        assertTrue(mapper.nodes().get("m:m2:1").module());
        assertEquals("jar", mapper.nodes().get("m:m2:1").type());
        assertEquals(List.of("m:m2:1"), mapper.edges().stream().map(Edge::to).toList());
    }

    @Test
    void moduleRootIsNode() {
        DefaultDependencyNode root = root("m", "agg", "1");
        DependencyGraphMapper mapper = new DependencyGraphMapper(Set.of("m:agg:1"));
        mapper.addModuleGraph("m:agg:1", root, NONE);
        assertEquals(new GraphModel.Node("m:agg:1", "m", "agg", "1", "jar", "", true, null),
                mapper.nodes().get("m:agg:1"));
        assertEquals(1, mapper.nodes().size());
    }

    @Test
    void sharedNodeHasEdgesPerModule() {
        DependencyGraphMapper mapper = new DependencyGraphMapper(Set.of());
        for (String m : List.of("m1", "m2")) {
            DefaultDependencyNode r = root("m", m, "1");
            children(r, node("g", "a", "1"));
            mapper.addModuleGraph("m:" + m + ":1", r, NONE);
        }
        assertEquals(3, mapper.nodes().size());
        assertEquals(List.of("m:m1:1", "m:m2:1"), mapper.edges().stream().map(Edge::module).toList());
    }

    @Test
    void cycleDoesNotRecurseForever() {
        DefaultDependencyNode root = root("m", "m1", "1");
        DefaultDependencyNode a = node("g", "a", "1");
        DefaultDependencyNode b = node("g", "b", "1");
        children(root, a);
        children(a, b);
        children(b, a);
        DependencyGraphMapper mapper = new DependencyGraphMapper(Set.of());
        mapper.addModuleGraph("m:m1:1", root, NONE);
        assertEquals(3, mapper.edges().size());
        assertEquals(3, Set.copyOf(mapper.edges()).size());
    }
}
