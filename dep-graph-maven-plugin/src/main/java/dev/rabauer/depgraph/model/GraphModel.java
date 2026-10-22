package dev.rabauer.depgraph.model;

import java.util.List;

public record GraphModel(String title, List<Module> modules, List<Node> nodes, List<Edge> edges) {

    public static String nodeId(String g, String a, String type, String classifier, String v) {
        boolean plain = "jar".equals(type) && (classifier == null || classifier.isEmpty());
        return plain ? g + ":" + a + ":" + v : g + ":" + a + ":" + type + ":" + classifier + ":" + v;
    }

    public record Module(String nodeId, String name) {}

    public record Node(String id, String groupId, String artifactId, String version,
                       String type, String classifier, boolean module, Latest latest) {}

    /** A null {@code latest} on a node means "not checked". */
    public record Latest(String latestSameMajor, String latestOverall, boolean newerInSameMajor) {}

    public record Edge(String from, String to, String module, String scope, boolean optional,
                       EdgeStatus status, String requestedVersion, String managedBy) {}
}
