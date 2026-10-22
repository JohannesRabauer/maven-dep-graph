package dev.rabauer.depgraph.page;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import dev.rabauer.depgraph.model.GraphModel;
import dev.rabauer.depgraph.model.JsonWriter;
import java.io.IOException;
import java.util.List;
import org.junit.jupiter.api.Test;

class HtmlPageWriterTest {

    private static final String DATA_OPEN = "id=\"dep-graph-data\">";

    private static GraphModel model(String title, String artifactId) {
        GraphModel.Node node = new GraphModel.Node("g:" + artifactId + ":1", "g", artifactId, "1", "jar", "", true, null);
        return new GraphModel(title, List.of(new GraphModel.Module(node.id(), artifactId)), List.of(node), List.of());
    }

    private static int count(String s, String needle) {
        int n = 0;
        for (int i = s.indexOf(needle); i >= 0; i = s.indexOf(needle, i + 1)) {
            n++;
        }
        return n;
    }

    @Test
    void inlinesEverythingNoExternalRefs() throws IOException {
        String html = HtmlPageWriter.render(model("t", "a"));
        assertFalse(html.contains("src=\"http"));
        assertFalse(html.contains("href=\"http"));
        assertFalse(html.contains("@import url("));
        assertTrue(html.contains("cytoscape"));
        assertTrue(html.contains(DATA_OPEN));
    }

    @Test
    void escapesScriptCloseInData() throws IOException {
        GraphModel m = model("t", "x</script><b>");
        String html = HtmlPageWriter.render(m);
        int start = html.indexOf(DATA_OPEN) + DATA_OPEN.length();
        String block = html.substring(start, html.indexOf("</script>", start));
        assertTrue(block.contains("x<\\/script><b>"));
        assertFalse(block.contains("</script"));
        assertEquals(JsonWriter.toJson(m), block.replace("<\\/", "</"));
    }

    @Test
    void escapesTitle() throws IOException {
        String html = HtmlPageWriter.render(model("a<b&c", "a"));
        assertTrue(html.contains("<title>Dependency Graph: a&lt;b&amp;c</title>"));
    }

    @Test
    void scriptCloseCountMatchesTemplateScriptTags() throws IOException {
        String html = HtmlPageWriter.render(model("t", "x</script><b>"));
        assertEquals(4, count(html, "<script"));
        assertEquals(4, count(html, "</script>"));
        assertEquals(0, count(html.toLowerCase(), "</script ") + count(html.toLowerCase(), "</script/"));
    }

    @Test
    void placeholdersInDataAreNotRescanned() throws IOException {
        String html = HtmlPageWriter.render(model("{{DATA}} $1 \\", "/*{{APP}}*/"));
        assertTrue(html.contains("<title>Dependency Graph: {{DATA}} $1 \\</title>"));
        assertTrue(html.contains("/*{{APP}}*/"));
    }
}
