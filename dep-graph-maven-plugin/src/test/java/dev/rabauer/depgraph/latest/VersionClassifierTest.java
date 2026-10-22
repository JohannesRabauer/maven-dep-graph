package dev.rabauer.depgraph.latest;

import dev.rabauer.depgraph.model.GraphModel.Latest;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class VersionClassifierTest {

    private static final List<String> VERSIONS = List.of("2.17.0", "2.19.2", "2.20.1", "3.0.2");

    @Test
    void isStable() {
        for (String v : List.of("2.0.0-SNAPSHOT", "1.0.0-alpha1", "3.0.0-M2", "3.0.0-RC1",
                "5.0.0.CR1", "1.0.0-preview", "2.0-beta")) {
            assertFalse(VersionClassifier.isStable(v), v);
        }
        for (String v : List.of("2.19.2", "1.2.3.Final", "1.0-sources")) {
            assertTrue(VersionClassifier.isStable(v), v);
        }
    }

    @Test
    void majorIsLeadingDigits() {
        assertEquals("2", VersionClassifier.major("2.19.2"));
        assertEquals("", VersionClassifier.major("x1"));
    }

    @Test
    void classifyPicksSameMajorAndOverall() {
        assertEquals(new Latest("2.20.1", "3.0.2", true), VersionClassifier.classify("2.19.2", VERSIONS));
    }

    @Test
    void classifyUpToDate() {
        assertEquals(new Latest("3.0.2", "3.0.2", false), VersionClassifier.classify("3.0.2", VERSIONS));
    }

    @Test
    void classifyNullIsNotChecked() {
        assertNull(VersionClassifier.classify("1.0", null));
    }
}
