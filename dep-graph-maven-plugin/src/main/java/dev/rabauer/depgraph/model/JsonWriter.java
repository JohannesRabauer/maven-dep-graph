package dev.rabauer.depgraph.model;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.BiConsumer;

public final class JsonWriter {

    /** Bit set on an edge's {@code flags} when the dependency is optional. */
    private static final int OPTIONAL_FLAG = 4;

    private JsonWriter() {}

    public static String toJson(GraphModel m) {
        Table ids = new Table();
        for (GraphModel.Node n : m.nodes()) {
            ids.indexOf(n.id());
        }
        int knownIds = ids.size();
        Table moduleIds = new Table();
        for (GraphModel.Module mod : m.modules()) {
            moduleIds.indexOf(mod.nodeId());
        }
        Table scopes = new Table();
        Table versions = new Table();
        Table managedBys = new Table();

        // Edges reference the node, module and string tables by index: repeating the full
        // coordinates on every edge costs about ten times as much on a large reactor.
        StringBuilder edges = new StringBuilder();
        array(edges, m.edges(), (b, x) -> {
            int flags = (x.status() == null ? 0 : x.status().ordinal()) | (x.optional() ? OPTIONAL_FLAG : 0);
            int requested = versions.indexOrMinusOne(x.requestedVersion());
            int managedBy = managedBys.indexOrMinusOne(x.managedBy());
            b.append('[').append(ids.indexOf(x.from())).append(',').append(ids.indexOf(x.to()))
                    .append(',').append(moduleIds.indexOf(x.module()))
                    .append(',').append(scopes.indexOrMinusOne(x.scope()))
                    .append(',').append(flags);
            if (managedBy >= 0) {
                b.append(',').append(requested).append(',').append(managedBy);
            } else if (requested >= 0) {
                b.append(',').append(requested);
            }
            b.append(']');
        });

        StringBuilder sb = new StringBuilder();
        sb.append('{');
        key(sb, "title").append(str(m.title())).append(',');
        key(sb, "modules");
        array(sb, m.modules(), (b, x) -> {
            b.append('{');
            key(b, "nodeId").append(str(x.nodeId())).append(',');
            key(b, "name").append(str(x.name()));
            b.append('}');
        });
        sb.append(',');
        key(sb, "nodes");
        array(sb, m.nodes(), (b, x) -> {
            b.append('{');
            key(b, "id").append(str(x.id())).append(',');
            key(b, "groupId").append(str(x.groupId())).append(',');
            key(b, "artifactId").append(str(x.artifactId())).append(',');
            key(b, "version").append(str(x.version())).append(',');
            key(b, "type").append(str(x.type())).append(',');
            key(b, "classifier").append(str(x.classifier())).append(',');
            key(b, "module").append(x.module()).append(',');
            key(b, "latest");
            GraphModel.Latest l = x.latest();
            if (l == null) {
                b.append("null");
            } else {
                b.append('{');
                key(b, "latestSameMajor").append(str(l.latestSameMajor())).append(',');
                key(b, "latestOverall").append(str(l.latestOverall())).append(',');
                key(b, "newerInSameMajor").append(l.newerInSameMajor());
                b.append('}');
            }
            b.append('}');
        });
        sb.append(',');
        // Edge endpoints that no node carries, indexed behind the node ids.
        key(sb, "extraIds");
        strings(sb, ids.values().subList(knownIds, ids.size()));
        sb.append(',');
        key(sb, "scopeNames");
        strings(sb, scopes.values());
        sb.append(',');
        key(sb, "statusNames");
        strings(sb, java.util.Arrays.stream(EdgeStatus.values()).map(Enum::name).toList());
        sb.append(',');
        key(sb, "versions");
        strings(sb, versions.values());
        sb.append(',');
        key(sb, "managedBys");
        strings(sb, managedBys.values());
        sb.append(',');
        key(sb, "edges").append(edges);
        sb.append('}');
        return sb.toString();
    }

    /** Insertion-ordered string table; {@code null} never gets an index. */
    private static final class Table {

        private final Map<String, Integer> indices = new LinkedHashMap<>();

        int indexOf(String value) {
            return indices.computeIfAbsent(value, v -> indices.size());
        }

        int indexOrMinusOne(String value) {
            return value == null ? -1 : indexOf(value);
        }

        int size() {
            return indices.size();
        }

        List<String> values() {
            return new ArrayList<>(indices.keySet());
        }
    }

    private static void strings(StringBuilder sb, List<String> values) {
        array(sb, values, (b, x) -> b.append(str(x)));
    }

    private static StringBuilder key(StringBuilder sb, String name) {
        return sb.append('"').append(name).append("\":");
    }

    private static <T> void array(StringBuilder sb, List<T> items, BiConsumer<StringBuilder, T> each) {
        sb.append('[');
        boolean first = true;
        for (T item : items) {
            if (!first) {
                sb.append(',');
            }
            first = false;
            each.accept(sb, item);
        }
        sb.append(']');
    }

    private static String str(String s) {
        if (s == null) {
            return "null";
        }
        StringBuilder sb = new StringBuilder(s.length() + 2).append('"');
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"' -> sb.append("\\\"");
                case '\\' -> sb.append("\\\\");
                case '\n' -> sb.append("\\n");
                case '\r' -> sb.append("\\r");
                case '\t' -> sb.append("\\t");
                default -> {
                    if (c < 0x20) {
                        sb.append(String.format("\\u%04x", (int) c));
                    } else {
                        sb.append(c);
                    }
                }
            }
        }
        return sb.append('"').toString();
    }
}
