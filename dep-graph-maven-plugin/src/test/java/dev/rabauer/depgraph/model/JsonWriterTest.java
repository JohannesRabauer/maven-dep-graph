package dev.rabauer.depgraph.model;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import org.junit.jupiter.api.Test;

class JsonWriterTest {

    private static GraphModel model(String title, GraphModel.Latest latest, EdgeStatus status) {
        GraphModel.Node node = new GraphModel.Node("g:a:1", "g", "a", "1", "jar", "", true, latest);
        GraphModel.Edge edge = new GraphModel.Edge("g:a:1", "g:b:2", "g:a:1", "compile", false,
                status, status == EdgeStatus.KEPT ? null : "3", null);
        return new GraphModel(title, List.of(new GraphModel.Module("g:a:1", "a")), List.of(node), List.of(edge));
    }

    @Test
    void nodeIdOmitsDefaultJarType() {
        assertEquals("g:a:1", GraphModel.nodeId("g", "a", "jar", "", "1"));
        assertEquals("g:a:test-jar:tests:1", GraphModel.nodeId("g", "a", "test-jar", "tests", "1"));
    }

    @Test
    void serializesNullLatestAsNull() {
        assertTrue(JsonWriter.toJson(model("t", null, EdgeStatus.KEPT)).contains("\"latest\":null"));
    }

    @Test
    void escapesControlAndQuotes() {
        String json = JsonWriter.toJson(model("a\"b\\c\n", null, EdgeStatus.KEPT));
        assertTrue(json.contains("\"a\\\"b\\\\c\\n\""), json);
        assertTrue(JsonWriter.toJson(model("\u0001", null, EdgeStatus.KEPT)).contains("\"\\u0001\""));
    }

    @Test
    void enumsAsNames() {
        assertTrue(JsonWriter.toJson(model("t", null, EdgeStatus.DROPPED)).contains("\"status\":\"DROPPED\""));
    }
}
