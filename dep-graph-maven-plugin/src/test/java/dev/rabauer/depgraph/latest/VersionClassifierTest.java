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
                "5.0.0.CR1", "1.0.0-preview", "2.0-beta", "21-ea", "1.0.dev3", "2.0-b01", "1.0-pre1",
                "1.0.Beta1", "8.0-milestone-1", "1.0-nightly", "1.0-canary")) {
            assertFalse(VersionClassifier.isStable(v), v);
        }
        for (String v : List.of("2.19.2", "1.2.3.Final", "1.0-sources", "33.0.0-jre", "33.0.0-android",
                "1.5.0-jdk11")) {
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
    void variantIsTheSuffixAfterTheNumbers() {
        assertEquals("-jre", VersionClassifier.variant("33.0.0-jre"));
        assertEquals("-android", VersionClassifier.variant("33.3.1-android"));
        assertEquals("-jdk11", VersionClassifier.variant("1.5.0-jdk11"));
        assertEquals("", VersionClassifier.variant("2.19.2"));
        assertEquals("", VersionClassifier.variant("20040616"));
    }

    @Test
    void variantNormalisesReleaseMarkers() {
        assertEquals("", VersionClassifier.variant("6.4.4.Final"));
        assertEquals("", VersionClassifier.variant("5.2.9.RELEASE"));
        assertEquals("", VersionClassifier.variant("1.0.GA"));
        assertEquals("", VersionClassifier.variant("1.2.3-1"));
        assertEquals("", VersionClassifier.variant("3.0.0-RC1"));
    }

    @Test
    void classifyStaysInVariant() {
        List<String> guava = List.of("33.0.0-android", "33.0.0-jre", "33.0.1-android", "34.0.0-android");
        assertEquals(new Latest("33.0.0-jre", "33.0.0-jre", false), VersionClassifier.classify("33.0.0-jre", guava));
    }

    @Test
    void classifyCrossesReleaseMarker() {
        assertEquals(new Latest("5.3.39", "5.3.39", true),
                VersionClassifier.classify("5.2.9.RELEASE", List.of("5.2.9.RELEASE", "5.3.39")));
        assertEquals(new Latest("6.6.1.Final", "7.0.0.Final", true),
                VersionClassifier.classify("6.4.4.Final", List.of("6.4.4.Final", "6.6.1.Final", "7.0.0.Final")));
    }

    @Test
    void classifyUnstableCurrentUsesPlainVariant() {
        assertEquals(new Latest("3.0.2", "3.0.2", true), VersionClassifier.classify("3.0.0-RC1", VERSIONS));
    }

    @Test
    void classifyKeepsVPrefixedAndDatedVersionsInOneVariant() {
        assertEquals(new Latest("v1.3", "v1.3", true), VersionClassifier.classify("v1.2", List.of("v1.2", "v1.3")));
        assertEquals(new Latest("1.0.1.v20220101", "1.0.1.v20220101", true),
                VersionClassifier.classify("1.0.0.v20210101", List.of("1.0.0.v20210101", "1.0.1.v20220101")));
    }

    @Test
    void variantOfPreReleaseKeepsPlatformSuffix() {
        assertEquals("-jre", VersionClassifier.variant("33.0.0-jre-SNAPSHOT"));
        assertEquals("-android", VersionClassifier.variant("33.0.0-android-rc1"));
        assertEquals("", VersionClassifier.variant("3.0.0.CR1"));
        assertEquals("-jre", VersionClassifier.variant("33.0.0-RC1-jre"));
        assertEquals("", VersionClassifier.variant("3.0.0RC1"));
        assertEquals("", VersionClassifier.variant("8.0-milestone-1"));
    }

    @Test
    void classifyPreReleaseWithoutSeparatorSeesRelease() {
        assertEquals(new Latest("3.0.2", "3.0.2", true), VersionClassifier.classify("3.0.0RC1", List.of("3.0.2")));
    }

    @Test
    void classifyPreReleaseBeforePlatformSuffixStaysInVariant() {
        assertEquals(new Latest("33.0.1-jre", "33.0.1-jre", true),
                VersionClassifier.classify("33.0.0-RC1-jre", List.of("33.0.1", "33.0.1-jre")));
    }

    @Test
    void classifyPreReleaseWithPlatformSuffixStaysInVariant() {
        assertEquals(new Latest("33.0.1-jre", "33.0.1-jre", true),
                VersionClassifier.classify("33.0.0-jre-SNAPSHOT", List.of("33.0.1", "33.0.1-jre")));
    }

    @Test
    void classifyNullIsNotChecked() {
        assertNull(VersionClassifier.classify("1.0", null));
    }
}
