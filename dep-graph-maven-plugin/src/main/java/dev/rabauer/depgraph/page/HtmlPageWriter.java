package dev.rabauer.depgraph.page;

import dev.rabauer.depgraph.model.GraphModel;
import dev.rabauer.depgraph.model.JsonWriter;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Renders the single-file, offline HTML page. */
public final class HtmlPageWriter {

    private static final String BASE = "/dev/rabauer/depgraph/page/";
    private static final Pattern SCRIPT_CLOSE = Pattern.compile("</script", Pattern.CASE_INSENSITIVE);
    private static final List<String> PLACEHOLDERS =
            List.of("{{TITLE}}", "/*{{CSS}}*/", "/*{{VENDOR}}*/", "/*{{MODEL}}*/", "/*{{APP}}*/", "{{DATA}}");

    private HtmlPageWriter() {}

    public static String render(GraphModel m) throws IOException {
        String template = resource("template.html");
        String vendor = String.join(";\n",
                resource("vendor/cytoscape.min.js"),
                resource("vendor/dagre.min.js"),
                resource("vendor/cytoscape-dagre.js"));
        String[] values = {
                escapeHtml(m.title()),
                resource("app.css"),
                escapeScript(vendor),
                escapeScript(resource("graph-model.js")),
                escapeScript(resource("app.js")),
                JsonWriter.toJson(m).replace("</", "<\\/")
        };

        // Single pass over the original template so inserted content is never re-scanned.
        StringBuilder out = new StringBuilder(template.length() + 1024);
        int pos = 0;
        while (true) {
            int next = -1;
            int which = -1;
            for (int i = 0; i < PLACEHOLDERS.size(); i++) {
                int idx = template.indexOf(PLACEHOLDERS.get(i), pos);
                if (idx >= 0 && (next < 0 || idx < next)) {
                    next = idx;
                    which = i;
                }
            }
            if (next < 0) {
                break;
            }
            out.append(template, pos, next).append(values[which]);
            pos = next + PLACEHOLDERS.get(which).length();
        }
        out.append(template, pos, template.length());
        return out.toString();
    }

    private static String escapeScript(String js) {
        return SCRIPT_CLOSE.matcher(js).replaceAll(r -> Matcher.quoteReplacement("<\\/" + r.group().substring(2)));
    }

    private static String escapeHtml(String s) {
        return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;");
    }

    private static String resource(String name) throws IOException {
        try (InputStream in = HtmlPageWriter.class.getResourceAsStream(BASE + name)) {
            if (in == null) {
                throw new IOException("Missing resource " + BASE + name);
            }
            return new String(in.readAllBytes(), StandardCharsets.UTF_8);
        }
    }
}
