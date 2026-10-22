package dev.rabauer.depgraph.model;

import java.util.List;
import java.util.function.BiConsumer;

public final class JsonWriter {

    private JsonWriter() {}

    public static String toJson(GraphModel m) {
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
        key(sb, "edges");
        array(sb, m.edges(), (b, x) -> {
            b.append('{');
            key(b, "from").append(str(x.from())).append(',');
            key(b, "to").append(str(x.to())).append(',');
            key(b, "module").append(str(x.module())).append(',');
            key(b, "scope").append(str(x.scope())).append(',');
            key(b, "optional").append(x.optional()).append(',');
            key(b, "status").append(str(x.status() == null ? null : x.status().name())).append(',');
            key(b, "requestedVersion").append(str(x.requestedVersion())).append(',');
            key(b, "managedBy").append(str(x.managedBy()));
            b.append('}');
        });
        sb.append('}');
        return sb.toString();
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
